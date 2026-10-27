'use strict';

/**
 * Layout real da requisicao de exame da Policia Civil da Paraiba
 * (Central de Flagrantes / Delegacias / NUMOL-CG).
 *
 * O texto vem de OCR e varia muito: "1" vira "I" ou "l", colunas se misturam,
 * nomes quebram de linha. Por isso cada campo tem regex tolerante e o modulo
 * aceita uma segunda fonte de texto (a camada digital do PDF) para completar
 * numeros que o OCR tenha truncado.
 *
 * So e usado quando `detectar` reconhece o layout; o extrator padrao continua
 * intacto para o modelo ficticio dos testes.
 */

const MESES = {
  janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05',
  junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10',
  novembro: '11', dezembro: '12',
};

function semAcento(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function limpar(texto) {
  return String(texto ?? '').replace(/\s+/g, ' ').trim();
}

function somenteDigitos(texto) {
  return String(texto ?? '').replace(/\D/g, '');
}

function formatarCpf(digitos) {
  const d = String(digitos).slice(0, 11);
  if (d.length !== 11) return d;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

function detectar(linhas) {
  const texto = linhas.join('\n');
  // Requisicoes com periciando (pessoa) e sem periciando (ossada/antropologia).
  return /Perici[a-z]*\(a\):/i.test(texto) || /Exame Requisitado:/i.test(texto);
}

function numeroRequisicaoValido(valor) {
  return /^\d{2,6}[./]\d{4}$/.test(valor) || /^\d{4}\.\d{2}\.\d\.\d{2}\.\d{4}\.\d{6}$/.test(valor);
}

function numeroRegistroValido(valor) {
  return /^\d{3,5}\.\d{2}\.\d{4}\.\d{1,2}\.\d{2}\.\d{3}$/.test(valor);
}

/** Extrai os campos de um unico texto (OCR ou camada digital). */
function extrairDoTexto(texto, configuracao) {
  const dados = {};

  // Numero da requisicao: "REQUISICAO DE EXAME Nº 2233.2026" ou "Nº 142 2026"
  const requisicao = texto.match(/REQUISI[CÇ][AÃ]O DE EXAME[^\n]*?N[º°]\s*([0-9][0-9.,/\s]*\d)/i)
    || texto.match(/N[º°]\s*([0-9]{2,6}[.,/\s]?\d{4})/);
  if (requisicao) {
    let numero = requisicao[1].replace(/\s+/g, '').replace(/,/g, '.');
    if (/^\d{2,6}\s?\d{4}$/.test(numero)) numero = numero.replace(/\s/, '.');
    dados.numeroRequisicao = numero;
  }

  // Procedimento/BO: "Ref.: BO Nº 00760.05.2026.2.00.402" ou "Procedimento Policial:"
  const referencia = texto.match(/Ref\.?:\s*([^\n]+)/i)
    || texto.match(/Procedimento Policial:\s*([0-9][0-9.\-/\s]*)/i);
  if (referencia) {
    const limpo = referencia[1]
      .replace(/["“”]/g, ' ')
      .replace(/\s*([.,])\s*/g, '.')
      .replace(/(\d)\s+(\d)/g, '$1.$2')
      .replace(/[^\d.]/g, '');
    const partes = limpo.match(/(\d{3,5})\.(\d{2})\.(\d{4})\.(\d{1,2})\.(\d{2})\.(\d{3})/);
    if (partes) {
      dados.numeroRegistro = `${partes[1]}.${partes[2]}.${partes[3]}.${partes[4]}.${partes[5]}.${partes[6]}`;
    }
  }
  if (!dados.numeroRegistro) {
    const procedimento = texto.match(/\b(\d{4}\.\d{2}\.\d\.\d{2}\.\d{4}\.\d{6})\b/);
    if (procedimento) dados.numeroRegistro = procedimento[1];
  }
  if (!dados.numeroRequisicao && dados.numeroRegistro && /^\d{4}\.\d{2}\.\d\./.test(dados.numeroRegistro)) {
    // Alguns modelos so trazem o numero do procedimento; ele identifica a requisicao.
    dados.numeroRequisicao = dados.numeroRegistro;
  }

  // Data da requisicao: "Data:" ou "DATA E HORA DO REGISTRO:"
  const dataRequisicao = texto.match(/Data:\s*(\d{2}\/\d{2}\/\d{4})/)
    || texto.match(/DATA E HORA DO REGISTRO:[\s\S]{0,160}?(\d{2}\/\d{2}\/\d{4})/i);
  if (dataRequisicao) dados.dataRequisicao = dataRequisicao[1];

  // Autoridade
  const autoridade = texto.match(/Delegado\(a\) de Pol[íi]cia Civil:\s*([^\n]+)/i);
  if (autoridade) {
    const nome = limpar(autoridade[1]).replace(/\s*[|!—].*$/, '').trim();
    if (!/^(Local|Data|Ref)/i.test(nome)) dados.autoridade = nome;
  }

  // Orgao solicitante: a unidade que aparece no cabecalho
  const padroesOrgao = [
    /Central de Flagrantes de Campina Grande/i,
    /Central de Pol[íi]cia Civil de Campina Grande/i,
    /Delegacia Especializada[^\n]*/i,
    /Delegacia Distrital de Campina Grande/i,
    /Delegacia do Munic[íi]pio[^\n]*/i,
    /Delegacia de Pol[íi]cia Civil[^\n]*/i,
  ];
  for (const padrao of padroesOrgao) {
    const encontrado = texto.match(padrao);
    if (encontrado) {
      dados.orgao = limpar(encontrado[0])
        .replace(/\s+(GOVERNO|Secretaria|ao O RAIBA|Beciana).*$/i, '')
        .replace(/\s*-\s*$/, '')
        .trim();
      break;
    }
  }

  // Destino do laudo
  const destino = texto.match(/remeter o laudo para\s+([\s\S]*?)\.\s*(?:\n|$)/i);
  if (destino) {
    dados.destinoExame = limpar(destino[1]);
  } else if (/NUMOL-CG/i.test(texto)) {
    dados.destinoExame = 'NUMOL-CG';
  }

  // Tipo do exame
  const tipo = texto.match(/Exame Requisitado:\s*([^\n]+)/i)
    || texto.match(/Exame de\s+([A-Za-zÀ-ÿ ]+?)\s+na pessoa/i);
  if (tipo) {
    const valor = limpar(tipo[1]);
    dados.tipoExame = /^Exame/i.test(valor) ? valor : `Exame de ${valor}`;
  }

  // Nome do periciando: ate a primeira virgula, mesmo que o nome quebre linha
  const nome = texto.match(
    /Perici[a-z]*\(a\):\s*([\s\S]*?),(?:\s*(?:CPF|RG|CNH|nacionalidade|profissão|filho|$))/i,
  );
  if (nome) {
    const valor = limpar(nome[1]);
    if (!/^(CPF|RG|CNH)/i.test(valor)) dados.nomeExaminado = valor;
  }

  // RG
  const rgTrecho = texto.match(
    /RG\s*n[º°]?\s*([\s\S]{0,40}?)(?=,|\s*(?:CPF|CNH|nacionalidade|$))/i,
  );
  if (rgTrecho) {
    const digitos = somenteDigitos(rgTrecho[1]).slice(0, 15);
    if (digitos.length >= 5) dados.rg = digitos;
  }

  // CPF
  const cpfTrecho = texto.match(
    /CPF\s*n[º°]?\s*([\s\S]{0,40}?)(?=,|\s*(?:RG|CNH|nacionalidade|$))/i,
  );
  if (cpfTrecho) {
    const digitos = somenteDigitos(cpfTrecho[1]).slice(0, 11);
    if (digitos.length === 11) dados.cpf = formatarCpf(digitos);
  }

  // Nascimento: dd/mm/aaaa ou por extenso
  const nascimento = texto.match(/nascido\(a\) em\s*(\d{2}\/\d{2}\/\d{4})/i)
    || texto.match(/nascido\(a\) em\s*(\d{1,2})\s*de\s*([A-Za-zÀ-ÿ]+)\s*de\s*(\d{4})/i);
  if (nascimento) {
    if (nascimento[2] && nascimento[3]) {
      const mes = MESES[semAcento(nascimento[2])];
      if (mes) {
        dados.dataNascimento = `${String(nascimento[1]).padStart(2, '0')}/${mes}/${nascimento[3]}`;
      }
    } else {
      dados.dataNascimento = nascimento[1];
    }
  }

  // Filiacao: mae e pai (o pai pode nao existir)
  const filiacao = texto.match(
    /filho\(a\) de\s+([^,]+?)(?:\s+e\s+([^,]+))?,\s*natural/i,
  );
  if (filiacao) {
    dados.nomeMae = limpar(filiacao[1]);
    if (filiacao[2]) dados.nomePai = limpar(filiacao[2]);
  }

  // Endereco de residencia
  const endereco = texto.match(
    /residente\s+e\s+domiciliad[oa]\(?a?\)?\s+(?:no\(a\)\s+)?([\s\S]*?)(?:telefone|Local da Ocorr|Tipo do Local|$)/i,
  );
  if (endereco) {
    dados.endereco = limpar(endereco[1])
      .replace(/tendo como ponto de refer[êe]ncia/i, 'ponto de referência')
      .replace(/\bna cidade de\b/gi, '')
      .replace(/\s*\/\s*/g, '/')
      .replace(/\.\s*,\s*/g, ', ')
      .replace(/\s+,/g, ',')
      .replace(/[.,;]\s*$/, '')
      .trim();
  }

  // Local do fato
  const local = texto.match(/Local da Ocorr[êe]ncia:\s*([^\n]+)/i);
  if (local) {
    dados.localFato = limpar(local[1]).replace(/[.;]\s*$/, '');
  }

  // Data/hora do fato
  const dataFato = texto.match(/Data:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*Hora:\s*(\d{2}\s*:\s*\d{2})/i)
    || texto.match(/Data\/Hora:\s*(\d{2}\/\d{2}\/\d{4})\s*(\d{2}:\d{2})/i)
    || texto.match(/Local da Ocorr[êe]ncia:[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s*[àa]s\s*(\d{2}:\d{2})/i);
  if (dataFato) {
    dados.dataFato = `${dataFato[1]} ${String(dataFato[2]).replace(/\s/g, '')}`;
  }

  // Historico/Relato
  const fatos = texto.match(
    /(?:Hist[óo]rico|Relato):\s*([\s\S]*?)\s*(?:Local da Ocorr|Procedimento Policial|$)/i,
  );
  if (fatos) {
    dados.fatos = limpar(fatos[1])
      .replace(/\s*e\s*2\s*Policial:\s*[\d.]+\s*/i, ' ')
      .replace(/\s*1\/2\s*/i, ' ')
      .replace(/SECRETARIA DE ESTADO[\s\S]*?DAPARAIBA/gi, ' ')
      .replace(/•\s*Central de Flagrantes de Campina Grande[\s\S]*?Soei ol/gi, ' ')
      .replace(/DAPARAIBA[\s\S]*?Soei ol/gi, ' ')
      .replace(/\s*(?:OP e! o|e\s*2)\s*Policial:[\s\S]*?Central de Flagrantes, onde/i, ' Central de Flagrantes, onde')
      .replace(/\s*(?:Lil D|LAO|ECAZAY|RENATTA DIAS)[\s\S]*$/i, ' ')
      .replace(/\s*Procedimento Policial:\s*[\d.]+\s*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return dados;
}

function extrair(linhas, configuracao, linhasAlternativas) {
  const texto = linhas.join('\n');
  const dados = extrairDoTexto(texto, configuracao);

  // A camada digital do PDF as vezes preserva numeros que o OCR truncou.
  if (Array.isArray(linhasAlternativas) && linhasAlternativas.length > 0) {
    const alternativo = extrairDoTexto(linhasAlternativas.join('\n'), configuracao);
    for (const campo of configuracao?.campos || []) {
      const atual = dados[campo.id];
      const outro = alternativo[campo.id];
      if (!outro) continue;

      const ausente = atual === undefined || String(atual).trim() === '';
      const numericoIncompleto = (campo.id === 'numeroRegistro' && !numeroRegistroValido(atual))
        || (campo.id === 'numeroRequisicao' && !numeroRequisicaoValido(atual));
      if (ausente || numericoIncompleto) {
        dados[campo.id] = outro;
      }
    }
  }

  const avisos = [];
  if (!dados.rg) {
    avisos.push('RG nao encontrado; o campo ficara em branco (aviso, nao bloqueia).');
  }
  const ausentes = (configuracao?.campos || [])
    .filter((campo) => campo.obrigatorio && !(campo.id in dados))
    .map((campo) => campo.descricao);
  if (ausentes.length > 0) {
    avisos.push(`Campos obrigatorios ausentes neste modelo: ${ausentes.join(', ')}.`);
  }

  return { dados, avisos };
}

module.exports = { detectar, extrair, extrairDoTexto };
