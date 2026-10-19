'use strict';

/**
 * PROTECAO CONTRA ENVIO.
 *
 * Todo clique e toda digitacao passam por aqui antes de acontecer. Se o alvo
 * parecer um botao de envio, a operacao e recusada e a ferramenta para.
 *
 * A regra e deliberadamente conservadora: na duvida, bloqueia. E melhor o
 * operador preencher um campo na mao do que a ferramenta cadastrar algo sem
 * revisao.
 */

const TEXTOS_PROIBIDOS_PADRAO = [
  'cadastrar',
  'finalizar',
  'enviar',
  'salvar',
  'gravar',
  'confirmar',
  'concluir',
  'submeter',
  'protocolar',
  'registrar',
];

const TIPOS_SUBMIT = ['submit', 'image'];

/**
 * Normaliza texto para comparacao (sem acento, minusculo).
 */
function normalizar(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Avalia um elemento antes de qualquer interacao.
 *
 * @param {object} pagina instancia do Playwright Page
 * @param {object} handle ElementHandle alvo
 * @param {object} protetor bloco _protetor da configuracao
 * @returns {Promise<{permitido: boolean, motivo: string}>}
 */
async function avaliarElemento(pagina, handle, protetor) {
  const textosProibidos = (protetor.textosProibidos || TEXTOS_PROIBIDOS_PADRAO).map(normalizar);
  const seletoresProibidos = protetor.seletoresProibidos || [];

  // Le tudo em uma unica chamada dentro da pagina: menos ida e volta, menos risco.
  const informacoes = await handle.evaluate((elemento) => {
    const atributos = {};
    for (const atributo of elemento.attributes || []) {
      atributos[atributo.name] = atributo.value;
    }
    return {
      tag: elemento.tagName ? elemento.tagName.toLowerCase() : '',
      tipo: (atributos.type || '').toLowerCase(),
      texto: (elemento.innerText || elemento.textContent || '').slice(0, 200),
      atributos,
    };
  });

  // 1. Elementos de submissao nativos.
  if (informacoes.tag === 'button' && informacoes.tipo === 'submit') {
    return { permitido: false, motivo: 'O elemento e um botao de envio do formulario.' };
  }
  if ((informacoes.tag === 'input' || informacoes.tag === 'button') && TIPOS_SUBMIT.includes(informacoes.tipo)) {
    return { permitido: false, motivo: 'O elemento e um controle de envio do formulario.' };
  }

  // 2. Texto visivel com verbo de envio.
  const texto = normalizar(informacoes.texto);
  if (texto !== '') {
    for (const proibido of textosProibidos) {
      if (proibido.length < 3) {
        continue;
      }
      // Compara a palavra inteira: "Cadastrar exame" bloqueia, "Cadastro" nao.
      const expressao = new RegExp(`(^|[^a-z0-9])${proibido}($|[^a-z0-9])`);
      if (expressao.test(texto)) {
        return { permitido: false, motivo: `O elemento tem o texto "${informacoes.texto.trim()}", que indica envio.` };
      }
    }
  }

  // 3. Identificadores suspeitos (id, name, data-action).
  const identificadores = [
    informacoes.atributos.id,
    informacoes.atributos.name,
    informacoes.atributos['data-action'],
    informacoes.atributos['data-testid'],
  ]
    .filter(Boolean)
    .map(normalizar);

  for (const identificador of identificadores) {
    for (const proibido of textosProibidos) {
      if (identificador.includes(proibido)) {
        return { permitido: false, motivo: `O identificador "${identificador}" indica acao de envio.` };
      }
    }
  }

  // 4. Seletores proibidos da configuracao.
  if (seletoresProibidos.length > 0) {
    const combina = await handle.evaluate((elemento, seletores) => {
      for (const seletor of seletores) {
        try {
          if (elemento.matches(seletor)) return true;
        } catch {
          // Seletor invalido na configuracao: ignorado aqui, o validador avisa.
        }
      }
      return false;
    }, seletoresProibidos);
    if (combina) {
      return { permitido: false, motivo: 'O elemento esta na lista de seletores proibidos da configuracao.' };
    }
  }

  // 5. Formulario alvo: se clicar em algo submitaria por Enter, tambem barramos.
  if (informacoes.atributos.onclick && /submit|requestSubmit/i.test(informacoes.atributos.onclick)) {
    return { permitido: false, motivo: 'O elemento dispara envio de formulario ao ser clicado.' };
  }

  return { permitido: true, motivo: '' };
}

/**
 * Valida a configuracao de seletores antes de abrir o navegador.
 * Detecta seletores que apontem claramente para botoes de envio.
 */
function validarConfiguracao(perfil, protetor) {
  const problemas = [];
  const textosProibidos = (protetor.textosProibidos || TEXTOS_PROIBIDOS_PADRAO).map(normalizar);

  for (const aba of perfil.abas || []) {
    for (const campo of aba.campos || []) {
      const seletor = String(campo.seletor || '');
      const normalizado = normalizar(seletor);

      if (/type\s*=\s*['"]?submit/.test(normalizado)) {
        problemas.push(`O seletor do campo "${campo.campo}" aponta para um controle de envio: ${seletor}`);
      }

      for (const proibido of textosProibidos) {
        if (normalizado.includes(`btn-${proibido}`) || normalizado.includes(`botao-${proibido}`) || normalizado.includes(`button-${proibido}`)) {
          problemas.push(`O seletor do campo "${campo.campo}" aponta para um botao de "${proibido}": ${seletor}`);
        }
      }

      if (seletor.includes('SUBSTITUIR')) {
        problemas.push(`O seletor do campo "${campo.campo}" ainda nao foi configurado: ${seletor}`);
      }
    }

    if (aba.seletorAba && String(aba.seletorAba).includes('SUBSTITUIR')) {
      problemas.push(`O seletor da aba "${aba.id}" ainda nao foi configurado.`);
    }
  }

  return problemas;
}

module.exports = { avaliarElemento, validarConfiguracao, normalizar, TEXTOS_PROIBIDOS_PADRAO };
