'use strict';

/**
 * Logica da interface.
 *
 * Toda decisao pesada (ler documento, preencher) acontece no processo
 * principal. Aqui so cuidamos de: mostrar estado, receber arquivo, deixar o
 * operador corrigir valores e pedir o preenchimento.
 *
 * Nao existe nenhuma chamada de envio: a ferramenta para antes do botao de
 * cadastrar e quem conclui e o operador.
 */

const elementos = {
  seloModo: document.getElementById('selo-modo'),
  btnLogs: document.getElementById('btn-logs'),
  etapas: {
    entrada: document.getElementById('etapa-entrada'),
    andamento: document.getElementById('etapa-andamento'),
    dados: document.getElementById('etapa-dados'),
    resultado: document.getElementById('etapa-resultado'),
    erro: document.getElementById('etapa-erro'),
  },
  areaSolta: document.getElementById('area-solta'),
  btnEscanear: document.getElementById('btn-escanear'),
  scannerStatus: document.getElementById('scanner-status'),
  trilhaBarra: document.getElementById('trilha-barra'),
  andamentoTitulo: document.getElementById('andamento-titulo'),
  andamentoDetalhe: document.getElementById('andamento-detalhe'),
  corpoDados: document.getElementById('corpo-dados'),
  avisosExtracao: document.getElementById('avisos-extracao'),
  avisoNic: document.getElementById('aviso-nic-preencher'),
  origemLeitura: document.getElementById('origem-leitura'),
  btnPreencher: document.getElementById('btn-preencher'),
  btnDescartar: document.getElementById('btn-descartar'),
  btnNova: document.getElementById('btn-nova'),
  btnContinuar: document.getElementById('btn-continuar'),
  resultadoTitulo: document.getElementById('resultado-titulo'),
  resultadoTexto: document.getElementById('resultado-texto'),
  erroTitulo: document.getElementById('erro-titulo'),
  erroTexto: document.getElementById('erro-texto'),
  erroDetalhe: document.getElementById('erro-detalhe'),
  erroDetalheTexto: document.getElementById('erro-detalhe-texto'),
  btnErroVoltar: document.getElementById('btn-erro-voltar'),
  rodapeEstado: document.getElementById('rodape-estado'),
  rodapeVersao: document.getElementById('rodape-versao'),
};

/** Estado local da tela. */
const estado = {
  campos: [],           // definicoes de config/campos.json
  dados: {},            // valores atuais (editaveis)
  original: {},         // valores como vieram da extracao
  meta: null,           // metadados da extracao
  ocupado: false,
  modoTeste: false,
  // Estado da aba da vitima na pagina aberta (null = ainda nao consultado).
  vitima: null,
  monitoramentoVitima: null,
};

/* ----------------------------------------------------------- utilidades */

/** Mostra apenas a etapa pedida. */
function mostrarEtapa(nome) {
  for (const [chave, secao] of Object.entries(elementos.etapas)) {
    secao.hidden = chave !== nome;
  }
}

/** Atualiza a barra inferior. */
function definirRodape(texto, tipo = '') {
  elementos.rodapeEstado.textContent = texto;
  elementos.rodapeEstado.className = tipo ? `estado-${tipo}` : '';
}

/** Liga/desliga o estado ocupado (evita duplo clique). */
function definirOcupado(ocupado) {
  estado.ocupado = ocupado;
  elementos.areaSolta.classList.toggle('ocupado', ocupado);
  elementos.btnEscanear.disabled = ocupado;
  elementos.btnPreencher.disabled = ocupado;
}

/** Traduz o tipo de leitura para linguagem de operador. */
function descreverOrigemLeitura(via, confianca) {
  if (via === 'texto-de-pdf-digital') {
    return 'PDF digital (texto lido diretamente)';
  }
  const sufixo = confianca ? ` · leitura ${confianca}%` : '';
  if (via === 'ocr-de-pdf-escaneado') {
    return `PDF escaneado (reconhecido por OCR${sufixo})`;
  }
  if (via === 'ocr-de-imagem') {
    return `Imagem (reconhecida por OCR${sufixo})`;
  }
  return 'Documento';
}

/* ------------------------------------------------------ render dos dados */

/**
 * Desenha a tabela de conferencia. Cada valor e um campo editavel: o operador
 * corrige ali mesmo, e o que ele deixar ali e o que vai para o sistema.
 */
function renderizarDados() {
  elementos.corpoDados.textContent = '';

  for (const campo of estado.campos) {
    const valor = estado.dados[campo.id];
    const preenchido = valor !== undefined && valor !== null && String(valor).trim() !== '';

    const linha = document.createElement('tr');

    const celulaRotulo = document.createElement('td');
    celulaRotulo.className = 'coluna-campo';
    celulaRotulo.textContent = campo.descricao;
    if (campo.obrigatorio) {
      const marca = document.createElement('span');
      marca.className = 'obrigatorio';
      marca.textContent = '*';
      marca.title = 'Campo obrigatório';
      celulaRotulo.appendChild(marca);
    }

    const celulaValor = document.createElement('td');
    const entrada = document.createElement(preenchido && String(valor).length > 60 ? 'textarea' : 'input');

    if (entrada.tagName === 'INPUT') {
      entrada.type = 'text';
    } else {
      entrada.rows = 2;
    }

    entrada.className = 'campo-edicao';
    entrada.value = preenchido ? String(valor) : '';
    entrada.placeholder = preenchido ? '' : 'não encontrado — preencha se necessário';
    entrada.dataset.campo = campo.id;
    entrada.setAttribute('aria-label', campo.descricao);

    if (!preenchido) {
      entrada.classList.add('vazio');
    }

    entrada.addEventListener('input', () => {
      estado.dados[campo.id] = entrada.value;
      entrada.classList.remove('vazio');
      entrada.classList.toggle('alterado', entrada.value !== (estado.original[campo.id] ?? ''));
      atualizarBotaoPreencher();
    });

    celulaValor.appendChild(entrada);
    linha.append(celulaRotulo, celulaValor);
    elementos.corpoDados.appendChild(linha);
  }
}

/** Compara o exame sem acento e sem caixa (mesma regra do preenchimento). */
function exameEhNecropsia(exame) {
  return String(exame ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase() === 'necropsia';
}

/**
 * No exame de NECROPSIA o sistema so libera a vitima depois do NIC.
 * Enquanto o operador nao digitar o NIC, o botao de preencher fica bloqueado.
 */
function aguardandoNic() {
  const vitima = estado.vitima;
  return Boolean(
    vitima
    && vitima.paginaAberta
    && vitima.formularioAberto
    && exameEhNecropsia(vitima.exame)
    && !vitima.nicPreenchido
  );
}

/** Habilita o preenchimento somente quando ha algo para preencher. */
function atualizarBotaoPreencher() {
  const total = Object.values(estado.dados).filter((v) => String(v ?? '').trim() !== '').length;
  const esperando = aguardandoNic();

  elementos.btnPreencher.disabled = estado.ocupado || total === 0 || esperando;
  elementos.btnPreencher.textContent = esperando
    ? 'Aguardando o NIC...'
    : total === 1
      ? 'Preencher o sistema (1 campo)'
      : `Preencher o sistema (${total} campos)`;

  elementos.avisoNic.hidden = !esperando;
}

/** Pergunta ao processo principal o estado da aba da vitima. */
async function consultarEstadoVitima() {
  if (estado.ocupado) return;
  try {
    const resposta = await window.api.estadoVitima();
    estado.vitima = resposta && resposta.paginaAberta ? resposta : null;
    atualizarBotaoPreencher();
  } catch {
    // Consulta opcional: sem ela o botao segue o comportamento normal.
    estado.vitima = null;
    atualizarBotaoPreencher();
  }
}

/** Passa a observar a aba da vitima enquanto a conferencia esta na tela. */
function iniciarMonitoramentoVitima() {
  if (estado.monitoramentoVitima || !estado.modoTeste) return;
  consultarEstadoVitima();
  estado.monitoramentoVitima = window.setInterval(consultarEstadoVitima, 1500);
}

/** Para de observar (ao preencher ou ao sair da conferencia). */
function pararMonitoramentoVitima() {
  if (estado.monitoramentoVitima) {
    window.clearInterval(estado.monitoramentoVitima);
    estado.monitoramentoVitima = null;
  }
}

/** Mostra os avisos da extracao (campos opcionais nao encontrados). */
function renderizarAvisos(avisos) {
  if (!avisos || avisos.length === 0) {
    elementos.avisosExtracao.hidden = true;
    elementos.avisosExtracao.textContent = '';
    return;
  }
  elementos.avisosExtracao.hidden = false;
  elementos.avisosExtracao.textContent = avisos.join(' ');
}

/* ------------------------------------------------------------- fluxo */

/** Recebe o resultado da extracao e vai para a tela de conferencia. */
function exibirExtracao(resultado) {
  estado.dados = { ...resultado.dados };
  estado.original = { ...resultado.dados };
  estado.meta = resultado.meta;

  elementos.origemLeitura.textContent = descreverOrigemLeitura(
    resultado.meta.viaDeLeitura,
    resultado.meta.confianca,
  );

  renderizarAvisos(resultado.meta.avisos);
  renderizarDados();
  atualizarBotaoPreencher();
  iniciarMonitoramentoVitima();
  mostrarEtapa('dados');
  definirRodape('Dados extraídos — aguardando conferência');
}

/** Exibe erro em linguagem simples, com detalhe tecnico recolhido. */
function exibirErro(titulo, mensagem, detalhe) {
  elementos.erroTitulo.textContent = titulo;
  elementos.erroTexto.textContent = mensagem;

  if (detalhe) {
    elementos.erroDetalhe.hidden = false;
    elementos.erroDetalheTexto.textContent = String(detalhe);
  } else {
    elementos.erroDetalhe.hidden = true;
    elementos.erroDetalheTexto.textContent = '';
  }

  mostrarEtapa('erro');
  definirRodape('Interrompido', 'erro');
  definirOcupado(false);
}

/** Volta para a tela inicial, limpando os dados em memoria. */
function reiniciar() {
  pararMonitoramentoVitima();
  estado.vitima = null;
  estado.dados = {};
  estado.original = {};
  estado.meta = null;
  elementos.corpoDados.textContent = '';
  elementos.avisosExtracao.hidden = true;
  elementos.avisoNic.hidden = true;
  elementos.btnContinuar.hidden = true;
  elementos.origemLeitura.textContent = '';
  elementos.trilhaBarra.style.width = '0%';
  mostrarEtapa('entrada');
  atualizarBotaoPreencher();
  definirRodape('Pronto');
}

/** Liga o modo de andamento com mensagem. */
function iniciarAndamento(titulo) {
  elementos.andamentoTitulo.textContent = titulo;
  elementos.andamentoDetalhe.textContent = 'Aguarde…';
  elementos.trilhaBarra.classList.add('indeterminada');
  elementos.trilhaBarra.style.width = '';
  document.getElementById('passo-andamento').textContent = '2';
  mostrarEtapa('andamento');
  definirRodape('Trabalhando…');
}

/* --------------------------------------------------- processar arquivo */

/**
 * Envia o arquivo para o processo principal.
 * @param {string} caminho caminho absoluto do arquivo
 */
async function processarCaminho(caminho) {
  if (estado.ocupado) return;

  if (!caminho) {
    exibirErro('Arquivo não reconhecido', 'Não foi possível identificar o caminho do arquivo. Arraste-o novamente para a janela.');
    return;
  }

  definirOcupado(true);
  iniciarAndamento('Processando a requisição…');

  try {
    const resposta = await window.api.processarArquivo(caminho);

    if (!resposta.ok) {
      exibirErro('Não foi possível ler a requisição', resposta.erro, resposta.detalhe);
      return;
    }

    exibirExtracao(resposta.resultado);
  } catch (erro) {
    exibirErro('Falha inesperada', 'A leitura do documento foi interrompida. Tente novamente.', erro.message);
  } finally {
    definirOcupado(false);
  }
}

/* ------------------------------------------------------------- eventos */

// --- arrastar e soltar ---

elementos.areaSolta.addEventListener('click', async () => {
  if (estado.ocupado) return;
  const escolha = await window.api.escolherArquivo();
  if (escolha?.ok) {
    await processarCaminho(escolha.caminho);
  }
});

elementos.areaSolta.addEventListener('keydown', (evento) => {
  if (evento.key === 'Enter' || evento.key === ' ') {
    evento.preventDefault();
    elementos.areaSolta.click();
  }
});

for (const evento of ['dragenter', 'dragover']) {
  elementos.areaSolta.addEventListener(evento, (e) => {
    e.preventDefault();
    if (!estado.ocupado) elementos.areaSolta.classList.add('ativo');
  });
}

for (const evento of ['dragleave', 'dragend']) {
  elementos.areaSolta.addEventListener(evento, () => {
    elementos.areaSolta.classList.remove('ativo');
  });
}

elementos.areaSolta.addEventListener('drop', async (e) => {
  e.preventDefault();
  elementos.areaSolta.classList.remove('ativo');

  const arquivo = e.dataTransfer?.files?.[0];
  if (!arquivo) return;

  // webUtils.getPathForFile e o caminho suportado no Electron atual.
  const caminho = window.api.caminhoDoArquivo(arquivo);
  await processarCaminho(caminho);
});

// --- escanear ---

elementos.btnEscanear.addEventListener('click', async () => {
  if (estado.ocupado) return;

  definirOcupado(true);
  iniciarAndamento('Digitalizando a folha…');
  elementos.andamentoDetalhe.textContent = 'Não abra outro programa durante a digitalização.';

  try {
    const resposta = await window.api.escanear();

    if (!resposta.ok) {
      exibirErro('Não foi possível digitalizar', resposta.erro, resposta.detalhe);
      return;
    }

    exibirExtracao(resposta.resultado);
  } catch (erro) {
    exibirErro('Falha na digitalização', 'O scanner não respondeu. Confira o aparelho e tente novamente.', erro.message);
  } finally {
    definirOcupado(false);
  }
});

// --- preencher ---

elementos.btnPreencher.addEventListener('click', async () => {
  if (estado.ocupado) return;

  pararMonitoramentoVitima();
  definirOcupado(true);
  iniciarAndamento('Preenchendo o sistema…');
  elementos.andamentoDetalhe.textContent = 'O navegador vai abrir. Não clique em nada até terminar.';

  try {
    const resposta = await window.api.preencher(estado.dados);

    if (!resposta.ok) {
      const detalhes = Array.isArray(resposta.detalhes) ? resposta.detalhes.join('\n') : resposta.detalhe;
      exibirErro(
        resposta.tipo === 'configuracao' ? 'Configuração incompleta' : 'Não foi possível preencher',
        resposta.erro,
        detalhes,
      );
      return;
    }

    const total = resposta.resumo.totalPreenchidos;
    const puladas = Array.isArray(resposta.abasPuladas) ? resposta.abasPuladas : [];
    const avisoVitima = puladas.includes('daVitima')
      ? '\n\nA aba da vítima não estava aberta. Abra o cadastro da vítima e clique em Preencher de novo.'
      : '';

    elementos.btnContinuar.hidden = !puladas.includes('daVitima');

    elementos.resultadoTitulo.textContent = 'Pronto para revisão';
    elementos.resultadoTexto.textContent =
      `${total} ${total === 1 ? 'campo preenchido e conferido' : 'campos preenchidos e conferidos'} no sistema.\n\n` +
      'O navegador está aberto com os dados já lançados. Revise cada campo e clique em ' +
      '“Cadastrar” você mesmo. A ferramenta não envia nada sozinha.' + avisoVitima;

    mostrarEtapa('resultado');
    definirRodape('Aguardando revisão do operador', 'ok');
  } catch (erro) {
    exibirErro('Falha no preenchimento', 'O preenchimento foi interrompido.', erro.message);
  } finally {
    definirOcupado(false);
  }
});

// --- navegacao simples ---

elementos.btnDescartar.addEventListener('click', reiniciar);
elementos.btnNova.addEventListener('click', reiniciar);
elementos.btnErroVoltar.addEventListener('click', reiniciar);
elementos.btnLogs.addEventListener('click', () => window.api.abrirLogs());

/**
 * Volta para a conferencia SEM descartar os dados. Serve para o operador abrir
 * o cadastro da vitima, digitar o NIC e mandar preencher o restante.
 */
elementos.btnContinuar.addEventListener('click', () => {
  mostrarEtapa('dados');
  definirRodape('Dados extraídos — aguardando conferência');
  iniciarMonitoramentoVitima();
  consultarEstadoVitima();
});

// --- andamento vindo do processo principal ---

window.api.aoProgredir((payload) => {
  if (payload?.mensagem) {
    elementos.andamentoDetalhe.textContent = payload.mensagem;
  }
});

/* ------------------------------------------------------------- abertura */

/**
 * Le o estado inicial: modo, campos e avisos de configuracao.
 */
async function iniciar() {
  mostrarEtapa('entrada');
  definirRodape('Pronto');

  try {
    const info = await window.api.estado();

    if (!info.ok) {
      exibirErro(
        'Configuração inválida',
        'A ferramenta não conseguiu ler os arquivos de configuração. ' +
        'Confira a pasta "config" antes de usar.',
        info.erro,
      );
      return;
    }

    estado.campos = info.campos;
    estado.modoTeste = info.modoTeste;

    // Selo de modo: o operador precisa saber, sem duvida, onde esta escrevendo.
    elementos.seloModo.hidden = false;
    if (info.modoTeste) {
      elementos.seloModo.textContent = 'Modo de teste';
      elementos.seloModo.className = 'selo selo-teste';
      elementos.seloModo.title = 'Os dados vão para a página de simulação, não para o sistema oficial.';
    } else {
      elementos.seloModo.textContent = 'Sistema oficial';
      elementos.seloModo.className = 'selo selo-oficial';
      elementos.seloModo.title = 'Atenção: os dados vão para o sistema real.';
    }

    elementos.rodapeVersao.textContent = `versão ${info.versao}`;

    // Avisos de configuracao aparecem na tela inicial: melhor saber antes.
    if (info.avisosConfiguracao?.length) {
      elementos.scannerStatus.textContent = info.avisosConfiguracao.join(' ');
    }

    atualizarBotaoPreencher();

    // Diagnostico do scanner, sem abrir nada: so informa se ha aparelho.
    const scanners = await window.api.listarScanners();
    if (scanners?.erro) {
      elementos.scannerStatus.textContent = `Scanner indisponível: ${scanners.erro}`;
    } else if (!scanners?.dispositivos?.length) {
      elementos.scannerStatus.textContent = 'Nenhum scanner detectado. Use o arrastar e soltar.';
    } else {
      const nomes = scanners.dispositivos.map((d) => d.nome).join(', ');
      elementos.scannerStatus.textContent = `Scanner pronto: ${nomes}`;
    }
  } catch (erro) {
    exibirErro(
      'Falha ao iniciar',
      'A ferramenta não conseguiu verificar a configuração inicial.',
      erro.message,
    );
  }
}

iniciar();
