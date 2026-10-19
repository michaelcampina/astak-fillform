'use strict';

/**
 * Ponte segura entre a interface e o processo principal.
 *
 * A interface nao tem acesso a Node.js: so recebe as funcoes expostas aqui.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /** Estado inicial: modo, campos configurados, avisos. */
  estado: () => ipcRenderer.invoke('app:estado'),

  /** Processa um arquivo recebido por arrastar-e-soltar. */
  processarArquivo: (caminho) => ipcRenderer.invoke('arquivo:processar', { caminho }),

  /** Abre o seletor de arquivos do sistema. */
  escolherArquivo: () => ipcRenderer.invoke('arquivo:escolher'),

  /** Aciona o scanner e ja processa o resultado. */
  escanear: () => ipcRenderer.invoke('scanner:capturar'),

  /** Lista scanners instalados (diagnostico). */
  listarScanners: () => ipcRenderer.invoke('scanner:listar'),

  /** Preenche o formulario. Nunca envia. */
  preencher: (dados) => ipcRenderer.invoke('preenchimento:executar', { dados }),

  /** Abre a pasta de logs. */
  abrirLogs: () => ipcRenderer.invoke('logs:abrir'),

  /** Assina mensagens de andamento. */
  aoProgredir: (retorno) => {
    const ouvinte = (_evento, payload) => retorno(payload);
    ipcRenderer.on('progresso', ouvinte);
    return () => ipcRenderer.removeListener('progresso', ouvinte);
  },

  /**
   * Obtem o caminho real de um arquivo solto na janela.
   * No Electron 32+ file.path foi removido; webUtils e o caminho suportado.
   */
  caminhoDoArquivo: (arquivo) => {
    try {
      return webUtils.getPathForFile(arquivo);
    } catch {
      return arquivo?.path || '';
    }
  },
});
