'use strict';

/**
 * Formatacao e validacao dos valores extraidos.
 *
 * Cada regra recebe o texto bruto e devolve o valor pronto para preenchimento.
 * Se a regra nao conseguir interpretar o valor, lanca ERRO DE FORMATO: a
 * ferramenta prefere parar a preencher dado inventado.
 *
 * Nenhuma regra "adivinha": se o texto nao casa com um padrao conhecido, e erro.
 */

class ErroDeFormato extends Error {
  constructor(campo, valorBruto, motivo) {
    super(`Nao foi possivel formatar o campo "${campo}". ${motivo} Valor lido: "${valorBruto}".`);
    this.name = 'ErroDeFormato';
    this.campo = campo;
    this.valorBruto = valorBruto;
  }
}

/** Meses por extenso, sem acento (a comparacao e feita normalizada). */
const MESES = {
  jan: 1, janeiro: 1,
  fev: 2, fevereiro: 2,
  mar: 3, marco: 3,
  abr: 4, abril: 4,
  mai: 5, maio: 5,
  jun: 6, junho: 6,
  jul: 7, julho: 7,
  ago: 8, agosto: 8,
  set: 9, setembro: 9,
  out: 10, outubro: 10,
  nov: 11, novembro: 11,
  dez: 12, dezembro: 12,
};

/** Minusculas e sem acento, para comparar meses digitados por extenso. */
function semAcento(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function compactarEspacos(texto) {
  return String(texto).replace(/[\t\u00a0]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

function dataValida(dia, mes, ano) {
  if (!Number.isInteger(dia) || !Number.isInteger(mes) || !Number.isInteger(ano)) {
    return false;
  }
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
    return false;
  }
  const teste = new Date(Date.UTC(ano, mes - 1, dia));
  return teste.getUTCFullYear() === ano && teste.getUTCMonth() === mes - 1 && teste.getUTCDate() === dia;
}

function doisDigitos(valor) {
  return String(valor).padStart(2, '0');
}

/**
 * Converte um texto de data em { dia, mes, ano }, aceitando:
 *  - DD/MM/AAAA, DD-MM-AAAA, DD.MM.AAAA (e variacoes com 1 ou 4 digitos no ano)
 *  - AAAA-MM-DD
 *  - "12 de marco de 2024", "12 mar 2024", "12 de mar. de 2024"
 * @returns {{dia: number, mes: number, ano: number}|null}
 */
function interpretarData(bruto) {
  // O OCR troca com frequencia "1" por "l"/"I" e "0" por "O" em datas.
  const texto = compactarEspacos(bruto)
    .replace(/[ºª°]/g, '')
    .replace(/(?<=\d)[lI](?=\d)/g, '1')
    .replace(/(?<=\d)O(?=\d)/g, '0');

  // Formato numerico.
  const numerica = texto.match(/^(\d{1,4})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,4})$/);
  if (numerica) {
    const [, a, b, c] = numerica;
    // Se o primeiro grupo tem quatro digitos, e AAAA-MM-DD.
    if (a.length === 4) {
      return { dia: Number(c), mes: Number(b), ano: Number(a) };
    }
    return { dia: Number(a), mes: Number(b), ano: Number(c) };
  }

  // Formato por extenso.
  const extenso = semAcento(texto).match(/^(\d{1,2})\s*(?:de\s*)?([a-z]{3,9})\.?\s*(?:de\s*)?(\d{2,4})$/);
  if (extenso) {
    const [, dia, nomeMes, ano] = extenso;
    const mes = MESES[nomeMes];
    if (!mes) {
      return null;
    }
    return { dia: Number(dia), mes, ano: Number(ano) };
  }

  return null;
}

/** Formata uma data conforme o padrao de saida configurado. */
function formatarData(bruto, opcoes, idCampo) {
  const partes = interpretarData(bruto);
  if (!partes) {
    throw new ErroDeFormato(idCampo, bruto, 'A data nao esta em um formato reconhecido.');
  }

  let { dia, mes, ano } = partes;

  // Ano com dois digitos: assume o seculo atual (2000+).
  if (ano < 100) {
    ano += 2000;
  }

  if (opcoes.validarCalendario !== false && !dataValida(dia, mes, ano)) {
    throw new ErroDeFormato(idCampo, bruto, 'A data lida nao existe no calendario.');
  }

  const saida = opcoes.formatoSaida || 'DD/MM/AAAA';
  if (saida === 'AAAA-MM-DD') {
    return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
  }
  return `${doisDigitos(dia)}/${doisDigitos(mes)}/${ano}`;
}

function formatarCpf(bruto, opcoes, idCampo) {
  const digitos = String(bruto).replace(/\D/g, '');
  const esperado = opcoes.exigirDigitos || 11;

  if (digitos.length !== esperado) {
    throw new ErroDeFormato(idCampo, bruto, `O CPF precisa ter ${esperado} digitos e foram lidos ${digitos.length}.`);
  }

  if (opcoes.validarDigitoVerificador) {
    const invalido = /^(\d)\1{10}$/.test(digitos);
    if (invalido) {
      throw new ErroDeFormato(idCampo, bruto, 'O CPF tem todos os digitos iguais.');
    }
    const calcular = (ate) => {
      let soma = 0;
      for (let i = 0; i < ate; i += 1) {
        soma += Number(digitos[i]) * (ate + 1 - i);
      }
      const resto = (soma * 10) % 11;
      return resto === 10 ? 0 : resto;
    };
    if (calcular(9) !== Number(digitos[9]) || calcular(10) !== Number(digitos[10])) {
      throw new ErroDeFormato(idCampo, bruto, 'O digito verificador do CPF nao confere.');
    }
  }

  if ((opcoes.formatoSaida || '000.000.000-00') === 'somente-digitos') {
    return digitos;
  }
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

function formatarRg(bruto, opcoes, idCampo) {
  let valor = String(bruto);
  if (opcoes.removerSeparadores !== false) {
    valor = valor.replace(/[\s.\-\/]/g, '');
  }
  if (opcoes.maiusculas !== false) {
    valor = valor.toUpperCase();
  }
  if (valor.length < 4) {
    throw new ErroDeFormato(idCampo, bruto, 'O RG lido tem menos de 4 caracteres.');
  }
  return valor;
}

function formatarCodigo(bruto, opcoes) {
  let valor = compactarEspacos(bruto);
  if (opcoes.maiusculas) {
    valor = valor.toUpperCase();
  }
  return valor;
}

function formatarNome(bruto, opcoes) {
  return opcoes.compactarEspacos === false ? String(bruto).trim() : compactarEspacos(bruto);
}

/**
 * Corrige hifenizacao de quebra de linha vinda do OCR/PDF:
 * "infor-\nmacao" -> "informacao". Tambem junta as linhas do mesmo paragrafo.
 */
function formatarTextoLongo(bruto, opcoes) {
  let texto = String(bruto).replace(/\r/g, '');
  texto = texto.replace(/-\n(?=\p{Ll})/gu, '');

  if (opcoes.preservarQuebrasDeLinha) {
    return texto
      .split('\n')
      .map((linha) => compactarEspacos(linha))
      .join('\n')
      .trim();
  }

  return compactarEspacos(texto.replace(/\n+/g, ' '));
}

const REGRAS = {
  data: formatarData,
  cpf: formatarCpf,
  rg: formatarRg,
  codigo: formatarCodigo,
  nome: formatarNome,
  texto: formatarNome,
  textoLongo: formatarTextoLongo,
};

/**
 * Aplica a regra configurada ao valor bruto.
 *
 * @param {object} campo definicao de config/campos.json
 * @param {string} valorBruto texto como saiu do PDF ou do OCR
 * @param {object} formatacao conteudo de config/formatacao.json
 * @returns {{valor: string, regra: string}}
 */
function aplicar(campo, valorBruto, formatacao) {
  const opcoes = formatacao[campo.formato];
  const regra = REGRAS[campo.formato];
  if (!regra) {
    throw new Error(`Formato "${campo.formato}" nao implementado (campo ${campo.id}).`);
  }
  const valor = regra(valorBruto, opcoes || {}, campo.id);
  if (valor === '' || valor === null || valor === undefined) {
    throw new ErroDeFormato(campo.id, valorBruto, 'O valor ficou vazio depois da formatacao.');
  }
  return { valor, regra: campo.formato };
}

module.exports = { aplicar, ErroDeFormato, interpretarData, dataValida };
