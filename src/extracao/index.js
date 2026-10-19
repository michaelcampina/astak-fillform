'use strict';

/**
 * Orquestracao da extracao: arquivo ou scanner -> JSON estruturado.
 *
 * Esta camada nao conhece a interface nem o navegador. Recebe bytes, devolve
 * dados. Assim o teste automatico usa exatamente o mesmo caminho do uso real.
 */

const { detectarTipo, lerTextoDoPdf, renderizarPdfComoImagens } = require('./pdf');
const { extrairTextoDeImagens, extrairTextoDeImagem } = require('./ocr');
const { extrairBrutos } = require('./rotulos');
const formatacao = require('./formatacao');
const registro = require('../nucleo/registro');

/**
 * Erro de extracao com mensagem pronta para o operador.
 * O campo tecnico fica em "detalheTecnico" e so aparece no log.
 */
class ErroDeExtracao extends Error {
  constructor(mensagem, detalheTecnico) {
    super(mensagem);
    this.name = 'ErroDeExtracao';
    this.detalheTecnico = detalheTecnico;
  }
}

/**
 * Monta o JSON final a partir do texto e das definicoes de campo.
 *
 * Regra de falha:
 *  - campo OBRIGATORIO ausente ou ilegivel -> a extracao falha;
 *  - campo OPCIONAL ausente ou ilegivel   -> vira aviso e o trabalho continua.
 *
 * Isso evita o pior cenario possivel: parar a operacao inteira porque um
 * campo de preenchimento facultativo (ex.: "Observacoes") veio em branco.
 */
function montarDados(linhas, configuracao, origem) {
  const { valores, avisos } = extrairBrutos(
    linhas,
    configuracao.campos,
    configuracao.geral.extracao?.padroesDeParada || [],
  );

  const dados = {};
  const ausentes = [];
  const erros = [];
  const avisosFinais = [];

  const definicaoDe = (id) => configuracao.campos.find((c) => c.id === id);
  const obrigatorios = new Set(configuracao.campos.filter((c) => c.obrigatorio).map((c) => c.id));

  // Avisos de campos opcionais: informacao para o operador, sem bloquear.
  for (const aviso of avisos) {
    if (obrigatorios.has(aviso.campoId)) {
      erros.push(aviso.mensagem);
    } else {
      avisosFinais.push(aviso.mensagem);
    }
  }

  for (const campo of configuracao.campos) {
    const bruto = valores.get(campo.id);
    if (bruto === undefined) {
      if (campo.obrigatorio) {
        ausentes.push(campo.id);
      }
      continue;
    }
    try {
      const { valor } = formatacao.aplicar(campo, bruto, configuracao.formatacao);
      dados[campo.id] = valor;
    } catch (erro) {
      if (campo.obrigatorio) {
        erros.push(erro.message);
      } else {
        avisosFinais.push(erro.message);
      }
    }
  }

  if (ausentes.length > 0) {
    const descricoes = ausentes
      .map((id) => definicaoDe(id)?.descricao || id)
      .join(', ');
    throw new ErroDeExtracao(
      `A requisicao nao trouxe os campos obrigatorios: ${descricoes}. ` +
      'Confira se o documento esta legivel e completo e tente novamente.',
      { ausentes, origem, avisos: avisosFinais },
    );
  }

  if (erros.length > 0) {
    throw new ErroDeExtracao(
      `Alguns dados foram lidos, mas nao puderam ser interpretados com seguranca (${erros[0]}). ` +
      'A ferramenta nao preencheu nada.',
      { erros, origem },
    );
  }

  return { dados, avisos: avisosFinais };
}

/**
 * Processa um arquivo (Buffer) ou uma imagem vinda do scanner.
 *
 * @param {object} entrada
 * @param {Buffer} entrada.buffer conteudo em memoria
 * @param {string} [entrada.nomeArquivo] nome apenas para o log
 * @param {string} [entrada.tipo] 'pdf' | 'imagem' (detectado se omitido)
 * @param {object} configuracao config carregada
 * @param {function} [aoProgredir] callback com mensagem de andamento para a interface
 */
async function processar(entrada, configuracao, aoProgredir = () => {}) {
  const { buffer, nomeArquivo = 'origem-desconhecida' } = entrada;
  const tipo = entrada.tipo || detectarTipo(buffer, nomeArquivo);

  if (!buffer || buffer.length === 0) {
    throw new ErroDeExtracao('O arquivo recebido esta vazio. Aponte outro documento.', { origem: nomeArquivo });
  }

  if (tipo === 'desconhecido') {
    throw new ErroDeExtracao(
      'O arquivo nao e um PDF nem uma imagem reconhecida. Use PDF, PNG ou JPG.',
      { origem: nomeArquivo },
    );
  }

  let linhas = [];
  let viaDeLeitura = '';
  let confianca = null;

  if (tipo === 'pdf') {
    aoProgredir('Lendo o PDF...');
    let leitura;
    try {
      leitura = await lerTextoDoPdf(buffer, configuracao.geral.extracao);
    } catch (erro) {
      throw new ErroDeExtracao(
        'Nao foi possivel abrir este PDF. Ele pode estar protegido por senha ou corrompido.',
        { origem: nomeArquivo, erro: erro.message },
      );
    }

    if (!leitura.precisaOcr) {
      linhas = leitura.linhas;
      viaDeLeitura = 'texto-de-pdf-digital';
    } else {
      aoProgredir('PDF escaneado detectado. Preparando as paginas...');
      let imagens;
      try {
        imagens = await renderizarPdfComoImagens(buffer, configuracao.geral.extracao);
      } catch (erro) {
        throw new ErroDeExtracao(
          'Nao foi possivel transformar as paginas deste PDF em imagem para leitura.',
          { origem: nomeArquivo, erro: erro.message },
        );
      }

      aoProgredir('Reconhecendo o texto das paginas...');
      const ocr = await extrairTextoDeImagens(imagens, configuracao);
      linhas = ocr.linhas;
      confianca = ocr.confianca;
      viaDeLeitura = 'ocr-de-pdf-escaneado';
    }
  } else {
    aoProgredir('Reconhecendo o texto da imagem...');
    const ocr = await extrairTextoDeImagem(buffer, configuracao);
    linhas = ocr.linhas;
    confianca = ocr.confianca;
    viaDeLeitura = 'ocr-de-imagem';
  }

  if (linhas.length === 0) {
    throw new ErroDeExtracao(
      'Nenhum texto foi encontrado no documento. Verifique se a pagina esta em branco ou torta.',
      { origem: nomeArquivo, viaDeLeitura },
    );
  }

  const minimoConfianca = configuracao.geral.extracao.confiancaMinimaOcr || 0;
  if (confianca !== null && confianca < minimoConfianca) {
    throw new ErroDeExtracao(
      'A qualidade da imagem ficou baixa demais para uma leitura confiavel. ' +
      'Tente escanear de novo com a folha alinhada e sem sombras.',
      { origem: nomeArquivo, confianca, minimoConfianca },
    );
  }

  aoProgredir('Identificando os campos da requisicao...');
  const { dados, avisos } = montarDados(linhas, configuracao, nomeArquivo);

  registro.info('Extracao concluida', {
    origem: nomeArquivo,
    viaDeLeitura,
    confianca,
    camposPreenchidos: Object.keys(dados).length,
    avisos: avisos.length,
  });

  return {
    dados,
    meta: {
      origem: nomeArquivo,
      viaDeLeitura,
      confianca,
      linhasLidas: linhas.length,
      avisos,
      extraidoEm: new Date().toISOString(),
    },
  };
}

module.exports = { processar, montarDados, ErroDeExtracao };
