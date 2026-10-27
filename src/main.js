'use strict';

/**
 * Processo principal do Electron.
 *
 * Regras de interface:
 *  - uma unica janela; nenhuma outra e aberta pela ferramenta;
 *  - o navegador do sistema oficial e aberto pelo Playwright, nao pelo Electron;
 *  - nenhuma janela de console ou de dialogo nativo extra.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Garante uma unica instancia: duas janelas confundiriam o operador.
const bloqueioDeInstancia = app.requestSingleInstanceLock();
if (!bloqueioDeInstancia) {
  app.quit();
}

let janelaPrincipal = null;

// Estado da ultima extracao. Fica SO em memoria, nunca em disco.
const estado = {
  ultimoResultado: null,
  preenchimentoEmAndamento: false,
};

function criarJanela() {
  janelaPrincipal = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 860,
    minHeight: 640,
    show: false,
    backgroundColor: '#f5f7f9',
    title: 'Preenchimento de Requisições de Exame',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  janelaPrincipal.setMenuBarVisibility(false);
  janelaPrincipal.loadFile(path.join(__dirname, 'interface', 'index.html'));

  janelaPrincipal.once('ready-to-show', () => {
    janelaPrincipal.show();
  });
}

app.on('second-instance', () => {
  if (janelaPrincipal) {
    if (janelaPrincipal.isMinimized()) janelaPrincipal.restore();
    janelaPrincipal.focus();
  }
});

app.whenReady().then(() => {
  criarJanela();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      criarJanela();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// ---------------------------------------------------------------- IPC

/**
 * Envia atualizacao de andamento para a interface, se ela existir.
 */
function avisar(canal, payload) {
  if (janelaPrincipal && !janelaPrincipal.isDestroyed()) {
    janelaPrincipal.webContents.send(canal, payload);
  }
}

/** Executa tarefas pesadas sem travar a interface. */
function registrarPontes() {
  const config = require('./nucleo/config');
  const registro = require('./nucleo/registro');
  const extracao = require('./extracao');
  const scanner = require('./captura/scanner');
  const preenchimento = require('./preenchimento/index');
  const { ErroDePreenchimento, ErroDeConfiguracao } = require('./preenchimento/erros');

  let configuracao = null;

  function obterConfiguracao() {
    if (!configuracao) {
      configuracao = config.carregar();
      registro.configurar(
        path.join(configuracao.raiz, configuracao.geral.registro.diretorio),
        configuracao.geral.registro.nivel,
      );
    }
    return configuracao;
  }

  // --- Estado inicial da interface ---
  ipcMain.handle('app:estado', () => {
    try {
      const cfg = obterConfiguracao();
      return {
        ok: true,
        modoTeste: cfg.modoTeste,
        versao: app.getVersion(),
        campos: cfg.campos.map((c) => ({
          id: c.id,
          descricao: c.descricao,
          obrigatorio: Boolean(c.obrigatorio),
        })),
        avisosConfiguracao: cfg.pendentesDeConfiguracao.length > 0
          ? [`${cfg.pendentesDeConfiguracao.length} seletor(es) ainda com valor de exemplo no arquivo de configuracao.`]
          : [],
        camposSemDestino: cfg.camposSemDestino,
      };
    } catch (erro) {
      registro.erro('Falha ao carregar configuracao', erro.message);
      return { ok: false, erro: erro.message };
    }
  });

  // --- Processar arquivo arrastado ---
  ipcMain.handle('arquivo:processar', async (_evento, { caminho }) => {
    try {
      const cfg = obterConfiguracao();

      if (!caminho || !fs.existsSync(caminho)) {
        return { ok: false, erro: 'O arquivo nao foi encontrado. Arraste-o novamente para a janela.' };
      }

      const estatistica = fs.statSync(caminho);
      if (estatistica.size > 40 * 1024 * 1024) {
        return { ok: false, erro: 'O arquivo e grande demais (acima de 40 MB). Use um PDF ou imagem menor.' };
      }

      const buffer = fs.readFileSync(caminho);
      avisar('progresso', { etapa: 'processando', mensagem: 'Processando documento...' });

      const resultado = await extracao.processar(
        { buffer, nomeArquivo: path.basename(caminho) },
        cfg,
        (mensagem) => avisar('progresso', { etapa: 'processando', mensagem }),
      );

      estado.ultimoResultado = resultado;
      registro.info('Documento processado', {
        origem: path.basename(caminho),
        via: resultado.meta.viaDeLeitura,
      });

      return { ok: true, resultado };
    } catch (erro) {
      registro.erro('Falha ao processar documento', erro.detalheTecnico || erro.message);
      return {
        ok: false,
        erro: erro.name === 'ErroDeExtracao' ? erro.message : 'Nao foi possivel ler este documento.',
        detalhe: erro.detalheTecnico || erro.message,
      };
    }
  });

  // --- Escanear papel ---
  ipcMain.handle('scanner:capturar', async () => {
    try {
      const cfg = obterConfiguracao();
      avisar('progresso', { etapa: 'escaneando', mensagem: 'Digitalizando a folha...' });

      const captura = await scanner.capturarPagina(cfg);

      const resultado = await extracao.processar(
        captura,
        cfg,
        (mensagem) => avisar('progresso', { etapa: 'processando', mensagem }),
      );

      estado.ultimoResultado = resultado;
      return { ok: true, resultado };
    } catch (erro) {
      registro.erro('Falha na digitalizacao', erro.message);
      return {
        ok: false,
        erro: erro.name === 'ErroDeExtracao' ? erro.message : erro.message,
        detalhe: erro.detalheTecnico || erro.message,
      };
    }
  });

  // --- Listar scanners (para diagnostico e configuracao) ---
  ipcMain.handle('scanner:listar', async () => {
    const cfg = obterConfiguracao();
    return scanner.listarScanners(cfg);
  });

  // --- Estado da aba da vitima (regra do NIC, so no modo simulacao) ---
  //
  // A interface consulta isto enquanto a tela de conferencia esta aberta para
  // decidir se o botao "Preencher" pode ser liberado. Nunca abre navegador:
  // se nao houver sessao viva, devolve paginaAberta=false.
  ipcMain.handle('simulacao:estado-vitima', async () => {
    try {
      const cfg = obterConfiguracao();
      if (!cfg.modoTeste) {
        return { paginaAberta: false };
      }

      const sessao = require('./preenchimento/sessao');
      const pagina = sessao.paginaAtual();
      if (!pagina) {
        return { paginaAberta: false };
      }

      const regra = cfg.perfil.regraNic;
      if (!regra || !regra.seletorExame || !regra.seletorNic) {
        return { paginaAberta: true, exame: '', nicPreenchido: true, formularioAberto: false };
      }

      const abaVitima = (cfg.perfil.abas || []).find((aba) => aba.requerFormularioAberto);
      const seletorFormulario = abaVitima ? abaVitima.requerFormularioAberto : null;

      const consulta = pagina.evaluate((dados) => {
        const simulacao = window.__simulacao || {};
        const ler = (seletor) => {
          const elemento = document.querySelector(seletor);
          return elemento ? String(elemento.value ?? '') : '';
        };
        const elementoNic = document.querySelector(dados.seletorNic);
        const formulario = dados.seletorFormulario
          ? document.querySelector(dados.seletorFormulario)
          : null;
        return {
          exame: ler(dados.seletorExame),
          nic: ler(dados.seletorNic),
          nicMarcado: Boolean(elementoNic && elementoNic.dataset
            && elementoNic.dataset.preenchido === 'true'),
          estadoNic: Boolean(simulacao.nicPreenchido),
          formularioAberto: Boolean(
            (formulario && !formulario.hidden) || simulacao.formularioVitimaAberto
          ),
          estadoExame: String(simulacao.exame || ''),
        };
      }, {
        seletorExame: regra.seletorExame,
        seletorNic: regra.seletorNic,
        seletorFormulario,
      });

      // A pagina pode estar navegando ou travada: a consulta nao pode segurar a interface.
      const estadoPagina = await Promise.race([
        consulta,
        new Promise((_resolver, rejeitar) => setTimeout(() => rejeitar(new Error('tempo esgotado')), 2000)),
      ]);

      return {
        paginaAberta: true,
        exame: estadoPagina.exame || estadoPagina.estadoExame,
        nicPreenchido: Boolean(
          estadoPagina.nicMarcado
          || estadoPagina.estadoNic
          || String(estadoPagina.nic).trim() !== ''
        ),
        formularioAberto: estadoPagina.formularioAberto,
      };
    } catch {
      return { paginaAberta: false };
    }
  });

  // --- Preencher o sistema ---
  ipcMain.handle('preenchimento:executar', async (_evento, { dados }) => {
    if (estado.preenchimentoEmAndamento) {
      return { ok: false, erro: 'Ja existe um preenchimento em andamento.' };
    }

    try {
      const cfg = obterConfiguracao();
      estado.preenchimentoEmAndamento = true;

      avisar('progresso', { etapa: 'preenchendo', mensagem: 'Abrindo o navegador...' });

      const resultado = await preenchimento.preencher(dados, cfg, {
        aoProgredir: (mensagem) => avisar('progresso', { etapa: 'preenchendo', mensagem }),
      });

      estado.preenchimentoEmAndamento = false;

      // Registro de auditoria: nomes de campo e resultado, sem valores.
      registro.info('Auditoria de preenchimento', {
        modo: cfg.modoTeste ? 'simulacao' : 'sistema-oficial',
        camposVerificados: resultado.preenchidos.map((p) => p.campo),
        totalVerificado: resultado.preenchidos.length,
      });

      return {
        ok: true,
        preenchidos: resultado.preenchidos,
        ignorados: resultado.ignorados,
        abasPuladas: resultado.abasPuladas || [],
        resumo: resultado.resumo,
      };
    } catch (erro) {
      estado.preenchimentoEmAndamento = false;
      registro.erro('Falha no preenchimento', erro.message);

      if (erro instanceof ErroDeConfiguracao) {
        return {
          ok: false,
          erro: erro.message,
          detalhes: erro.detalhes,
          tipo: 'configuracao',
        };
      }

      return {
        ok: false,
        erro: erro.message || 'Nao foi possivel preencher o sistema.',
        detalhe: erro.detalheTecnico || null,
        tipo: erro instanceof ErroDePreenchimento ? 'preenchimento' : 'desconhecido',
        aba: erro.aba || null,
        campo: erro.campo || null,
      };
    }
  });

  // --- Abrir a pasta de logs (unica acao externa permitida, chamada pelo operador) ---
  ipcMain.handle('logs:abrir', async () => {
    const cfg = obterConfiguracao();
    const pasta = path.join(cfg.raiz, cfg.geral.registro.diretorio);
    fs.mkdirSync(pasta, { recursive: true });
    await shell.openPath(pasta);
    return { ok: true };
  });

  // --- Escolher arquivo pelo dialogo do sistema (alternativa ao arrastar) ---
  ipcMain.handle('arquivo:escolher', async () => {
    const escolha = await dialog.showOpenDialog(janelaPrincipal, {
      title: 'Selecionar a requisicao',
      properties: ['openFile'],
      filters: [
        { name: 'Documentos', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'bmp'] },
      ],
    });

    if (escolha.canceled || escolha.filePaths.length === 0) {
      return { ok: false, cancelado: true };
    }
    return { ok: true, caminho: escolha.filePaths[0] };
  });
}

app.whenReady().then(registrarPontes);
