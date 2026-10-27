'use strict';

/**
 * Regra do NIC (exame de NECROPSIA).
 *
 * No sistema oficial, o cadastro da vitima so libera os campos depois que o
 * operador informa o NIC. Esta regra e pura de proposito: assim os testes
 * conseguem verifica-la sem abrir navegador, e a interface usa a MESMA decisao
 * que o preenchimento usa (uma fonte de verdade so).
 */

const { normalizar } = require('./protetor');

/**
 * O exame atual exige o NIC antes de liberar os campos da vitima?
 *
 * @param {string} exame texto do campo "Exame" (aba 2)
 * @param {{valorExame?: string}} [regra] bloco regraNic da configuracao
 * @returns {boolean}
 */
function exigeNic(exame, regra) {
  if (!regra || !regra.valorExame) {
    return false;
  }
  return normalizar(exame) === normalizar(regra.valorExame);
}

/**
 * O NIC pode ser considerado informado?
 *
 * Qualquer conteudo nao vazio vale: o formato e validado pelo sistema oficial,
 * nao pela ferramenta. Se o operador digitou algo, a tela ja liberou os campos.
 *
 * @param {string} valor
 * @returns {boolean}
 */
function nicPreenchido(valor) {
  return String(valor ?? '').trim() !== '';
}

module.exports = { exigeNic, nicPreenchido };
