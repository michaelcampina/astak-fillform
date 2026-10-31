'use strict';

/**
 * Diagnostico de uma amostra de requisicoes reais.
 *
 * Mostra o inicio, as linhas relevantes (RG, sexo, estado civil, datas,
 * diretor do NUMOL) e o fim do texto de cada arquivo, para calibrar as regras
 * de autoridade final, RG separado, sexo/estado civil e datas.
 *
 * Uso:
 *   node testes/diagnostico-amostra.js "req1.pdf" "req2.pdf" ...
 *   node testes/diagnostico-amostra.js            (usa a amostra padrao)
 */

const fs = require('node:fs');
const path = require('node:path');

const { lerTextoDoPdf, renderizarPdfComoImagens } = require('../src/extracao/pdf');
const { extrairTextoDeImagens } = require('../src/extracao/ocr');
const config = require('../src/nucleo/config');

const RAIZ = path.resolve(__dirname, '..');
const PASTA = path.join(RAIZ, 'requisições');

const AMOSTRA_PADRAO = [
  'Adobe Scan 21 de out. de 2026 (5).pdf',
  'Adobe Scan 21 de out. de 2026 (6).pdf',
  'Adobe Scan 21 de out. de 2026 (7).pdf',
  'Adobe Scan 21 de out. de 2026 (19).pdf',
  'Adobe Scan 21 de out. de 2026 (22).pdf',
  'Adobe Scan 21 de out. de 2026 (36).pdf',
  'Adobe Scan 29 de out. de 2026.pdf',
  'Adobe Scan 29 de out. de 2026 (13).pdf',
  'Adobe Scan 29 de out. de 2026 (50).pdf',
  'Adobe Scan 29 de out. de 2026 (75).pdf',
];

const RELEVANTE = /Delegad|Diretor|Carlos Alberto|NUMOL|RG\s*n|Sexo|Estado Civil|Uni[aã]o|Registro|Of[ií]cio|Periciando|CPF|nascid/i;

async function main() {
  const cfg = config.carregar();
  const nomes = process.argv.slice(2).length > 0 ? process.argv.slice(2) : AMOSTRA_PADRAO;

  for (const nome of nomes) {
    const caminho = path.join(PASTA, nome);
    console.log(`\n\n===== ${nome} =====`);
    if (!fs.existsSync(caminho)) {
      console.log('ARQUIVO NAO ENCONTRADO');
      continue;
    }

    const buffer = fs.readFileSync(caminho);
    const leitura = await lerTextoDoPdf(buffer, cfg.geral.extracao);
    let linhas = leitura.linhas;
    let via = 'texto digital';
    let confianca = null;

    if (leitura.precisaOcr || /Perici[a-z]*\(a\):|Exame Requisitado:/i.test(linhas.join('\n'))) {
      const imagens = await renderizarPdfComoImagens(buffer, cfg.geral.extracao);
      const ocr = await extrairTextoDeImagens(imagens, cfg);
      linhas = ocr.linhas;
      via = 'OCR';
      confianca = ocr.confianca;
    }

    console.log(`Via: ${via}${confianca === null ? '' : ` (confianca ${confianca}%)`} | linhas: ${linhas.length}`);
    console.log('--- inicio ---');
    console.log(linhas.slice(0, 22).join('\n'));
    console.log('--- relevantes ---');
    console.log(linhas.filter((linha) => RELEVANTE.test(linha)).slice(0, 30).join('\n'));
    console.log('--- fim ---');
    console.log(linhas.slice(-25).join('\n'));
  }

  await require('../src/extracao/ocr').encerrar().catch(() => {});
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
