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
 * Regras de negocio aplicadas aqui:
 *  - Autoridade: prevalece a assinatura ao final; se o final for a mesma pessoa
 *    com grafia pior, usa a grafia do inicio. Se for outra pessoa, usa o final.
 *  - RG: numero + orgao expedidor (qualquer sigla) + UF (nome por extenso).
 *  - Sexo: "identidade de genero"/"sexo" -> Feminino/Masculino.
 *  - Estado civil: Uniao Estavel -> Solteiro(a).
 *  - Datas incompletas: data atual / 00:00 (somente oficio e fato).
 *  - Diretor do NUMOL/NULF: nunca e usado como nome de pessoa.
 */

const DIRETORES = require('../../config/diretores.json');

const MESES = {
  janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05',
  junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10',
  novembro: '11', dezembro: '12',
};

const UF_POR_SIGLA = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
  PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia',
  RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe',
  TO: 'Tocantins',
};

const CARGOS_PROIBIDOS = (DIRETORES.cargos || []).map((cargo) => semAcento(cargo));

const PALAVRAS_NAO_NOME = /(procedimento|policial|delegacia|secretaria|governo|numol|nulf|n[úu]cleo|diretor|data|ref|local|p[áa]gina|matr[íi]cula|central|flagrante|pol[íi]cia|civil|estado|para[íi]ba|seguran[çc]a|defesa|social|senhor|gerente|ilmo|excelent|atencios|requisit|exame|hist[óo]rico|quesito|cumpriment|assinatura|servidor|periciando|periciado|autoridade|solicitante|requerente|examinado|m[ée]dico|legista|perito|delegado|delegada|rua|avenida|bairro|travessa|campina|n[úu]mero|telefone|contato|vitima|vítima|orgao|órgão|expedidor|uf)/i;

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

function capitalizar(texto) {
  return limpar(texto).replace(
    /(^|\s)(\p{L})/gu,
    (espaco, letra) => espaco + letra.toUpperCase(),
  );
}

function formatarData(data) {
  const dia = String(data.getDate()).padStart(2, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${data.getFullYear()}`;
}

function tokensNome(texto) {
  return semAcento(texto)
    .replace(/[^a-z ]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !['de', 'da', 'do', 'das', 'dos', 'e'].includes(token));
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

/** Diz se dois nomes sao a mesma pessoa, tolerando erros de OCR. */
function mesmaPessoa(a, b) {
  const ta = tokensNome(a);
  const tb = tokensNome(b);
  if (ta.length === 0 || tb.length === 0) return false;

  const primeiro = ta[0] === tb[0] || levenshtein(ta[0], tb[0]) <= 1;
  if (!primeiro) return false;
  if (ta.length === 1 || tb.length === 1) return true;

  const sa = ta.slice(1);
  const sb = tb.slice(1);
  return sa.some((x) => sb.some((y) => (
    x === y
    || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)))
    || levenshtein(x, y) <= 1
  )));
}

function limparAutoridade(valor) {
  return limpar(valor)
    .replace(/\s*[|!—].*$/, '')
    .replace(/^[^A-Za-zÀ-Ý]+/, '')
    .replace(/^[A-Za-zÀ-Ý]\s+/, '')
    .replace(/^[^A-Za-zÀ-Ý]+/, '')
    .replace(/\s+RA\s*\d+.*$/i, '')
    .replace(/\s+OAB\s*\d+.*$/i, '')
    .replace(/\s+\d{2,}.*$/, '')
    .replace(/[.,;:'"”\s]+$/, '')
    .trim();
}

function nomeValido(nome) {
  if (!nome) return false;
  if (/\d/.test(nome)) return false;
  if (PALAVRAS_NAO_NOME.test(nome)) return false;
  const normalizado = semAcento(nome);
  if (CARGOS_PROIBIDOS.some((cargo) => cargo && normalizado.includes(cargo))) return false;
  const palavras = nome.split(/\s+/).filter(Boolean);
  return palavras.length >= 2 && palavras.length <= 8;
}

function nomeProibido(nome, nomesProibidos) {
  const n = semAcento(nome);
  if (!n) return true;
  return nomesProibidos.some((proibido) => {
    const p = semAcento(proibido);
    return p.length >= 5 && (n === p || n.includes(p) || p.includes(n));
  });
}

/** Diretores configurados + a linha "Dr(a). NOME" encontrada no texto. */
function nomesDoDiretor(texto) {
  const nomes = [...(DIRETORES.nomes || [])];
  for (const encontrado of texto.matchAll(/Dr\(a\)\.\s*([^\n]+)/gi)) {
    const nome = limpar(encontrado[1]).replace(/\s*[-–].*$/, '').trim();
    if (nome) nomes.push(nome);
  }
  return nomes;
}

function normalizarEstadoCivil(valor) {
  const v = semAcento(valor).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/uniao estavel|uniao estavel/.test(v)) return 'Solteiro(a)';
  if (/solteir/.test(v)) return 'Solteiro(a)';
  if (/casad/.test(v)) return 'Casado(a)';
  if (/divorciad/.test(v)) return 'Divorciado(a)';
  if (/viuv/.test(v)) return 'Viúvo(a)';
  return '';
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

/**
 * Coleta os nomes ligados a "Delegado(a) de Policia Civil" (depois do cargo e
 * na linha imediatamente anterior, que e a assinatura). A ultima ocorrencia no
 * texto e a assinatura; ela prevalece quando for outra pessoa. Se for a mesma
 * pessoa com grafia pior (OCR), usa a grafia do inicio, que costuma ser a
 * versao digitada correta.
 */
function extrairAutoridade(texto, nomesProibidos) {
  const candidatos = [];

  const depois = /D[e3]l[a-z]{1,2}g[a4]d[o0]\(a\)?\.?\s*d[eê]\s*Pol[íi]cia\s+Civil\s*:\s*([^\n]+)/gi;
  for (const encontrado of texto.matchAll(depois)) {
    const nome = limparAutoridade(encontrado[1]);
    if (nomeValido(nome) && !nomeProibido(nome, nomesProibidos)) {
      candidatos.push({ pos: encontrado.index, nome });
    }
  }

  const antes = /([^\n]{4,90})\s*\n\s*D[e3]l[a-z]{1,2}g[a4]d[o0]\(a\)?\.?\s*d[eê]\s*Pol[íi]cia\s+Civil/gi;
  for (const encontrado of texto.matchAll(antes)) {
    const nome = limparAutoridade(encontrado[1]);
    if (nomeValido(nome) && !nomeProibido(nome, nomesProibidos)) {
      candidatos.push({ pos: encontrado.index, nome });
    }
  }

  candidatos.sort((a, b) => a.pos - b.pos);
  if (candidatos.length === 0) return undefined;
  const primeiro = candidatos[0];
  const ultimo = candidatos[candidatos.length - 1];
  if (candidatos.length === 1) return primeiro.nome;
  if (mesmaPessoa(ultimo.nome, primeiro.nome)) return primeiro.nome;
  return ultimo.nome;
}

/** Extrai os campos de um unico texto (OCR ou camada digital). */
function extrairDoTexto(texto, configuracao) {
  const dados = {};
  const nomesProibidos = nomesDoDiretor(texto);

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

  // Data da requisicao/oficio: data de registro/protocolo, no cabecalho.
  const cabecalho = texto.split(/Ref\.?:|Periciando\(a\):|Hist[óo]rico:/i)[0];
  const dataRequisicao = cabecalho.match(/Data:\s*(\d{2}\/\d{2}\/\d{4})/)
    || texto.match(/DATA E HORA DO REGISTRO:[\s\S]{0,160}?(\d{2}\/\d{2}\/\d{4})/i);
  if (dataRequisicao) dados.dataRequisicao = dataRequisicao[1];

  // Sexo: "Sexo: Feminino" ou "identidade de genero feminino".
  const sexo = texto.match(/(?:sexo|identidade de g[êe]nero)\s*[:\s]+(feminino|masculino|n[ãa]o identificado)/i);
  if (sexo) dados.sexo = capitalizar(sexo[1]);

  // Estado civil: Uniao Estavel -> Solteiro(a).
  const estadoCivil = texto.match(/estado civil\s*:?\s+([A-Za-zÀ-ÿ() ]+?)(?=,|\.|\s+identidade|\s+profiss|\s+filho|\n)/i);
  if (estadoCivil) {
    const valor = normalizarEstadoCivil(estadoCivil[1]);
    if (valor) dados.estadoCivil = valor;
  }

  // Autoridade: a assinatura final prevalece; mesma pessoa usa a grafia do inicio.
  const autoridade = extrairAutoridade(texto, nomesProibidos);
  if (autoridade) dados.autoridade = autoridade;

  // Orgao solicitante: a unidade que aparece no cabecalho.
  const padroesOrgao = [
    /Central de Flagrantes[^\n]*/i,
    /Central de Pol[íi]cia Civil[^\n]*/i,
    /(?:\d{1,2}[º°ª]\s+)?Delegacia Distrital[^\n]*/i,
    /Delegacia Especializada[^\n]*/i,
    /Delegacia da Comarca[^\n]*/i,
    /Delegacia do Munic[íi]pio[^\n]*/i,
    /Delegacia de Pol[íi]cia Civil[^\n]*/i,
  ];
  for (const padrao of padroesOrgao) {
    const encontrado = texto.match(padrao);
    if (encontrado) {
      dados.orgao = limpar(encontrado[0])
        .replace(/\s+(GOVERNO|GOVERA|Secretaria|ao O RAIBA|Beciana|DA\s+PARA[ÍI]BA|PARA[ÍI]BA|Ada\s+AA)[\s\S]*$/i, '')
        .replace(/\s*-\s*$/, '')
        .replace(/[.,;]+$/, '')
        .trim();
      break;
    }
  }

  // Destino do laudo: para antes do periciando/local/tipo da pagina seguinte.
  const destino = texto.match(/remeter o laudo para\s+([\s\S]*?)(?=Periciando\(a\):|Local da Ocorr|Tipo do Local|$)/i);
  if (destino) {
    dados.destinoExame = limpar(destino[1])
      .replace(/\s*["“”'‘’|][\s\S]*$/, '')
      .replace(/—\s*:\s*/g, '— ')
      .replace(/[.,;:'"”|\s]+$/, '')
      .trim();
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
    if (!/^(CPF|RG|CNH)/i.test(valor) && !nomeProibido(valor, nomesProibidos)) {
      dados.nomeExaminado = valor;
    }
  }

  // RG: numero + sigla do orgao emissor (qualquer sigla) + /UF.
  const rgTrecho = texto.match(/\bR\.?G\.?\s*:?\s*n?[º°]?\s*([\dXx.\-\s]{4,20}?)\s*([A-Za-z]{2,10})\s*\/\s*([A-Za-z]{2})\b/i);
  if (rgTrecho) {
    const numero = rgTrecho[1].replace(/[^\dXx]/g, '').toUpperCase();
    if (numero.length >= 5) {
      dados.rg = numero;
      dados.orgaoExpedidor = rgTrecho[2].toUpperCase();
      const uf = rgTrecho[3].toUpperCase();
      dados.ufExpedidor = UF_POR_SIGLA[uf] || uf;
    }
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
    const mae = limpar(filiacao[1]);
    const pai = filiacao[2] ? limpar(filiacao[2]) : '';
    if (!nomeProibido(mae, nomesProibidos)) dados.nomeMae = mae;
    if (pai && !nomeProibido(pai, nomesProibidos)) dados.nomePai = pai;
  }

  // Endereco de residencia: so o bloco de qualificacao. Para em telefone,
  // quesitos, historico, periciando, local/tipo do local e demais rotulos.
  const endereco = texto.match(
    /(?:residente\s+e\s+domiciliad[oa]\(?a?\)?|residente|domiciliad[oa]\(?a?\)?)\s+(?:no\s*\(a\)|no\s+a|na|no)?\s*([\s\S]{0,260}?)(?=\s*(?:telefone|fone|celular|contato|e-?mail|quesitos?|\d{1,2}[º°]\s*quesito|\d{1,2}[º°]\s*\)|\d{1,2}[.)]\s+(?:Se|Qual|Há|H|Existe|O|A|Em|Caso|Houve|Provocou|Resultou)|[a-d][.)]\s+[A-ZÀ-Ý]|perguntas?|hist[óo]rico|relato|periciando|periciado|local da ocorr|tipo do local|cpf|rg|cnh|nacionalidade|profiss[ãa]o|filho|nascido|natural|data|hora|exame|ref\s*[.:]|procedimento|cep|$))/i,
  );
  if (endereco) {
    let textoEndereco = limpar(endereco[1])
      .replace(/\s*(?:tendo como\s+(?:ã\s+)?)?ponto de refer[eê]ncia[^,;]*/gi, '')
      .replace(/\b(?:na\s+cidade|da\s+cidade|cidade)\s+de\b/gi, '')
      .replace(/\b(?:na|da)\s+cidade\b/gi, '')
      .replace(/\s*CEP\s*:?\s*[\d.\-]+/gi, '')
      .replace(/\b(?:n[º°]|n\.|n[úu]m(?:ero|\.)?|bairro)\s*/gi, '')
      .replace(/\s*\/\s*/g, '/')
      .replace(/\.\s*,\s*/g, ', ')
      .replace(/\s*,\s*,+/g, ',')
      .replace(/\s+,/g, ',')
      .replace(/[.,;]\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Cidade/UF no fim: "..., Campina Grande/PB".
    const cidadeUf = textoEndereco.match(/,\s*([^,]+?)\s*\/\s*([A-Z]{2})\s*$/i);
    if (cidadeUf) {
      dados.cidade = capitalizar(cidadeUf[1]);
      const sigla = cidadeUf[2].toUpperCase();
      dados.uf = UF_POR_SIGLA[sigla] || sigla;
      textoEndereco = textoEndereco.slice(0, cidadeUf.index).replace(/,\s*$/, '').trim();
    }

    // Bairro: ultimo segmento, se nao for numero nem complemento.
    const partes = textoEndereco.split(',').map((parte) => parte.trim()).filter(Boolean);
    const complementos = /^(?:casa|apto?|apartamento|bloco|lote|quadra|edif[ií]cio|condom[ií]nio|fundos|sala|loja|andar|cobertura|kitnet|residencial)\b/i;
    if (partes.length >= 2) {
      const ultimo = partes[partes.length - 1];
      const ehNumero = /^\d+[A-Za-z]?$/.test(ultimo);
      const ehComplemento = complementos.test(ultimo);
      if (!ehNumero && !ehComplemento) {
        dados.bairro = capitalizar(ultimo);
        partes.pop();
      }
    }

    dados.endereco = partes.join(', ')
      .replace(/\b(?:n[º°]|n\.|n[úu]m(?:ero|\.)?|bairro)\s*/gi, '')
      .replace(/\s*,\s*,+/g, ',')
      .replace(/\s+,/g, ',')
      .replace(/[.,;]\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Local do fato
  const local = texto.match(/Local da Ocorr[êe]ncia:\s*([^\n]+)/i);
  if (local) {
    dados.localFato = limpar(local[1])
      .replace(/\s*["“”'‘’|].*$/, '')
      .replace(/[.,;:'"”|\s]+$/, '')
      .trim();
  }

  // Data/hora do fato: "Data: ... - Hora:", "Data/Hora:" ou a linha do Tipo do Local.
  const dataFato = texto.match(/Data:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*Hora:\s*(\d{2}\s*:\s*\d{2})/i)
    || texto.match(/Data\/Hora:\s*(\d{2}\/\d{2}\/\d{4})\s*(\d{2}:\d{2})/i)
    || texto.match(/Local da Ocorr[êe]ncia:[\s\S]*?(\d{2}\/\d{2}\/\d{4})\s*[àa]s\s*(\d{2}:\d{2})/i);
  if (dataFato) {
    dados.dataFato = `${dataFato[1]} ${String(dataFato[2]).replace(/\s/g, '')}`;
  }
  if (!dados.dataFato) {
    const parcial = texto.match(/Tipo do Local:[\s\S]{0,140}?(?:Data\/Hora|Data)\s*:\s*(\d{2}\/\d{2}\/\d{4})?(?:\s*[-–]\s*Hora\s*:\s*|\s+)?(\d{2}:\d{2})?/i);
    if (parcial && (parcial[1] || parcial[2])) {
      dados.dataFato = [parcial[1], parcial[2]].filter(Boolean).join(' ');
    }
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

/** Completa data do oficio e data do fato; nunca inventa data de nascimento. */
function completarDatas(dados, avisos) {
  const hoje = formatarData(new Date());

  if (!dados.dataRequisicao) {
    dados.dataRequisicao = hoje;
    avisos.push('Data da requisicao ausente; preenchida com a data atual.');
  }

  if (!dados.dataFato) {
    dados.dataFato = `${hoje} 00:00`;
    avisos.push('Data do fato ausente; preenchida com a data atual e 00:00.');
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dados.dataFato)) {
    dados.dataFato += ' 00:00';
    avisos.push('Hora do fato ausente; preenchida com 00:00.');
  } else if (/^\d{2}:\d{2}$/.test(dados.dataFato)) {
    dados.dataFato = `${hoje} ${dados.dataFato}`;
    avisos.push('Data do fato ausente; preenchida com a data atual.');
  }
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

  // Só completa as datas quando a requisicao tem numero ou periciando: evita
  // transformar um arquivo ilegivel em "valido" apenas pela data atual.
  if (dados.numeroRequisicao || dados.nomeExaminado) {
    completarDatas(dados, avisos);
  }

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
