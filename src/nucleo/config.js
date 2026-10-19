'use strict';

/**
 * Carregamento e validacao das configuracoes.
 *
 * Nada de valores de campo, seletor ou regra fica no codigo: tudo vem daqui.
 * Se uma configuracao estiver invalida, a ferramenta falha imediatamente na
 * abertura, com mensagem clara, em vez de tentar se recuperar em tempo de uso.
 */

const fs = require('node:fs');
const path = require('node:path');

// Raiz do projeto: este arquivo fica em <raiz>/src/nucleo/config.js
const RAIZ = path.resolve(__dirname, '..', '..');

function lerJson(caminho) {
  let bruto;
  try {
    bruto = fs.readFileSync(caminho, 'utf8');
  } catch (erro) {
    throw new Error(`Nao foi possivel ler o arquivo de configuracao: ${caminho}`);
  }
  try {
    return JSON.parse(bruto);
  } catch (erro) {
    throw new Error(`O arquivo de configuracao tem um erro de sintaxe JSON: ${caminho} (${erro.message})`);
  }
}

function validar(condicao, mensagem) {
  if (!condicao) {
    throw new Error(mensagem);
  }
}

/**
 * Carrega as quatro configs e devolve um objeto unico, ja validado.
 */
function carregar() {
  const geral = lerJson(path.join(RAIZ, 'config', 'configuracao.json'));
  const campos = lerJson(path.join(RAIZ, 'config', 'campos.json'));
  const seletores = lerJson(path.join(RAIZ, 'config', 'seletores.json'));
  const formatacao = lerJson(path.join(RAIZ, 'config', 'formatacao.json'));

  // ---- validacoes de estrutura ----

  validar(typeof geral.MODO_TESTE === 'boolean', 'configuracao.json: "MODO_TESTE" deve ser true ou false.');
  validar(Array.isArray(campos.campos) && campos.campos.length > 0, 'campos.json: a lista "campos" esta vazia.');

  const idsVistos = new Set();
  for (const campo of campos.campos) {
    validar(typeof campo.id === 'string' && campo.id.length > 0, 'campos.json: existe um campo sem "id".');
    validar(!idsVistos.has(campo.id), `campos.json: o campo "${campo.id}" aparece duas vezes.`);
    validar(
      Array.isArray(campo.rotulos) && campo.rotulos.length > 0,
      `campos.json: o campo "${campo.id}" precisa de pelo menos um rotulo.`,
    );
    validar(
      typeof formatacao[campo.formato] === 'object',
      `campos.json: o campo "${campo.id}" usa o formato "${campo.formato}", que nao existe em formatacao.json.`,
    );
    idsVistos.add(campo.id);
  }

  // Chave de seletores usada conforme o modo.
  const chaveSeletores = geral.MODO_TESTE ? 'simulacao' : 'sistemaOficial';
  const perfil = seletores[chaveSeletores];
  validar(perfil, `seletores.json: falta o bloco "${chaveSeletores}".`);

  // No sistema oficial, os seletores ainda sao os de exemplo: avisa em vez de preencher errado.
  const pendentes = [];
  JSON.stringify(perfil, (chave, valor) => {
    if (typeof valor === 'string' && valor.includes('SUBSTITUIR')) {
      pendentes.push(valor);
    }
    return valor;
  });

  // Campos do formulario precisam existir na extracao, e vice-versa (aviso, nao erro).
  const camposDoFormulario = new Set();
  for (const aba of perfil.abas || []) {
    for (const campo of aba.campos || []) {
      camposDoFormulario.add(campo.campo);
      validar(idsVistos.has(campo.campo), `seletores.json: a aba "${aba.id}" aponta para o campo "${campo.campo}", que nao existe em campos.json.`);
      validar(typeof campo.seletor === 'string', `seletores.json: o campo "${campo.campo}" (aba "${aba.id}") esta sem "seletor".`);
      const tipos = ['texto', 'areaTexto', 'selectNativo', 'caixaPesquisavel'];
      validar(tipos.includes(campo.tipo), `seletores.json: tipo desconhecido "${campo.tipo}" no campo "${campo.campo}".`);
      if (campo.tipo === 'caixaPesquisavel') {
        validar(typeof campo.seletorLista === 'string' && typeof campo.seletorOpcoes === 'string',
          `seletores.json: o campo pesquisavel "${campo.campo}" precisa de "seletorLista" e "seletorOpcoes".`);
      }
    }
  }

  const camposSemDestino = campos.campos.filter((c) => !camposDoFormulario.has(c.id)).map((c) => c.id);

  return {
    raiz: RAIZ,
    geral,
    campos: campos.campos,
    perfil: { ...perfil, chave: chaveSeletores },
    formatacao,
    protetor: perfil._protetor || { seletoresProibidos: [], textosProibidos: [] },
    fluxoTeste: seletores.simulacao,
    fluxoSistemaOficial: seletores.sistemaOficial,
    seletoresBrutos: seletores,
    pendentesDeConfiguracao: pendentes,
    camposSemDestino,
    modoTeste: geral.MODO_TESTE,
  };
}

/** Resolve um caminho relativo a pasta do projeto. */
function resolver(...partes) {
  return path.join(RAIZ, ...partes);
}

module.exports = { carregar, resolver, RAIZ };
