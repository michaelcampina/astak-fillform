'use strict';

/**
 * Preenchimento de cada tipo de campo, sempre com verificacao posterior.
 *
 * Contrato de todos os preenchedores:
 *   1. localizar o elemento por seletor fixo;
 *   2. recusar se o elemento parecer um botao de envio;
 *   3. preencher;
 *   4. LER DE VOLTA e comparar;
 *   5. lancar erro se nao bater, sem tentar "consertar" sozinho.
 *
 * Nada aqui usa Enter: em formulario real, Enter pode submeter o formulario.
 * A confirmacao e sempre pelo Tab (blur), que dispara a validacao do sistema
 * sem risco de envio.
 */

const { ErroDePreenchimento } = require('./erros');
const { avaliarElemento, normalizar } = require('./protetor');
const registro = require('../nucleo/registro');

/** Normaliza valor para comparacao tolerante a espacos e caixa. */
function comparavel(valor) {
  return String(valor ?? '').replace(/\s+/g, ' ').trim();
}

/** Compara dois textos com tolerancia a diferencas de espaco e caixa. */
function equivalentes(esperado, obtido, toleranteACaixa = true) {
  const a = comparavel(esperado);
  const b = comparavel(obtido);
  if (a === b) {
    return true;
  }
  return toleranteACaixa && a.toLowerCase() === b.toLowerCase();
}

/**
 * Compara ignorando acentos e caixa. Usado na conferencia de valores que o
 * sistema pode devolver com grafia levemente diferente da lida no papel.
 */
function equivalentesSemAcento(esperado, obtido) {
  return normalizar(esperado) === normalizar(obtido);
}

/**
 * Localiza um elemento e confirma que ele esta visivel e editavel.
 */
async function localizarCampo(pagina, definicao, contexto, protetor, timeoutMs) {
  const seletor = String(definicao.seletor || '');
  const localizador = seletor.startsWith('//') || seletor.startsWith('(')
    ? pagina.locator(`xpath=${seletor}`)
    : pagina.locator(seletor);

  try {
    await localizador.first().waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    throw new ErroDePreenchimento(
      `O campo "${contexto.descricao}" nao apareceu na tela do sistema. ` +
      'O layout pode ter mudado ou a pagina nao carregou por completo.',
      {
        etapa: 'localizar',
        campo: contexto.campoId,
        aba: contexto.abaId,
        detalheTecnico: `Seletor nao encontrado: ${seletor}`,
      },
    );
  }

  const alvo = localizador.first();
  const handle = await alvo.elementHandle();
  if (!handle) {
    throw new ErroDePreenchimento(
      `Nao foi possivel acessar o campo "${contexto.descricao}".`,
      { etapa: 'localizar', campo: contexto.campoId, aba: contexto.abaId, detalheTecnico: seletor },
    );
  }

  const avaliacao = await avaliarElemento(pagina, handle, protetor);
  if (!avaliacao.permitido) {
    throw new ErroDePreenchimento(
      `A ferramenta se recusou a interagir com o campo "${contexto.descricao}" porque ele parece um botao de envio. ` +
      'Confira os seletores no arquivo de configuracao.',
      {
        etapa: 'protecao',
        campo: contexto.campoId,
        aba: contexto.abaId,
        detalheTecnico: avaliacao.motivo,
      },
    );
  }

  return { handle, localizador: alvo };
}

/** Limpa um campo de forma segura (sem Enter). */
async function limparCampo(pagina, localizador, timeoutMs) {
  await localizador.click({ timeout: timeoutMs });
  await pagina.keyboard.press('Control+A');
  await pagina.keyboard.press('Backspace');
}

/**
 * Devolve ao campo o valor completo lido da requisicao.
 *
 * A caixa pesquisavel tenta varios filtros; o ultimo costuma ser so a primeira
 * palavra. Se nenhuma opcao servir, o operador precisa ver o valor inteiro para
 * corrigir, e nao um pedaco dele. Nunca seleciona nada: so digita.
 */
async function restaurarValorDigitado(pagina, localizador, valor, opcoes) {
  try {
    await limparCampo(pagina, localizador, opcoes.timeoutMs);
    await localizador.pressSequentially(valor, { delay: opcoes.atrasoDigitacaoMs });
  } catch {
    // Se nao for possivel restaurar, o campo fica com o que ja estava.
  }
}

/** Le o valor atual de um input/textarea/select. */
async function lerValor(handle) {
  return handle.evaluate((elemento) => {
    if (elemento.tagName === 'SELECT') {
      const opcao = elemento.options ? elemento.options[elemento.selectedIndex] : null;
      return opcao ? opcao.textContent.trim() : elemento.value;
    }
    if ('value' in elemento) {
      return String(elemento.value ?? '');
    }
    return String(elemento.textContent ?? '');
  });
}

/**
 * Campo de texto ou area de texto.
 */
async function preencherTexto(pagina, definicao, valor, contexto, protetor, opcoes) {
  const { handle, localizador } = await localizarCampo(
    pagina, definicao, contexto, protetor, opcoes.timeoutMs,
  );

  // Limpa antes de digitar: o formulario pode vir com valor padrao.
  await limparCampo(pagina, localizador, opcoes.timeoutMs);

  // pressSequentially digita como pessoa real, disparando os eventos que o
  // sistema oficial espera (keydown, input, change). Sem isso, algumas telas
  // com mascara ou validacao incremental nao registram o valor.
  // Textos longos (historico) podem estourar o timeout padrao; nesse caso a
  // gravacao exata com fill e a releitura abaixo continuam valendo.
  let digitacaoFalhou = false;
  try {
    await localizador.pressSequentially(valor, {
      delay: opcoes.atrasoDigitacaoMs,
      timeout: Math.max(opcoes.timeoutMs || 20000, 60000),
    });
  } catch {
    digitacaoFalhou = true;
  }

  // Sai do campo para disparar a validacao do proprio sistema (blur).
  await pagina.keyboard.press('Tab');

  let lido = await lerValor(handle);

  if (!equivalentes(valor, lido)) {
    // A digitacao tecla a tecla pode ser interrompida quando a janela perde o
    // foco ou o texto e longo. O fill grava o valor exato e dispara
    // input/change; a releitura abaixo continua sendo obrigatoria.
    await localizador.fill(valor);
    await pagina.keyboard.press('Tab');
    const lidoComFill = await lerValor(handle);
    if (equivalentes(valor, lidoComFill)) {
      registro.aviso('Digitacao incompleta; valor regravado com fill e conferido', {
        campo: contexto.campoId,
        esperado: valor.length,
        lidoNaPrimeira: String(lido).length,
        estourouTimeout: digitacaoFalhou,
      });
    }
    lido = lidoComFill;
  }

  if (!equivalentes(valor, lido)) {
    throw new ErroDePreenchimento(
      `O campo "${contexto.descricao}" nao ficou com o valor esperado. ` +
      'A ferramenta parou para nao registrar dado incorreto. Confira o campo na tela.',
      {
        etapa: 'verificar',
        campo: contexto.campoId,
        aba: contexto.abaId,
        detalheTecnico: `Esperado "${valor}" (${valor.length} caracteres); lido "${lido}" (${String(lido).length} caracteres).`,
      },
    );
  }

  return { valorLido: lido };
}

/**
 * Campo <select> nativo.
 */
async function preencherSelectNativo(pagina, definicao, valor, contexto, protetor, opcoes) {
  const { handle } = await localizarCampo(pagina, definicao, contexto, protetor, opcoes.timeoutMs);

  // Descobre as opcoes reais para casar por texto ou por value.
  const opcoesDisponiveis = await handle.evaluate((el) =>
    Array.from(el.options || []).map((o) => ({ valor: o.value, texto: (o.textContent || '').trim() })),
  );

  if (opcoesDisponiveis.length === 0) {
    throw new ErroDePreenchimento(
      `O campo "${contexto.descricao}" nao tem opcoes disponiveis no momento.`,
      { etapa: 'preencher', campo: contexto.campoId, aba: contexto.abaId },
    );
  }

  const alvo = comparavel(valor);
  const alvoNormalizado = normalizar(alvo);

  // Ordem de preferencia: valor exato, texto exato, texto exato sem acento.
  // "Contem" NAO entra aqui: em lista fechada, casar por pedaco escolheria a
  // opcao errada sem o operador perceber.
  const encontrada =
    opcoesDisponiveis.find((o) => comparavel(o.valor) === alvo) ||
    opcoesDisponiveis.find((o) => comparavel(o.texto) === alvo) ||
    opcoesDisponiveis.find((o) => normalizar(o.texto) === alvoNormalizado) ||
    opcoesDisponiveis.find((o) => normalizar(o.texto).replace(/\(a\)/g, '') === alvoNormalizado.replace(/\(a\)/g, ''));

  if (!encontrada) {
    const amostra = opcoesDisponiveis.slice(0, 8).map((o) => o.texto).join(' | ');
    throw new ErroDePreenchimento(
      `O valor "${valor}" nao existe na lista de "${contexto.descricao}". ` +
      `A ferramenta nao escolhe por aproximacao. Opcoes disponiveis: ${amostra}.`,
      { etapa: 'selecionar', campo: contexto.campoId, aba: contexto.abaId },
    );
  }

  await handle.selectOption(encontrada.valor, { timeout: opcoes.timeoutMs });
  await pagina.keyboard.press('Tab');

  const lido = await lerValor(handle);

  if (!equivalentes(encontrada.texto, lido) && !equivalentes(encontrada.valor, lido)) {
    throw new ErroDePreenchimento(
      `A selecao de "${contexto.descricao}" nao foi confirmada pelo sistema.`,
      {
        etapa: 'verificar',
        campo: contexto.campoId,
        aba: contexto.abaId,
        detalheTecnico: `Esperado "${encontrada.texto}"; lido "${lido}".`,
      },
    );
  }

  return { valorLido: lido, opcaoEscolhida: encontrada.texto };
}

/**
 * Monta as tentativas de filtro para uma caixa pesquisavel.
 *
 * Por que varias tentativas: o filtro dessas caixas costuma ser sensivel a
 * acento e a pontuacao. Se o OCR perder um acento ("Ministerio" no lugar de
 * "Ministerio"), digitar o valor inteiro NAO retorna nada. Reduzir para o
 * inicio do texto (que normalmente nao tem acento) traz as opcoes de volta.
 *
 * A lista e fixa e sempre na mesma ordem: o comportamento e deterministico.
 */
function montarTentativasDeFiltro(valor) {
  const texto = comparavel(valor);
  const tentativas = [];
  const adicionar = (candidato) => {
    const limpo = comparavel(candidato);
    if (limpo.length >= 3 && !tentativas.includes(limpo)) {
      tentativas.push(limpo);
    }
  };

  // 1. Valor completo, como foi lido.
  adicionar(texto);

  // 2. Sem os trechos entre parenteses (comum em nomes de orgao).
  adicionar(texto.replace(/\([^)]*\)/g, ' '));

  // 3. Antes da primeira virgula ou barra (endereco/qualificador costuma vir depois).
  adicionar(texto.split(/[,\/]/)[0]);

  // 4. Inicio do texto ate o primeiro acento: a parte sem acento sempre casa.
  const semAcentoInicial = texto.match(/^[^\u00c0-\u017f]+/);
  if (semAcentoInicial) {
    adicionar(semAcentoInicial[0]);
  }

  // 5. Prefixos curtos, do maior para o menor.
  const palavras = texto.split(' ');
  if (palavras.length > 1) {
    adicionar(palavras.slice(0, 2).join(' '));
  }
  adicionar(palavras[0]);

  return tentativas;
}

/**
 * Caixa seletora pesquisavel (item 6 do escopo).
 *
 * Fluxo obrigatorio:
 *   1. clicar no campo para ativar o foco;
 *   2. digitar o texto extraido para filtrar;
 *   3. aguardar a lista de opcoes surgir;
 *   4. clicar na opcao correspondente;
 *   5. confirmar com Tab (NUNCA Enter);
 *   6. ler de volta e comparar.
 *
 * Se mais de uma opcao casar, a ferramenta PARA: escolher no escuro seria
 * exatamente o tipo de erro que este projeto nao pode cometer.
 */
async function preencherCaixaPesquisavel(pagina, definicao, valor, contexto, protetor, opcoes) {
  const { handle, localizador } = await localizarCampo(
    pagina, definicao, contexto, protetor, opcoes.timeoutMs,
  );

  const modo = definicao.modoCorrespondencia || 'exata';
  const minimo = definicao.minimoCaracteresFiltro || 3;

  if (comparavel(valor).length < minimo) {
    throw new ErroDePreenchimento(
      `O valor lido para "${contexto.descricao}" e curto demais para filtrar a lista com seguranca.`,
      { etapa: 'selecionar', campo: contexto.campoId, aba: contexto.abaId },
    );
  }

  const lista = pagina.locator(definicao.seletorLista);
  const opcoesLocator = pagina.locator(definicao.seletorOpcoes);

  const tentativas = montarTentativasDeFiltro(valor);
  const historico = [];
  let escolhida = null;

  for (const tentativa of tentativas) {
    await limparCampo(pagina, localizador, opcoes.timeoutMs);
    await localizador.pressSequentially(tentativa, { delay: opcoes.atrasoDigitacaoMs });

    // Aguarda a lista aparecer. Se o sistema nao abrir a lista, seguimos para
    // a proxima tentativa em vez de abortar de imediato.
    const abriu = await lista
      .first()
      .waitFor({ state: 'visible', timeout: Math.min(opcoes.timeoutMs, 5000) })
      .then(() => true)
      .catch(() => false);

    if (!abriu) {
      historico.push(`"${tentativa}": a lista nao abriu`);
      continue;
    }

    // Pequena espera para a lista terminar de filtrar.
    await pagina.waitForTimeout(opcoes.esperaEstabilizacaoMs || 300);

    const textos = [];
    const total = await opcoesLocator.count();
    for (let indice = 0; indice < total; indice += 1) {
      const texto = comparavel(await opcoesLocator.nth(indice).innerText().catch(() => ''));
      // Opcoes de "nenhum resultado" nao sao candidatas.
      if (texto === '' || /nenhum|nenhuma|sem resultado/i.test(texto)) continue;
      textos.push({ indice, texto });
    }

    if (textos.length === 0) {
      historico.push(`"${tentativa}": nenhuma opcao`);
      continue;
    }

    const alvo = comparavel(valor).toLowerCase();
    const alvoSemAcento = normalizar(valor);

    let candidatos;
    if (modo === 'exata') {
      candidatos = textos.filter((o) => normalizar(o.texto) === alvoSemAcento);
    } else if (modo === 'inicio') {
      candidatos = textos.filter((o) => normalizar(o.texto).startsWith(alvoSemAcento));
    } else {
      candidatos = textos.filter((o) => normalizar(o.texto).includes(alvoSemAcento));
    }

    // Reforco: quando o filtro devolve poucas opcoes, aceitamos a que tem o
    // texto mais parecido com o valor lido, desde que seja a UNICA.
    if (candidatos.length === 0 && textos.length === 1) {
      candidatos = textos;
    }

    if (candidatos.length === 1) {
      escolhida = { ...candidatos[0], filtro: tentativa };
      break;
    }

    if (candidatos.length > 1) {
      const listaAmbigua = candidatos.slice(0, 5).map((o) => o.texto).join(' | ');
      await restaurarValorDigitado(pagina, localizador, valor, opcoes);
      throw new ErroDePreenchimento(
        `Mais de uma opcao corresponde a "${valor}" em "${contexto.descricao}". ` +
        `A ferramenta nao escolhe por conta propria. Opcoes: ${listaAmbigua}.`,
        {
          etapa: 'selecionar',
          campo: contexto.campoId,
          aba: contexto.abaId,
          detalheTecnico: `Filtro usado: "${tentativa}".`,
        },
      );
    }

    historico.push(`"${tentativa}": ${textos.length} opcao(oes), nenhuma corresponde ao valor lido`);
  }

  if (!escolhida) {
    await restaurarValorDigitado(pagina, localizador, valor, opcoes);
    throw new ErroDePreenchimento(
      `Nenhuma opcao de "${contexto.descricao}" corresponde a "${valor}". ` +
      'Confira se o dado lido da requisicao esta correto ou ajuste o cadastro no sistema.',
      {
        etapa: 'selecionar',
        campo: contexto.campoId,
        aba: contexto.abaId,
        detalheTecnico: historico.join(' ; '),
      },
    );
  }

  const elementoOpcao = opcoesLocator.nth(escolhida.indice);
  const handleOpcao = await elementoOpcao.elementHandle();

  const avaliacaoOpcao = await avaliarElemento(pagina, handleOpcao, protetor);
  if (!avaliacaoOpcao.permitido) {
    throw new ErroDePreenchimento(
      `A opcao encontrada para "${contexto.descricao}" parece acionar envio e foi bloqueada.`,
      { etapa: 'protecao', campo: contexto.campoId, aba: contexto.abaId, detalheTecnico: avaliacaoOpcao.motivo },
    );
  }

  await elementoOpcao.click({ timeout: opcoes.timeoutMs });

  // Confirma sem Enter.
  await pagina.keyboard.press('Tab');
  await pagina.waitForTimeout(opcoes.esperaEstabilizacaoMs || 300);

  // Confere o que o sistema registrou.
  const valorLido = await lerValor(handle);
  const estrategia = definicao.valorVerificacao || 'textoOpcao';
  const esperado = estrategia === 'valorDigitado' ? valor : escolhida.texto;

  const confere =
    equivalentes(esperado, valorLido) ||
    equivalentesSemAcento(esperado, valorLido) ||
    equivalentePorInclusao(esperado, valorLido);

  if (!confere) {
    throw new ErroDePreenchimento(
      `A selecao de "${contexto.descricao}" nao foi confirmada pelo sistema. ` +
      'Confira o campo na tela antes de continuar.',
      {
        etapa: 'verificar',
        campo: contexto.campoId,
        aba: contexto.abaId,
        detalheTecnico: `Esperado: "${esperado}". Lido no campo: "${valorLido}". Opcao clicada: "${escolhida.texto}".`,
      },
    );
  }

  registro.info('Caixa pesquisavel preenchida', {
    campo: contexto.campoId,
    opcao: escolhida.texto,
  });

  return { valorLido, opcaoEscolhida: escolhida.texto };
}

/** O texto do campo contem o esperado (ou vice-versa), desconsiderando acento. */
function equivalentePorInclusao(esperado, obtido) {
  const a = normalizar(esperado);
  const b = normalizar(obtido);
  if (a === '' || b === '') return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Despacha para o preenchedor correto conforme o tipo configurado.
 */
async function preencherCampo(pagina, definicao, valor, contexto, protetor, opcoes) {
  switch (definicao.tipo) {
    case 'texto':
    case 'areaTexto':
      return preencherTexto(pagina, definicao, valor, contexto, protetor, opcoes);
    case 'selectNativo':
      return preencherSelectNativo(pagina, definicao, valor, contexto, protetor, opcoes);
    case 'caixaPesquisavel':
      return preencherCaixaPesquisavel(pagina, definicao, valor, contexto, protetor, opcoes);
    default:
      throw new ErroDePreenchimento(
        `O tipo de campo "${definicao.tipo}" nao e reconhecido pela ferramenta.`,
        { etapa: 'configuracao', campo: contexto.campoId, aba: contexto.abaId },
      );
  }
}

module.exports = {
  preencherCampo,
  equivalentes,
  equivalentesSemAcento,
  comparavel,
  montarTentativasDeFiltro,
  normalizar,
};
