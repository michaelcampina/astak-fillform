# Guia de configuração

Toda a configuração da ferramenta está em quatro arquivos, na pasta `config`.
Nenhum seletor, rótulo ou regra de formatação está escrito no código.

| Arquivo | Conteúdo |
|---|---|
| `configuracao.json` | Modo de teste, leitura (PDF/OCR), navegador, scanner, logs |
| `campos.json` | Quais campos existem e como reconhecê-los na requisição |
| `seletores.json` | Onde cada campo está na tela do sistema oficial |
| `formatacao.json` | Regras de limpeza e formatação por tipo de dado |

> Depois de qualquer alteração, **feche e abra a ferramenta**. A configuração é
> lida na inicialização.

---

## 1. `configuracao.json`

```json
{
  "MODO_TESTE": true,
  "idiomaOcr": "por",
  "caminhoTessdata": "recursos/tessdata",
  "extracao": {
    "escalaRenderizacao": 2.5,
    "paginasMaximas": 5,
    "confiancaMinimaOcr": 55,
    "minimoCaracteresTextoDigital": 120,
    "padroesDeParada": ["..."]
  },
  "navegador": {
    "perfil": "perfis/chrome-operador",
    "canaisPermitidos": ["chrome", "msedge", "chromium"],
    "headless": false,
    "timeoutPadraoMs": 20000,
    "esperaEstabilizacaoMs": 300
  },
  "scanner": {
    "controlador": "wia-powershell",
    "dpi": 300,
    "modoCor": 2,
    "timeoutMs": 180000
  },
  "registro": { "diretorio": "logs", "nivel": "INFO" },
  "testes": {
    "gabarito": "testes/fixtures/gabarito.json",
    "diretorioSaida": "testes/saida"
  }
}
```

### Campos mais usados

| Chave | Para que serve | Cuidado |
|---|---|---|
| `MODO_TESTE` | `true` usa a página de simulação; `false` usa o sistema real | Deixe `true` até os seletores estarem prontos |
| `extracao.escalaRenderizacao` | Resolução do PDF antes do OCR (2,5 ≈ 240 DPI) | Acima de 3 fica lento sem ganho real |
| `extracao.confiancaMinimaOcr` | Abaixo disso, a leitura é tratada como ilegível | Subir demais gera falsos erros |
| `extracao.paginasMaximas` | Quantas páginas do PDF são lidas | A requisição costuma ter 1 ou 2 |
| `extracao.minimoCaracteresTextoDigital` | Texto extraído abaixo disso é tratado como PDF sem texto útil, e cai para o OCR | Evita OCR desnecessário em PDF digital |
| `navegador.timeoutPadraoMs` | Tempo máximo de espera por campo | Em rede lenta, aumente para 30000 |
| `navegador.esperaEstabilizacaoMs` | Pausa após carregar a página | Ajuda em sistemas com carregamento tardio |
| `navegador.perfil` | Pasta do perfil do Chrome da ferramenta | Não aponte para o seu perfil pessoal |
| `navegador.canaisPermitidos` | Ordem de tentativa dos navegadores | `chrome` primeiro é o recomendado |
| `navegador.headless` | Não use `true`: o operador precisa **ver** o preenchimento | — |
| `scanner.dpi` | Resolução da digitalização | 300 é o equilíbrio entre qualidade e tamanho |
| `registro.nivel` | `DEBUG`, `INFO`, `AVISO`, `ERRO` | `DEBUG` só para investigar problema |

### `extracao.padroesDeParada`

Lista de expressões regulares que marcam **o fim de um campo de várias linhas**
(como `observacoes`). Quando uma linha casa com um padrão, a captura para ali.

Isso existe porque um campo longo, sem marcador de fim, engole o rodapé inteiro do
documento. Exemplo real que motivou o recurso: as observações terminavam em
`...conforme ofício nº 221/2024.` e continuavam capturando `Página 1 de 1`,
`Assinatura` e o endereço do rodapé.

Padrões já configurados:

| Padrão | O que barra |
|---|---|
| `^(PAGINA\|PAG\.?\|FOLHA)\s*\d` | Numeração de página |
| `^\d+\s*(DE\|/)\s*\d+$` | `1 de 2`, `1/2` |
| `^(DOCUMENTO FICTICIO\|DOCUMENTO GERADO\|NAO CONTEM DADOS REAIS)` | Marca d'água das fixtures |
| `^(ASSINATURA\|ASSINADO\|CARIMBO)\b` | Bloco de assinatura |
| `^(RUA\|RUA DAS\|AVENIDA\|AV\.)\s` | Endereço de rodapé |

Se o seu documento tiver outro marcador de fim, acrescente um padrão aqui. Não é
preciso mexer no código.

> Os padrões são aplicados sobre a linha **sem acento e em caixa alta**. Por isso
> `NAO CONTEM` casa com `NÃO CONTÉM`.

---

## 2. `campos.json`

Define os campos que a ferramenta procura na requisição. Cada campo é localizado
pelo **rótulo**, no texto extraído do PDF ou do OCR.

```json
{
  "id": "numeroRequisicao",
  "descricao": "Numero da requisicao",
  "rotulos": ["Numero da Requisicao", "Nº da Requisição", "No. da Requisicao"],
  "formato": "codigo",
  "regexCaptura": "([A-Z]{2,6}[-\\s]?\\d{2,6})",
  "obrigatorio": true
}
```

### Chaves de cada campo

| Chave | Obrigatória | O que faz |
|---|---|---|
| `id` | sim | Nome interno. Deve bater com `seletores.json` |
| `descricao` | sim | Nome exibido na tela de conferência |
| `rotulos` | sim | Todas as formas do rótulo que podem aparecer no documento |
| `obrigatorio` | sim | `true` interrompe o processo se faltar; `false` só avisa |
| `formato` | sim | Nome de uma regra em `formatacao.json` |
| `regexCaptura` | não | Restringe o que é aceito como valor |
| `multilinha` | não | Captura as linhas seguintes até achar outro rótulo conhecido |
| `linhasMaximas` | não | Limite de linhas na captura multilinha (padrão 10) |
| `valorNaLinhaSeguinte` | não | O valor está na linha **abaixo** do rótulo |
| `aceitarSemDoisPontos` | não | Aceita rótulo sem `:` no fim |

### `multilinha`

Usado em `fatos` e `observacoes`. A captura segue linha a linha até encontrar:

1. outro rótulo conhecido, ou
2. um padrão de parada de `extracao.padroesDeParada`, ou
3. o limite de `linhasMaximas`.

> Não existe chave `aba` em `campos.json`: a aba de cada campo é definida em
> `seletores.json`. A validação da configuração recusa iniciar se um campo de
> `campos.json` não tiver destino em `seletores.json`.

### `valorNaLinhaSeguinte`

Use quando o documento traz o rótulo numa linha e o valor na de baixo:

```
Observações
Compareceu ao IML acompanhado da genitora.
```

Sem essa chave, a ferramenta procura o valor na mesma linha e não acha. É o que
`observacoes` usa hoje.

### `aceitarSemDoisPontos`

Por padrão, um rótulo que **não** termina a linha precisa vir seguido de `:`. Sem
essa regra, o rótulo `Exame` casaria com o começo de
`Exame solicitado em caráter de urgência...` e o valor viria errado — foi um bug
real, encontrado durante o desenvolvimento.

Só ligue essa opção quando o documento realmente escreve o rótulo sem dois-pontos.

### Adicionar um campo novo

1. Acrescente o objeto em `campos.json`.
2. Acrescente o seletor correspondente em `seletores.json`.
3. Acrescente a regra em `formatacao.json`, se o `formato` for novo.
4. Acrescente o campo em `testes/fixtures/gabarito.json`, se quiser que o teste o
   verifique.
5. Rode `npm test`.

---

## 3. `seletores.json`

Diz onde cada campo está na tela do sistema.

```json
{
  "simulacao": {
    "url": "file:///__DIRETORIO_SIMULACAO__/sistema-simulado.html",
    "seletorPronto": "#form-laudo",
    "regraNic": {
      "seletorExame": "#exame",
      "valorExame": "NECROPSIA",
      "seletorNic": "#nic"
    },
    "abas": [ ... ]
  },
  "sistemaOficial": { "abas": [ ... ] }
}
```

O bloco usado depende de `MODO_TESTE`. A ferramenta valida o bloco escolhido na
abertura e recusa iniciar se algo estiver inconsistente.

### Estrutura de uma aba

```json
{
  "id": "requisicao",
  "descricao": "Requisicao",
  "seletorAba": "button[data-aba='requisicao']",
  "seletorPainel": "#painel-requisicao",
  "campos": [
    {
      "campo": "orgao",
      "tipo": "caixaPesquisavel",
      "seletor": "#orgao",
      "seletorLista": "#orgao-opcoes",
      "seletorOpcoes": "#orgao-opcoes li[role='option']",
      "modoCorrespondencia": "exata",
      "valorVerificacao": "textoOpcao"
    }
  ]
}
```

| Chave | Para que serve |
|---|---|
| `url` | Endereço da tela. Só no nível do bloco, não da aba |
| `seletorPronto` | Como saber que a página terminou de carregar |
| `seletorAba` | Como clicar na aba. Deixe nulo se for uma página única |
| `seletorPainel` | Como saber que a aba já está aberta (evita clicar sem necessidade) |
| `requerFormularioAberto` | Seletor de um bloco que o **operador** precisa abrir antes (ex.: cadastro da vítima). Se não estiver visível, a aba é pulada com aviso, sem erro |
| `seletor` | O campo em si. Aceita CSS ou XPath com prefixo `xpath=` |
| `tipo` | `texto`, `areaTexto`, `selectNativo`, `caixaPesquisavel` |
| `seletorLista` / `seletorOpcoes` | **Obrigatórios** em `caixaPesquisavel`: o container da lista e os itens clicáveis |
| `modoCorrespondencia` | `exata` (recomendado) ou `contem` |
| `valorVerificacao` | Como reler o campo depois de preenchido (`textoOpcao` = usar o texto da opção escolhida) |

### Regra do NIC (`regraNic`)

No exame de **NECROPSIA**, o sistema oficial mantém o cadastro da vítima
bloqueado até o operador digitar o **NIC**. A ferramenta não tenta contornar o
bloqueio:

| Chave | Para que serve |
|---|---|
| `seletorExame` | Campo que diz qual exame está selecionado (fica em outra aba) |
| `valorExame` | Valor que dispara a regra (`NECROPSIA`) |
| `seletorNic` | Campo do NIC, no cadastro da vítima |

Com isso, a ferramenta:

1. só habilita o botão **Preencher** depois que o NIC aparece na tela;
2. se o operador apagar o NIC, volta a bloquear;
3. se for preencher com o NIC vazio, espera até 60 s e para com orientação — em
   vez de tentar escrever em campo bloqueado.

Em qualquer outro exame, o comportamento é o normal: o operador abre o cadastro
da vítima e os campos já estão livres.

### Os quatro tipos de campo

**`texto` / `areaTexto`** — digita e confere. Nada de especial.

**`selectNativo`** — um `<select>` comum. A ferramenta tenta, nesta ordem:
valor exato, texto exato, texto exato sem acento. **Nunca usa "contém"**, para não
escolher `Instituto Médico Legal do Rio de Janeiro` quando o documento diz
`Instituto Médico Legal de São Paulo`. Se nada casar, ela para e lista as opções
disponíveis — assim você vê na hora o que o sistema tem.

**`caixaPesquisavel`** — o caso mais delicado. A sequência é:
clicar → digitar para filtrar → esperar a lista → conferir quantas opções casam
→ clicar na opção → sair com **Tab** (nunca Enter) → ler de volta.

Se **duas ou mais** opções casarem, a ferramenta para. Escolher no escuro seria
pior do que pedir que você decida.

#### Como o filtro é tentado

Sistemas de busca costumam ser exigentes. Por isso a ferramenta tenta, nesta
ordem fixa (`montarTentativasDeFiltro`):

1. o texto completo, como foi lido: `Instituto Médico Legal de São Paulo`
2. sem os trechos entre parênteses
3. antes da primeira vírgula ou barra
4. o início do texto **até o primeiro caractere acentuado**: `Instituto M` — essa
   parte sem acento sempre casa em filtros sensíveis a acento
5. as duas primeiras palavras e, por último, só a primeira

Se alguma tentativa resultar em **exatamente uma** opção, ela é escolhida. Se
todas falharem, a ferramenta para e lista o que tentou.

> **Acentos importam.** Muitos filtros comparam com acento. Digitar
> `Instituto Medico` não retorna nada quando o cadastro tem `Instituto Médico`.
> É por isso que as tentativas 4 e 5 existem, e é por isso que a ferramenta nunca
> "adivinha" a opção.

### Preencher o bloco `sistemaOficial`

Os valores estão como `SUBSTITUIR...` de propósito: assim a ferramenta não roda
contra o sistema real por acidente.

Antes de trocar `MODO_TESTE` para `false`, preencha no bloco `sistemaOficial`:

1. `url` — o endereço da tela de cadastro de requisição;
2. `seletorPronto` — algo que só existe quando a página terminou de carregar
   (por exemplo `#form-requisicao`);
3. `seletorAba` e `seletorPainel` de cada aba;
4. `seletor` de cada campo;
5. em `caixaPesquisavel`, também `seletorLista` e `seletorOpcoes`;
6. `_protetor.seletoresProibidos` — troque `#SUBSTITUIR-BOTAO-CADASTRAR` pelo
   seletor real do botão de cadastro do sistema.

Enquanto qualquer `SUBSTITUIR` existir no bloco em uso, a ferramenta se recusa a
abrir o navegador.

Para descobrir o seletor de um campo:

1. Abra a tela do sistema no Chrome.
2. Clique com o botão direito no campo → **Inspecionar**.
3. Copie o `id`. `id="cpf"` → seletor `#cpf`.
4. Sem `id`, use o `name`: `input[name="cpf"]`.

### Ajuste recomendado no bloco oficial

O bloco `simulacao` usa `"modoCorrespondencia": "exata"` nas caixas pesquisáveis.
O bloco `sistemaOficial` vem com `"contem"`. **Recomenda-se trocar para `"exata"`**:
`contem` aceita a opção quando o texto aparece em qualquer posição, o que aumenta o
risco de escolher a opção errada quando a lista tem nomes parecidos.

---

## 4. `formatacao.json`

Regras de limpeza e validação aplicadas ao valor lido, antes de preencher. O
`formato` de cada campo em `campos.json` aponta para uma chave daqui.

```json
{
  "data": {
    "descricao": "Data no padrao DD/MM/AAAA",
    "formatoSaida": "DD/MM/AAAA",
    "aceitarEntrada": ["DD/MM/AAAA", "DD-MM-AAAA", "DD.MM.AAAA", "AAAA-MM-DD"],
    "validarCalendario": true
  },
  "cpf": {
    "descricao": "CPF no padrao 000.000.000-00",
    "formatoSaida": "000.000.000-00",
    "exigirDigitos": 11,
    "validarDigitoVerificador": false
  },
  "rg": {
    "descricao": "RG sem pontuacao, digito X preservado em maiuscula",
    "formatoSaida": "somente-digitos-e-X",
    "removerSeparadores": true,
    "maiusculas": true
  },
  "codigo": {
    "descricao": "Codigo alfanumerico em maiusculas",
    "maiusculas": true,
    "compactarEspacos": true
  },
  "nome": {
    "descricao": "Nome proprio, espacos normalizados",
    "compactarEspacos": true,
    "removerEspacosExtremos": true
  },
  "texto": {
    "descricao": "Texto curto em linha unica",
    "compactarEspacos": true
  },
  "textoLongo": {
    "descricao": "Texto multilinha, hifenizacao corrigida",
    "compactarEspacos": true,
    "corrigirHifenizacao": true,
    "preservarQuebrasDeLinha": false
  }
}
```

As seis regras já configuradas: `data`, `cpf`, `rg`, `codigo`, `nome`, `texto`,
`textoLongo`.

### Como as regras se comportam

**Uma regra que não consegue formatar o valor faz a extração falhar.** A
ferramenta para e avisa, em vez de preencher dado duvidoso. Exemplo: um `cpf` com
`exigirDigitos: 11` que recebe 9 dígitos interrompe o processo.

Isso é proposital. Um valor que não cabe no formato esperado é sinal de leitura
ruim, não de dado a ser "consertado" pela ferramenta.

### `cpf.validarDigitoVerificador`

Vem como `false` de propósito. Muitos documentos reais trazem CPF digitado errado
no papel; validar o dígito travaria o atendimento por um erro que já existia antes.
Ative para `true` se o órgão exigir essa checagem.

### `data.validarCalendario`

`true` rejeita `31/02/2024`. Vale manter ligado: pega erro de OCR em datas.

### `textoLongo.corrigirHifenizacao`

Corrige palavras quebradas na virada de linha pelo OCR:

```
apresentando ferimentos compa-
tíveis com ação de terceiros
```

vira `...ferimentos compatíveis com ação de terceiros`. Essencial para os campos
`fatos` e `observacoes`.

---

## 5. Validação antes de preencher

Antes de abrir o navegador, `src/nucleo/config.js` carrega e valida as quatro
configurações. Recusa iniciar se encontrar:

- `MODO_TESTE` que não seja `true` ou `false`;
- lista `campos` vazia, campo sem `id`, `id` repetido ou campo sem `rotulos`;
- `formato` que não exista em `formatacao.json`;
- bloco de seletores ausente (`simulacao` ou `sistemaOficial`, conforme o modo);
- seletor que aponte para um campo que não existe em `campos.json`;
- campo sem `seletor`, ou com `tipo` desconhecido;
- `caixaPesquisavel` sem `seletorLista` e `seletorOpcoes`.

E, em `protetor.validarConfiguracao`, recusa também:

- qualquer seletor ainda com `SUBSTITUIR`;
- seletor com `type="submit"`;
- seletor com `btn-cadastrar`, `botao-finalizar`, `button-enviar` e afins.

### O bloco `_protetor`

Fica **dentro de cada bloco** (`simulacao` e `sistemaOficial`), não na raiz:

```json
"_protetor": {
  "seletoresProibidos": [
    "#btn-cadastrar",
    "#btn-finalizar",
    "#btn-enviar",
    "#btn-salvar",
    "button[type='submit']",
    "input[type='submit']"
  ],
  "textosProibidos": ["cadastrar", "finalizar", "enviar", "salvar", "gravar", "confirmar", "concluir"]
}
```

- `seletoresProibidos` — nunca clicar nem digitar nesses elementos.
- `textosProibidos` — palavras que, no texto visível de um elemento, o marcam como
  botão de envio. A comparação é por **palavra inteira**: bloqueia
  `Cadastrar exame`, mas não `Cadastro`.

Essa é a segunda camada de proteção. A primeira é a validação da configuração
acima; a terceira é a ausência total de gatilho de envio no código — a ferramenta
nunca pressiona Enter nem chama `form.submit()`.
