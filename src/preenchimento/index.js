'use strict';

/**
 * Orquestracao do preenchimento no navegador.
 *
 * Responsabilidades:
 *  - usar a sessao do navegador com o perfil do operador (sessao ja logada);
 *  - percorrer as abas e os campos na ORDEM da configuracao;
 *  - verificar cada campo depois de preencher;
 *  - parar no primeiro problema, sem tentar compensar;
 *  - NUNCA clicar em botao de envio.
 */

const path = require('node:path');
const { ErroDePreenchimento, ErroDeConfiguracao } = require('./erros');
const { preencherCampo } = require('./campos');
const { validarConfiguracao } = require('./protetor');
const { exigeNic, nicPreenchido } = require('./nic');
const { obterNavegador } = require('./sessao');
const registro = require('../nucleo/registro');

/** Substitui marcadores especiais na URL (usado pela pagina de simulacao). */
function resolverUrl(url, configuracao) {
  return String(url).replace(
    '__DIRETORIO_SIMULACAO__',
    path.join(configuracao.raiz, 'simulacao').replace(/\\/g, '/'),
  );
}

/** A URL configurada aponta para uma pagina local do projeto? */
function ehUrlLocal(url) {
  return String(url).startsWith('file:');
}

/**
 * Navega ate a tela do formulario e espera o marcador de pagina pronta.
 *
 * Comportamento importante: se a pagina ATUAL ja e o formulario (mesma URL e o
 * marcador esta visivel), nao recarregamos. Recarregar apagaria o que o
 * operador ja digitou a mao e, no sistema oficial, pode perder o contexto da
 * tela aberta. Assim o preenchimento e idempotente.
 */
async function abrirFormulario(pagina, configuracao) {
  const perfil = configuracao.perfil;
  const url = resolverUrl(perfil.url, configuracao);
  const timeout = configuracao.geral.navegador.timeoutPadraoMs;

  const jaEstaNoFormulario = await pagina
    .locator(perfil.seletorPronto)
    .first()
    .isVisible()
    .catch(() => false);

  const mesmaUrl = (() => {
    try {
      const atual = pagina.url();
      // Para file://, comparamos o caminho normalizado.
      if (ehUrlLocal(url) && atual.startsWith('file:')) {
        const normalizar = (u) => decodeURIComponent(u).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        return normalizar(atual) === normalizar(url);
      }
      return atual === url;
    } catch {
      return false;
    }
  })();

  if (jaEstaNoFormulario && mesmaUrl) {
    registro.info('Formulario ja estava aberto; preenchendo sem recarregar.', { url });
  } else {
    registro.info('Abrindo o formulario', {
      url,
      modo: configuracao.modoTeste ? 'teste' : 'oficial',
    });

    try {
      await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout });
    } catch (erro) {
      throw new ErroDePreenchimento(
        'A pagina do sistema nao carregou. Confira a conexao e se o sistema oficial esta no ar.',
        { etapa: 'navegador', detalheTecnico: `URL: ${url}. Erro: ${erro.message}` },
      );
    }

    try {
      await pagina.locator(perfil.seletorPronto).first().waitFor({ state: 'visible', timeout });
    } catch {
      // Caso classico: a sessao expirou e o sistema redirecionou para o login.
      const titulo = await pagina.title().catch(() => '');
      const camposDeSenha = await pagina.locator('input[type="password"]').count().catch(() => 0);

      if (camposDeSenha > 0) {
        throw new ErroDePreenchimento(
          'A sessao do sistema expirou. Entre no sistema nessa janela, abra a tela de cadastro e clique em Preencher de novo.',
          { etapa: 'navegador', detalheTecnico: `Login detectado. Titulo: ${titulo}` },
        );
      }

      throw new ErroDePreenchimento(
        'O formulario do sistema nao apareceu. A tela pode ter mudado ou a pagina nao terminou de carregar.',
        {
          etapa: 'navegador',
          detalheTecnico: `Seletor de pagina pronta nao encontrado: ${perfil.seletorPronto}. Titulo: ${titulo}`,
        },
      );
    }
  }

  await pagina.bringToFront().catch(() => {});
}

/**
 * Ativa uma aba e confirma que o painel dela ficou visivel.
 */
async function abrirAba(pagina, aba, opcoes) {
  if (!aba.seletorAba) {
    return; // Formulario de pagina unica.
  }

  const elementoAba = pagina.locator(aba.seletorAba).first();

  try {
    await elementoAba.waitFor({ state: 'visible', timeout: opcoes.timeoutMs });
  } catch {
    throw new ErroDePreenchimento(
      `A aba "${aba.descricao}" nao foi encontrada no sistema.`,
      { etapa: 'localizar', aba: aba.id, detalheTecnico: `Seletor nao visivel: ${aba.seletorAba}` },
    );
  }

  // Se o painel da aba ja esta visivel, nao clicamos de novo: evita navegacao
  // desnecessaria em telas que recarregam conteudo ao clicar.
  const painelJaVisivel = aba.seletorPainel
    ? await pagina.locator(aba.seletorPainel).first().isVisible().catch(() => false)
    : false;

  if (!painelJaVisivel) {
    await elementoAba.click({ timeout: opcoes.timeoutMs });

    if (aba.seletorPainel) {
      try {
        await pagina.locator(aba.seletorPainel).first().waitFor({ state: 'visible', timeout: opcoes.timeoutMs });
      } catch {
        throw new ErroDePreenchimento(
          `A aba "${aba.descricao}" foi clicada, mas o conteudo dela nao abriu.`,
          { etapa: 'aba', aba: aba.id, detalheTecnico: `Painel nao visivel: ${aba.seletorPainel}` },
        );
      }
    }
  }

  await pagina.waitForTimeout(opcoes.esperaEstabilizacaoMs || 300);
}

/**
 * Le o valor atual de um campo simples da tela, sem falhar se ele sumir.
 *
 * Nao exige visibilidade: o campo "Exame" fica em outra aba, que pode estar
 * oculta no momento da leitura. O valor continua valendo.
 */
async function lerValorSimples(pagina, seletor) {
  try {
    return await pagina
      .locator(seletor)
      .first()
      .evaluate((elemento) => String(elemento.value ?? elemento.textContent ?? '').trim());
  } catch {
    return '';
  }
}

/**
 * Espera o operador informar o NIC na tela.
 *
 * So acontece na aba da vitima quando o exame e NECROPSIA. O sistema oficial
 * mantem os campos bloqueados ate o NIC; a ferramenta aguarda em vez de
 * desistir no primeiro instante.
 */
async function aguardarNic(pagina, regra, opcoes, aoProgredir) {
  const limite = opcoes.esperaNicMs || 60000;
  aoProgredir('Aguardando o NIC na aba da vitima...');

  const fim = Date.now() + limite;
  while (Date.now() < fim) {
    await pagina.waitForTimeout(500);
    const nic = await lerValorSimples(pagina, regra.seletorNic);
    if (nicPreenchido(nic)) {
      return;
    }
  }

  throw new ErroDePreenchimento(
    'O NIC nao foi informado na aba da vitima. No exame de NECROPSIA o sistema ' +
    'so libera os campos depois do NIC. Informe o NIC e clique em Preencher novamente.',
    {
      etapa: 'preenchimento',
      detalheTecnico: `Campo "${regra.seletorNic}" continuou vazio por ${limite} ms.`,
    },
  );
}

/**
 * Preenche uma aba e devolve os campos efetivamente preenchidos e verificados.
 */
async function preencherAba(pagina, aba, dados, configuracao, aoProgredir) {
  const opcoes = {
    timeoutMs: configuracao.geral.navegador.timeoutPadraoMs || 20000,
    atrasoDigitacaoMs: configuracao.geral.navegador.atrasoDigitacaoMs ?? 8,
    esperaEstabilizacaoMs: configuracao.geral.navegador.esperaEstabilizacaoMs ?? 300,
    esperaNicMs: configuracao.geral.navegador.esperaNicMs ?? 60000,
  };

  await abrirAba(pagina, aba, opcoes);

  // Aba cujo formulario precisa ter sido aberto pelo OPERADOR (ex.: cadastro da
  // vitima). A ferramenta nunca clica em "Cadastrar uma nova vitima".
  if (aba.requerFormularioAberto) {
    const formularioAberto = await pagina
      .locator(aba.requerFormularioAberto)
      .first()
      .isVisible()
      .catch(() => false);

    if (!formularioAberto) {
      registro.info('Aba ignorada: o formulario nao foi aberto pelo operador', { aba: aba.id });
      return {
        preenchidos: [],
        ignorados: (aba.campos || []).map((campo) => campo.campo),
        pulada: aba.id,
      };
    }

    // Regra do NIC: em NECROPSIA os campos ficam bloqueados ate o operador
    // informar o NIC. A ferramenta espera em vez de preencher em campo travado.
    const regraNic = configuracao.perfil.regraNic;
    if (regraNic && regraNic.seletorExame && regraNic.seletorNic) {
      const exame = await lerValorSimples(pagina, regraNic.seletorExame);
      const nic = await lerValorSimples(pagina, regraNic.seletorNic);
      if (exigeNic(exame, regraNic) && !nicPreenchido(nic)) {
        await aguardarNic(pagina, regraNic, opcoes, aoProgredir);
      }
    }
  }

  const preenchidos = [];
  const ignorados = [];

  for (const definicao of aba.campos || []) {
    const valor = dados[definicao.campo];

    if (valor === undefined || valor === null || String(valor).trim() === '') {
      // Campo sem dado extraido: nao preenche. A obrigatoriedade ja foi
      // checada na extracao, que para antes de chegar aqui.
      ignorados.push(definicao.campo);
      continue;
    }

    const descricao =
      configuracao.campos.find((c) => c.id === definicao.campo)?.descricao || definicao.campo;

    aoProgredir(`Preenchendo: ${descricao}`);

    const resultado = await preencherCampo(
      pagina,
      definicao,
      String(valor),
      { campoId: definicao.campo, abaId: aba.id, descricao },
      configuracao.protetor,
      opcoes,
    );

    preenchidos.push({
      campo: definicao.campo,
      descricao,
      aba: aba.id,
      tipo: definicao.tipo,
      verificado: true,
      opcaoEscolhida: resultado.opcaoEscolhida || null,
    });
  }

  return { preenchidos, ignorados };
}

/**
 * Fluxo completo: abre o formulario, preenche todas as abas e PARA.
 *
 * @param {object} dados JSON extraido da requisicao
 * @param {object} configuracao config carregada
 * @param {object} [gatilhos] callbacks { aoProgredir }
 * @returns {Promise<{preenchidos: object[], ignorados: string[], resumo: object}>}
 */
async function preencher(dados, configuracao, gatilhos = {}) {
  const aoProgredir = gatilhos.aoProgredir || (() => {});

  // 1. Valida a configuracao ANTES de abrir navegador.
  const problemas = validarConfiguracao(configuracao.perfil, configuracao.protetor);
  if (problemas.length > 0) {
    throw new ErroDeConfiguracao(
      'Os seletores do formulario precisam de ajuste antes do preenchimento. ' +
      'Abra o arquivo de configuracao e complete os campos indicados.',
      problemas,
    );
  }

  // 2. Confere se ha dados para preencher.
  const totalCampos = (configuracao.perfil.abas || [])
    .flatMap((aba) => aba.campos || [])
    .filter((c) => dados[c.campo] !== undefined && String(dados[c.campo]).trim() !== '')
    .length;

  if (totalCampos === 0) {
    throw new ErroDePreenchimento(
      'Nenhum dado foi reconhecido para preencher. Confira a requisicao.',
      { etapa: 'preenchimento' },
    );
  }

  aoProgredir('Abrindo o navegador...');
  const { pagina } = await obterNavegador(configuracao);

  aoProgredir('Carregando o formulario do sistema...');
  await abrirFormulario(pagina, configuracao);

  const preenchidos = [];
  const ignorados = [];
  const abasPuladas = [];

  for (const aba of configuracao.perfil.abas || []) {
    const resultado = await preencherAba(pagina, aba, dados, configuracao, aoProgredir);
    preenchidos.push(...resultado.preenchidos);
    ignorados.push(...resultado.ignorados);
    if (resultado.pulada) {
      abasPuladas.push(resultado.pulada);
    }
  }

  // 3. Deixa o operador na primeira aba, com o topo da pagina visivel.
  const primeiraAba = (configuracao.perfil.abas || [])[0];
  if (primeiraAba?.seletorAba) {
    await pagina.locator(primeiraAba.seletorAba).first().click({ timeout: 5000 }).catch(() => {});
  }
  await pagina.evaluate(() => window.scrollTo({ top: 0 })).catch(() => {});

  registro.info('Preenchimento concluido e verificado', {
    totalCampos: preenchidos.length,
    ignorados: ignorados.length,
    abasPuladas,
    modo: configuracao.modoTeste ? 'teste' : 'oficial',
  });

  return {
    preenchidos,
    ignorados,
    abasPuladas,
    resumo: {
      totalPreenchidos: preenchidos.length,
      totalIgnorados: ignorados.length,
      abas: (configuracao.perfil.abas || []).map((aba) => aba.id),
      abasPuladas,
      finalizadoEm: new Date().toISOString(),
    },
  };
}

module.exports = { preencher, abrirFormulario, abrirAba, resolverUrl };
