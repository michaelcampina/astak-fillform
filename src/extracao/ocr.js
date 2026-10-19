'use strict';

/**
 * OCR local com Tesseract.js.
 *
 * Regra de estabilidade: o modelo de idioma e procurado ANTES em disco
 * (recursos/tessdata). Nada e baixado durante a operacao. Se o modelo nao
 * estiver presente e nao houver cache local, o OCR falha com mensagem clara em
 * vez de tentar a rede (a ferramenta precisa funcionar offline).
 */

const fs = require('node:fs');
const path = require('node:path');

let worker = null;
let workerIdioma = null;

/**
 * Resolve o caminho do modelo de idioma.
 * @returns {{caminhoTessdata: string, idioma: string}|null}
 */
function resolverTessdata(caminhoTessdataConfigurado, raizProjeto, idioma) {
  const diretorio = path.isAbsolute(caminhoTessdataConfigurado)
    ? caminhoTessdataConfigurado
    : path.join(raizProjeto, caminhoTessdataConfigurado);

  if (!fs.existsSync(diretorio)) {
    return null;
  }

  // Tesseract.js 5 aceita arquivos .traineddata.gz ou .traineddata.
  const variantes = [`${idioma}.traineddata.gz`, `${idioma}.traineddata`];
  const encontrado = variantes.some((nome) => fs.existsSync(path.join(diretorio, nome)));
  if (!encontrado) {
    return null;
  }

  return { caminhoTessdata: diretorio, idioma };
}

/**
 * Prepara (ou reaproveita) o worker de OCR.
 * @param {object} configuracao config carregada
 */
async function obterWorker(configuracao) {
  const idioma = configuracao.geral.idiomaOcr || 'por';
  if (worker && workerIdioma === idioma) {
    return worker;
  }

  if (worker) {
    await worker.terminate();
    worker = null;
    workerIdioma = null;
  }

  const tessdata = resolverTessdata(
    configuracao.geral.caminhoTessdata,
    configuracao.raiz,
    idioma,
  );

  if (!tessdata) {
    throw new Error(
      `O arquivo de idioma do OCR ("${idioma}") nao foi encontrado em recursos/tessdata. ` +
      'Rode "npm run idioma-ocr" uma vez, com internet, para baixar o modelo. ' +
      'Depois disso a ferramenta funciona sem conexao.',
    );
  }

  const { createWorker } = require('tesseract.js');

  worker = await createWorker(idioma, 1, {
    langPath: tessdata.caminhoTessdata,
    gzip: true,
    cachePath: tessdata.caminhoTessdata,
    cacheMethod: 'none', // nunca escreve cache extra: nada de dados em disco
    logger: () => {}, // sem ruido no console durante o uso
    errorHandler: (erro) => {
      // eslint-disable-next-line no-console
      console.error(`[OCR] ${erro}`);
    },
  });

  // Parametros conservadores para formularios impressos.
  await worker.setParameters({
    tessedit_pageseg_mode: '6', // bloco uniforme de texto: melhor para layout fixo
    preserve_interword_spaces: '1',
  });

  workerIdioma = idioma;
  return worker;
}

/**
 * Extrai texto de uma imagem em memoria.
 * @param {Buffer} imagemBuffer PNG/JPEG
 * @param {object} configuracao config carregada
 * @returns {Promise<{texto: string, linhas: string[], confianca: number}>}
 */
async function extrairTextoDeImagem(imagemBuffer, configuracao) {
  const motor = await obterWorker(configuracao);
  const resultado = await motor.recognize(imagemBuffer);

  const texto = (resultado.data.text || '').replace(/\r/g, '');
  const linhas = texto
    .split('\n')
    .map((linha) => linha.replace(/[ \t]{2,}/g, ' ').trim())
    .filter((linha) => linha !== '');

  return {
    texto: linhas.join('\n'),
    linhas,
    confianca: Math.round(resultado.data.confidence || 0),
  };
}

/**
 * OCR de varias paginas, na ordem.
 * @param {Buffer[]} imagens
 */
async function extrairTextoDeImagens(imagens, configuracao) {
  const linhas = [];
  const confiancas = [];

  for (const imagem of imagens) {
    const pagina = await extrairTextoDeImagem(imagem, configuracao);
    linhas.push(...pagina.linhas);
    confiancas.push(pagina.confianca);
  }

  const confianca = confiancas.length
    ? Math.round(confiancas.reduce((total, valor) => total + valor, 0) / confiancas.length)
    : 0;

  return { texto: linhas.join('\n'), linhas, confianca };
}

async function encerrar() {
  if (worker) {
    await worker.terminate();
    worker = null;
    workerIdioma = null;
  }
}

module.exports = { extrairTextoDeImagem, extrairTextoDeImagens, resolverTessdata, encerrar };
