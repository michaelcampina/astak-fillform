'use strict';

/**
 * Enriquece as listas da pagina de simulacao com os valores reais extraidos
 * no lote de requisicoes.
 *
 * Le o JSON do lote (`lote-requisicoes-*.json`), pega os valores unicos de
 * orgao, destinoExame e autoridade, limpa o lixo de OCR e mescla com as listas
 * atuais de `simulacao/sistema-simulado.html`. As listas ficticias sao mantidas.
 *
 * Uso:
 *   node testes/atualizar-listas-simulacao.js [caminho-do-lote.json]
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const SAIDA = path.join(RAIZ, 'testes', 'saida');
const PAGINA = path.join(RAIZ, 'simulacao', 'sistema-simulado.html');

const LIXO_ORGAO = /(assola|tao |ntça|SU db|Dotena|Becietaria|Secretario|Saeao|enecadtocas|aeee|Defesa Social|PARAÍBA|\bHH\b|Ontena|Bacim|Tº|GOVERA|Ada\s+AA|DA\s+PARA[ÍI]BA|\d+\*|\d+"|\*|—\s*:|—\s*[A-Z]$|—\s*\d$|—\s*Delegacia(?:\s+do)?$|—\s*Central$|—$)/i;

function ultimoLote() {
  const arquivos = fs
    .readdirSync(SAIDA)
    .filter((nome) => /^lote-requisicoes-.*\.json$/.test(nome))
    .map((nome) => ({ nome, mtime: fs.statSync(path.join(SAIDA, nome)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (arquivos.length === 0) {
    throw new Error('Nenhum lote-requisicoes-*.json em testes/saida.');
  }
  return path.join(SAIDA, arquivos[0].nome);
}

function limparOrgao(valor) {
  let texto = String(valor ?? '')
    .replace(/\s*Periciando[\s\S]*$/i, '')
    .replace(/\s*["“”'‘’][\s\S]*$/, '')
    .replace(/\s+(?:GOVERNO|GOVERA|Secretaria|\bBO\b|PARAÍBA|DA\s+PARAÍBA|ao O RAIBA|Beciana|Ada\s+AA)[\s\S]*$/i, '')
    .replace(/\s*[|!][\s\S]*$/, '')
    .replace(/\s+e\s*$/i, '')
    .replace(/[.,;:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (texto) {
    texto = texto.charAt(0).toUpperCase() + texto.slice(1);
  }
  return texto;
}

function limparAutoridade(valor) {
  return String(valor ?? '')
    .replace(/\s+(?:Re:?|AA|N|O)\s+[\s\S]*$/i, '')
    .replace(/\s+(?:AA|a)\s*$/i, '')
    .replace(/\s+[A-Za-z]?\s*\d[\s\S]*$/i, '')
    .replace(/\s*[|!—][\s\S]*$/, '')
    .replace(/^[^A-Za-zÀ-Ý]+/, '')
    .replace(/^[A-Za-zÀ-Ý]\s+/, '')
    .replace(/^[^A-Za-zÀ-Ý]+/, '')
    .replace(/[.,;:'"”\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function unicos(valores) {
  const vistos = new Set();
  const saida = [];
  for (const bruto of valores) {
    const valor = String(bruto ?? '').replace(/\s+/g, ' ').trim();
    if (!valor || vistos.has(valor)) continue;
    vistos.add(valor);
    saida.push(valor);
  }
  return saida;
}

function lerArray(html, nome) {
  const encontrado = html.match(new RegExp(`var ${nome} = (\\[[\\s\\S]*?\\]);`));
  if (!encontrado) {
    throw new Error(`Nao encontrei var ${nome} no HTML.`);
  }
  const bruto = encontrado[1];
  try {
    return JSON.parse(bruto);
  } catch {
    // Blocos antigos usam aspas simples; os novos usam JSON (aspas duplas).
    return JSON.parse(bruto.replace(/'/g, '"'));
  }
}

function bloco(nome, lista) {
  return `  var ${nome} = ${JSON.stringify(lista, null, 2)};`;
}

function main() {
  const caminhoLote = process.argv[2] ? path.resolve(process.argv[2]) : ultimoLote();
  const lote = JSON.parse(fs.readFileSync(caminhoLote, 'utf8'));
  const html = fs.readFileSync(PAGINA, 'utf8');

  const orgaosLote = [];
  const destinosLote = [];
  const autoridadesLote = [];

  for (const resultado of lote.resultados || []) {
    const dados = resultado.dados || {};
    if (dados.orgao) orgaosLote.push(limparOrgao(dados.orgao));
    if (dados.destinoExame) destinosLote.push(limparOrgao(dados.destinoExame));
    if (dados.autoridade) autoridadesLote.push(limparAutoridade(dados.autoridade));
  }

  const orgaosLoteLimpos = unicos(orgaosLote).filter((item) => !LIXO_ORGAO.test(item));
  const destinosLoteLimpos = unicos(destinosLote).filter((item) => !LIXO_ORGAO.test(item));
  const autoridadesLoteLimpas = unicos(autoridadesLote);

  const orgaosAtuais = lerArray(html, 'ORGAOS').map(limparOrgao).filter((item) => !LIXO_ORGAO.test(item));
  const autoridadesAtuais = lerArray(html, 'AUTORIDADES').map(limparAutoridade);

  const novosOrgaos = unicos([...orgaosAtuais, ...orgaosLoteLimpos, ...destinosLoteLimpos]);
  const novasAutoridades = unicos([...autoridadesAtuais, ...autoridadesLoteLimpas]);

  let atualizado = html
    .replace(/  var ORGAOS = \[[\s\S]*?\];/, bloco('ORGAOS', novosOrgaos))
    .replace(/  var AUTORIDADES = \[[\s\S]*?\];/, bloco('AUTORIDADES', novasAutoridades));

  if (atualizado === html) {
    throw new Error('Nao consegui substituir os blocos ORGAOS/AUTORIDADES.');
  }

  fs.writeFileSync(PAGINA, atualizado, 'utf8');

  console.log(`Lote: ${path.relative(RAIZ, caminhoLote)}`);
  console.log(`ORGAOS: ${orgaosAtuais.length} -> ${novosOrgaos.length}`);
  console.log(`AUTORIDADES: ${autoridadesAtuais.length} -> ${novasAutoridades.length}`);
  console.log('\nÓrgãos/destinos adicionados:');
  for (const item of [...orgaosLoteLimpos, ...destinosLoteLimpos]) console.log(`  - ${item}`);
  console.log('\nAutoridades adicionadas:');
  for (const item of autoridadesLoteLimpas) console.log(`  - ${item}`);
}

main();
