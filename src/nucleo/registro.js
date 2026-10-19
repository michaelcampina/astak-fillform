'use strict';

/**
 * Registro local de operacao (auditoria e diagnostico).
 *
 * REGRA DE OURO: nunca grava dado pessoal. Grava o NOME do campo, se ele foi
 * preenchido com sucesso e um resumo sem conteudo. O conteudo extraido fica
 * apenas em memoria.
 */

const fs = require('node:fs');
const path = require('node:path');

let diretorioLog = null;
let nivelMinimo = 'INFO';

const NIVEIS = { DEBUG: 10, INFO: 20, AVISO: 30, ERRO: 40 };

function configurar(diretorio, nivel = 'INFO') {
  diretorioLog = path.isAbsolute(diretorio) ? diretorio : path.resolve(process.cwd(), diretorio);
  nivelMinimo = NIVEIS[nivel] ? nivel : 'INFO';
  fs.mkdirSync(diretorioLog, { recursive: true });
}

function arquivoDoDia() {
  const hoje = new Date();
  const iso = [
    hoje.getFullYear(),
    String(hoje.getMonth() + 1).padStart(2, '0'),
    String(hoje.getDate()).padStart(2, '0'),
  ].join('-');
  return path.join(diretorioLog, `ferramenta-${iso}.log`);
}

/** Mascara um valor qualquer: mostra apenas quantidade de caracteres. */
function mascarar(valor) {
  if (valor === null || valor === undefined) {
    return '(vazio)';
  }
  const texto = String(valor);
  return `(${texto.length} caractere${texto.length === 1 ? '' : 's'})`;
}

function registrar(nivel, mensagem, detalhes) {
  if (NIVEIS[nivel] < NIVEIS[nivelMinimo]) {
    return;
  }
  const carimbo = new Date().toISOString();
  let linha = `${carimbo} [${nivel}] ${mensagem}`;
  if (detalhes !== undefined) {
    linha += ` | ${typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes)}`;
  }

  // Espelho no console ajuda durante o diagnostico presencial.
  // eslint-disable-next-line no-console
  console.log(linha);

  if (!diretorioLog) {
    return;
  }
  try {
    fs.appendFileSync(arquivoDoDia(), linha + '\n', 'utf8');
  } catch (erro) {
    // Falha de log nunca pode derrubar o preenchimento.
    // eslint-disable-next-line no-console
    console.error(`Nao foi possivel escrever o log: ${erro.message}`);
  }
}

module.exports = {
  configurar,
  mascarar,
  debug: (mensagem, detalhes) => registrar('DEBUG', mensagem, detalhes),
  info: (mensagem, detalhes) => registrar('INFO', mensagem, detalhes),
  aviso: (mensagem, detalhes) => registrar('AVISO', mensagem, detalhes),
  erro: (mensagem, detalhes) => registrar('ERRO', mensagem, detalhes),
};
