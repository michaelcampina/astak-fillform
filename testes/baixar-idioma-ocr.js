'use strict';

/**
 * Prepara o idioma do OCR (portugues) para uso 100% offline.
 *
 * A ferramenta NAO baixa nada em tempo de execucao. Este script e uma etapa de
 * instalacao, rodada uma unica vez, e serve para dois cenarios:
 *
 *   1. o arquivo ja esta em recursos/tessdata  -> so confirma;
 *   2. o arquivo nao esta                     -> tenta obtê-lo, sem custo.
 *
 * Tudo o que ele faz e gratuito. Nenhum servico pago e usado.
 *
 * Uso: npm run idioma-ocr
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const DIR_TESSDATA = path.join(RAIZ, 'recursos', 'tessdata');
const ARQUIVO = path.join(DIR_TESSDATA, 'por.traineddata.gz');

/**
 * Fontes gratuitas do arquivo, na ordem em que sao tentadas.
 * O pacote do npm e a mais confiavel em redes restritas.
 */
const FONTES = [
  {
    tipo: 'npm',
    descricao: 'pacote npm @tesseract.js-data/por (offline, usa o cache local)',
    pacote: '@tesseract.js-data/por',
    // Caminho do .gz dentro do pacote publicado.
    interno: 'package/4.0.0/por.traineddata.gz',
  },
  {
    tipo: 'url',
    descricao: 'repositorio oficial tessdata do Tesseract (GitHub)',
    url: 'https://github.com/naptha/tessdata/raw/gh-pages/4.0.0/por.traineddata.gz',
  },
];

/** Mostra o tamanho de forma legivel. */
function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Verifica se o arquivo existe e tem tamanho plausivel. */
function arquivoValido() {
  if (!fs.existsSync(ARQUIVO)) {
    return { ok: false, motivo: 'arquivo ausente' };
  }
  const tamanho = fs.statSync(ARQUIVO).size;
  // Um arquivo real de portugues tem varios MB. Menos de 100 KB e download quebrado.
  if (tamanho < 100 * 1024) {
    return { ok: false, motivo: `arquivo muito pequeno (${tamanho} bytes), provavelmente incompleto` };
  }
  return { ok: true, tamanho };
}

/** Baixa de uma URL para o destino. */
async function baixarDe(url, destino) {
  // fetch existe no Node 18+; a ferramenta exige Node 20+.
  const resposta = await fetch(url, { redirect: 'follow' });
  if (!resposta.ok) {
    throw new Error(`o servidor respondeu ${resposta.status}`);
  }
  const dados = Buffer.from(await resposta.arrayBuffer());
  if (dados.length < 100 * 1024) {
    throw new Error(`o arquivo recebido e pequeno demais (${dados.length} bytes)`);
  }
  fs.writeFileSync(destino, dados);
  return dados.length;
}

/**
 * Obtem o arquivo a partir do pacote npm.
 *
 * Usa "npm pack" no cache do proprio projeto. Isso funciona onde o download
 * direto por HTTPS esta bloqueado, porque o npm usa o registry configurado.
 */
async function baixarDoNpm(fonte, destino) {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-idioma-'));

  try {
    execFileSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['pack', fonte.pacote, '--pack-destination', dirTemp, '--cache', path.join(RAIZ, '.npm-cache')],
      { stdio: 'pipe', timeout: 120000 },
    );

    const pacote = fs.readdirSync(dirTemp).find((n) => n.endsWith('.tgz'));
    if (!pacote) {
      throw new Error('o npm nao gerou o pacote esperado');
    }

    // Extrai apenas o arquivo do idioma, sem dependencia externa.
    const { execFileSync: extrair } = require('node:child_process');
    extrair('tar', ['-xzf', path.join(dirTemp, pacote), '-C', dirTemp, fonte.interno], {
      stdio: 'pipe',
      timeout: 60000,
    });

    const origem = path.join(dirTemp, ...fonte.interno.split('/'));
    if (!fs.existsSync(origem)) {
      throw new Error('o arquivo do idioma nao esta dentro do pacote');
    }
    fs.copyFileSync(origem, destino);
    return fs.statSync(destino).size;
  } finally {
    fs.rmSync(dirTemp, { recursive: true, force: true });
  }
}

async function principal() {
  fs.mkdirSync(DIR_TESSDATA, { recursive: true });

  const atual = arquivoValido();
  if (atual.ok) {
    console.log('Idioma do OCR já instalado.');
    console.log(`  ${path.relative(RAIZ, ARQUIVO)} — ${mb(atual.tamanho)}`);
    console.log('Nada a fazer.');
    return;
  }

  console.log('Preparando o idioma português para o OCR...');
  if (atual.motivo) {
    console.log(`  motivo: ${atual.motivo}`);
  }

  const falhas = [];
  for (const fonte of FONTES) {
    console.log(`  tentando: ${fonte.descricao}`);
    try {
      const tamanho = fonte.tipo === 'npm'
        ? await baixarDoNpm(fonte, ARQUIVO)
        : await baixarDe(fonte.url, ARQUIVO);

      console.log(`  pronto: ${mb(tamanho)} gravados em ${path.relative(RAIZ, ARQUIVO)}`);
      return;
    } catch (erro) {
      falhas.push(`${fonte.descricao}: ${erro.message}`);
      console.log(`  não funcionou (${erro.message})`);
      // Remove resto de download parcial para nao enganar a proxima tentativa.
      fs.rmSync(ARQUIVO, { force: true });
    }
  }

  console.error('\nNão foi possível obter o arquivo do idioma automaticamente.');
  for (const falha of falhas) {
    console.error(`  - ${falha}`);
  }
  console.error(
    '\nComo resolver sem custo, escolha uma opção:\n' +
    '  1. Copie o arquivo por.r/enviado por outro computador que já tenha a ferramenta instalada\n' +
    '     e coloque em: recursos/tessdata/por.traineddata.gz\n' +
    '  2. Rode novamente em um computador com internet e copie a pasta recursos/tessdata\n' +
    '  3. Peça ao suporte de TI para liberar o acesso ao site do npm\n' +
    '\nO OCR não funciona sem esse arquivo, e a ferramenta vai avisar isso ao abrir.',
  );
  process.exit(1);
}

if (require.main === module) {
  principal().catch((erro) => {
    console.error(`Falha inesperada: ${erro.message}`);
    process.exit(1);
  });
}

module.exports = { principal };
