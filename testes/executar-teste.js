'use strict';

/**
 * Runner de testes da ferramenta.
 *
 * Tres blocos, rodaveis juntos ou separados:
 *
 *   1. EXTRACAO   - le as tres fixtures e compara com o gabarito, campo a campo.
 *   2. PREENCHIMENTO - abre a pagina de simulacao, preenche e confere o que ficou
 *                      nos campos, sem clicar em nada de envio.
 *   3. PROTECAO   - verifica que nenhum clique de envio foi disparado e que o
 *                      protetor recusa elementos de envio.
 *
 * Uso:
 *   npm run teste              (tudo, modo simulacao obrigatorio)
 *   npm run teste:extracao     (so extracao)
 *   npm run teste:preenchimento(so preenchimento)
 *
 * Saida: relatorio legivel no console + arquivo em testes/saida/.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const DIR_SAIDA = path.join(RAIZ, 'testes', 'saida');
const DIR_FIXTURES = path.join(RAIZ, 'testes', 'fixtures');

const config = require('../src/nucleo/config');
const registro = require('../src/nucleo/registro');
const extracao = require('../src/extracao');

/** Cores para o terminal. Desligadas quando a saida vai para arquivo. */
const cores = process.stdout.isTTY
  ? { ok: '\x1b[32m', erro: '\x1b[31m', aviso: '\x1b[33m', fraco: '\x1b[90m', fim: '\x1b[0m' }
  : { ok: '', erro: '', aviso: '', fraco: '', fim: '' };

/* ====================================================== comparacao de texto */

/**
 * Normaliza para comparacao: espacos, pontuacao tipografica e acento.
 *
 * Por que tolerar a pontuacao: o OCR frequentemente troca travessao por hifen
 * e aspas curvas por retas. Isso nao e erro de dado, e ruido de leitura.
 */
function normalizarParaComparar(texto) {
  return String(texto ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[—–−]/g, '-')
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Distancia de edicao (Levenshtein), limitada para nao pesar em textos longos.
 * Usada apenas para medir o tamanho da divergencia, nunca para "aprovar" sozinha.
 */
function distanciaDeEdicao(a, b) {
  const s = [...a];
  const t = [...b];
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;

  let anterior = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    const atual = [i];
    for (let j = 1; j <= t.length; j += 1) {
      const custo = s[i - 1] === t[j - 1] ? 0 : 1;
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + custo);
    }
    anterior = atual;
  }
  return anterior[t.length];
}

/**
 * Compara dois valores segundo a tolerancia declarada no gabarito.
 *
 * @param {string} esperado valor de referencia
 * @param {string} obtido valor extraido
 * @param {string} [tolerancia] 'pontuacao' | 'ocr'
 * @returns {{igual: boolean, motivo: string, divergencia?: number}}
 */
function compararValor(esperado, obtido, tolerancia) {
  const a = normalizarParaComparar(esperado);
  const b = normalizarParaComparar(obtido);

  if (a === b) {
    return { igual: true, motivo: '' };
  }

  if (tolerancia === 'pontuacao') {
    // Ignora toda a pontuacao e a caixa.
    const chave = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (chave(a) === chave(b)) {
      return { igual: true, motivo: 'equivalente (diferença apenas de pontuação)' };
    }
  }

  /**
   * Tolerancia 'ocr': para campos de texto longo.
   *
   * O OCR erra acento de forma esporadica em palavras longas (ex.: "periciado"
   * virou "períciado" com 94% de confianca). Isso NAO e o mesmo que ler o campo
   * errado, e bloquear a operacao por causa de um acento seria desproporcional:
   * o operador recebe o valor numa tabela editavel e corrige.
   *
   * Aprovamos somente quando a divergencia e pequena em relacao ao tamanho do
   * texto: no maximo 1 caractere errado a cada 40. E o resultado NAO sai como
   * "OK" silencioso: vira aviso no relatorio pedindo revisao daquele campo.
   */
  if (tolerancia === 'ocr') {
    const distancia = distanciaDeEdicao(a.toLowerCase(), b.toLowerCase());
    const limite = Math.max(1, Math.floor(a.length / 40));
    if (distancia <= limite) {
      return {
        igual: true,
        motivo: `${distancia} caractere(s) diferente(s) — conferir este campo no sistema`,
        divergencia: distancia,
      };
    }
    return { igual: false, motivo: `${distancia} caracteres diferentes (acima do limite de ${limite})`, divergencia: distancia };
  }

  return { igual: false, motivo: 'valores diferentes' };
}

/* ============================================================== relatorio */

/** Acumula resultados e produz o relatorio final. */
class Relatorio {
  constructor() {
    this.blocos = [];
    this.blocoAtual = null;
  }

  iniciarBloco(titulo) {
    this.blocoAtual = { titulo, linhas: [], falhas: 0, avisos: 0 };
    this.blocos.push(this.blocoAtual);
  }

  /** Linha de resultado de campo. */
  campo(nome, esperado, obtido, resultado) {
    const { igual, motivo } = resultado;
    if (!igual) this.blocoAtual.falhas += 1;
    else if (motivo) this.blocoAtual.avisos += 1;

    this.blocoAtual.linhas.push({
      nome,
      esperado,
      obtido,
      igual,
      motivo,
    });
  }

  /** Linha informativa, sem comparacao. */
  nota(texto, tipo = 'info') {
    this.blocoAtual.linhas.push({ nota: texto, tipo });
    if (tipo === 'falha') this.blocoAtual.falhas += 1;
    if (tipo === 'aviso') this.blocoAtual.avisos += 1;
  }

  get totalFalhas() {
    return this.blocos.reduce((soma, b) => soma + b.falhas, 0);
  }

  get totalAvisos() {
    return this.blocos.reduce((soma, b) => soma + b.avisos, 0);
  }

  /** Imprime no console e devolve o texto em markdown. */
  imprimir() {
    const linhas = [];

    for (const bloco of this.blocos) {
      const marca = bloco.falhas === 0
        ? `${cores.ok}OK${cores.fim}`
        : `${cores.erro}${bloco.falhas} falha(s)${cores.fim}`;
      console.log(`\n${bloco.titulo}  [${marca}]`);
      linhas.push(`## ${bloco.titulo}`, '');

      for (const l of bloco.linhas) {
        if (l.nota !== undefined) {
          const prefixo = l.tipo === 'falha' ? `${cores.erro}x${cores.fim}` : l.tipo === 'aviso' ? `${cores.aviso}!${cores.fim}` : `${cores.fraco}-${cores.fim}`;
          console.log(`  ${prefixo} ${l.nota}`);
          linhas.push(`- ${l.tipo === 'falha' ? '**FALHA:** ' : l.tipo === 'aviso' ? '**AVISO:** ' : ''}${l.nota}`);
          continue;
        }

        if (l.igual) {
          const extra = l.motivo ? ` ${cores.fraco}(${l.motivo})${cores.fim}` : '';
          console.log(`  ${cores.ok}OK${cores.fim} ${l.nome}${extra}`);
          linhas.push(`- OK — ${l.nome}${l.motivo ? ` (${l.motivo})` : ''}`);
        } else {
          console.log(`  ${cores.erro}DIFERENTE${cores.fim} ${l.nome}`);
          console.log(`      esperado: ${cores.fraco}${JSON.stringify(l.esperado)}${cores.fim}`);
          console.log(`      obtido:   ${cores.fraco}${JSON.stringify(l.obtido)}${cores.fim}`);
          linhas.push(
            `- **DIFERENTE** — ${l.nome}`,
            `  - esperado: \`${JSON.stringify(l.esperado)}\``,
            `  - obtido: \`${JSON.stringify(l.obtido)}\``,
          );
        }
      }
      linhas.push('');
    }

    return linhas.join('\n');
  }
}

/* ===================================================== bloco 1: extracao */

/**
 * Testa a extracao das tres fixtures contra o gabarito.
 * @param {object} cfg configuracao carregada
 * @param {Relatorio} relatorio
 */
async function testarExtracao(cfg, relatorio) {
  const gabarito = JSON.parse(fs.readFileSync(path.join(DIR_FIXTURES, 'gabarito.json'), 'utf8'));
  const tolerancias = gabarito.tolerancia || {};

  const fixtures = [
    { arquivo: 'requisicao-digital.pdf', descricao: 'PDF digital (texto real)' },
    { arquivo: 'requisicao-escaneada.pdf', descricao: 'PDF escaneado (OCR)' },
    { arquivo: 'requisicao-imagem.png', descricao: 'Imagem (OCR)' },
  ];

  for (const { arquivo, descricao } of fixtures) {
    const caminho = path.join(DIR_FIXTURES, arquivo);

    if (!fs.existsSync(caminho)) {
      relatorio.iniciarBloco(`Extração — ${descricao}`);
      relatorio.nota(`Fixture ausente: ${arquivo}. Rode "npm run exemplos".`, 'falha');
      continue;
    }

    relatorio.iniciarBloco(`Extração — ${descricao}`);

    try {
      const buffer = fs.readFileSync(caminho);
      const inicio = Date.now();
      const resultado = await extracao.processar(
        { buffer, nomeArquivo: arquivo },
        cfg,
        () => {},
      );
      const duracao = Date.now() - inicio;

      relatorio.nota(`via de leitura: ${resultado.meta.viaDeLeitura} · ${duracao} ms`);
      if (resultado.meta.confianca !== null && resultado.meta.confianca !== undefined) {
        relatorio.nota(`confiança média do OCR: ${resultado.meta.confianca}%`);
      }

      // Compara campo a campo, na ordem do gabarito.
      // A tolerancia sobe para 'ocr' nos campos de texto longo quando a leitura
      // veio de OCR: nesse caminho, um acento trocado em palavra longa e ruido
      // de leitura, nao erro de campo. O relatorio marca esses casos como aviso.
      const viaOcr = String(resultado.meta.viaDeLeitura || '').startsWith('ocr');
      const camposDeTextoLongo = new Set(['fatos', 'observacoes']);

      for (const [campoId, esperado] of Object.entries(gabarito.dados)) {
        const obtido = resultado.dados[campoId];
        const tolerancia = viaOcr && camposDeTextoLongo.has(campoId)
          ? 'ocr'
          : tolerancias[campoId];
        relatorio.campo(
          campoId,
          esperado,
          obtido === undefined ? '(não extraído)' : obtido,
          compararValor(esperado, obtido, tolerancia),
        );
      }

      // Campo extraido que o gabarito nao espera tambem e divergencia.
      for (const campoId of Object.keys(resultado.dados)) {
        if (!(campoId in gabarito.dados)) {
          relatorio.nota(`campo não previsto no gabarito: ${campoId}`, 'aviso');
        }
      }
    } catch (erro) {
      relatorio.nota(`a extração falhou: ${erro.message}`, 'falha');
      if (erro.detalheTecnico) {
        relatorio.nota(`detalhe: ${JSON.stringify(erro.detalheTecnico).slice(0, 400)}`, 'info');
      }
    }
  }
}

/* ================================================ bloco 2: preenchimento */

/**
 * Abre a pagina de simulacao, preenche e confere os campos, sem enviar.
 * @param {object} cfg configuracao carregada
 * @param {Relatorio} relatorio
 */
async function testarPreenchimento(cfg, relatorio) {
  relatorio.iniciarBloco('Preenchimento — página de simulação');

  if (!cfg.modoTeste) {
    relatorio.nota(
      'MODO_TESTE está desligado. O teste de preenchimento só roda em simulação; ' +
      'ligue MODO_TESTE em config/configuracao.json.',
      'falha',
    );
    return;
  }

  const gabarito = JSON.parse(fs.readFileSync(path.join(DIR_FIXTURES, 'gabarito.json'), 'utf8'));
  const tolerancias = gabarito.tolerancia || {};
  const preenchimento = require('../src/preenchimento/index');
  const sessao = require('../src/preenchimento/sessao');

  let pagina = null;
  try {
    const navegador = await sessao.obterNavegador(cfg);
    pagina = navegador.pagina;

    await preenchimento.abrirFormulario(pagina, cfg);

    // Zera os contadores da pagina antes de comecar.
    await pagina.evaluate(() => {
      window.__cliquesDeEnvio = 0;
      window.__simulacaoCadastrada = false;
    });

    const resultado = await preenchimento.preencher(gabarito.dados, cfg, { aoProgredir: () => {} });

    relatorio.nota(`${resultado.resumo.totalPreenchidos} campo(s) preenchido(s) e verificado(s)`);

    // Le o que realmente ficou na tela, campo por campo.
    for (const aba of cfg.perfil.abas) {
      // Abre a aba para poder ler os campos dela.
      if (aba.seletorAba) {
        await pagina.locator(aba.seletorAba).first().click();
        await pagina.waitForTimeout(120);
      }

      for (const definicao of aba.campos || []) {
        const esperado = gabarito.dados[definicao.campo];
        if (esperado === undefined) continue;

        const localizador = pagina.locator(definicao.seletor).first();

        // Em <select>, o value e o texto visivel podem ser diferentes: o sistema
        // guarda "IML" no value e mostra "Instituto Médico Legal" na tela. Os dois
        // sao respostas corretas, entao lemos ambos e aceitamos qualquer um.
        const lido = await localizador.evaluate((el) => {
          if (el.tagName === 'SELECT') {
            const opcao = el.options[el.selectedIndex];
            return {
              texto: opcao ? opcao.textContent.trim() : '',
              valor: el.value,
            };
          }
          return { texto: String(el.value ?? ''), valor: String(el.value ?? '') };
        }).catch(() => ({ texto: '(campo não encontrado)', valor: '' }));

        const comparacaoTexto = compararValor(esperado, lido.texto, tolerancias[definicao.campo]);
        const comparacaoValor = comparacaoTexto.igual
          ? comparacaoTexto
          : compararValor(esperado, lido.valor, tolerancias[definicao.campo]);

        // Quando a acerto veio pelo value e nao pelo texto, o motivo e reescrito
        // para o operador entender: nao e divergencia, e a forma do <select>.
        let resultado;
        if (comparacaoTexto.igual) {
          resultado = comparacaoTexto;
        } else if (comparacaoValor.igual) {
          resultado = {
            igual: true,
            motivo: `opção "${lido.texto}" registrada no sistema (valor interno "${lido.valor}")`,
          };
        } else {
          resultado = comparacaoTexto;
        }

        relatorio.campo(
          `${aba.id} › ${definicao.campo}`,
          esperado,
          lido.texto === lido.valor ? lido.texto : `${lido.texto} (valor: ${lido.valor})`,
          resultado,
        );
      }
    }

    // --- verificacao anti-envio ---
    const cliques = await pagina.evaluate(() => window.__cliquesDeEnvio ?? 0);
    const cadastrada = await pagina.evaluate(() => window.__simulacaoCadastrada ?? false);

    if (cliques === 0 && cadastrada === false) {
      relatorio.nota('nenhum clique de envio disparado; nada foi cadastrado');
    } else {
      relatorio.nota(
        `A FERRAMENTA ENVIOU DADOS: ${cliques} clique(s) de envio e cadastro=${cadastrada}`,
        'falha',
      );
    }

    // --- protetor recusa botoes de envio ---
    const protetor = require('../src/preenchimento/protetor');
    for (const seletor of ['#btn-cadastrar', '#btn-finalizar', '#btn-enviar', '#btn-salvar']) {
      const elemento = await pagina.$(seletor);
      if (!elemento) {
        relatorio.nota(`botão ${seletor} não existe na página de simulação`, 'aviso');
        continue;
      }
      const avaliacao = await protetor.avaliarElemento(pagina, elemento, cfg.protetor);
      if (avaliacao.permitido) {
        relatorio.nota(`o protetor PERMITIU interagir com ${seletor}`, 'falha');
      } else {
        relatorio.nota(`protetor bloqueou ${seletor} (${avaliacao.motivo})`);
      }
    }
  } catch (erro) {
    relatorio.nota(`o preenchimento falhou: ${erro.message}`, 'falha');
    if (erro.detalheTecnico) {
      relatorio.nota(`detalhe: ${erro.detalheTecnico}`, 'info');
    }
  } finally {
    // Fecha SO a sessao de teste; o uso normal mantem a janela aberta.
    await sessao.encerrar(true);
  }
}

/* ======================================================== ponto de entrada */

async function principal() {
  fs.mkdirSync(DIR_SAIDA, { recursive: true });

  const argumentos = process.argv.slice(2);
  const apenasExtracao = argumentos.includes('--extracao');
  const apenasPreenchimento = argumentos.includes('--preenchimento');

  console.log('Preenchedor de Requisições de Exame — testes');
  console.log(`Projeto: ${RAIZ}`);

  // O log dos testes nao deve poluir a pasta de auditoria da operacao.
  registro.configurar(path.join(DIR_SAIDA, 'logs'), 'AVISO');

  let cfg;
  try {
    cfg = config.carregar();
  } catch (erro) {
    console.error(`\nConfiguração inválida: ${erro.message}`);
    process.exit(1);
  }

  const relatorio = new Relatorio();

  if (!apenasPreenchimento) {
    await testarExtracao(cfg, relatorio);
  }
  if (!apenasExtracao) {
    await testarPreenchimento(cfg, relatorio);
  }

  const markdown = relatorio.imprimir();

  const totalFalhas = relatorio.totalFalhas;
  const totalAvisos = relatorio.totalAvisos;

  console.log('\n' + '-'.repeat(60));
  if (totalFalhas === 0) {
    console.log(`${cores.ok}TODOS OS TESTES PASSARAM${cores.fim}  (${totalAvisos} aviso(s))`);
  } else {
    console.log(`${cores.erro}${totalFalhas} FALHA(S)${cores.fim}  (${totalAvisos} aviso(s))`);
  }

  // Salva o relatorio para consulta e para anexar ao aceite.
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const arquivoRelatorio = path.join(DIR_SAIDA, `relatorio-${carimbo}.md`);
  const cabecalho = [
    '# Relatório de testes',
    '',
    `- Data: ${new Date().toLocaleString('pt-BR')}`,
    `- Modo: ${cfg.modoTeste ? 'simulação' : 'sistema oficial'}`,
    `- Resultado: ${totalFalhas === 0 ? 'aprovado' : `${totalFalhas} falha(s)`}`,
    `- Avisos: ${totalAvisos}`,
    '',
  ].join('\n');

  fs.writeFileSync(arquivoRelatorio, cabecalho + markdown, 'utf8');
  console.log(`Relatório salvo em: ${path.relative(RAIZ, arquivoRelatorio)}`);

  // Encerra o OCR para o processo nao ficar pendurado.
  try {
    await require('../src/extracao/ocr').encerrar();
  } catch {
    // Sem problema: o worker pode nunca ter sido criado.
  }

  process.exit(totalFalhas === 0 ? 0 : 1);
}

if (require.main === module) {
  principal().catch((erro) => {
    console.error('Falha inesperada nos testes:', erro);
    process.exit(1);
  });
}

module.exports = { principal, compararValor, normalizarParaComparar };
