'use strict';

/**
 * Executa uma ou mais requisicoes reais de ponta a ponta:
 *   1. le cada PDF/imagem com o motor de extracao do projeto;
 *   2. monta o JSON dos campos mapeados;
 *   3. abre a pagina de simulacao e preenche campo a campo;
 *   4. confere CPF, datas e as listas dinamicas de cidade/bairro;
 *   5. grava um relatorio individual e um consolidado.
 *
 * O preenchimento e feito campo a campo de proposito: o orquestrador normal
 * para no primeiro erro, e aqui queremos saber TUDO o que passou e o que falhou.
 * A ferramenta nunca clica em botao de envio; o unico clique de "operador" e
 * abrir o cadastro da vitima, que no sistema real e feito por uma pessoa.
 *
 * Uso: node testes/executar-requisicao-real.js "req1.pdf" "req2.pdf" ...
 */

const fs = require('node:fs');
const path = require('node:path');

const config = require('../src/nucleo/config');
const registro = require('../src/nucleo/registro');
const extracao = require('../src/extracao');
const preenchimento = require('../src/preenchimento/index');
const { preencherCampo } = require('../src/preenchimento/campos');
const sessao = require('../src/preenchimento/sessao');
const ocr = require('../src/extracao/ocr');

const RAIZ = path.resolve(__dirname, '..');
const SAIDA = path.join(RAIZ, 'testes', 'saida');

function carimbo() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function comparavel(valor) {
  return String(valor ?? '').replace(/\s+/g, ' ').trim();
}

function equivalentes(a, b) {
  const x = comparavel(a).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const y = comparavel(b).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return x === y || (x !== '' && (x.includes(y) || y.includes(x)));
}

async function lerValorNaTela(pagina, seletor) {
  try {
    return await pagina
      .locator(seletor)
      .first()
      .evaluate((elemento) => String(elemento.value ?? ''))
      .catch(() => '');
  } catch {
    return '';
  }
}

async function abrirAba(pagina, aba, opcoes) {
  if (!aba.seletorAba) return;
  await pagina
    .locator(aba.seletorAba)
    .first()
    .click({ timeout: opcoes.timeoutMs })
    .catch(() => {});
  await pagina.waitForTimeout(150);
}

/**
 * Abre o cadastro da vitima como o OPERADOR faria. A ferramenta nao faz isso.
 * @returns {Promise<boolean>} se o formulario ficou visivel
 */
async function garantirFormularioVitima(pagina, aba, opcoes) {
  const visivel = await pagina
    .locator(aba.requerFormularioAberto)
    .first()
    .isVisible()
    .catch(() => false);

  if (visivel) return true;

  const botao = pagina.locator('#btn-nova-vitima').first();
  const existe = await botao.isVisible().catch(() => false);
  if (!existe) return false;

  await botao.click({ timeout: opcoes.timeoutMs }).catch(() => {});
  await pagina.waitForTimeout(250);

  return pagina
    .locator(aba.requerFormularioAberto)
    .first()
    .isVisible()
    .catch(() => false);
}

async function preencherCampos(pagina, cfg, dados) {
  const opcoes = {
    timeoutMs: cfg.geral.navegador.timeoutPadraoMs || 20000,
    atrasoDigitacaoMs: cfg.geral.navegador.atrasoDigitacaoMs ?? 8,
    esperaEstabilizacaoMs: cfg.geral.navegador.esperaEstabilizacaoMs ?? 300,
    esperaNicMs: 60000,
  };

  const registros = [];

  for (const aba of cfg.perfil.abas || []) {
    await abrirAba(pagina, aba, opcoes);

    if (aba.requerFormularioAberto) {
      const abriu = await garantirFormularioVitima(pagina, aba, opcoes);
      if (!abriu) {
        for (const definicao of aba.campos || []) {
          registros.push({
            aba: aba.id,
            campo: definicao.campo,
            status: 'aba-indisponivel',
            detalhe: `O formulario "${aba.requerFormularioAberto}" nao abriu.`,
          });
        }
        continue;
      }
    }

    for (const definicao of aba.campos || []) {
      const valor = dados[definicao.campo];
      const descricao = cfg.campos.find((c) => c.id === definicao.campo)?.descricao
        || definicao.campo;

      if (valor === undefined || valor === null || String(valor).trim() === '') {
        registros.push({
          aba: aba.id,
          campo: definicao.campo,
          seletor: definicao.seletor,
          descricao,
          status: 'sem-dado',
          esperado: '',
        });
        continue;
      }

      try {
        const resultado = await preencherCampo(
          pagina,
          definicao,
          String(valor),
          { campoId: definicao.campo, abaId: aba.id, descricao },
          cfg.protetor,
          opcoes,
        );
        registros.push({
          aba: aba.id,
          campo: definicao.campo,
          seletor: definicao.seletor,
          descricao,
          status: 'ok',
          esperado: String(valor),
          lido: resultado.valorLido,
        });
      } catch (erro) {
        const lido = await lerValorNaTela(pagina, definicao.seletor);
        const permaneceu = equivalentes(valor, lido);
        registros.push({
          aba: aba.id,
          campo: definicao.campo,
          seletor: definicao.seletor,
          descricao,
          status: permaneceu ? 'fora-da-lista' : 'falha',
          esperado: String(valor),
          lido,
          valorNaTela: permaneceu,
          erro: erro.message,
          detalhe: erro.detalheTecnico || '',
        });
      }
    }
  }

  return registros;
}

/**
 * Confere, na propria simulacao, as formatacoes e as listas dinamicas.
 * Nao clica em botao de envio: so le campos e troca opcoes de <select>.
 */
async function verificarSimulacao(pagina) {
  const verificacoes = [];

  await pagina.locator('#aba-4').click().catch(() => {});
  const cpf = await pagina.locator('#cpfVitima').inputValue().catch(() => '');
  verificacoes.push({
    nome: 'CPF com máscara XXX.XXX.XXX-XX',
    ok: /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(cpf),
    valor: cpf,
  });

  const nascimento = await pagina.locator('#dataNascimentoVitima').inputValue().catch(() => '');
  verificacoes.push({
    nome: 'Data de nascimento dd/mm/aaaa',
    ok: /^\d{2}\/\d{2}\/\d{4}$/.test(nascimento),
    valor: nascimento,
  });

  await pagina.locator('#aba-3').click().catch(() => {});
  const dataFato = await pagina.locator('#dataHoraFato').inputValue().catch(() => '');
  verificacoes.push({
    nome: 'Data/hora do fato dd/mm/aaaa hh:mm',
    ok: /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(dataFato),
    valor: dataFato,
  });

  await pagina.locator('#cidade').selectOption({ label: 'Campina Grande' }).catch(() => {});
  const bairrosCampina = await pagina
    .evaluate(() => Array.from(document.querySelectorAll('#bairro option')).map((o) => o.value))
    .catch(() => []);
  verificacoes.push({
    nome: 'Bairros dinâmicos de Campina Grande',
    ok: bairrosCampina.includes('Bodocongó'),
    valor: `${bairrosCampina.length} bairro(s)`,
  });

  await pagina.locator('#cidade').selectOption({ label: 'João Pessoa' }).catch(() => {});
  const bairrosJoaoPessoa = await pagina
    .evaluate(() => Array.from(document.querySelectorAll('#bairro option')).map((o) => o.value))
    .catch(() => []);
  verificacoes.push({
    nome: 'Bairros dinâmicos de João Pessoa',
    ok: bairrosJoaoPessoa.includes('Tambiá'),
    valor: `${bairrosJoaoPessoa.length} bairro(s)`,
  });

  await pagina.locator('#aba-4').click().catch(() => {});
  await pagina.locator('#ufNascimento').selectOption({ label: 'Paraíba' }).catch(() => {});
  const cidadesPb = await pagina
    .evaluate(() => Array.from(document.querySelectorAll('#cidadeNascimento option'))
      .filter((o) => o.value !== '').length)
    .catch(() => 0);
  verificacoes.push({
    nome: 'Cidades da Paraíba por UF',
    ok: cidadesPb === 223,
    valor: `${cidadesPb} cidade(s)`,
  });

  await pagina.locator('#ufResidencia').selectOption({ label: 'Paraíba' }).catch(() => {});
  await pagina.locator('#cidadeResidencia').selectOption({ label: 'Campina Grande' }).catch(() => {});
  const bairrosResidencia = await pagina
    .evaluate(() => Array.from(document.querySelectorAll('#bairroResidencia option')).map((o) => o.value))
    .catch(() => []);
  verificacoes.push({
    nome: 'Bairros de residência por cidade',
    ok: bairrosResidencia.includes('Bodocongó'),
    valor: `${bairrosResidencia.length} bairro(s)`,
  });

  return verificacoes;
}

function montarRelatorio({
  caminho,
  dados,
  meta,
  msExtracao,
  msPreenchimento,
  msVerificacoes,
  registros,
  cliques,
  cadastrada,
  verificacoes,
  cfg,
  erroGeral,
}) {
  const linhas = [];
  linhas.push('# Requisição real — extração e preenchimento', '');
  linhas.push(`- Arquivo: \`${caminho}\``);
  linhas.push(`- Data: ${new Date().toLocaleString('pt-BR')}`);
  linhas.push('');

  if (erroGeral) {
    linhas.push('## Falha na extração', '', erroGeral, '');
    return linhas.join('\n');
  }

  linhas.push('## Leitura', '');
  linhas.push(`- Via: ${meta.viaDeLeitura}`);
  if (meta.layout) {
    linhas.push(`- Layout: ${meta.layout}`);
  }
  if (meta.confianca !== null && meta.confianca !== undefined) {
    linhas.push(`- Confiança do OCR: ${meta.confianca}%`);
  }
  if (Array.isArray(meta.avisos) && meta.avisos.length > 0) {
    linhas.push(`- Avisos: ${meta.avisos.join(' ')}`);
  }
  linhas.push(`- Tempo de extração: ${(msExtracao / 1000).toFixed(2)} s`);
  linhas.push(`- Tempo de preenchimento: ${(msPreenchimento / 1000).toFixed(2)} s`);
  linhas.push(`- Tempo de verificação: ${((msVerificacoes || 0) / 1000).toFixed(2)} s`);
  linhas.push(`- Tempo total: ${(((msExtracao + msPreenchimento + (msVerificacoes || 0))) / 1000).toFixed(2)} s`);
  linhas.push('');

  linhas.push('## JSON extraído', '', '```json', JSON.stringify(dados, null, 2), '```', '');

  const semDestino = (cfg.camposSemDestino || []).filter((campo) => dados[campo] !== undefined);
  if (semDestino.length > 0) {
    linhas.push('## Campos extraídos sem destino na simulação', '');
    for (const campo of semDestino) {
      linhas.push(`- \`${campo}\`: ${JSON.stringify(dados[campo])}`);
    }
    linhas.push('');
  }

  linhas.push('## Campos preenchidos', '');
  const ok = registros.filter((r) => r.status === 'ok');
  const fora = registros.filter((r) => r.status === 'fora-da-lista');
  const falhas = registros.filter((r) => r.status === 'falha');
  const semDado = registros.filter((r) => r.status === 'sem-dado');

  if (ok.length === 0) {
    linhas.push('_Nenhum campo preenchido._', '');
  } else {
    linhas.push('| Aba | Campo (seletor) | Valor |');
    linhas.push('|---|---|---|');
    for (const r of ok) {
      linhas.push(`| ${r.aba} | \`${r.campo}\` (${r.seletor}) | ${r.lido || r.esperado} |`);
    }
    linhas.push('');
  }

  linhas.push('## Digitados fora da lista', '');
  if (fora.length === 0) {
    linhas.push('_Nenhum._', '');
  } else {
    linhas.push('| Aba | Campo (seletor) | Valor digitado | Observação |');
    linhas.push('|---|---|---|---|');
    for (const r of fora) {
      const motivo = (r.erro || '').replace(/\|/g, '\\|').slice(0, 180);
      linhas.push(`| ${r.aba} | \`${r.campo}\` (${r.seletor}) | ${r.lido} | Valor permaneceu no campo; ${motivo} |`);
    }
    linhas.push('');
  }

  linhas.push('## Falhas', '');
  if (falhas.length === 0) {
    linhas.push('_Nenhuma falha de preenchimento._', '');
  } else {
    linhas.push('| Aba | Campo (seletor) | Valor esperado | Valor na tela | Motivo |');
    linhas.push('|---|---|---|---|---|');
    for (const r of falhas) {
      const motivo = (r.erro || '').replace(/\|/g, '\\|').slice(0, 220);
      linhas.push(`| ${r.aba} | \`${r.campo}\` (${r.seletor}) | ${r.esperado} | ${r.lido || '(vazio)'} | ${motivo} |`);
    }
    linhas.push('');
  }

  if (semDado.length > 0) {
    linhas.push('## Campos mapeados sem dado extraído', '');
    for (const r of semDado) {
      linhas.push(`- \`${r.campo}\` (${r.aba}, ${r.seletor})`);
    }
    linhas.push('');
  }

  if (Array.isArray(verificacoes) && verificacoes.length > 0) {
    linhas.push('## Verificações da simulação', '');
    linhas.push('| Verificação | Resultado | Valor |');
    linhas.push('|---|---|---|');
    for (const verificacao of verificacoes) {
      linhas.push(`| ${verificacao.nome} | ${verificacao.ok ? 'OK' : 'FALHA'} | ${verificacao.valor} |`);
    }
    linhas.push('');
  }

  linhas.push('## Resumo', '');
  linhas.push(`- Preenchidos e conferidos: ${ok.length}`);
  linhas.push(`- Digitados fora da lista (valor permaneceu): ${fora.length}`);
  linhas.push(`- Falhas: ${falhas.length}`);
  linhas.push(`- Sem dado extraído: ${semDado.length}`);
  linhas.push(`- Cliques de envio: ${cliques} (${cadastrada ? 'ALGO FOI CADASTRADO' : 'nada foi cadastrado'})`);
  linhas.push('');

  return linhas.join('\n');
}

function resumoRegistros(registros) {
  return {
    ok: registros.filter((r) => r.status === 'ok').length,
    fora: registros.filter((r) => r.status === 'fora-da-lista').length,
    falhas: registros.filter((r) => r.status === 'falha').length,
    semDado: registros.filter((r) => r.status === 'sem-dado').length,
  };
}

async function processarArquivo(caminho, cfg, pagina, baseArquivo) {
  const resultado = { caminho, baseArquivo, erro: null, dados: {}, meta: {} };

  console.log(`\nArquivo: ${caminho}`);
  console.log('Extraindo com o motor do projeto...');

  const inicioExtracao = Date.now();
  try {
    const buffer = fs.readFileSync(caminho);
    const extraido = await extracao.processar(
      { buffer, nomeArquivo: path.basename(caminho) },
      cfg,
      (mensagem) => console.log('  extracao: ' + mensagem),
    );
    resultado.dados = extraido.dados;
    resultado.meta = extraido.meta;
    resultado.msExtracao = Date.now() - inicioExtracao;
  } catch (erro) {
    resultado.msExtracao = Date.now() - inicioExtracao;
    resultado.erro = `${erro.message}\n\n\`\`\`\n${erro.detalheTecnico || ''}\n\`\`\``;
    resultado.relatorio = montarRelatorio({
      caminho,
      dados: {},
      meta: {},
      msExtracao: resultado.msExtracao,
      msPreenchimento: 0,
      msVerificacoes: 0,
      registros: [],
      cliques: 0,
      cadastrada: false,
      verificacoes: [],
      cfg,
      erroGeral: resultado.erro,
    });
    console.error('A extracao falhou:', erro.message);
    return resultado;
  }

  console.log('JSON extraido:');
  console.log(JSON.stringify(resultado.dados, null, 2));
  console.log(`Meta: ${JSON.stringify(resultado.meta)}`);
  console.log(`Extracao: ${(resultado.msExtracao / 1000).toFixed(2)} s`);

  fs.writeFileSync(
    baseArquivo + '.json',
    JSON.stringify({
      caminho,
      extraidoEm: new Date().toISOString(),
      msExtracao: resultado.msExtracao,
      dados: resultado.dados,
      meta: resultado.meta,
    }, null, 2),
    'utf8',
  );

  console.log('Abrindo a pagina de simulacao...');
  const inicioPreenchimento = Date.now();
  let registros = [];
  let cliques = 0;
  let cadastrada = false;
  let verificacoes = [];
  let msPreenchimento = 0;
  let msVerificacoes = 0;

  try {
    // Recarrega para cada requisicao: o formulario comeca limpo.
    await pagina.reload({ waitUntil: 'domcontentloaded' });
    await preenchimento.abrirFormulario(pagina, cfg);
    await pagina.bringToFront().catch(() => {});

    // O operador abre o cadastro da vitima antes de a ferramenta preencher.
    const abaVitima = (cfg.perfil.abas || []).find((aba) => aba.requerFormularioAberto);
    if (abaVitima) {
      await abrirAba(pagina, abaVitima, {
        timeoutMs: cfg.geral.navegador.timeoutPadraoMs || 20000,
      });
      await garantirFormularioVitima(pagina, abaVitima, {
        timeoutMs: cfg.geral.navegador.timeoutPadraoMs || 20000,
      });
    }

    await pagina.evaluate(() => {
      window.__cliquesDeEnvio = 0;
      window.__simulacaoCadastrada = false;
    });

    registros = await preencherCampos(pagina, cfg, resultado.dados);
    msPreenchimento = Date.now() - inicioPreenchimento;

    cliques = await pagina.evaluate(() => window.__cliquesDeEnvio ?? 0);
    cadastrada = await pagina.evaluate(() => window.__simulacaoCadastrada ?? false);

    // Evidencia dos numeros na aba 1 e dos dados da vitima na aba 4.
    await pagina.locator('#aba-1').click({ timeout: 5000 }).catch(() => {});
    await pagina.locator('.conteudo').evaluate((el) => { el.scrollTop = 0; }).catch(() => {});
    await pagina.waitForTimeout(150);
    await pagina.screenshot({ path: baseArquivo + '-aba1.png', fullPage: false });

    await pagina.locator('#aba-4').click({ timeout: 5000 }).catch(() => {});
    await pagina.locator('.conteudo').evaluate((el) => { el.scrollTop = 0; }).catch(() => {});
    await pagina.waitForTimeout(150);
    await pagina.screenshot({ path: baseArquivo + '.png', fullPage: false });

    const inicioVerificacoes = Date.now();
    verificacoes = await verificarSimulacao(pagina);
    msVerificacoes = Date.now() - inicioVerificacoes;
  } catch (erro) {
    msPreenchimento = Date.now() - inicioPreenchimento;
    console.error('Falha ao preencher:', erro.message);
    registros.push({
      aba: '(geral)',
      campo: '(preenchimento)',
      status: 'falha',
      esperado: '',
      erro: erro.message,
      detalhe: erro.detalheTecnico || '',
    });
  }

  resultado.msPreenchimento = msPreenchimento;
  resultado.msVerificacoes = msVerificacoes;
  resultado.registros = registros;
  resultado.cliques = cliques;
  resultado.cadastrada = cadastrada;
  resultado.verificacoes = verificacoes;
  resultado.relatorio = montarRelatorio({
    caminho,
    dados: resultado.dados,
    meta: resultado.meta,
    msExtracao: resultado.msExtracao,
    msPreenchimento,
    msVerificacoes,
    registros,
    cliques,
    cadastrada,
    verificacoes,
    cfg,
  });

  return resultado;
}

function montarConsolidado(resultados, cfg) {
  const linhas = [];
  linhas.push('# Lote de preenchimento real', '');
  const comExtracao = resultados.filter((r) => !r.erro);
  linhas.push(`- Arquivos: ${resultados.length}`);
  linhas.push(`- Extraídos e preenchidos: ${comExtracao.length}`);
  linhas.push(`- Falhas de extração: ${resultados.filter((r) => r.erro).length}`);
  linhas.push(`- Tempo total: ${(resultados.reduce((soma, r) => soma + (r.msExtracao || 0) + (r.msPreenchimento || 0) + (r.msVerificacoes || 0), 0) / 1000).toFixed(2)} s`);
  linhas.push('');

  linhas.push('## Resumo', '');
  linhas.push('| Arquivo | Preenchidos | Fora da lista | Falhas | Sem dado | Cliques de envio | Extração | Preenchimento | Verificação |');
  linhas.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of resultados) {
    if (r.erro) {
      linhas.push(`| ${path.basename(r.caminho)} | - | - | - | - | - | ${(r.msExtracao / 1000).toFixed(2)} s | - | - |`);
      continue;
    }
    const s = resumoRegistros(r.registros);
    linhas.push(
      `| ${path.basename(r.caminho)} | ${s.ok} | ${s.fora} | ${s.falhas} | ${s.semDado} | ${r.cliques} | ${(r.msExtracao / 1000).toFixed(2)} s | ${(r.msPreenchimento / 1000).toFixed(2)} s | ${(r.msVerificacoes / 1000).toFixed(2)} s |`,
    );
  }
  linhas.push('');

  const todasVerificacoes = [];
  for (const r of comExtracao) {
    for (const verificacao of r.verificacoes || []) {
      todasVerificacoes.push({ arquivo: path.basename(r.caminho), ...verificacao });
    }
  }
  if (todasVerificacoes.length > 0) {
    linhas.push('## Verificações da simulação', '');
    linhas.push('| Arquivo | Verificação | Resultado | Valor |');
    linhas.push('|---|---|---|---|');
    for (const v of todasVerificacoes) {
      linhas.push(`| ${v.arquivo} | ${v.nome} | ${v.ok ? 'OK' : 'FALHA'} | ${v.valor} |`);
    }
    linhas.push('');
  }

  for (const r of resultados) {
    linhas.push('---', '', r.relatorio || '');
  }

  return linhas.join('\n');
}

async function main() {
  const caminhos = process.argv.slice(2).filter(Boolean);
  if (caminhos.length === 0) {
    console.error('Informe ao menos um caminho. Exemplo: node testes/executar-requisicao-real.js "C:\\...\\requisicao.pdf"');
    process.exit(1);
  }

  fs.mkdirSync(SAIDA, { recursive: true });
  const cfg = config.carregar();
  registro.configurar(path.join(SAIDA, 'logs'), 'AVISO');

  const marcador = carimbo();
  const baseLote = path.join(SAIDA, `lote-preenchimento-${marcador}`);
  const resultados = [];

  try {
    const { pagina } = await sessao.obterNavegador(cfg);

    for (let indice = 0; indice < caminhos.length; indice += 1) {
      const caminho = caminhos[indice];
      if (!fs.existsSync(caminho)) {
        resultados.push({
          caminho,
          erro: 'Arquivo nao encontrado.',
          msExtracao: 0,
          msPreenchimento: 0,
          relatorio: `# Requisição real — extração e preenchimento\n\n- Arquivo: \`${caminho}\`\n\n## Falha na extração\n\nArquivo nao encontrado.\n`,
        });
        continue;
      }

      const baseArquivo = path.join(SAIDA, `requisicao-real-${marcador}-${indice + 1}`);
      const resultado = await processarArquivo(caminho, cfg, pagina, baseArquivo);
      resultados.push(resultado);

      if (resultado.relatorio) {
        fs.writeFileSync(baseArquivo + '.md', resultado.relatorio, 'utf8');
        console.log('Relatorio individual: ' + path.relative(RAIZ, baseArquivo + '.md'));
      }
    }
  } finally {
    await sessao.encerrar(true);
    await ocr.encerrar().catch(() => {});
  }

  const consolidado = montarConsolidado(resultados, cfg);
  fs.writeFileSync(baseLote + '.md', consolidado, 'utf8');
  fs.writeFileSync(
    baseLote + '.json',
    JSON.stringify({
      geradoEm: new Date().toISOString(),
      arquivos: resultados.map((r) => ({
        caminho: r.caminho,
        erro: r.erro || null,
        msExtracao: r.msExtracao || 0,
        msPreenchimento: r.msPreenchimento || 0,
        msVerificacoes: r.msVerificacoes || 0,
        dados: r.dados || {},
        meta: r.meta || {},
        registros: r.registros || [],
        cliques: r.cliques || 0,
        cadastrada: Boolean(r.cadastrada),
        verificacoes: r.verificacoes || [],
      })),
    }, null, 2),
    'utf8',
  );

  console.log('\n' + consolidado);
  console.log('\nRelatorio consolidado: ' + path.relative(RAIZ, baseLote + '.md'));
  console.log('JSON consolidado: ' + path.relative(RAIZ, baseLote + '.json'));

  const falhas = resultados.filter((r) => r.erro).length;
  process.exit(falhas > 0 ? 1 : 0);
}

main().catch((erro) => {
  console.error('Falha inesperada:', erro);
  process.exit(1);
});
