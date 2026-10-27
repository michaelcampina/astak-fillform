'use strict';

/**
 * Gera `simulacao/municipios-ibge.js` com os municipios de cada UF.
 *
 * Fonte: API oficial do IBGE (localidades). O arquivo gerado e versionado para
 * a pagina de simulacao funcionar offline, sem depender de rede.
 *
 * Uso: node testes/gerar-municipios-ibge.js
 */

const fs = require('node:fs');
const path = require('node:path');

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const DESTINO = path.resolve(__dirname, '..', 'simulacao', 'municipios-ibge.js');

async function main() {
  const municipiosPorUf = {};

  for (const uf of UFS) {
    const url = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`;
    const resposta = await fetch(url);
    if (!resposta.ok) {
      throw new Error(`Falha ao baixar ${uf}: HTTP ${resposta.status}`);
    }
    const lista = await resposta.json();
    municipiosPorUf[uf] = lista.map((municipio) => municipio.nome);
    console.log(`${uf}: ${municipiosPorUf[uf].length} município(s)`);
  }

  const total = Object.values(municipiosPorUf).reduce((soma, lista) => soma + lista.length, 0);
  const conteudo = [
    "'use strict';",
    '',
    '/**',
    ' * Municipios por UF — fonte: API de localidades do IBGE.',
    ' * Gerado por testes/gerar-municipios-ibge.js. Nao editar a mao.',
    ' */',
    `window.MUNICIPIOS_POR_UF = ${JSON.stringify(municipiosPorUf, null, 2)};`,
    '',
  ].join('\n');

  fs.writeFileSync(DESTINO, conteudo, 'utf8');
  console.log(`\n${total} município(s) gravados em ${path.relative(process.cwd(), DESTINO)}`);
}

main().catch((erro) => {
  console.error('Falha ao gerar os municípios:', erro.message);
  process.exit(1);
});
