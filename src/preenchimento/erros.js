'use strict';

/**
 * Erros de preenchimento com mensagem pronta para o operador.
 *
 * Cada erro carrega:
 *  - mensagem: texto em portugues, sem jargao, para a tela;
 *  - etapa: onde parou ("aba", "campo", "navegador");
 *  - campo / aba: identificacao para o log;
 *  - detalheTecnico: o que o suporte precisa saber.
 */
class ErroDePreenchimento extends Error {
  constructor(mensagem, { etapa = 'preenchimento', campo = null, aba = null, detalheTecnico = null } = {}) {
    super(mensagem);
    this.name = 'ErroDePreenchimento';
    this.etapa = etapa;
    this.campo = campo;
    this.aba = aba;
    this.detalheTecnico = detalheTecnico;
  }
}

/** Erro de configuração: seletores ausentes ou inseguros. */
class ErroDeConfiguracao extends Error {
  constructor(mensagem, detalhes = null) {
    super(mensagem);
    this.name = 'ErroDeConfiguracao';
    this.detalhes = detalhes;
  }
}

module.exports = { ErroDePreenchimento, ErroDeConfiguracao };
