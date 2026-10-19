'use strict';

/**
 * Sessao do navegador: mantem UMA janela do Chrome viva entre preenchimentos.
 *
 * Por que isso importa:
 *  - o perfil do operador fica travado enquanto o Chrome esta aberto; abrir
 *    uma segunda instancia no mesmo perfil falha sempre;
 *  - o operador costuma conferir dados, ajustar algo e preencher de novo, na
 *    mesma janela;
 *  - abrir e fechar navegador a cada uso deixa a operacao lenta e instavel.
 *
 * A sessao NUNCA e fechada pela ferramenta por conta propria: quem fecha a
 * janela do sistema e o operador. A ferramenta apenas registra que ela sumiu.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ErroDePreenchimento } = require('./erros');
const registro = require('../nucleo/registro');

/** @type {{contexto: object, canal: string, caminhoPerfil: string}|null} */
let sessao = null;

function caminhoDoPerfil(configuracao) {
  const configurado = configuracao.geral.navegador.perfil;
  return path.isAbsolute(configurado) ? configurado : path.join(configuracao.raiz, configurado);
}

/**
 * Garante que exista um diretorio temporario gravavel para o Playwright.
 *
 * O Playwright cria uma pasta temporaria (playwright-artifacts-XXXXXX) ANTES de
 * abrir o navegador, para guardar artefatos de diagnostico. Em maquinas onde o
 * %TEMP% do usuario e restrito por politica corporativa, ou onde a ferramenta
 * roda sob um sandbox de execucao, essa criacao falha com EPERM — e o erro
 * resultante parece "o Chrome nao abriu", o que manda o operador investigar o
 * lugar errado.
 *
 * Verificado neste ambiente: os.tmpdir() recusa mkdtemp com EPERM, enquanto uma
 * pasta dentro do projeto aceita. Apontar TMP/TEMP para la resolve.
 *
 * @returns {{temporario: string, alterado: boolean}}
 */
function garantirTemporarioGravavel(configuracao) {
  const atual = os.tmpdir();

  try {
    const prova = fs.mkdtempSync(path.join(atual, 'preenchedor-XXXXXX'));
    fs.rmSync(prova, { recursive: true, force: true });
    return { temporario: atual, alterado: false };
  } catch {
    // Temporario do sistema recusou escrita: usa uma pasta da propria ferramenta.
  }

  const alternativo = path.join(configuracao.raiz, 'logs', 'tmp');
  fs.mkdirSync(alternativo, { recursive: true });

  // O Playwright consulta TMP/TEMP no momento em que precisa, entao basta
  // ajustar as variaveis antes de abrir o navegador.
  process.env.TMP = alternativo;
  process.env.TEMP = alternativo;

  registro.aviso('O diretorio temporario do sistema recusou escrita; usando uma pasta da ferramenta.', {
    de: atual,
    para: alternativo,
  });

  return { temporario: alternativo, alterado: true };
}

/** Descobre se a sessao guardada ainda e valida. */
function sessaoViva() {
  if (!sessao) return false;
  try {
    // browser() e null em contexto persistente; o sinal confiavel e a lista
    // de paginas ainda responder.
    const paginas = sessao.contexto.pages();
    return Array.isArray(paginas);
  } catch {
    return false;
  }
}

/** Escolhe uma pagina utilizavel, criando uma se nao houver. */
async function obterPagina() {
  const paginas = sessao.contexto.pages();
  const utilizavel = paginas.find((p) => !p.isClosed());
  if (utilizavel) {
    return utilizavel;
  }
  return sessao.contexto.newPage();
}

/**
 * Abre o navegador (ou reaproveita o que ja esta aberto).
 *
 * @param {object} configuracao config carregada
 * @returns {Promise<{contexto: object, pagina: object, reaproveitada: boolean}>}
 */
async function obterNavegador(configuracao) {
  if (sessaoViva()) {
    const pagina = await obterPagina();
    await pagina.setDefaultTimeout(configuracao.geral.navegador.timeoutPadraoMs || 20000);
    return { contexto: sessao.contexto, pagina, reaproveitada: true };
  }
  if (sessao) {
    registro.aviso('Sessao anterior do navegador nao esta mais disponivel; abrindo outra.');
    sessao = null;
  }

  const { chromium } = require('playwright');
  const opcoes = configuracao.geral.navegador;
  const caminhoPerfil = caminhoDoPerfil(configuracao);
  fs.mkdirSync(caminhoPerfil, { recursive: true });

  garantirTemporarioGravavel(configuracao);

  const canais = opcoes.canaisPermitidos || ['chrome'];
  const falhas = [];

  for (const canal of canais) {
    try {
      const contexto = await chromium.launchPersistentContext(caminhoPerfil, {
        channel: canal === 'chromium' ? undefined : canal,
        headless: false, // o operador precisa VER o preenchimento
        viewport: null,
        args: ['--start-maximized'],
        acceptDownloads: false,
        timeout: 60000,
      });

      sessao = { contexto, canal, caminhoPerfil };

      // Se o operador fechar a janela, a sessao deixa de valer.
      contexto.on('close', () => {
        registro.info('Janela do navegador fechada pelo operador.');
        sessao = null;
      });

      const pagina = await obterPagina();
      await pagina.setDefaultTimeout(opcoes.timeoutPadraoMs || 20000);
      registro.info('Navegador aberto', { canal, perfil: caminhoPerfil });
      return { contexto, pagina, reaproveitada: false };
    } catch (erro) {
      falhas.push({ canal, mensagem: erro.message });
      registro.aviso('Nao foi possivel abrir o navegador neste canal', {
        canal,
        erro: erro.message,
      });
    }
  }

  // Escolhe o erro que MAIS ajuda o operador.
  //
  // Cuidado ja corrigido aqui: a versao anterior mostrava a mensagem do ultimo
  // canal testado, que costuma ser a menos informativa ("executavel do Chromium
  // nao existe") e escondia a causa real ("acesso negado ao iniciar o Chrome").
  // Ordem de prioridade: permissao do ambiente > perfil em uso > resto.
  const textoDeTodas = falhas.map((f) => f.mensagem).join('\n');

  // mkdtemp/EPERM em "playwright-artifacts" e falta de permissao em pasta
  // temporaria, NAO no Chrome. Confundir os dois manda o operador cobrar o TI
  // pelo motivo errado, entao este caso vem primeiro.
  const ehTempBloqueado = /mkdtemp|playwright-artifacts/i.test(textoDeTodas) && /EPERM|EACCES/i.test(textoDeTodas);
  const ehPermissao = !ehTempBloqueado
    && /EPERM|EACCES|Acesso negado|platform_channel|0x5/i.test(textoDeTodas);
  const ehPerfilEmUso = /profile.*in use|already in use|SingletonLock|ProcessSingleton/i.test(textoDeTodas);
  const ehExecutavelAusente = /Executable doesn't exist|npx playwright install/i.test(textoDeTodas);

  let mensagem;
  let detalhe = textoDeTodas;

  if (ehTempBloqueado) {
    mensagem =
      'O Windows não deixou a ferramenta criar a pasta temporária de trabalho. ' +
      'Isso costuma acontecer quando a política de segurança da rede restringe a pasta ' +
      'Temp do usuário. A ferramenta já tentou usar uma pasta própria; se o erro ' +
      'continuar, confirme com o suporte de TI se a pasta da ferramenta tem permissão de escrita.';
  } else if (ehPermissao) {
    mensagem =
      'O Windows bloqueou a abertura do Chrome pela ferramenta. ' +
      'Isso costuma acontecer quando o antivírus ou a política de segurança da rede ' +
      'restringe a execução do navegador. Peça ao suporte de TI para liberar a execução ' +
      'do Chrome para a pasta da ferramenta.';
  } else if (ehPerfilEmUso) {
    mensagem =
      'Já existe uma janela do sistema aberta com o perfil da ferramenta. ' +
      'Feche essa janela e clique em Preencher novamente.';
    detalhe = falhas.map((f) => `${f.canal}: ${f.mensagem}`).join('\n');
  } else if (ehExecutavelAusente && !falhas.some((f) => f.canal === 'chrome' || f.canal === 'msedge')) {
    mensagem = 'Confira se o Google Chrome está instalado no computador.';
  } else {
    mensagem = 'Não foi possível abrir o navegador para preencher o sistema.';
  }

  throw new ErroDePreenchimento(mensagem, {
    etapa: 'navegador',
    detalheTecnico: detalhe || 'Nenhum canal de navegador disponível.',
  });
}

/**
 * Fecha a sessao. Usado ao sair da ferramenta e pelos testes.
 * @param {boolean} silencioso nao registra aviso quando nao ha sessao
 */
async function encerrar(silencioso = false) {
  if (!sessao) {
    if (!silencioso) registro.info('Nao havia navegador aberto para encerrar.');
    return;
  }
  const alvo = sessao;
  sessao = null;
  try {
    await alvo.contexto.close();
  } catch (erro) {
    registro.aviso('Falha ao fechar o navegador', { erro: erro.message });
  }
}

/** Informa se existe sessao viva (usado pela interface e pelos testes). */
function estaAberta() {
  return sessaoViva();
}

module.exports = { obterNavegador, encerrar, estaAberta, caminhoDoPerfil };
