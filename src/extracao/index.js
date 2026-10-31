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
const layoutRequisicaoPb = require('./layout-requisicao-pb');
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
    // Um unico campo solto (ex.: o endereco da unidade no cabecalho) nao torna
    // o arquivo legivel. Sem numero, nome ou data, a requisicao nao foi lida.
    const nucleo = ['numeroRequisicao', 'nomeExaminado', 'dataRequisicao'];
    if (!nucleo.some((id) => dados[id] !== undefined)) {
      throw new ErroDeExtracao(
        'A requisição não pôde ser lida. Verifique a legibilidade do arquivo ou preencha manualmente.',
        { ausentes, origem, avisos: avisosFinais },
      );
    }
    if (ausentes.length === obrigatorios.size) {
      throw new ErroDeExtracao(
        'A requisição não pôde ser lida. Verifique a legibilidade do arquivo ou preencha manualmente.',
        { ausentes, origem, avisos: avisosFinais },
      );
    }
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
  let linhasDigitais = null;
  let viaDeLeitura = '';
  let confianca = null;
  let layout = null;

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
      const textoDigital = linhas.join('\n');

      // O texto digital de scanners costuma confundir 1/I/l e misturar colunas.
      // Quando o documento parece uma requisicao, o OCR do projeto le melhor.
      // A camada digital fica como fonte alternativa para numeros truncados.
      const pareceRequisicao = layoutRequisicaoPb.detectar(linhas)
        || /REQUISI[CÇ][AÃ]O DE EXAME(?!\s+PERICIAL)/i.test(textoDigital)
        || /Ref\.?:\s*(?:BO|APF|80)/i.test(textoDigital)
        || /Delegado\(a\) de Pol[íi]cia Civil/i.test(textoDigital)
        || /Hist[óo]rico:/i.test(textoDigital);

      if (pareceRequisicao) {
        linhasDigitais = linhas;
        try {
          aoProgredir('Reconhecendo o texto das paginas...');
          const imagens = await renderizarPdfComoImagens(buffer, configuracao.geral.extracao);
          const ocr = await extrairTextoDeImagens(imagens, configuracao);
          if (ocr.linhas.length > 0) {
            linhas = ocr.linhas;
            confianca = ocr.confianca;
            viaDeLeitura = 'ocr-de-pdf-escaneado';
          }
        } catch {
          // Sem OCR, segue com o texto digital.
        }
      }

      if (layoutRequisicaoPb.detectar(linhas)) {
        layout = 'requisicao-pb';
      }
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
      if (layoutRequisicaoPb.detectar(linhas)) {
        layout = 'requisicao-pb';
      }
    }
  } else {
    aoProgredir('Reconhecendo o texto da imagem...');
    const ocr = await extrairTextoDeImagem(buffer, configuracao);
    linhas = ocr.linhas;
    confianca = ocr.confianca;
    viaDeLeitura = 'ocr-de-imagem';
    if (layoutRequisicaoPb.detectar(linhas)) {
      layout = 'requisicao-pb';
    }
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
  let dados;
  let avisos;
  if (layout === 'requisicao-pb') {
    const extraido = layoutRequisicaoPb.extrair(linhas, configuracao, linhasDigitais);
    dados = extraido.dados;
    avisos = extraido.avisos;
  } else {
    ({ dados, avisos } = montarDados(linhas, configuracao, nomeArquivo));
  }

  // RG e um dado dificil de ler e nem toda requisicao o traz. A ausencia NAO
  // bloqueia o preenchimento: vira aviso no log e na tela.
  if (!dados.rg) {
    registro.aviso('RG nao encontrado; seguindo sem o campo (aviso)', { origem: nomeArquivo });
    if (!avisos.some((aviso) => /RG/i.test(aviso))) {
      avisos.push('RG nao encontrado; o campo ficara em branco.');
    }
  }

  // Se nada obrigatorio foi lido, o arquivo e ilegivel: para com mensagem clara
  // em vez de seguir com um JSON vazio. O campo-nucleo evita que um unico
  // endereco solto (falso positivo) seja tratado como requisicao valida.
  const obrigatorios = configuracao.campos.filter((campo) => campo.obrigatorio);
  const encontrados = obrigatorios.filter((campo) => dados[campo.id] !== undefined);
  const nucleo = ['numeroRequisicao', 'nomeExaminado', 'dataRequisicao'];
  const temNucleo = nucleo.some((id) => dados[id] !== undefined);
  if (encontrados.length === 0 || !temNucleo) {
    throw new ErroDeExtracao(
      'A requisição não pôde ser lida. Verifique a legibilidade do arquivo ou preencha manualmente.',
      {
        origem: nomeArquivo,
        layout: layout || 'padrao',
        ausentes: obrigatorios.map((campo) => campo.id),
        encontrados: encontrados.map((campo) => campo.id),
      },
    );
  }

  registro.info('Extracao concluida', {
    origem: nomeArquivo,
    viaDeLeitura,
    layout: layout || 'padrao',
    confianca,
    camposPreenchidos: Object.keys(dados).length,
    avisos: avisos.length,
  });

  return {
    dados,
    meta: {
      origem: nomeArquivo,
      viaDeLeitura,
      layout: layout || 'padrao',
      confianca,
      linhasLidas: linhas.length,
      avisos,
      extraidoEm: new Date().toISOString(),
    },
  };
}

module.exports = { processar, montarDados, ErroDeExtracao };
