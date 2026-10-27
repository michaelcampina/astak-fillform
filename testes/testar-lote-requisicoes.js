'use strict';

/**
 * Roda a extracao em varios PDFs reais e gera um relatorio consolidado.
 *
 * Uso:
 *   node testes/testar-lote-requisicoes.js "arquivo1.pdf" "arquivo2.pdf" ...
 *
 * Para cada arquivo: layout reconhecido, via de leitura, campos extraidos,
 * campos obrigatorios ausentes, avisos, tempo e erro (se houver).
 * Os dados completos ficam no JSON ao lado do relatorio.
 */

const fs = require('node:fs');
const path = require('node:path');

const config = require('../src/nucleo/config');
const registro = require('../src/nucleo/registro');
const extracao = require('../src/extracao');
const ocr = require('../src/extracao/ocr');

const RAIZ = path.resolve(__dirname, '..');
const SAIDA = path.join(RAIZ, 'testes', 'saida');

function carimbo() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function fmtSegundos(ms) {
  return (ms / 1000).toFixed(2) + ' s';
}

async function main() {
  const caminhos = process.argv.slice(2).filter(Boolean);
  if (caminhos.length === 0) {
    console.error('Informe os caminhos dos PDFs.');
    process.exit(1);
  }

  fs.mkdirSync(SAIDA, { recursive: true });
  const cfg = config.carregar();
  registro.configurar(path.join(SAIDA, 'logs'), 'AVISO');

  const marcador = carimbo();
  const baseArquivo = path.join(SAIDA, `lote-requisicoes-${marcador}`);
  const resultados = [];
  const inicioLote = Date.now();

  for (let indice = 0; indice < caminhos.length; indice += 1) {
    const caminho = caminhos[indice];
    const nome = path.basename(caminho);
    const inicio = Date.now();
    const registroArquivo = {
      arquivo: nome,
      caminho,
      status: 'falha',
      layout: null,
      via: null,
      confianca: null,
      ms: 0,
      campos: [],
      obrigatoriosAusentes: [],
      opcionaisAusentes: [],
      avisos: [],
      dados: null,
      erro: null,
      detalhe: null,
    };

    try {
      if (!fs.existsSync(caminho)) {
        throw new Error('Arquivo nao encontrado.');
      }
      const buffer = fs.readFileSync(caminho);
      const resultado = await extracao.processar(
        { buffer, nomeArquivo: nome },
        cfg,
        () => {},
      );
      const ms = Date.now() - inicio;
      const dados = resultado.dados || {};
      const layout = resultado.meta.layout || 'padrao';
      const obrigatoriosAusentes = cfg.campos
        .filter((campo) => campo.obrigatorio && !(campo.id in dados))
        .map((campo) => campo.id);
      const opcionaisAusentes = cfg.campos
        .filter((campo) => !campo.obrigatorio && !(campo.id in dados))
        .map((campo) => campo.id);

      registroArquivo.status = layout === 'requisicao-pb'
        ? (obrigatoriosAusentes.length === 0 ? 'padrao' : 'padrao-incompleto')
        : 'outro-layout';
      registroArquivo.layout = layout;
      registroArquivo.via = resultado.meta.viaDeLeitura;
      registroArquivo.confianca = resultado.meta.confianca;
      registroArquivo.ms = ms;
      registroArquivo.campos = Object.keys(dados);
      registroArquivo.obrigatoriosAusentes = obrigatoriosAusentes;
      registroArquivo.opcionaisAusentes = opcionaisAusentes;
      registroArquivo.avisos = resultado.meta.avisos || [];
      registroArquivo.dados = dados;

      console.log(
        `[${indice + 1}/${caminhos.length}] ${nome}: ${layout} · ${registroArquivo.campos.length} campos` +
        `${obrigatoriosAusentes.length ? ' · FALTAM ' + obrigatoriosAusentes.join(',') : ''} · ${fmtSegundos(ms)}`,
      );
    } catch (erro) {
      registroArquivo.ms = Date.now() - inicio;
      registroArquivo.erro = erro.message;
      registroArquivo.detalhe = erro.detalheTecnico
        ? (typeof erro.detalheTecnico === 'string'
          ? erro.detalheTecnico
          : JSON.stringify(erro.detalheTecnico))
        : null;
      console.log(`[${indice + 1}/${caminhos.length}] ${nome}: FALHA · ${erro.message}`);
    }

    resultados.push(registroArquivo);
  }

  await ocr.encerrar().catch(() => {});

  const totalMs = Date.now() - inicioLote;
  const padrao = resultados.filter((r) => r.status === 'padrao');
  const padraoIncompleto = resultados.filter((r) => r.status === 'padrao-incompleto');
  const outroLayout = resultados.filter((r) => r.status === 'outro-layout');
  const falhas = resultados.filter((r) => r.status === 'falha');

  const linhas = [];
  linhas.push('# Lote de requisições reais — extração', '');
  linhas.push(`- Arquivos: ${resultados.length}`);
  const comAvisoRg = padrao.filter((r) => (r.avisos || []).some((a) => /RG/i.test(a))).length;
  linhas.push(`- Layout padrão (sem obrigatório ausente): ${padrao.length}${comAvisoRg ? ` (${comAvisoRg} com aviso de RG)` : ''}`);
  linhas.push(`- Layout padrão com obrigatório ausente: ${padraoIncompleto.length}`);
  linhas.push(`- Outro layout: ${outroLayout.length}`);
  linhas.push(`- Falhas de extração: ${falhas.length}`);
  linhas.push(`- Tempo total: ${fmtSegundos(totalMs)}`);
  linhas.push('');

  linhas.push('## Resumo por arquivo', '');
  linhas.push('| Arquivo | Status | Layout | Via | Campos | Obrigatórios ausentes | Avisos | Tempo |');
  linhas.push('|---|---|---|---|---|---|---|---|');
  for (const r of resultados) {
    const status = r.status === 'falha' ? 'FALHA' : r.status;
    const aviso = (r.avisos || []).join(' ').replace(/\|/g, '\\|');
    linhas.push(
      `| ${r.arquivo} | ${status} | ${r.layout || '-'} | ${r.via || '-'} | ${r.campos.length} | ${r.obrigatoriosAusentes.join(', ') || '-'} | ${aviso ? aviso.slice(0, 140) : '-'} | ${fmtSegundos(r.ms)} |`,
    );
  }
  linhas.push('');

  if (padrao.length > 0) {
    linhas.push('## Layout padrão — campos-chave', '');
    linhas.push('| Arquivo | Nº requisição | Nome | CPF | Data requisição | Exame |');
    linhas.push('|---|---|---|---|---|---|');
    for (const r of padrao) {
      linhas.push(
        `| ${r.arquivo} | ${r.dados.numeroRequisicao || '-'} | ${r.dados.nomeExaminado || '-'} | ${r.dados.cpf || '-'} | ${r.dados.dataRequisicao || '-'} | ${r.dados.tipoExame || '-'} |`,
      );
    }
    linhas.push('');
  }

  if (padraoIncompleto.length > 0) {
    linhas.push('## Layout padrão incompleto', '');
    for (const r of padraoIncompleto) {
      linhas.push(`### ${r.arquivo}`, '');
      linhas.push(`- Obrigatórios ausentes: ${r.obrigatoriosAusentes.join(', ')}`);
      if (r.avisos.length > 0) linhas.push(`- Avisos: ${r.avisos.join(' ')}`);
      linhas.push(`- Campos lidos: ${r.campos.join(', ')}`);
      linhas.push('');
    }
  }

  if (outroLayout.length > 0) {
    linhas.push('## Outros layouts', '');
    for (const r of outroLayout) {
      linhas.push(`- ${r.arquivo}: layout ${r.layout}, ${r.campos.length} campo(s), via ${r.via}`);
    }
    linhas.push('');
  }

  if (falhas.length > 0) {
    linhas.push('## Falhas de extração', '');
    for (const r of falhas) {
      linhas.push(`### ${r.arquivo}`, '');
      linhas.push(`- Erro: ${r.erro}`);
      if (r.detalhe) linhas.push(`- Detalhe: ${r.detalhe.slice(0, 500)}`);
      linhas.push('');
    }
  }

  const texto = linhas.join('\n');
  fs.writeFileSync(baseArquivo + '.md', texto, 'utf8');
  fs.writeFileSync(
    baseArquivo + '.json',
    JSON.stringify({
      geradoEm: new Date().toISOString(),
      totalMs,
      resultados,
    }, null, 2),
    'utf8',
  );

  console.log('\n' + texto);
  console.log('\nRelatorio: ' + path.relative(RAIZ, baseArquivo + '.md'));
  console.log('JSON: ' + path.relative(RAIZ, baseArquivo + '.json'));
}

main().catch((erro) => {
  console.error('Falha no lote:', erro);
  process.exit(1);
});
