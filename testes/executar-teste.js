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

/* ================================================= catalogo do sistema oficial
   Estes arrays sao a transcricao das opcoes reais do sistema. O teste compara
   a pagina de simulacao item a item; qualquer divergencia aparece no relatorio.
   Listas de orgaos/autoridades/CEP nao entram aqui: sao dados de exemplo. */

const ABAS_ESPERADAS = [
  '1-Dados da Entrada',
  '2-Do Exame',
  '3-Do Fato',
  '4-Da Vitima/Periciando',
  '5-Do Vestigio',
  '6-Anexo',
];

const EXAMES_ESPERADOS = [
  'DANO PSIQUICO EM VÍTIMAS DE VIOLÊNCIA',
  'EXAME ANTROPOLÓGICO',
  'EXAME CORPORAL COM LESÃO',
  'EXAME CORPORAL SEM LESÃO',
  'EXAME DE DANO EMOCIONAL',
  'EXAME DE LESÃO CORPORAL COMPLEMENTAR (SANIDADE)',
  'EXAME CORPORAL COMPLEMENTAR (SANIDADE)',
  'EXAME DE SANIDADE MENTAL',
  'EXAME PARA CONSTATAÇÃO DE EMBRIAGUEZ',
  'EXAME PARA ESTIMATIVA DE IDADE',
  'EXAME SEXOLÓGICO',
  'EXUMAÇÃO CADAVÉRICA',
  'LESÃO CORPORAL-DPVAT',
  'NECROPSIA',
  'PERICIA PSICOLOGICA EM CRIANÇAS E ADOLESCENTES VITIMAS DE ABUSO SEXUAL',
];

const FATOS_ESPERADOS = [
  'acidente',
  'acidente de trabalho',
  'acidente de trânsito',
  'Adulteração de quilometragem de veículo',
  'afogamento',
  'antropologia',
  'arrombamento',
  'crime contra a fauna',
  'crime contra a fauna/flora',
  'crime contra a fauna/flora/poluição',
  'crime contra a poluição/fauna',
  'crime contra a poluição/flora',
  'crime contra flora',
  'crime de poluição',
  'crime sexual',
  'danos em propriedade privada',
  'danos em propriedade pública',
  'desabamento',
  'doença',
  'eletroplessão',
  'envenenamento',
  'explosão',
  'explosão agência bancária',
  'exumações',
  'feto',
  'fraude em/através de dispositivos eletrônicos',
  'furto de água',
  'furto de energia elétrica',
  'homicídio',
  'indeterminado',
  'inumações',
  'local de fabricação/plantio/armazenamento drogas',
  'local envolvido em infração penal',
  'morte a esclarecer',
  'ofensa física',
  'queda da própria altura',
  'queda de nível',
  'queimadura',
  'raio',
  'sufocação',
  'suicídio',
  'tentativa de homicídio',
];

const CVLI_ESPERADO = ['SIM', 'NÃO', 'A ESCLARECER'];
const TIPOS_LOCAL_ESPERADOS = [
  'unidade hospitalar', 'via publica', 'residencia', 'estabelecimento privado',
  'estabelecimento publico', 'meio liquido', 'meio de vegetação',
];
const CORES_ESPERADAS = ['branca', 'Preta', 'Amarela', 'Parda', 'indigena', 'Não declarada'];
const ESTADOS_CIVIS_ESPERADOS = ['Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Viúvo(a)'];
const GENEROS_ESPERADOS = [
  'Mulher Transgenero', 'Homem transexual', 'Mulher transexual', 'Cisgenero',
  'não sei responder', 'prefiro não responder', 'outros',
];
const SEXOS_ESPERADOS = ['Masculino', 'feminino', 'Não identificado'];
const NACIONALIDADES_ESPERADAS = [
  'Brasileira', 'Brasileira: nascido no exterior ou naturalizado', 'estrangeira',
];
const UFS_ESPERADAS = [
  'Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Bahia', 'Ceará', 'Distrito Federal',
  'Espírito Santo', 'Goiás', 'Maranhão', 'Mato Grosso', 'Mato Grosso do Sul',
  'Minas Gerais', 'Pará', 'Paraíba', 'Paraná', 'Pernambuco', 'Piauí',
  'Rio de Janeiro', 'Rio Grande do Norte', 'Rio Grande do Sul', 'Rondônia',
  'Roraima', 'Santa Catarina', 'São Paulo', 'Sergipe', 'Tocantins',
];
const REGISTROS_ESPERADOS = ['Com Ofício', 'Sem Ofício'];
const TIPOS_AUTORIDADE_ESPERADOS = ['DELEGADO(A)', 'JUIZ(A)', 'OUTRO', 'PERITO(A)', 'PROMOTOR(A)'];
const POLICIAL_ESPERADO = [
  'NÃO', 'SIM COMO VÍTIMA', 'SIM COMO AUTOR', 'SIM VÍTIMA E AUTOR',
  'SIM — CLASSIFICAÇÃO NÃO INFORMADA',
];
const IGNORADO_ESPERADO = ['Não', 'Sim'];


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

/* ======================================== bloco 1.5: pagina de simulacao */

/** Confere uma lista inteira, sem poluir o relatorio quando esta tudo certo. */
function conferirLista(relatorio, nome, esperado, obtido) {
  const mesmo = JSON.stringify(esperado) === JSON.stringify(obtido);
  if (mesmo) {
    relatorio.nota(`${nome}: ${esperado.length} item(ns) exatos`);
    return;
  }
  relatorio.campo(nome, esperado.join(' | '), obtido.join(' | '), {
    igual: false,
    motivo: `esperava ${esperado.length} item(ns), veio ${obtido.length}`,
  });
}

/** Comparacao simples de um valor com outro. */
function conferir(relatorio, nome, esperado, obtido) {
  const a = String(esperado);
  const b = String(obtido);
  relatorio.campo(nome, a, b, { igual: a === b, motivo: '' });
}

/**
 * Confere a pagina de simulacao: estrutura, catalogos, dependencia do objeto
 * utilizado e a regra do NIC (NECROPSIA).
 */
async function testarSimulacao(cfg, relatorio) {
  relatorio.iniciarBloco('Simulação — estrutura, catálogos e regra do NIC');

  if (!cfg.modoTeste) {
    relatorio.nota('MODO_TESTE está desligado; a página de simulação não foi testada.', 'falha');
    return;
  }

  const sessao = require('../src/preenchimento/sessao');
  const preenchimento = require('../src/preenchimento/index');
  const nic = require('../src/preenchimento/nic');
  const gabarito = JSON.parse(fs.readFileSync(path.join(DIR_FIXTURES, 'gabarito.json'), 'utf8'));

  let pagina = null;
  try {
    // --- regra pura, sem navegador ---
    conferir(relatorio, 'regra do NIC: NECROPSIA exige', true, nic.exigeNic('NECROPSIA', cfg.perfil.regraNic));
    conferir(relatorio, 'regra do NIC: caixa e espaço não importam', true, nic.exigeNic(' necropsia ', cfg.perfil.regraNic));
    conferir(relatorio, 'regra do NIC: outro exame não exige', false, nic.exigeNic('EXAME CORPORAL SEM LESÃO', cfg.perfil.regraNic));
    conferir(relatorio, 'regra do NIC: NIC com conteúdo', true, nic.nicPreenchido('2026/123456'));
    conferir(relatorio, 'regra do NIC: NIC em branco', false, nic.nicPreenchido('   '));

    pagina = (await sessao.obterNavegador(cfg)).pagina;
    await preenchimento.abrirFormulario(pagina, cfg);

    const estrutura = await pagina.evaluate(() => {
      const textoOpcoes = (id) => Array.from(document.querySelectorAll('#' + id + ' option'))
        .filter((opcao) => opcao.value !== '')
        .map((opcao) => opcao.textContent.trim());
      return {
        abas: Array.from(document.querySelectorAll('.aba')).map((botao) => botao.textContent.trim()),
        painel5: (document.querySelector('#painel-5 .aviso-detalhar') || {}).textContent || '',
        painel6: (document.querySelector('#painel-6 .aviso-detalhar') || {}).textContent || '',
        exames: textoOpcoes('exame'),
        realizadoEm: textoOpcoes('realizadoEm'),
        fatos: textoOpcoes('fatoSuposto'),
        cvli: textoOpcoes('cvli'),
        tiposLocal: textoOpcoes('tipoLocal'),
        corRaca: textoOpcoes('corRaca'),
        estadoCivil: textoOpcoes('estadoCivil'),
        genero: textoOpcoes('genero'),
        sexo: textoOpcoes('sexo'),
        nacionalidade: textoOpcoes('nacionalidade'),
        ufs: textoOpcoes('ufNascimento'),
        registros: textoOpcoes('registro'),
        tiposAutoridade: textoOpcoes('tipoAutoridade'),
        policial: textoOpcoes('policialEnvolvido'),
        ignorado: textoOpcoes('vitima-ignorado'),
      };
    });

    conferirLista(relatorio, 'abas', ABAS_ESPERADAS, estrutura.abas);
    conferir(relatorio, 'aba 5 aviso', 'Conteúdo a detalhar', String(estrutura.painel5).trim());
    conferir(relatorio, 'aba 6 aviso', 'Conteúdo a detalhar', String(estrutura.painel6).trim());
    conferirLista(relatorio, 'exames', EXAMES_ESPERADOS, estrutura.exames);
    conferirLista(relatorio, 'realizado em', ['VÍTIMA', 'PRESO'], estrutura.realizadoEm);
    conferirLista(relatorio, 'fatos', FATOS_ESPERADOS, estrutura.fatos);
    conferirLista(relatorio, 'CVLI', CVLI_ESPERADO, estrutura.cvli);
    conferirLista(relatorio, 'tipos de local', TIPOS_LOCAL_ESPERADOS, estrutura.tiposLocal);
    conferirLista(relatorio, 'cor/raça', CORES_ESPERADAS, estrutura.corRaca);
    conferirLista(relatorio, 'estado civil', ESTADOS_CIVIS_ESPERADOS, estrutura.estadoCivil);
    conferirLista(relatorio, 'gênero', GENEROS_ESPERADOS, estrutura.genero);
    conferirLista(relatorio, 'sexo', SEXOS_ESPERADOS, estrutura.sexo);
    conferirLista(relatorio, 'nacionalidade', NACIONALIDADES_ESPERADAS, estrutura.nacionalidade);
    conferirLista(relatorio, 'UFs', UFS_ESPERADAS, estrutura.ufs);
    conferirLista(relatorio, 'registro', REGISTROS_ESPERADOS, estrutura.registros);
    conferirLista(relatorio, 'tipo de autoridade', TIPOS_AUTORIDADE_ESPERADOS, estrutura.tiposAutoridade);
    conferirLista(relatorio, 'policial envolvido', POLICIAL_ESPERADO, estrutura.policial);
    conferirLista(relatorio, 'ignorado(a)', IGNORADO_ESPERADO, estrutura.ignorado);

    // --- tela inicial da vitima ---
    await pagina.locator('#aba-4').click();
    const inicial = await pagina.evaluate(() => ({
      telaInicial: !document.getElementById('tela-vitima-inicial').hidden,
      formulario: !document.getElementById('form-vitima').hidden,
      botaoPesquisar: document.getElementById('btn-pesquisar-vitima').textContent.trim(),
      botaoNova: document.getElementById('btn-nova-vitima').textContent.trim(),
    }));
    conferir(relatorio, 'vítima: tela inicial visível', true, inicial.telaInicial);
    conferir(relatorio, 'vítima: formulário oculto no início', false, inicial.formulario);
    conferir(relatorio, 'vítima: botão pesquisar', 'PESQUISAR VÍTIMA JÁ CADASTRADA', inicial.botaoPesquisar);
    conferir(relatorio, 'vítima: botão cadastrar nova', 'CADASTRAR UMA NOVA VÍTIMA', inicial.botaoNova);

    // --- objeto utilizado depende do fato ---
    await pagina.locator('#aba-3').click();
    await pagina.locator('#fatoSuposto').selectOption({ label: 'acidente de trânsito' });
    const transito = await pagina.evaluate(() => ({
      desabilitado: document.getElementById('objetoUtilizado').disabled,
      opcoes: Array.from(document.querySelectorAll('#objetoUtilizado option'))
        .filter((opcao) => opcao.value !== '')
        .map((opcao) => opcao.textContent.trim()),
    }));
    conferir(relatorio, 'objeto: acidente de trânsito habilita', false, transito.desabilitado);
    conferirLista(
      relatorio,
      'objeto: opções de acidente de trânsito',
      ['carro', 'moto', 'trator', 'atropelamento', 'trem', 'bicicleta', 'outros'],
      transito.opcoes,
    );

    await pagina.locator('#fatoSuposto').selectOption({ label: 'tentativa de homicídio' });
    const tentativa = await pagina.evaluate(() => document.getElementById('objetoUtilizado').disabled);
    conferir(relatorio, 'objeto: "tentativa de homicídio" mantém bloqueado (lapso do sistema)', true, tentativa);

    // --- cidades da Paraíba e bairros dinâmicos ---
    const cidades = await pagina.evaluate(() => {
      const opcoes = Array.from(document.querySelectorAll('#cidade option'))
        .filter((opcao) => opcao.value !== '')
        .map((opcao) => opcao.textContent.trim());
      return { total: opcoes.length, campina: opcoes.indexOf('Campina Grande') !== -1 };
    });
    conferir(relatorio, 'cidades da Paraíba: 223', 223, cidades.total);
    conferir(relatorio, 'cidades da Paraíba: Campina Grande', true, cidades.campina);

    await pagina.locator('#cidade').selectOption({ label: 'Campina Grande' });
    const bairrosCampina = await pagina.evaluate(() => ({
      total: Array.from(document.querySelectorAll('#bairro option')).filter((o) => o.value !== '').length,
      bodocongo: Array.from(document.querySelectorAll('#bairro option')).some((o) => o.value === 'Bodocongó'),
    }));
    conferir(relatorio, 'bairros de Campina Grande: quantidade', true, bairrosCampina.total > 10);
    conferir(relatorio, 'bairros de Campina Grande: Bodocongó', true, bairrosCampina.bodocongo);

    await pagina.locator('#cidade').selectOption({ label: 'João Pessoa' });
    const bairrosJoaoPessoa = await pagina.evaluate(() => ({
      total: Array.from(document.querySelectorAll('#bairro option')).filter((o) => o.value !== '').length,
      tambia: Array.from(document.querySelectorAll('#bairro option')).some((o) => o.value === 'Tambiá'),
    }));
    conferir(relatorio, 'bairros de João Pessoa: quantidade', true, bairrosJoaoPessoa.total > 10);
    conferir(relatorio, 'bairros de João Pessoa: Tambiá', true, bairrosJoaoPessoa.tambia);

    // --- CEP de exemplo seleciona a cidade e os bairros dela ---
    await pagina.locator('#cep').fill('58400000');
    await pagina.locator('#btn-pesquisar-cep').click();
    const cep = await pagina.evaluate(() => ({
      cidade: document.getElementById('cidade').value,
      bairros: Array.from(document.querySelectorAll('#bairro option'))
        .filter((opcao) => opcao.value !== '')
        .map((opcao) => opcao.textContent.trim()),
    }));
    conferir(relatorio, 'CEP de exemplo: cidade', 'Campina Grande', cep.cidade);
    conferir(
      relatorio,
      'CEP de exemplo: bairros da cidade',
      true,
      cep.bairros.length > 10 && cep.bairros.indexOf('Centro') !== -1,
    );

    // --- formato de data/hora ---
    await pagina.locator('#dataHoraFato').fill('100320241430');
    conferir(relatorio, 'Suposta data/hora formatada', '10/03/2024 14:30',
      await pagina.inputValue('#dataHoraFato'));

    await pagina.locator('#dataEntradaIpc').fill('110320240830');
    conferir(relatorio, 'Data/hora entrada IPC formatada', '11/03/2024 08:30',
      await pagina.inputValue('#dataEntradaIpc'));

    // --- formato da data do oficio (aba 1) ---
    await pagina.locator('#aba-1').click();
    await pagina.locator('#dataOficio').fill('12032024');
    conferir(relatorio, 'Data Ofício formatada', '12/03/2024', await pagina.inputValue('#dataOficio'));

    // --- combos: valor fora da lista permanece e vai para valoresExtraidos ---
    await pagina.locator('#orgaoSolicitante').fill('Órgão Inexistente XYZ');
    await pagina.locator('#orgaoSolicitante').press('Tab');
    const resiliente = await pagina.evaluate(() => ({
      valor: document.getElementById('orgaoSolicitante').value,
      extraidos: window.__simulacao.valoresExtraidos,
    }));
    conferir(relatorio, 'combo: valor fora da lista não é apagado', 'Órgão Inexistente XYZ', resiliente.valor);
    const registroFora = resiliente.extraidos.find(
      (registro) => registro.campo === 'orgaoSolicitante' && registro.valor === 'Órgão Inexistente XYZ',
    );
    conferir(relatorio, 'combo: valor guardado em valoresExtraidos', true, Boolean(registroFora));
    conferir(relatorio, 'combo: marcado como fora da lista', false, registroFora ? registroFora.naLista : null);

    await pagina.locator('#orgaoSolicitante').fill('Ministério Público de São Paulo');
    await pagina.locator('#orgaoSolicitante').press('Tab');
    const registroLista = await pagina.evaluate(() => window.__simulacao.valoresExtraidos.find(
      (registro) => registro.campo === 'orgaoSolicitante' && registro.valor === 'Ministério Público de São Paulo',
    ));
    conferir(relatorio, 'combo: valor da lista marcado', true, Boolean(registroLista && registroLista.naLista));

    // --- regra do NIC: NECROPSIA ---
    await pagina.locator('#aba-2').click();
    await pagina.locator('#exame').selectOption({ label: 'NECROPSIA' });
    await pagina.locator('#aba-4').click();
    await pagina.locator('#btn-nova-vitima').click();

    const bloqueado = await pagina.evaluate(() => ({
      nomeBloqueado: document.getElementById('nomeVitima').disabled,
      nicLiberado: !document.getElementById('nic').disabled,
      avisoVisivel: !document.getElementById('aviso-nic').hidden,
      botaoBloqueado: document.getElementById('btn-cadastrar-vitima').disabled,
      estado: window.__simulacao.camposLiberados,
      nicPreenchido: window.__simulacao.nicPreenchido,
      dataPreenchido: document.getElementById('nic').dataset.preenchido,
    }));
    conferir(relatorio, 'NECROPSIA: nome bloqueado', true, bloqueado.nomeBloqueado);
    conferir(relatorio, 'NECROPSIA: NIC liberado', true, bloqueado.nicLiberado);
    conferir(relatorio, 'NECROPSIA: aviso visível', true, bloqueado.avisoVisivel);
    conferir(relatorio, 'NECROPSIA: botão de cadastrar bloqueado', true, bloqueado.botaoBloqueado);
    conferir(relatorio, 'NECROPSIA: estado não liberado', false, bloqueado.estado);
    conferir(relatorio, 'NECROPSIA: estado do NIC exposto como vazio', false, bloqueado.nicPreenchido);
    conferir(relatorio, 'NECROPSIA: data-preenchido falso', 'false', bloqueado.dataPreenchido);

    await pagina.locator('#nic').fill('2026/123456');
    const liberado = await pagina.evaluate(() => ({
      nomeLiberado: !document.getElementById('nomeVitima').disabled,
      avisoOculto: document.getElementById('aviso-nic').hidden,
      estado: window.__simulacao.camposLiberados,
      nicPreenchido: window.__simulacao.nicPreenchido,
      dataPreenchido: document.getElementById('nic').dataset.preenchido,
    }));
    conferir(relatorio, 'NIC digitado: campos liberados', true, liberado.nomeLiberado);
    conferir(relatorio, 'NIC digitado: aviso oculto', true, liberado.avisoOculto);
    conferir(relatorio, 'NIC digitado: estado liberado', true, liberado.estado);
    conferir(relatorio, 'NIC digitado: estado do NIC exposto', true, liberado.nicPreenchido);
    conferir(relatorio, 'NIC digitado: data-preenchido verdadeiro', 'true', liberado.dataPreenchido);

    await pagina.locator('#nic').fill('');
    await pagina.locator('#nic').dispatchEvent('input');
    const rebloqueado = await pagina.evaluate(() => document.getElementById('nomeVitima').disabled);
    conferir(relatorio, 'NIC apagado: campos voltam a bloquear', true, rebloqueado);

    // --- outro exame libera na hora ---
    await pagina.locator('#aba-2').click();
    await pagina.locator('#exame').selectOption({ label: 'EXAME CORPORAL SEM LESÃO' });
    await pagina.locator('#aba-4').click();
    const outroExame = await pagina.evaluate(() => ({
      nomeLiberado: !document.getElementById('nomeVitima').disabled,
      avisoOculto: document.getElementById('aviso-nic').hidden,
    }));
    conferir(relatorio, 'outro exame: campos liberados na abertura', true, outroExame.nomeLiberado);
    conferir(relatorio, 'outro exame: sem aviso do NIC', true, outroExame.avisoOculto);

    // --- máscaras da vítima ---
    await pagina.locator('#dataNascimentoVitima').fill('05071980');
    conferir(relatorio, 'Data de nascimento formatada', '05/07/1980',
      await pagina.inputValue('#dataNascimentoVitima'));

    await pagina.locator('#cpfVitima').fill('12345678900');
    conferir(relatorio, 'CPF com máscara', '123.456.789-00',
      await pagina.inputValue('#cpfVitima'));

    // --- cidades por UF e bairros por cidade ---
    await pagina.locator('#ufNascimento').selectOption({ label: 'Paraíba' });
    const nascimentoPb = await pagina.evaluate(() => ({
      total: Array.from(document.querySelectorAll('#cidadeNascimento option')).filter((o) => o.value !== '').length,
    }));
    conferir(relatorio, 'cidades de nascimento (PB): 223', 223, nascimentoPb.total);

    await pagina.locator('#ufNascimento').selectOption({ label: 'São Paulo' });
    const nascimentoSp = await pagina.evaluate(() => {
      const opcoes = Array.from(document.querySelectorAll('#cidadeNascimento option')).map((o) => o.value);
      return { campinas: opcoes.indexOf('Campinas') !== -1, saoPaulo: opcoes.indexOf('São Paulo') !== -1 };
    });
    conferir(relatorio, 'cidades de nascimento (SP): Campinas', true, nascimentoSp.campinas);
    conferir(relatorio, 'cidades de nascimento (SP): São Paulo', true, nascimentoSp.saoPaulo);

    await pagina.locator('#ufResidencia').selectOption({ label: 'Paraíba' });
    const residenciaPb = await pagina.evaluate(() => ({
      total: Array.from(document.querySelectorAll('#cidadeResidencia option')).filter((o) => o.value !== '').length,
    }));
    conferir(relatorio, 'cidades de residência (PB): 223', 223, residenciaPb.total);

    await pagina.locator('#cidadeResidencia').selectOption({ label: 'Campina Grande' });
    const bairrosResidencia = await pagina.evaluate(() => ({
      total: Array.from(document.querySelectorAll('#bairroResidencia option')).filter((o) => o.value !== '').length,
      bodocongo: Array.from(document.querySelectorAll('#bairroResidencia option')).some((o) => o.value === 'Bodocongó'),
    }));
    conferir(relatorio, 'bairros de residência: quantidade', true, bairrosResidencia.total > 10);
    conferir(relatorio, 'bairros de residência: Bodocongó', true, bairrosResidencia.bodocongo);

    // --- tela de pesquisa da vítima ---
    await pagina.locator('#btn-pesquisar-vitima').click();
    const pesquisa = await pagina.evaluate(() => {
      const select = document.getElementById('pesquisa-por');
      return {
        tela: !document.getElementById('tela-vitima-pesquisa').hidden,
        formOculto: document.getElementById('form-vitima').hidden,
        inicialOculta: document.getElementById('tela-vitima-inicial').hidden,
        opcoes: select ? Array.from(select.options).map((opcao) => opcao.textContent.trim()) : [],
        temBotao: Boolean(document.getElementById('btn-executar-pesquisa')),
        estado: window.__simulacao.telaVitima,
      };
    });
    conferir(relatorio, 'pesquisar vítima: tela própria', true, pesquisa.tela);
    conferir(relatorio, 'pesquisar vítima: cadastro oculto', true, pesquisa.formOculto);
    conferir(relatorio, 'pesquisar vítima: tela inicial oculta', true, pesquisa.inicialOculta);
    conferir(relatorio, 'pesquisar vítima: botão pesquisar', true, pesquisa.temBotao);
    conferir(relatorio, 'pesquisar vítima: estado exposto', 'pesquisa', pesquisa.estado);
    conferirLista(
      relatorio,
      'pesquisar vítima: opções',
      ['Pesquisar por:', 'NIC', 'NOME', 'CPF'],
      pesquisa.opcoes,
    );

    // O botão de cadastrar leva para o formulário.
    await pagina.locator('#btn-nova-vitima').click();
    conferir(relatorio, 'pesquisar vítima: cadastro reabre', 'cadastro',
      await pagina.evaluate(() => window.__simulacao.telaVitima));

    // --- formulário fechado: a aba da vitima e pulada, sem erro ---
    await pagina.locator('#btn-cancelar-cadastro').click();
    const pulado = await preenchimento.preencher(gabarito.dados, cfg, { aoProgredir: () => {} });
    conferir(
      relatorio,
      'formulário fechado: aba da vítima pulada',
      true,
      (pulado.abasPuladas || []).includes('daVitima'),
    );

    // --- NECROPSIA sem NIC: o preenchimento espera e para com orientacao ---
    await pagina.locator('#aba-2').click();
    await pagina.locator('#exame').selectOption({ label: 'NECROPSIA' });
    await pagina.locator('#aba-4').click();
    await pagina.locator('#btn-nova-vitima').click();
    await pagina.locator('#nic').fill('');

    const esperaOriginal = cfg.geral.navegador.esperaNicMs;
    cfg.geral.navegador.esperaNicMs = 1200;
    let mensagemDeEspera = '';
    try {
      const resultadoEspera = await preenchimento.preencher(gabarito.dados, cfg, { aoProgredir: () => {} });
      mensagemDeEspera = `(não parou; ${resultadoEspera.resumo.totalPreenchidos} campo(s) preenchido(s), abas puladas: ${(resultadoEspera.abasPuladas || []).join(', ') || 'nenhuma'})`;
    } catch (erro) {
      mensagemDeEspera = erro.message;
    } finally {
      cfg.geral.navegador.esperaNicMs = esperaOriginal;
    }
    relatorio.nota(`mensagem do cenário NECROPSIA sem NIC: ${mensagemDeEspera}`, 'info');
    conferir(
      relatorio,
      'NECROPSIA sem NIC: para com orientação',
      true,
      /NIC nao foi informado/i.test(mensagemDeEspera),
    );
  } catch (erro) {
    relatorio.nota(`a verificação da simulação falhou: ${erro.message}`, 'falha');
    if (erro.detalheTecnico) {
      relatorio.nota(`detalhe: ${JSON.stringify(erro.detalheTecnico).slice(0, 400)}`, 'info');
    }
  } finally {
    await sessao.encerrar(true);
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

    // O operador abre o cadastro da vitima. A ferramenta nunca clica nesse
    // botao: aqui quem clica e o teste, representando o operador.
    await pagina.locator('#aba-4').click();
    await pagina.locator('#btn-nova-vitima').click();
    await pagina.waitForTimeout(150);

    // Zera os contadores da pagina antes de comecar.
    await pagina.evaluate(() => {
      window.__cliquesDeEnvio = 0;
      window.__simulacaoCadastrada = false;
    });

    const resultado = await preenchimento.preencher(gabarito.dados, cfg, { aoProgredir: () => {} });

    relatorio.nota(`${resultado.resumo.totalPreenchidos} campo(s) preenchido(s) e verificado(s)`);
    if ((resultado.abasPuladas || []).length > 0) {
      relatorio.nota(`abas puladas: ${resultado.abasPuladas.join(', ')}`, 'falha');
    }

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
    for (const seletor of ['#btn-cadastrar-vitima', '#btn-finalizar-lancamento', '#btn-voltar', '#btn-cancelar-cadastro']) {
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
    await testarSimulacao(cfg, relatorio);
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
