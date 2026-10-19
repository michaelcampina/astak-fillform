'use strict';

/**
 * Teste ponta a ponta NA JANELA REAL da ferramenta.
 *
 * Diferenca para `executar-teste.js`: aquele chama a extracao e o preenchimento
 * diretamente, como biblioteca. Este abre o Electron, deixa a janela do operador
 * subir e percorre o MESMO caminho da interface:
 *
 *   1. a janela unica abre;
 *   2. a requisicao e entregue como o arrastar-e-soltar entrega;
 *   3. a tabela de conferencia aparece, com os campos editaveis;
 *   4. o operador clica em "Preencher o sistema" (clique de verdade);
 *   5. a ferramenta preenche o Chrome e para em "Pronto para revisao".
 *
 * Por que existe: o teste de biblioteca pode passar mesmo que a janela esteja
 * quebrada (botao desabilitado, tabela vazia, transicao de tela errada). Este
 * cobre justamente essa parte.
 *
 * Uso:  npm run teste:janela
 *
 * Pre-requisitos: os mesmos do uso normal (Chrome instalado). O resultado e
 * gravado em arquivo porque o electron.exe, no Windows, nao anexa console.
 */

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const RAIZ = path.resolve(__dirname, '..');
const SAIDA = path.join(RAIZ, 'testes', 'saida', 'resultado-janela.json');

const linhas = [];
const falhas = [];

function registrar(texto) {
  linhas.push(texto);
  try {
    fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
    fs.writeFileSync(SAIDA, JSON.stringify({ passos: linhas, falhas }, null, 2), 'utf8');
  } catch (erro) {
    /* o arquivo e so evidencia; nao deve derrubar o teste */
  }
}

function reprovar(mensagem) {
  falhas.push(mensagem);
  registrar('FALHOU: ' + mensagem);
}

function esperar(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/** Espera uma condicao na pagina, com prazo. */
async function aguardarNaPagina(wc, expressao, prazoMs = 15000, intervaloMs = 250) {
  const limite = Date.now() + prazoMs;
  while (Date.now() < limite) {
    const valor = await wc.executeJavaScript(expressao);
    if (valor) return valor;
    await esperar(intervaloMs);
  }
  return null;
}

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  registrar('app pronto');

  // Reaproveita o main real: mesmos IPC, mesma janela, mesmo estado.
  require(path.join(RAIZ, 'src', 'main.js'));

  await esperar(2500);

  const janelas = BrowserWindow.getAllWindows();
  if (janelas.length !== 1) {
    reprovar(`esperava exatamente 1 janela, encontrei ${janelas.length}`);
    return encerrar(1);
  }
  registrar('[1] janela unica aberta');

  const wc = janelas[0].webContents;

  const montou = await aguardarNaPagina(wc, 'Boolean(document.getElementById("area-solta"))');
  if (!montou) {
    reprovar('a interface nao montou (area de solta ausente)');
    return encerrar(1);
  }
  registrar('[1] interface montada');

  // A janela nao pode ter um segundo navegador embutido nem abas internas.
  const temAbasInternas = await wc.executeJavaScript(
    'document.querySelectorAll(".aba-interna, nav.abas").length > 0',
  );
  if (temAbasInternas) {
    registrar('[aviso] encontrei navegacao interna na janela (nao era esperado)');
  }

  const fixture = path.join(RAIZ, 'testes', 'fixtures', 'requisicao-digital.pdf');
  if (!fs.existsSync(fixture)) {
    reprovar('fixture ausente: testes/fixtures/requisicao-digital.pdf (rode npm run exemplos)');
    return encerrar(1);
  }

  // [2] e [3] — mesma funcao que o arrastar-e-soltar chama.
  await wc.executeJavaScript(`(async () => { await processarCaminho(${JSON.stringify(fixture)}); })()`);

  const conferencia = await aguardarNaPagina(
    wc,
    `(() => {
       const ativa = document.querySelector("section[id^='etapa-']:not([hidden])");
       if (!ativa || ativa.id !== 'etapa-dados') return null;
       const linhas = document.querySelectorAll('#corpo-dados tr');
       if (linhas.length === 0) return null;
       const editaveis = document.querySelectorAll('#corpo-dados input, #corpo-dados textarea');
       return {
         etapa: ativa.id,
         campos: linhas.length,
         editaveis: editaveis.length,
         botaoHabilitado: !document.getElementById('btn-preencher').disabled,
         botaoTexto: document.getElementById('btn-preencher').textContent.trim(),
         origem: document.getElementById('origem-leitura').textContent.trim(),
       };
     })()`,
  );

  if (!conferencia) {
    reprovar('a tabela de conferencia nao apareceu depois de processar o arquivo');
    return encerrar(1);
  }

  registrar(`[2] extracao: ${conferencia.campos} campo(s), origem "${conferencia.origem}"`);
  registrar(`[3] tabela editavel: ${conferencia.editaveis} campo(s), botao "${conferencia.botaoTexto}"`);

  if (conferencia.campos === 0) reprovar('a tabela veio vazia');
  if (conferencia.editaveis !== conferencia.campos) {
    reprovar(`esperava ${conferencia.campos} campos editaveis, encontrei ${conferencia.editaveis}`);
  }
  if (!conferencia.botaoHabilitado) reprovar('o botao "Preencher" ficou desabilitado com dados na tela');

  if (falhas.length > 0) return encerrar(1);

  // [4] clique real no botao, como o operador faz.
  registrar('[4] clicando em "Preencher o sistema"...');
  wc.executeJavaScript('document.getElementById("btn-preencher").click(), true').catch(() => {});

  const desfecho = await aguardarNaPagina(
    wc,
    `(() => {
       const ativa = document.querySelector("section[id^='etapa-']:not([hidden])");
       if (!ativa) return null;
       if (ativa.id !== 'etapa-resultado' && ativa.id !== 'etapa-erro') return null;
       return {
         etapa: ativa.id,
         rodape: document.getElementById('rodape-estado').textContent.trim(),
         texto: document.getElementById('resultado-texto').textContent.trim(),
         erro: document.getElementById('erro-texto').textContent.trim(),
       };
     })()`,
    240000,
    1000,
  );

  if (!desfecho) {
    reprovar('o preenchimento nao terminou no prazo de 4 minutos');
    return encerrar(1);
  }

  if (desfecho.etapa === 'etapa-erro') {
    reprovar('a interface mostrou erro em vez de concluir: ' + desfecho.erro);
    registrar('[5] erro exibido ao operador: ' + desfecho.erro);
    return encerrar(1);
  }

  registrar('[5] etapa final: ' + desfecho.etapa + ' / rodape: ' + desfecho.rodape);
  registrar('[5] mensagem: ' + desfecho.texto.split('\n')[0]);

  // A tela final precisa dizer que o envio e responsabilidade do operador.
  if (!/não envia nada sozinha/i.test(desfecho.texto)) {
    reprovar('a tela final nao avisa que a ferramenta nao envia sozinha');
  }
  if (!/Aguardando revis/i.test(desfecho.rodape)) {
    reprovar(`o rodape deveria indicar espera por revisao, veio "${desfecho.rodape}"`);
  }

  // Nenhum botao de envio pode ter sido acionado de fato.
  const envios = await wc.executeJavaScript(
    'window.__cliquesDeEnvio === undefined ? null : window.__cliquesDeEnvio',
  );
  if (envios !== null) {
    registrar(`[5] cliques de envio observados na pagina: ${envios}`);
    if (envios > 0) reprovar(`${envios} clique(s) de envio foram disparados`);
  }

  return encerrar(falhas.length === 0 ? 0 : 1);
}).catch((erro) => {
  reprovar('excecao: ' + (erro && erro.stack ? erro.stack : String(erro)));
  encerrar(1);
});

function encerrar(codigo) {
  const aprovado = codigo === 0;
  registrar('');
  registrar(aprovado ? 'JANELA: FLUXO COMPLETO APROVADO' : 'JANELA: FALHOU');
  if (falhas.length > 0) {
    registrar('--- falhas ---');
    falhas.forEach((f) => registrar('  - ' + f));
  }
  registrar(`resultado gravado em ${SAIDA}`);

  // Imprime tambem no stdout, util quando chamado por um terminal que capte.
  linhas.forEach((l) => console.log(l));

  app.exit(codigo);
}
