'use strict';

/**
 * Lanca o teste de janela, escolhendo as flags conforme o ambiente.
 *
 * Por que este arquivo existe:
 *   Em algumas maquinas o Electron nao sobe sem `--no-sandbox --disable-gpu`
 *   (ele morre antes de executar qualquer linha nossa, com STATUS_BREAKPOINT ou
 *   erro de acesso). Em maquinas normais, essas flags nao sao necessarias — e
 *   `--no-sandbox` reduz a isencao de seguranca do processo.
 *
 *   Por isso o padrao e tentar SEMPRE sem as flags. So quando o processo morre de
 *   forma caracteristica de bloqueio de ambiente o teste e repetido com elas. A
 *   maquina do operador nunca recebe `--no-sandbox` por causa disto.
 *
 * Uso:  npm run teste:janela
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'testes', 'executar-teste-janela.js');
const RESULTADO = path.join(RAIZ, 'testes', 'saida', 'resultado-janela.json');

// Codigos que indicam bloqueio do ambiente, nao defeito do teste.
//   -2147483645 = 0x80000003 STATUS_BREAKPOINT
//   -1073741819 = 0xC0000005  violacao de acesso
const CODIGOS_DE_BLOQUEIO = new Set([-2147483645, -1073741819, 3221225477]);

/** Caminho do executavel do Electron instalado no projeto. */
function caminhoElectron() {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require('electron');
  } catch (erro) {
    return null;
  }
}

function executar(args) {
  const resultado = spawnSync(caminhoElectron(), [SCRIPT, ...args], {
    cwd: RAIZ,
    stdio: 'inherit',
    timeout: 10 * 60 * 1000,
  });

  let codigo = resultado.status ?? (resultado.error ? null : -1);

  // O Windows as vezes entrega o codigo de saida como inteiro SEM sinal
  // (2147483651 em vez de -2147483645). Normaliza para comparar direito.
  if (typeof codigo === 'number' && codigo > 2147483647) {
    codigo -= 4294967296;
  }

  return { codigo, sinal: resultado.signal, erro: resultado.error };
}

function lerResultado() {
  try {
    return JSON.parse(fs.readFileSync(RESULTADO, 'utf8'));
  } catch (erro) {
    return null;
  }
}

function main() {
  const executavel = caminhoElectron();
  if (!executavel || !fs.existsSync(executavel)) {
    console.error('Electron nao encontrado. Rode: npm install');
    process.exit(1);
  }

  // Remove resultado anterior: senao um arquivo velho mascara uma falha nova.
  fs.rmSync(RESULTADO, { force: true });

  console.log('Tentando abrir o Electron normalmente...');
  const primeira = executar([]);

  if (primeira.codigo === 0) {
    const dados = lerResultado();
    if (dados && Array.isArray(dados.falhas) && dados.falhas.length === 0) {
      console.log('JANELA: FLUXO COMPLETO APROVADO');
      process.exit(0);
    }
    console.error('JANELA: FALHOU (o teste rodou e reprovou)');
    (dados?.falhas || ['sem detalhes']).forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }

  if (!CODIGOS_DE_BLOQUEIO.has(primeira.codigo)) {
    // Nao e bloqueio de ambiente: e uma falha real do teste. Nao mascara.
    console.error(`JANELA: FALHOU (codigo ${primeira.codigo})`);
    process.exit(1);
  }

  // Bloqueio de ambiente: repete com as flags que contornam a restricao.
  console.log(`O Electron nao iniciou sem flags (codigo ${primeira.codigo}).`);
  console.log('Repetindo com --no-sandbox --disable-gpu (ambiente restrito)...');

  const perfilTemporario = path.join(RAIZ, 'logs', 'tmp', 'electron-teste-janela');
  fs.mkdirSync(perfilTemporario, { recursive: true });
  fs.rmSync(RESULTADO, { force: true });

  const segunda = executar([
    '--no-sandbox',
    '--disable-gpu',
    `--user-data-dir=${perfilTemporario}`,
  ]);

  const dados = lerResultado();

  if (segunda.codigo === 0 && dados && Array.isArray(dados.falhas) && dados.falhas.length === 0) {
    console.log('JANELA: FLUXO COMPLETO APROVADO');
    console.log('(executado com --no-sandbox porque este ambiente exige)');
    process.exit(0);
  }

  console.error(`JANELA: FALHOU (codigo ${segunda.codigo})`);
  if (dados?.falhas?.length) {
    dados.falhas.forEach((f) => console.error('  - ' + f));
  } else {
    console.error('  sem resultado gravado; provavel bloqueio do ambiente');
  }
  process.exit(1);
}

main();
