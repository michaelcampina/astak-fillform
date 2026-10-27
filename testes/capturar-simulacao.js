'use strict';

/**
 * Captura da pagina de simulacao para conferencia visual.
 *
 * Abre `simulacao/sistema-simulado.html` num Chromium sem interface, percorre
 * as seis abas e grava PNGs em `testes/saida/simulacao/`. Serve para comparar,
 * lado a lado, com os prints do sistema oficial. Nao preenche nada e nao clica
 * em botao de envio: quando precisa do formulario da vitima, o clique em
 * "Cadastrar uma nova vitima" representa o operador.
 *
 * Uso: node testes/capturar-simulacao.js
 */

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..');
const PAGINA = path.join(RAIZ, 'simulacao', 'sistema-simulado.html');
const SAIDA = path.join(RAIZ, 'testes', 'saida', 'simulacao');

async function clicarAba(pagina, numero) {
  await pagina.locator('#aba-' + numero).click();
  await pagina.waitForTimeout(120);
}

/**
 * Abre um navegador headless. O chromium baixado pelo Playwright pode nao
 * estar instalado nesta maquina; nesse caso usamos o Chrome/Edge do sistema,
 * que a ferramenta ja utiliza no modo normal.
 */
async function abrirNavegador() {
  const tentativas = [
    { channel: 'chrome' },
    { channel: 'msedge' },
    {},
  ];
  const falhas = [];
  for (const opcoes of tentativas) {
    try {
      const navegador = await chromium.launch({ headless: true, ...opcoes });
      console.log('Navegador: ' + (opcoes.channel || 'chromium do Playwright'));
      return navegador;
    } catch (erro) {
      falhas.push((opcoes.channel || 'chromium') + ': ' + erro.message.split('\n')[0]);
    }
  }
  throw new Error('Nenhum navegador disponivel para a captura:\n' + falhas.join('\n'));
}

async function capturar(pagina, nome) {
  const destino = path.join(SAIDA, nome);
  await pagina.screenshot({ path: destino, fullPage: false });
  console.log('  ' + nome);
}

async function main() {
  if (!fs.existsSync(PAGINA)) {
    console.error('Pagina nao encontrada: ' + PAGINA);
    process.exit(1);
  }
  fs.mkdirSync(SAIDA, { recursive: true });

  const navegador = await abrirNavegador();
  const pagina = await navegador.newPage({ viewport: { width: 1600, height: 780 } });

  const problemas = [];
  pagina.on('pageerror', (erro) => problemas.push('erro de script: ' + erro.message));
  pagina.on('console', (msg) => {
    if (msg.type() === 'error') problemas.push('console: ' + msg.text());
  });

  await pagina.goto(pathToFileURL(PAGINA).href, { waitUntil: 'load' });
  await pagina.waitForSelector('#form-laudo');

  // Conferencia rapida dos catalogos antes de fotografar.
  const contagens = await pagina.evaluate(() => ({
    exames: document.querySelectorAll('#exame option').length - 1,
    fatos: document.querySelectorAll('#fatoSuposto option').length - 1,
    tiposLocal: document.querySelectorAll('#tipoLocal option').length - 1,
    ufs: document.querySelectorAll('#ufNascimento option').length - 1,
    abas: document.querySelectorAll('.aba').length,
  }));
  console.log('Catalogos:', JSON.stringify(contagens));

  console.log('Capturando:');

  await capturar(pagina, 'aba-01.png');

  await clicarAba(pagina, 2);
  await capturar(pagina, 'aba-02.png');

  await clicarAba(pagina, 3);
  await capturar(pagina, 'aba-03a.png');
  await pagina.locator('#autoridadePresente').scrollIntoViewIfNeeded();
  await pagina.waitForTimeout(120);
  await capturar(pagina, 'aba-03b.png');

  await clicarAba(pagina, 4);
  await pagina.locator('.conteudo').evaluate((el) => { el.scrollTop = 0; });
  await capturar(pagina, 'aba-04a.png');

  // O clique abaixo representa o operador abrindo o cadastro da vitima.
  await pagina.locator('#btn-nova-vitima').click();
  await pagina.waitForTimeout(120);
  await pagina.locator('#nic').fill('2026/123456');
  await pagina.locator('.conteudo').evaluate((el) => { el.scrollTop = 0; });
  await capturar(pagina, 'aba-04b.png');
  await pagina.locator('#telefone').scrollIntoViewIfNeeded();
  await pagina.waitForTimeout(120);
  await capturar(pagina, 'aba-04c.png');

  // Tela de pesquisa da vitima (diferente do cadastro).
  await pagina.locator('#btn-pesquisar-vitima').click();
  await pagina.locator('.conteudo').evaluate((el) => { el.scrollTop = 0; });
  await pagina.waitForTimeout(120);
  await capturar(pagina, 'aba-04-pesquisa.png');
  await pagina.locator('#btn-nova-vitima').click();

  await clicarAba(pagina, 5);
  await capturar(pagina, 'aba-05.png');
  await clicarAba(pagina, 6);
  await capturar(pagina, 'aba-06.png');

  // Cenario NECROPSIA: form bloqueado e depois liberado pelo NIC.
  await clicarAba(pagina, 2);
  await pagina.locator('#exame').selectOption('NECROPSIA');
  await clicarAba(pagina, 4);
  await pagina.locator('#form-vitima').evaluate((el) => {
    el.hidden = false;
    document.getElementById('tela-vitima-inicial').hidden = true;
  });
  await pagina.locator('#nic').fill('');
  await pagina.locator('#nic').dispatchEvent('input');
  await pagina.waitForTimeout(120);
  const bloqueado = await pagina.evaluate(() => ({
    nomeBloqueado: document.getElementById('nomeVitima').disabled,
    nicLiberado: !document.getElementById('nic').disabled,
    avisoVisivel: !document.getElementById('aviso-nic').hidden,
    botaoBloqueado: document.getElementById('btn-cadastrar-vitima').disabled,
  }));
  console.log('NECROPSIA bloqueado:', JSON.stringify(bloqueado));
  await pagina.locator('.conteudo').evaluate((el) => { el.scrollTop = 0; });
  await capturar(pagina, 'extra-04-necropsia-bloqueada.png');

  await pagina.locator('#nic').fill('2026/123456');
  await pagina.waitForTimeout(120);
  const liberado = await pagina.evaluate(() => ({
    nomeLiberado: !document.getElementById('nomeVitima').disabled,
    avisoVisivel: !document.getElementById('aviso-nic').hidden,
    camposLiberados: window.__simulacao.camposLiberados,
  }));
  console.log('NECROPSIA liberado:', JSON.stringify(liberado));
  await capturar(pagina, 'extra-04-necropsia-liberada.png');

  await navegador.close();

  if (problemas.length > 0) {
    console.error('\nProblemas detectados na pagina:');
    problemas.forEach((p) => console.error('  - ' + p));
    process.exit(1);
  }

  console.log('\nCapturas em ' + path.relative(RAIZ, SAIDA));
}

main().catch((erro) => {
  console.error('Falha ao capturar a simulacao:', erro);
  process.exit(1);
});
