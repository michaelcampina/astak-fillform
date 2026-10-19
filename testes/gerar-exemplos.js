'use strict';

/**
 * Gerador das fixtures de teste.
 *
 * Produz tres origens com o MESMO conteudo, para cobrir os tres caminhos de
 * leitura da ferramenta:
 *
 *   1. requisicao-digital.pdf   -> PDF com texto real (caminho pdf.js, sem OCR)
 *   2. requisicao-escaneada.pdf -> PDF de uma imagem (caminho pdf.js -> OCR)
 *   3. requisicao-imagem.png    -> imagem avulsa (caminho OCR direto)
 *
 * Nada aqui depende de servico externo: as fontes vem do sistema e o texto e
 * desenhado com canvas. Rodar: npm run exemplos
 */

const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const RAIZ = path.resolve(__dirname, '..');
const DIR_FIXTURES = path.join(RAIZ, 'testes', 'fixtures');
const DIR_SAIDA = path.join(RAIZ, 'testes', 'saida');

/**
 * Conteudo ficticio da requisicao. Tambem e a fonte do gabarito: o teste
 * compara o que a ferramenta extrai com estes valores.
 */
const REQUISICAO = {
  titulo: 'REQUISIÇÃO DE EXAME PERICIAL',
  subtitulo: 'Secretaria de Segurança Pública — Instituto de Criminalística',
  linhas: [
    ['Número da Requisição', 'REQ-2024-0012'],
    ['Número de Registro', '4587/2024'],
    ['Data da Requisição', '12/03/2024'],
    ['Autoridade Requisitante', 'Dra. Fernanda Souza'],
    ['Órgão Requisitante', 'Ministério Público de São Paulo'],
    ['Tipo de Exame', 'Corpo de delito'],
    ['Destino do Exame', 'IML'],
    ['Nome do Examinado', 'JOÃO DA SILVA'],
    ['Data de Nascimento', '05/07/1980'],
    ['Nome da Mãe', 'Maria Aparecida da Silva'],
    ['Nome do Pai', 'José Pereira da Silva'],
    ['RG', '12.345.678-9'],
    ['CPF', '123.456.789-00'],
    ['Endereço', 'Rua das Acácias, 123 — Jardim Primavera'],
    ['Local do Fato', 'São Paulo — SP'],
    ['Data do Fato', '10/03/2024'],
  ],
  fatos: [
    'O periciado foi encontrado em via pública, apresentando ferimentos',
    'compatíveis com ação de terceiros, sendo encaminhado para exame de',
    'corpo de delito no instituto médico legal da capital.',
  ],
  observacoes: 'Exame solicitado em caráter de urgência, conforme ofício nº 221/2024.',
  rodape: ['Documento fictício gerado apenas para testes da ferramenta.', 'Não contém dados reais de pessoas.'],
};

/**
 * Desenha a requisicao em um canvas, com o layout fixo usado nos testes.
 * @param {number} escala multiplicador de resolucao (2 = ~200 dpi)
 * @returns {{canvas: object, largura: number, altura: number}}
 */
function desenharRequisicao(escala = 1) {
  const larguraBase = 1240; // A4 a ~150 dpi
  const alturaBase = 1754;
  const largura = Math.round(larguraBase * escala);
  const altura = Math.round(alturaBase * escala);

  const canvas = createCanvas(largura, altura);
  const ctx = canvas.getContext('2d');

  const f = escala; // fator para todas as medidas
  const margem = 70 * f;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, largura, altura);

  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'alphabetic';

  // Cabecalho
  ctx.font = `bold ${22 * f}px Arial`;
  ctx.fillText(REQUISICAO.titulo, margem, 90 * f);

  ctx.font = `${13 * f}px Arial`;
  ctx.fillStyle = '#333333';
  ctx.fillText(REQUISICAO.subtitulo, margem, 116 * f);

  // Linha divisoria
  ctx.strokeStyle = '#999999';
  ctx.lineWidth = Math.max(1, 1 * f);
  ctx.beginPath();
  ctx.moveTo(margem, 136 * f);
  ctx.lineTo(largura - margem, 136 * f);
  ctx.stroke();

  // Campos rotulo: valor
  let y = 172 * f;
  const alturaLinha = 30 * f;
  ctx.fillStyle = '#111111';

  for (const [rotulo, valor] of REQUISICAO.linhas) {
    ctx.font = `bold ${13 * f}px Arial`;
    ctx.fillText(`${rotulo}:`, margem, y);
    ctx.font = `${13 * f}px Arial`;
    ctx.fillText(valor, margem + 230 * f, y);
    y += alturaLinha;
  }

  // Bloco de fatos
  y += 10 * f;
  ctx.font = `bold ${13 * f}px Arial`;
  ctx.fillText('Fatos:', margem, y);
  y += alturaLinha * 0.85;

  ctx.font = `${13 * f}px Arial`;
  for (const linha of REQUISICAO.fatos) {
    ctx.fillText(linha, margem + 20 * f, y);
    y += alturaLinha * 0.85;
  }

  y += alturaLinha * 0.5;
  ctx.font = `bold ${13 * f}px Arial`;
  ctx.fillText('Observações:', margem, y);
  ctx.font = `${13 * f}px Arial`;
  ctx.fillText(REQUISICAO.observacoes, margem + 20 * f, y + alturaLinha * 0.85);

  // Rodape separado do corpo por uma linha, para o extrator nao o tratar como
  // continuacao do ultimo campo multilinha.
  ctx.strokeStyle = '#cccccc';
  ctx.beginPath();
  ctx.moveTo(margem, altura - 90 * f);
  ctx.lineTo(largura - margem, altura - 90 * f);
  ctx.stroke();

  ctx.font = `${11 * f}px Arial`;
  ctx.fillStyle = '#555555';
  let yRodape = altura - margem;
  for (const linha of [...REQUISICAO.rodape].reverse()) {
    ctx.fillText(linha, margem, yRodape);
    yRodape -= 16 * f;
  }

  return { canvas, largura, altura };
}

/** Gera o PDF digital: texto de verdade, selecionavel. */
async function gerarPdfDigital(destino) {
  const pdf = await PDFDocument.create();
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pagina = pdf.addPage([595.28, 841.89]); // A4 em pontos
  const margem = 42;
  let y = 800;

  // Helvetica padrao do PDF usa latin-1: os acentos do portugues funcionam,
  // mas emojis e caracteres fora da tabela nao. Sanitizamos por seguranca.
  const limpar = (texto) =>
    String(texto)
      .replace(/[—–]/g, '-')
      .replace(/[^\x20-\x7E\u00A0-\u017F]/g, '');

  pagina.drawText(limpar(REQUISICAO.titulo), { x: margem, y, size: 15, font: fonteNegrito });
  y -= 20;
  pagina.drawText(limpar(REQUISICAO.subtitulo), { x: margem, y, size: 9, font: fonte });
  y -= 22;

  for (const [rotulo, valor] of REQUISICAO.linhas) {
    pagina.drawText(limpar(`${rotulo}:`), { x: margem, y, size: 10, font: fonteNegrito });
    pagina.drawText(limpar(valor), { x: margem + 165, y, size: 10, font: fonte });
    y -= 19;
  }

  y -= 8;
  pagina.drawText('Fatos:', { x: margem, y, size: 10, font: fonteNegrito });
  y -= 16;
  for (const linha of REQUISICAO.fatos) {
    pagina.drawText(limpar(linha), { x: margem + 14, y, size: 10, font: fonte });
    y -= 15;
  }

  y -= 10;
  pagina.drawText('Observações:', { x: margem, y, size: 10, font: fonteNegrito });
  y -= 15;
  pagina.drawText(limpar(REQUISICAO.observacoes), { x: margem + 14, y, size: 9, font: fonte });

  // Rodape
  pagina.drawText(limpar(REQUISICAO.rodape[0]), { x: margem, y: 40, size: 7, font: fonte });
  pagina.drawText(limpar(REQUISICAO.rodape[1]), { x: margem, y: 30, size: 7, font: fonte });

  const bytes = await pdf.save();
  fs.writeFileSync(destino, bytes);
  return bytes.length;
}

/** Gera o PNG da requisicao (imagem avulsa). */
function gerarPng(destino) {
  const { canvas } = desenharRequisicao(1.6);
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(destino, buffer);
  return buffer.length;
}

/** Gera o PDF escaneado: uma imagem dentro de um PDF, sem texto. */
async function gerarPdfEscaneado(destino) {
  const { canvas } = desenharRequisicao(1.6);
  const png = canvas.toBuffer('image/png');

  const pdf = await PDFDocument.create();
  const imagem = await pdf.embedPng(png);
  const pagina = pdf.addPage([595.28, 841.89]);

  // Ajusta a imagem a pagina mantendo a proporcao.
  const { width, height } = pagina.getSize();
  const escala = Math.min(width / imagem.width, height / imagem.height);

  pagina.drawImage(imagem, {
    x: 0,
    y: height - imagem.height * escala,
    width: imagem.width * escala,
    height: imagem.height * escala,
  });

  const bytes = await pdf.save();
  fs.writeFileSync(destino, bytes);
  return bytes.length;
}

/**
 * Gabarito: o que a extracao DEVE devolver para as fixtures.
 * Valores ja no formato final (depois de config/formatacao.json).
 */
function montarGabarito() {
  return {
    _comentario: [
      'Gabarito dos testes de extracao.',
      'Cada chave e um id de config/campos.json e o valor e o esperado apos a formatacao.',
      'Compare com o relatorio gerado em testes/saida/relatorio-*.md',
    ],
    dados: {
      numeroRequisicao: 'REQ-2024-0012',
      numeroRegistro: '4587/2024',
      dataRequisicao: '12/03/2024',
      autoridade: 'Dra. Fernanda Souza',
      orgao: 'Ministério Público de São Paulo',
      tipoExame: 'Corpo de delito',
      destinoExame: 'IML',
      nomeExaminado: 'JOÃO DA SILVA',
      dataNascimento: '05/07/1980',
      nomeMae: 'Maria Aparecida da Silva',
      nomePai: 'José Pereira da Silva',
      rg: '123456789',
      cpf: '123.456.789-00',
      endereco: 'Rua das Acácias, 123 — Jardim Primavera',
      localFato: 'São Paulo — SP',
      dataFato: '10/03/2024',
      fatos:
        'O periciado foi encontrado em via pública, apresentando ferimentos ' +
        'compatíveis com ação de terceiros, sendo encaminhado para exame de ' +
        'corpo de delito no instituto médico legal da capital.',
      observacoes: 'Exame solicitado em caráter de urgência, conforme ofício nº 221/2024.',
    },
    /**
     * Tolerancias por campo. Alguns campos passam por OCR, que pode trocar
     * pontuacao (travessao por hifen). A comparacao aceita essas variacoes
     * quando o campo declara a tolerancia aqui.
     */
    tolerancia: {
      endereco: 'pontuacao',
      localFato: 'pontuacao',
      fatos: 'pontuacao',
      observacoes: 'pontuacao',
    },
  };
}

async function principal() {
  fs.mkdirSync(DIR_FIXTURES, { recursive: true });
  fs.mkdirSync(DIR_SAIDA, { recursive: true });

  const caminhoDigital = path.join(DIR_FIXTURES, 'requisicao-digital.pdf');
  const caminhoEscaneado = path.join(DIR_FIXTURES, 'requisicao-escaneada.pdf');
  const caminhoImagem = path.join(DIR_FIXTURES, 'requisicao-imagem.png');
  const caminhoGabarito = path.join(DIR_FIXTURES, 'gabarito.json');

  const tamanhoDigital = await gerarPdfDigital(caminhoDigital);
  const tamanhoEscaneado = await gerarPdfEscaneado(caminhoEscaneado);
  const tamanhoImagem = gerarPng(caminhoImagem);

  fs.writeFileSync(caminhoGabarito, JSON.stringify(montarGabarito(), null, 2), 'utf8');

  console.log('Fixtures geradas em testes/fixtures:');
  console.log(`  requisicao-digital.pdf    ${(tamanhoDigital / 1024).toFixed(1)} KB (texto digital)`);
  console.log(`  requisicao-escaneada.pdf  ${(tamanhoEscaneado / 1024).toFixed(1)} KB (imagem -> OCR)`);
  console.log(`  requisicao-imagem.png     ${(tamanhoImagem / 1024).toFixed(1)} KB (OCR direto)`);
  console.log('  gabarito.json             valores esperados da extracao');
}

if (require.main === module) {
  principal().catch((erro) => {
    console.error('Falha ao gerar as fixtures:', erro.message);
    process.exit(1);
  });
}

module.exports = { principal, montarGabarito, REQUISICAO };
