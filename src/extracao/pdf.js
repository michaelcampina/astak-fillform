'use strict';

/**
 * Leitura de PDF com pdf.js.
 *
 * Dois caminhos:
 *  - PDF digital: extrai o texto direto (rapido e exato).
 *  - PDF escaneado: renderiza cada pagina como imagem e entrega ao OCR.
 *
 * O que decide o caminho e a QUANTIDADE de texto util encontrada, nunca uma
 * estimativa "inteligente": se o texto digital tiver menos caracteres que o
 * minimo configurado, tratamos como escaneado.
 */

const fs = require('node:fs');
const path = require('node:path');

let pdfjsLib = null;

async function carregarPdfJs() {
  if (pdfjsLib) {
    return pdfjsLib;
  }
  // Import dinamico: pdfjs-dist expoe ESM.
  const modulo = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = require('@napi-rs/canvas');
  pdfjsLib = { ...modulo, createCanvas };
  return pdfjsLib;
}

/** Agrupa itens de texto do pdf.js em linhas, respeitando a posicao vertical. */
function itensParaLinhas(itens) {
  if (!itens || itens.length === 0) {
    return [];
  }

  const linhas = new Map();
  const tolerancia = 2; // pontos PDF

  for (const item of itens) {
    if (!item.str || item.str.trim() === '') {
      continue;
    }
    const y = Math.round(item.transform[5] / tolerancia) * tolerancia;
    if (!linhas.has(y)) {
      linhas.set(y, []);
    }
    linhas.get(y).push({ x: item.transform[4], texto: item.str });
  }

  return [...linhas.entries()]
    .sort((a, b) => b[0] - a[0]) // PDF cresce de baixo para cima
    .map(([, partes]) =>
      partes
        .sort((a, b) => a.x - b.x)
        .map((p) => p.texto)
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    )
    .filter((linha) => linha !== '');
}

/**
 * Abre o PDF e devolve { texto, totalPaginas, caracteresUteis }.
 * @param {Buffer} buffer conteudo do PDF em memoria
 * @param {object} opcoes configuracao.extracao
 */
async function lerTextoDoPdf(buffer, opcoes) {
  const { getDocument, createCanvas } = await carregarPdfJs();

  const documento = await getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
    isEvalSupported: false,
  }).promise;

  try {
    const totalPaginas = Math.min(documento.numPages, opcoes.paginasMaximas || 5);
    const linhas = [];

    for (let numero = 1; numero <= totalPaginas; numero += 1) {
      const pagina = await documento.getPage(numero);
      const conteudo = await pagina.getTextContent();
      const linhasDaPagina = itensParaLinhas(conteudo.items);
      linhas.push(...linhasDaPagina);
      pagina.cleanup();
    }

    const texto = linhas.join('\n');
    const caracteresUteis = texto.replace(/[^A-Za-zÀ-ÿ0-9]/g, '').length;

    return { texto, linhas, totalPaginas, caracteresUteis, precisaOcr: caracteresUteis < (opcoes.minimoCaracteresTextoDigital || 120) };
  } finally {
    await documento.destroy();
  }
}

/**
 * Renderiza cada pagina do PDF como PNG em memoria (Buffer[]).
 * Nao escreve nada em disco.
 */
async function renderizarPdfComoImagens(buffer, opcoes) {
  const { getDocument, createCanvas } = await carregarPdfJs();

  const documento = await getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
    isEvalSupported: false,
  }).promise;

  try {
    const totalPaginas = Math.min(documento.numPages, opcoes.paginasMaximas || 5);
    const escala = opcoes.escalaRenderizacao || 2.5;
    const imagens = [];

    for (let numero = 1; numero <= totalPaginas; numero += 1) {
      const pagina = await documento.getPage(numero);
      const viewport = pagina.getViewport({ scale: escala });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const contexto = canvas.getContext('2d');

      // Fundo branco: sem isso o OCR pode interpretar transparencia como tinta.
      contexto.fillStyle = '#ffffff';
      contexto.fillRect(0, 0, canvas.width, canvas.height);

      await pagina.render({ canvasContext: contexto, viewport }).promise;
      imagens.push(canvas.toBuffer('image/png'));
      pagina.cleanup();
    }

    return imagens;
  } finally {
    await documento.destroy();
  }
}

/** Detecta o tipo do arquivo pelo conteudo, nao pela extensao. */
function detectarTipo(buffer, nomeArquivo = '') {
  if (buffer.length > 4 && buffer.slice(0, 5).toString('latin1') === '%PDF-') {
    return 'pdf';
  }
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'imagem';
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'imagem';
  }
  if (buffer.length > 12 && buffer.slice(0, 4).toString('latin1') === 'RIFF' && buffer.slice(8, 12).toString('latin1') === 'WEBP') {
    return 'imagem';
  }
  if (buffer.length > 3 && buffer.slice(0, 4).toString('latin1') === 'II*\u0000'.slice(0, 4)) {
    return 'imagem';
  }

  const extensao = path.extname(nomeArquivo).toLowerCase();
  if (extensao === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp'].includes(extensao)) return 'imagem';

  return 'desconhecido';
}

module.exports = { lerTextoDoPdf, renderizarPdfComoImagens, detectarTipo, itensParaLinhas };
