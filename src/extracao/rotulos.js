'use strict';

/**
 * Deteccao de rotulos no texto extraido.
 *
 * O layout da requisicao e fixo, entao a estrategia e simples e deterministica:
 *   1. Todo texto vindo do PDF/OCR e normalizado (sem acento, caixa alta),
 *      mantendo um MAPA de posicoes entre o texto normalizado e o original.
 *   2. Para cada campo configurado, procuramos o rotulo no texto normalizado.
 *   3. O valor e o que vem depois do rotulo (ate o fim da linha).
 *   4. Campo multilinha segue consumindo linhas ate esbarrar em outro rotulo.
 *   5. O recorte do valor usa o mapa de posicoes, nunca um "chute" de
 *      deslocamento: acentos mudam o comprimento do texto e isso corrompia
 *      valores como "Orgao Requisitante: Ministerio Publico".
 *
 * Nao ha heuristica "inteligente" nem modelo de linguagem: so casamento de texto.
 */

/** Marcas combinantes geradas pela decomposicao NFD. */
const MARCAS = /[\u0300-\u036f]/g;
const ESPACO_INQUEBRAVEL = /\u00a0/g;

/**
 * Normaliza um texto para comparacao, devolvendo tambem o mapa de posicoes.
 *
 * mapa[i] = indice, no texto ORIGINAL, do caractere que gerou saida[i].
 * Com ele conseguimos recortar o valor original sem depender de somar ou
 * subtrair diferencas de comprimento (que erram quando ha acentos).
 *
 * @param {string} texto
 * @returns {{normalizado: string, mapa: number[]}}
 */
function normalizarComMapa(texto) {
  const original = String(texto ?? '');
  const pontos = [...original];

  let bruto = '';
  const mapaBruto = [];
  let posicaoOriginal = 0;

  for (const ponto of pontos) {
    const semAcento = ponto.normalize('NFD').replace(MARCAS, '');
    const convertido = semAcento.replace(ESPACO_INQUEBRAVEL, ' ').toUpperCase();
    for (const caractere of convertido) {
      bruto += caractere;
      mapaBruto.push(posicaoOriginal);
    }
    posicaoOriginal += ponto.length;
  }

  // Colapsa espacos repetidos mantendo o mapa sincronizado.
  let normalizado = '';
  const mapa = [];
  let espacoAnterior = false;
  for (let i = 0; i < bruto.length; i += 1) {
    const caractere = bruto[i];
    const ehEspaco = caractere === ' ' || caractere === '\t';
    if (ehEspaco) {
      if (espacoAnterior) continue;
      normalizado += ' ';
      mapa.push(mapaBruto[i]);
      espacoAnterior = true;
      continue;
    }
    normalizado += caractere;
    mapa.push(mapaBruto[i]);
    espacoAnterior = false;
  }

  // Trim nas duas pontas, ajustando o mapa na mesma medida.
  let inicio = 0;
  let fim = normalizado.length;
  while (inicio < fim && normalizado[inicio] === ' ') inicio += 1;
  while (fim > inicio && normalizado[fim - 1] === ' ') fim -= 1;

  return { normalizado: normalizado.slice(inicio, fim), mapa: mapa.slice(inicio, fim) };
}

/** Normaliza apenas para comparacao (sem mapa). */
function normalizar(texto) {
  return normalizarComMapa(texto).normalizado;
}

/** Versao "para exibicao", que preserva acentos mas normaliza espacos. */
function limparLinha(texto) {
  return String(texto ?? '').replace(ESPACO_INQUEBRAVEL, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Monta o indice de rotulos: para cada rotulo, qual campo ele corresponde.
 * Rotulos mais longos sao testados primeiro para evitar que "Pai" case antes
 * de "Nome do Pai".
 */
function montarIndiceRotulos(campos) {
  const entradas = [];
  for (const campo of campos) {
    for (const rotulo of campo.rotulos || []) {
      const normalizado = normalizar(rotulo);
      if (normalizado === '') continue;
      entradas.push({
        campoId: campo.id,
        rotulo,
        normalizado,
        // Rótulos de uma palavra ("Exame", "Local", "Pai") são perigosos: eles
        // também aparecem no meio de frases. Só os aceitamos seguidos de
        // dois-pontos, a não ser que o campo peça o contrário na configuração.
        aceitarSemDoisPontos: Boolean(campo.aceitarSemDoisPontos),
      });
    }
  }
  entradas.sort((a, b) => b.normalizado.length - a.normalizado.length);
  return entradas;
}

/** Caracteres aceitos imediatamente depois do rotulo. */
const DEPOIS_DO_ROTULO = /[\s:.\-–—]/;

/** Existe dois-pontos logo depois do rotulo (tolerando espacos no meio)? */
function temDoisPontosDepois(linhaNormalizada, fimRotulo) {
  return /^\s*:/.test(linhaNormalizada.slice(fimRotulo, fimRotulo + 3));
}

/** O rotulo ocupa a linha inteira (valor vem na linha de baixo)? */
function rotuloTerminaALinha(linhaNormalizada, fimRotulo) {
  return linhaNormalizada.slice(fimRotulo).replace(/[\s:.\-–—]+/, '') === '';
}

/**
 * Verifica se a linha comeca com algum rotulo conhecido.
 * @returns {{campoId: string, rotulo: string, entrada: object, fimRotulo: number}|null}
 */
function casarRotuloNoInicio(linhaNormalizada, indice) {
  const linha = linhaNormalizada.replace(/^[\s\-•·*]+/, '');
  const recuo = linhaNormalizada.length - linha.length;

  for (const entrada of indice) {
    const textoRotulo = entrada.normalizado.replace(/:$/, '');
    if (!linha.startsWith(textoRotulo)) {
      continue;
    }
    const seguinte = linha.charAt(textoRotulo.length);
    // O rotulo precisa terminar ali: dois-pontos, espaco, fim de linha ou pontuacao.
    if (seguinte !== '' && !DEPOIS_DO_ROTULO.test(seguinte)) {
      continue;
    }

    const fimRotulo = recuo + textoRotulo.length;

    // Sem dois-pontos E com texto depois do rotulo, so aceitamos se o campo
    // autorizar. Isso impede "Exame solicitado em carater de urgencia..." de
    // ser lido como o campo "Exame".
    const semDoisPontos = !temDoisPontosDepois(linhaNormalizada, fimRotulo);
    if (semDoisPontos && !entrada.aceitarSemDoisPontos && !rotuloTerminaALinha(linha, textoRotulo.length)) {
      continue;
    }

    return {
      campoId: entrada.campoId,
      rotulo: entrada.rotulo,
      entrada,
      fimRotulo,
    };
  }
  return null;
}

/**
 * Procura o rotulo em QUALQUER lugar da linha, exigindo dois-pontos logo depois.
 * Sem dois-pontos, aceita apenas quando o campo declara esse comportamento,
 * porque "AUTORIDADE DO ORGAO" nao e um campo.
 */
function casarRotuloEmQualquerLugar(linhaNormalizada, indice) {
  for (const entrada of indice) {
    const textoRotulo = entrada.normalizado.replace(/:$/, '');
    const posicao = linhaNormalizada.indexOf(textoRotulo);
    if (posicao < 0) {
      continue;
    }
    const fimRotulo = posicao + textoRotulo.length;
    const seguinte = linhaNormalizada.charAt(fimRotulo);
    if (seguinte !== '' && !DEPOIS_DO_ROTULO.test(seguinte)) {
      continue;
    }
    // Exige dois-pontos (com espacos no meio) imediatamente depois do rotulo.
    if (!temDoisPontosDepois(linhaNormalizada, fimRotulo)) {
      continue;
    }
    return { campoId: entrada.campoId, rotulo: entrada.rotulo, entrada, fimRotulo };
  }
  return null;
}

/** Remove separadores iniciais (":", "-", ".") do inicio de um valor. */
function limparInicioDoValor(texto) {
  return String(texto).replace(/^[\s.:\-–—]+/, '');
}

/**
 * Extrai os valores brutos (sem formatacao) do texto por linhas.
 *
 * @param {string[]} linhasOriginais linhas com acento, para devolver o valor legivel
 * @param {object[]} campos definicoes de config/campos.json
 * @param {string[]} [padroesDeParada] regex que encerram a captura de campos multilinha
 * @returns {{valores: Map<string,string>, avisos: {campoId: string, mensagem: string}[]}}
 */
function extrairBrutos(linhasOriginais, campos, padroesDeParada = []) {
  const indice = montarIndiceRotulos(campos);
  const valores = new Map();
  const avisos = [];
  const avisar = (campoId, mensagem) => avisos.push({ campoId, mensagem });

  // Compila os padroes de parada UMA vez. Padrao invalido e ignorado com aviso,
  // para nunca derrubar a operacao por causa de uma configuracao errada.
  const paradas = [];
  for (const padrao of padroesDeParada) {
    try {
      paradas.push(new RegExp(padrao, 'i'));
    } catch {
      avisar('_configuracao', `O padrao de parada "${padrao}" nao e uma expressao regular valida.`);
    }
  }

  /** A linha e um rodape/assinatura que encerra a captura multilinha? */
  const ehLinhaDeParada = (linhaNormalizada) => paradas.some((regex) => regex.test(linhaNormalizada));

  // Cada linha guarda o texto normalizado e o mapa de posicoes para recorte.
  const linhas = linhasOriginais.map((texto) => ({ original: texto, ...normalizarComMapa(texto) }));

  /** Recorta o valor original a partir do fim do rotulo normalizado. */
  function valorDepoisDoRotulo(linha, fimRotuloNormalizado) {
    // Pula, no normalizado, os separadores que vem logo depois do rotulo.
    let cursor = fimRotuloNormalizado;
    while (cursor < linha.normalizado.length && /[\s.:\-–—]/.test(linha.normalizado[cursor])) {
      cursor += 1;
    }
    if (cursor >= linha.normalizado.length) {
      return '';
    }
    // Converte a posicao normalizada para a posicao no texto original.
    const posicaoOriginal = linha.mapa[cursor];
    if (posicaoOriginal === undefined) {
      return '';
    }
    return limparLinha(limparInicioDoValor(linha.original.slice(posicaoOriginal)));
  }

  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i];
    if (linha.normalizado === '') continue;

    const casamento =
      casarRotuloNoInicio(linha.normalizado, indice) ||
      casarRotuloEmQualquerLugar(linha.normalizado, indice);

    if (!casamento) continue;

    const definicao = campos.find((c) => c.id === casamento.campoId);
    if (!definicao || valores.has(definicao.id)) {
      continue; // Primeira ocorrencia vence: a requisicao repete rotulos em vias diferentes.
    }

    let valorBruto = valorDepoisDoRotulo(linha, casamento.fimRotulo);
    let valorNaProximaLinha = false;

    // Rotulos que ficam em cima do valor (formulario em blocos).
    if (valorBruto === '' && definicao.valorNaLinhaSeguinte) {
      const proxima = linhas[i + 1];
      if (proxima && proxima.normalizado !== '' && !casarRotuloNoInicio(proxima.normalizado, indice)) {
        valorBruto = limparLinha(proxima.original);
        valorNaProximaLinha = true;
      }
    }

    if (definicao.multilinha) {
      const limite = definicao.linhasMaximas || 10;
      const inicio = valorNaProximaLinha ? i + 2 : i + 1;
      const linhasExtras = [];
      for (let j = inicio; j < linhas.length && linhasExtras.length < limite; j += 1) {
        const proxima = linhas[j];
        if (proxima.normalizado === '') {
          if (linhasExtras.length > 0) break;
          continue;
        }
        if (casarRotuloNoInicio(proxima.normalizado, indice)) break;
        if (ehLinhaDeParada(proxima.normalizado)) break;
        linhasExtras.push(proxima.original);
      }
      if (linhasExtras.length > 0) {
        valorBruto = [valorBruto, ...linhasExtras].filter(Boolean).join('\n');
      }
    }

    // Aplica o recorte por regex do campo, quando configurado. Isso isola o
    // dado mesmo que a linha traga informacao adicional depois do valor.
    if (definicao.regexCaptura) {
      let regex;
      try {
        regex = new RegExp(definicao.regexCaptura);
      } catch {
        avisar(definicao.id, `O campo "${definicao.id}" tem uma expressao regular invalida na configuracao.`);
        continue;
      }
      const achado = valorBruto.match(regex);
      if (achado) {
        valorBruto = achado[1] !== undefined ? achado[1] : achado[0];
      } else {
        avisar(definicao.id, `O campo "${definicao.id}" foi localizado, mas o valor nao corresponde ao padrao esperado.`);
      }
    }

    valorBruto = valorBruto.trim();
    if (valorBruto === '') {
      avisar(definicao.id, `O campo "${definicao.id}" foi localizado, porem sem valor ao lado do rotulo.`);
      continue;
    }

    valores.set(definicao.id, valorBruto);
  }

  return { valores, avisos };
}

module.exports = {
  normalizar,
  normalizarComMapa,
  limparLinha,
  extrairBrutos,
  montarIndiceRotulos,
};
