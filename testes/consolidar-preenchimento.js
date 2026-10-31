'use strict';

/**
 * Consolida os lotes de preenchimento dos blocos em um unico relatorio final,
 * com o nivel de acerto por arquivo e global.
 *
 * Uso:
 *   node testes/consolidar-preenchimento.js bloco1.json bloco2.json bloco3.json
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const SAIDA = path.join(RAIZ, 'testes', 'saida');

function carimbo() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function resumo(registros = []) {
  const ok = registros.filter((r) => r.status === 'ok').length;
  const fora = registros.filter((r) => r.status === 'fora-da-lista').length;
  const falhas = registros.filter((r) => r.status === 'falha').length;
  const semDado = registros.filter((r) => r.status === 'sem-dado').length;
  const avaliados = ok + fora + falhas;
  const total = avaliados + semDado;
  return {
    ok,
    fora,
    falhas,
    semDado,
    acertoPreenchimento: avaliados > 0 ? (ok / avaliados) * 100 : 0,
    acertoExtracao: total > 0 ? ((ok + fora) / total) * 100 : 0,
  };
}

function main() {
  const caminhos = process.argv.slice(2).filter(Boolean);
  if (caminhos.length === 0) {
    console.error('Informe os JSONs dos blocos. Exemplo: node testes/consolidar-preenchimento.js bloco1.json bloco2.json bloco3.json');
    process.exit(1);
  }

  const arquivos = [];
  for (const caminho of caminhos) {
    const lote = JSON.parse(fs.readFileSync(path.resolve(caminho), 'utf8'));
    for (const arquivo of lote.arquivos || []) {
      arquivos.push({ ...arquivo, bloco: path.basename(caminho) });
    }
  }

  if (arquivos.length === 0) {
    console.error('Nenhum arquivo encontrado nos JSONs informados.');
    process.exit(1);
  }

  const validos = arquivos.filter((a) => !a.erro);
  const comErro = arquivos.filter((a) => a.erro);

  let totalOk = 0;
  let totalFora = 0;
  let totalFalhas = 0;
  let totalSemDado = 0;
  let totalCliques = 0;
  let cadastrada = false;
  for (const arquivo of validos) {
    const s = resumo(arquivo.registros || []);
    totalOk += s.ok;
    totalFora += s.fora;
    totalFalhas += s.falhas;
    totalSemDado += s.semDado;
    totalCliques += arquivo.cliques || 0;
    cadastrada = cadastrada || Boolean(arquivo.cadastrada);
  }
  const avaliados = totalOk + totalFora + totalFalhas;
  const totalCampos = avaliados + totalSemDado;
  const acertoPreenchimento = avaliados > 0 ? (totalOk / avaliados) * 100 : 0;
  const acertoExtracao = totalCampos > 0 ? ((totalOk + totalFora) / totalCampos) * 100 : 0;

  const verificacoes = [];
  for (const arquivo of validos) {
    for (const verificacao of arquivo.verificacoes || []) {
      verificacoes.push({ arquivo: path.basename(arquivo.caminho), ...verificacao });
    }
  }
  const verificacoesOk = verificacoes.filter((v) => v.ok).length;
  const verificacoesFalha = verificacoes.filter((v) => !v.ok);

  const linhas = [];
  linhas.push('# Lote final de preenchimento — FillForm', '');
  linhas.push(`- Arquivos no lote: ${arquivos.length}`);
  linhas.push(`- Extraídos e preenchidos: ${validos.length}`);
  linhas.push(`- Falhas de extração: ${comErro.length}`);
  linhas.push(`- Campos preenchidos e conferidos: ${totalOk}`);
  linhas.push(`- Digitados fora da lista (valor permaneceu): ${totalFora}`);
  linhas.push(`- Falhas de preenchimento: ${totalFalhas}`);
  linhas.push(`- Sem dado extraído: ${totalSemDado}`);
  linhas.push(`- **Nível de acerto de preenchimento:** ${acertoPreenchimento.toFixed(1)}% (${totalOk}/${avaliados})`);
  linhas.push(`- **Nível de acerto de extração:** ${acertoExtracao.toFixed(1)}% (${totalOk + totalFora}/${totalCampos})`);
  linhas.push(`- Cliques de envio: ${totalCliques} (${cadastrada ? 'ALGO FOI CADASTRADO' : 'nada foi cadastrado'})`);
  linhas.push(`- Verificações da simulação: ${verificacoesOk}/${verificacoes.length} OK`);
  linhas.push('');

  linhas.push('## Resumo por arquivo', '');
  linhas.push('| Arquivo | Preenchidos | Fora | Falhas | Sem dado | Acerto | Cliques | Extração | Preenchimento |');
  linhas.push('|---|---|---|---|---|---|---|---|---|');
  for (const arquivo of arquivos) {
    if (arquivo.erro) {
      linhas.push(`| ${path.basename(arquivo.caminho)} | - | - | - | - | - | - | ${((arquivo.msExtracao || 0) / 1000).toFixed(2)} s | - |`);
      continue;
    }
    const s = resumo(arquivo.registros || []);
    linhas.push(
      `| ${path.basename(arquivo.caminho)} | ${s.ok} | ${s.fora} | ${s.falhas} | ${s.semDado} | ${s.acertoPreenchimento.toFixed(1)}% | ${arquivo.cliques || 0} | ${((arquivo.msExtracao || 0) / 1000).toFixed(2)} s | ${((arquivo.msPreenchimento || 0) / 1000).toFixed(2)} s |`,
    );
  }
  linhas.push('');

  if (comErro.length > 0) {
    linhas.push('## Falhas de extração', '');
    for (const arquivo of comErro) {
      linhas.push(`### ${path.basename(arquivo.caminho)}`, '');
      linhas.push(`- ${arquivo.erro}`);
      linhas.push('');
    }
  }

  if (verificacoesFalha.length > 0) {
    linhas.push('## Verificações com falha', '');
    for (const v of verificacoesFalha) {
      linhas.push(`- ${v.arquivo}: ${v.nome} (${v.valor})`);
    }
    linhas.push('');
  }

  const fora = [];
  const falhas = [];
  for (const arquivo of validos) {
    for (const registro of arquivo.registros || []) {
      if (registro.status === 'fora-da-lista') {
        fora.push({ arquivo: path.basename(arquivo.caminho), ...registro });
      }
      if (registro.status === 'falha') {
        falhas.push({ arquivo: path.basename(arquivo.caminho), ...registro });
      }
    }
  }
  if (fora.length > 0) {
    linhas.push('## Valores fora da lista', '');
    linhas.push('| Arquivo | Campo | Valor |');
    linhas.push('|---|---|---|');
    for (const f of fora) {
      linhas.push(`| ${f.arquivo} | ${f.campo} | ${String(f.lido || f.esperado || '').replace(/\|/g, '\\|').slice(0, 160)} |`);
    }
    linhas.push('');
  }
  if (falhas.length > 0) {
    linhas.push('## Falhas de preenchimento', '');
    linhas.push('| Arquivo | Campo | Esperado | Lido | Motivo |');
    linhas.push('|---|---|---|---|---|');
    for (const f of falhas) {
      linhas.push(`| ${f.arquivo} | ${f.campo} | ${f.esperado || ''} | ${f.lido || ''} | ${String(f.erro || '').replace(/\|/g, '\\|').slice(0, 180)} |`);
    }
    linhas.push('');
  }

  const base = path.join(SAIDA, `lote-preenchimento-final-${carimbo()}`);
  const texto = linhas.join('\n');
  fs.writeFileSync(base + '.md', texto, 'utf8');
  fs.writeFileSync(
    base + '.json',
    JSON.stringify({
      geradoEm: new Date().toISOString(),
      totais: {
        arquivos: arquivos.length,
        validos: validos.length,
        comErro: comErro.length,
        totalOk,
        totalFora,
        totalFalhas,
        totalSemDado,
        acertoPreenchimento,
        acertoExtracao,
        totalCliques,
        cadastrada,
        verificacoesOk,
        verificacoesTotal: verificacoes.length,
      },
      arquivos,
    }, null, 2),
    'utf8',
  );

  console.log(texto.split('\n').slice(0, 18).join('\n'));
  console.log('\nRelatorio final: ' + path.relative(RAIZ, base + '.md'));
  console.log('JSON final: ' + path.relative(RAIZ, base + '.json'));
}

main();
