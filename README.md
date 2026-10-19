# Preenchedor de Requisições de Exame

Assistente local que lê a requisição de exame (papel digitalizado, PDF ou imagem),
extrai os dados e preenche o sistema oficial — **parando sempre antes do botão de
cadastrar**.

O operador confere os dados extraídos, pode corrigir, e conclui o cadastro com a
própria mão.

- **Custo zero.** Só bibliotecas gratuitas e de código aberto. Nenhuma API paga.
- **100% local.** Nenhum dado sai da máquina. Sem nuvem, sem telemetria.
- **Não invasivo.** Sem acesso a banco de dados ou API interna. Só o navegador.
- **Determinístico.** Seletores fixos em arquivo de configuração. Nenhuma decisão
  tomada por IA em tempo de execução.
- **Nunca envia.** Existe uma proteção em código que recusa interagir com qualquer
  botão de cadastrar, finalizar, enviar ou salvar.

---

## Documentação

| Documento | Para quem |
|---|---|
| [Manual do operador](docs/manual-do-operador.md) | Quem usa a ferramenta no dia a dia |
| [Guia de configuração](docs/guia-de-configuracao.md) | Quem configura campos, seletores e regras |
| [Plano de testes](docs/plano-de-testes.md) | Quem valida e homologa |

---

## Instalação

Requisitos: **Node.js 20+** e **Google Chrome** instalados.

```bat
npm install --ignore-scripts
npm run idioma-ocr
npm run exemplos
```

| Comando | O que faz |
|---|---|
| `npm install --ignore-scripts` | Baixa as dependências sem executar scripts de terceiros |
| `npm run idioma-ocr` | Prepara o idioma português do OCR (~6,7 MB) |
| `npm run exemplos` | Gera as requisições de exemplo em `testes/fixtures` |

Se a rede bloquear o download do Electron:

```bat
set electron_config_cache=%~dp0.electron-cache
set ELECTRON_CACHE=%~dp0.electron-cache
node node_modules\electron\install.js
```

Se a rede bloquear o download do idioma do OCR, copie a pasta `recursos/tessdata`
de outra máquina onde a ferramenta já esteja instalada. O arquivo necessário é
`por.traineddata.gz`.

---

## Uso

```bat
npm start
```

1. Arraste a requisição para a janela, ou clique em **Escanear papel**.
2. Confira os dados lidos — a tabela é editável.
3. Clique em **Preencher o sistema**.
4. Revise na tela do sistema e clique em *Cadastrar* você mesmo.

Na primeira vez, o Chrome abre na tela de login: entre normalmente. A sessão fica
gravada no perfil `perfis/chrome-operador` e é reaproveitada nas próximas vezes.

---

## Testes

```bat
npm test                    :: extração + preenchimento
npm run teste:extracao      :: só a leitura dos documentos
npm run teste:preenchimento :: só o preenchimento na simulação
npm run teste:janela        :: fluxo completo dentro da janela real
```

O relatório sai em `testes/saida/relatorio-<data>.md`.

Resultado atual:

```
Extração — PDF digital    [OK]  18/18
Extração — PDF escaneado  [OK]  18/18   OCR 94%
Extração — Imagem         [OK]  18/18   OCR 95%
Preenchimento             [OK]  18 campos verificados
                               nenhum clique de envio; nada cadastrado
TODOS OS TESTES PASSARAM

Janela (Electron + clique real no botão)
                          [OK]  18 campos, parou em "Pronto para revisão"
JANELA: FLUXO COMPLETO APROVADO
```

---

## Como funciona

```
requisição (PDF/imagem/papel)
        |
        v
  [ leitura ]  PDF com texto -> extração direta
        |      PDF escaneado ou imagem -> render + OCR (Tesseract)
        v
  [ extração ]  localização por rótulo, captura de valor, formatação
        |
        v
  [ conferência ]  tabela editável para o operador
        |
        v
  [ preenchimento ]  Playwright conduz o Chrome: aba por aba, campo por campo
        |            cada campo é relido e comparado
        v
  [ PARADA ]  a ferramenta para. O operador conclui.
```

### Estrutura

```
config/                  configuração (nada de seletor no código)
  configuracao.json        modo, leitura, navegador, scanner, logs
  campos.json              campos da requisição e como reconhecê-los
  seletores.json           onde cada campo está no sistema
  formatacao.json          regras de limpeza por tipo
src/
  main.js                  processo principal do Electron
  preload.js               ponte segura para a interface
  interface/               janela (HTML, CSS, JS)
  captura/scanner.js       digitalização via WIA do Windows
  extracao/                pdf.js, Tesseract.js, rótulos, formatação
  preenchimento/           Playwright, campos, sessão, protetor anti-envio
  nucleo/                  configuração e registro de log
simulacao/               página que imita o sistema, para teste
testes/                  fixtures, gabarito e executor
docs/                    manual, configuração e plano de testes
```

### Proteções contra envio indevido

Três camadas independentes:

1. **Validação da configuração** — recusa iniciar se algum seletor apontar para
   controle de envio ou ainda estiver como `SUBSTITUIR`.
2. **Protetor em tempo de execução** — avalia cada elemento antes de clicar ou
   digitar. Bloqueia por texto, `type="submit"`, `id`, `name` ou seletor proibido.
3. **Ausência de gatilho** — a ferramenta nunca pressiona Enter, nunca clica em
   botão de ação final e nunca chama `form.submit()`. Para sair de um campo usa
   Tab.

O teste automatizado comprova: `window.__cliquesDeEnvio === 0`.

---

## Privacidade

- Os dados extraídos ficam **só na memória**. Fechou a janela, sumiram.
- O log registra nomes de campo, contagens, confiança do OCR e tamanhos — **nunca
  o conteúdo**: sem nome, sem CPF, sem endereço.
- A pasta `perfis/` guarda a sessão do navegador e não deve ser versionada.
- Nenhuma requisição HTTP sai da máquina, exceto a que o próprio Chrome faz para o
  sistema interno ao preencher.

---

## Limitações conhecidas

- **O scanner não foi testado com hardware real** neste desenvolvimento — não
  havia aparelho disponível. O caminho WIA está implementado e o diagnóstico de
  "nenhum scanner detectado" foi verificado.
- **O bloco `sistemaOficial` de `seletores.json` está como `SUBSTITUIR`.** Precisa
  ser preenchido com os seletores reais do sistema da instituição. A ferramenta se
  recusa a rodar contra o sistema real antes disso.
- **Precisão do OCR** depende da qualidade do documento. Ver
  [plano de testes, seção 4](docs/plano-de-testes.md#4-observações-sobre-precisão-do-ocr)
  para as alternativas gratuitas.
- **Campos pesquisáveis com nomes ambíguos** fazem a ferramenta parar de propósito.
  É uma escolha de projeto, não um defeito.
- **Ambientes com `%TEMP%` restrito** (política corporativa ou sandbox de execução)
  impedem o Playwright de criar sua pasta de artefatos. A ferramenta detecta isso,
  passa a usar `logs/tmp` e avisa no log. Ver
  [plano de testes, caso 2.10](docs/plano-de-testes.md#210-pasta-temporária-do-windows-restrita).
