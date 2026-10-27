# Plano de testes

Dois níveis: **automático** (roda sozinho, compara com gabarito) e **manual**
(os casos de erro que dependem de cenário físico ou de rede).

---

## 1. Teste automático

### Como rodar

```bat
npm run exemplos             :: cria as requisições de exemplo
npm test                     :: roda extração + preenchimento (biblioteca)
npm run teste:extracao       :: só a leitura dos documentos
npm run teste:preenchimento  :: só o preenchimento na página de simulação
npm run teste:janela         :: fluxo completo dentro da janela real
```

O relatório sai em `testes/saida/relatorio-<data>.md` e também na tela.
O teste de janela grava `testes/saida/resultado-janela.json`.

### Os três níveis de teste

| Nível | Comando | O que cobre |
|---|---|---|
| Extração | `npm run teste:extracao` | Lê os 3 fixtures e compara com o gabarito |
| Preenchimento | `npm run teste:preenchimento` | Bibliotecas direto, sem interface |
| Janela | `npm run teste:janela` | Electron + clique real no botão + revisão |

**Por que o teste de janela existe:** o teste de biblioteca pode passar com a
janela quebrada — botão desabilitado, tabela vazia, transição de tela errada. Ele
não toca na interface. O teste de janela abre o Electron, entrega o arquivo pelo
mesmo caminho do arrastar-e-soltar, **clica no botão** e confere se a tela final
avisa que o envio é do operador.

Ele termina com `JANELA: FLUXO COMPLETO APROVADO` e código 0.

O comando roda o Electron **sem** flags primeiro. Só se o processo morrer com um
código característico de bloqueio de ambiente (`0x80000003` ou `0xC0000005`) ele
repete com `--no-sandbox --disable-gpu` e avisa no final. Na máquina do operador a
segunda tentativa nunca acontece.

### O que ele faz

**Extração** — lê três arquivos com o mesmo conteúdo, por três caminhos técnicos
diferentes:

| Fixture | Caminho | O que prova |
|---|---|---|
| `requisicao-digital.pdf` | texto do PDF, sem OCR | Leitura exata; o caminho preferencial |
| `requisicao-escaneada.pdf` | PDF → imagem → OCR | O fluxo do papel digitalizado |
| `requisicao-imagem.png` | imagem → OCR | O fluxo de foto/scan solto |

Cada uma é comparada campo por campo com `testes/fixtures/gabarito.json`. A saída
marca `OK`, `DIFERENTE` (com esperado e obtido) ou `NÃO ENCONTRADO`.

**Preenchimento** — abre a página de simulação no Chrome real, preenche os 18
campos nas três abas, relê **todos** para conferir e verifica:

- `window.__cliquesDeEnvio === 0` — nenhum clique programático em botão de envio;
- `window.__simulacaoCadastrada === false` — nada foi cadastrado;
- o protetor bloqueia `#btn-cadastrar`, `#btn-finalizar`, `#btn-enviar` e
  `#btn-salvar`.

### Resultado da última execução

```
Extração — PDF digital       [OK]  18/18 campos
Extração — PDF escaneado     [OK]  18/18 campos  (OCR 94%, 1 aviso de revisão)
Extração — Imagem            [OK]  18/18 campos  (OCR 95%)
Preenchimento                [OK]  18 campos preenchidos e verificados
                                   nenhum clique de envio; nada cadastrado
TODOS OS TESTES PASSARAM (2 avisos)
```

Tempos medidos: ~180 ms (PDF digital), ~1850 ms (PDF escaneado), ~1700 ms (imagem).

### Sobre as tolerâncias

O gabarito tem um bloco `tolerancia`:

```json
"tolerancia": {
  "endereco": "pontuacao",
  "localFato": "pontuacao",
  "fatos": "pontuacao",
  "observacoes": "pontuacao"
}
```

- `pontuacao` — ignora diferença de acento, hífen, aspas e espaço.
- `ocr` — aplicado automaticamente a textos longos quando a leitura veio de OCR.
  Aceita divergência de até `max(1, tamanho/40)` caracteres (distância de
  Levenshtein) e **registra um aviso de revisão**, em vez de reprovar ou aprovar
  em silêncio.

Motivo real: o OCR de um PDF renderizado leu `periciado` como `períciado` — 1
caractere em 94. Reprovar seria rígido demais; aprovar sem avisar esconderia o
risco. O aviso manda conferir aquele campo no sistema.

**Tolerância não se aplica a campos críticos.** CPF, RG, datas e números são
comparados de forma exata. Um erro de OCR em CPF é inaceitável e deve reprovar.

---

## 2. Casos de erro (teste manual)

Estes dependem de cenário físico ou de rede, então são verificados à mão. O que se
espera, em todos: **a ferramenta para e explica, sem preencher dado errado**.

### 2.1 OCR falha — documento ilegível

**Como reproduzir:** fotografe uma folha desfocada, ou passe uma imagem com o
texto coberto, ou use uma folha em branco.

```bat
:: alternativa sem scanner: gire a fixture
```

**Esperado:** mensagem *"Não foi possível ler a requisição"*, com a confiança do
OCR no detalhe técnico. Nada é preenchido. O botão de preencher não aparece.

**O que NÃO pode acontecer:** preencher com campos vazios ou com valor inventado.

**Solução para o operador:** escanear de novo com mais qualidade, endireitar a
folha, usar o PDF digital quando existir.

---

### 2.2 Campo não encontrado na tela do sistema

**Como reproduzir:** em `config/seletores.json`, no bloco `simulacao`, troque um
seletor por um que não existe:

```json
{ "campo": "cpf", "tipo": "texto", "seletor": "#cpf-inexistente" }
```

**Esperado:** *"O campo "CPF" não apareceu na tela do sistema"*, com o seletor
usado no detalhe técnico. O preenchimento para ali; os campos anteriores ficam
preenchidos. O navegador **não é fechado** (a sessão e o que já foi digitado são
preservados para você conferir).

**O que NÃO pode acontecer:** pular o campo em silêncio e seguir adiante.

---

### 2.3 Página do sistema não carrega

**Como reproduzir:** em `configuracao.json`, aponte a URL para um endereço
inválido (`http://localhost:9/nao-existe`).

**Esperado:** *"Não foi possível abrir a tela do sistema"*, com a URL tentada. A
ferramenta não tenta preencher nada.

**Variação — sem internet / sistema fora do ar:** mesma mensagem, detalhe técnico
com o erro de rede.

---

### 2.4 Sessão expirada

**Como reproduzir:** abra a ferramenta, deixe a sessão expirar no sistema (ou
limpe os cookies do perfil `perfis/chrome-operador`).

**Esperado:** *"A sessão do sistema expirou. Entre no sistema nessa janela, abra a
tela de cadastro e clique em Preencher de novo."*

A detecção procura um campo `input[type="password"]` na página carregada.

**O que NÃO pode acontecer:** a ferramenta tentar "fazer login" sozinha.

---

### 2.5 Scanner indisponível

**Como reproduzir:** rode a ferramenta numa máquina sem scanner, ou com o
multifuncional desligado, ou sem driver WIA.

**Esperado:** na tela inicial, *"Nenhum scanner detectado. Use o arrastar e
soltar."* O botão **Escanear papel** fica desabilitado — não adianta clicar.

Se o serviço do Windows estiver presente mas não responder, a mensagem é
*"Scanner indisponível: o serviço de digitalização do Windows não respondeu neste
computador."*

**O que NÃO pode acontecer:** a ferramenta abrir o aplicativo "Digitalizar" do
Windows ou qualquer programa externo.

> Este é o único caminho **não testado com hardware real** neste projeto — não
> havia scanner disponível. O código fala com o WIA do Windows; o diagnóstico de
> "nenhum scanner detectado" foi verificado numa máquina sem aparelho.

---

### 2.6 Duas opções correspondem (caixa pesquisável)

**Como reproduzir:** em `simulacao/sistema-simulado.html`, a lista de autoridades
já contém `Delegada de Polícia Dra. Fernanda Souza` e `Dra. Fernanda Souza`.
Extraia uma requisição cujo valor seja `Dra. Fernanda Souza` e use o filtro
`Fernanda Souza`.

**Esperado:** *"Mais de uma opção corresponde a …"*, listando as candidatas. A
ferramenta **não escolhe**.

**Por que é assim:** escolher a opção errada num cadastro oficial é pior do que
pedir que o operador decida.

---

### 2.7 Valor existe na requisição, mas não no cadastro do sistema

**Como reproduzir:** use um órgão que não esteja na lista da simulação, por
exemplo `Ministério Público de Minas Gerais` (a lista tem SP e RJ).

**Esperado:** *"Nenhuma opção de "Órgão requisitante" corresponde a …"*, com a
lista do que foi tentado. Nada é selecionado.

Este caso apareceu de verdade durante o desenvolvimento: a fixture trouxe
`Ministério Público de São Paulo` e a lista de simulação não tinha esse órgão. A
ferramenta parou corretamente; o que estava errado era o **catálogo da
simulação**, que foi completado.

**O que isso ensina:** quando a ferramenta para nesse erro, vale conferir se o
dado lido está certo **e** se o cadastro do sistema realmente tem aquela opção.

---

### 2.8 Seletor aponta para botão de envio

**Como reproduzir:** em `config/seletores.json`, troque um campo por:

```json
{ "campo": "cpf", "tipo": "texto", "seletor": "#btn-cadastrar" }
```

**Esperado:** a ferramenta **recusa iniciar**, antes de abrir o navegador:
*"O seletor do campo "cpf" aponta para um botao de "cadastrar""*.

**Segunda camada:** mesmo que o validador fosse contornado, `protetor.js` avalia o
elemento em tempo de execução e recusa a interação, com o motivo
*"O elemento tem o texto "Cadastrar", que indica envio."*

---

### 2.9 Valor não confere depois de preenchido

**Como reproduzir:** troque o seletor de um campo para um que aponte para outro
campo, ou seja, um campo que não aceita aquele valor.

**Esperado:** *"O campo … não ficou com o valor esperado"*, mostrando o que era
esperado e o que ficou. O preenchimento para.

**Por que isso importa:** é a defesa contra um sistema que reformata, trunca ou
recusa o valor em silêncio. Sem a releitura, a ferramenta diria "pronto" com o
campo errado.

### 2.10 Pasta temporária do Windows restrita

**Como reproduzir:** rode a ferramenta numa conta cuja pasta `Temp` recusa
gravação (comum em máquina com política corporativa, ou sob sandbox de execução).

**Esperado:** a ferramenta detecta a recusa antes de abrir o navegador, passa a
usar `logs/tmp` e registra um aviso no log. O preenchimento segue normalmente.

Se nem a pasta própria servir, a mensagem é *"O Windows não deixou a ferramenta
criar a pasta temporária de trabalho"* — nunca *"bloqueou a abertura do Chrome"*.

**Por que isso importa:** foi um defeito real, encontrado na validação desta
entrega. O Playwright cria uma pasta `playwright-artifacts-XXXXXX` **antes** de
abrir o navegador; quando a criação falhava com `EPERM`, a ferramenta traduzia
como bloqueio de execução do Chrome e mandava o operador cobrar o TI pelo motivo
errado. Corrigido em duas frentes: fallback de pasta e detecção específica do
erro.

### 2.11 Exame NECROPSIA sem NIC

**Como reproduzir:** abra a aba 2, selecione `NECROPSIA`, vá à aba 4 e clique em
**Cadastrar uma nova vítima**. Deixe o NIC vazio e clique em **Preencher**.

**Esperado:** os campos da vítima ficam bloqueados, aparece o aviso *"Informe o
NIC para liberar o preenchimento"* e o botão de preencher fica desabilitado. Se o
preenchimento for acionado por outro caminho, a ferramenta espera até 60 s e
para com *"O NIC não foi informado na aba da vítima…"*. Nenhum campo bloqueado é
tocado.

Ao digitar qualquer NIC, os campos são liberados; ao apagar o NIC, voltam a
bloquear. Em qualquer outro exame, o cadastro abre liberado.

**Por que isso importa:** é a regra do fluxo oficial de necropsia. Preencher em
campo bloqueado falharia sem aviso ou gravaria dado incompleto.

### 2.12 Aba da vítima fechada

**Como reproduzir:** rode o preenchimento sem abrir o cadastro da vítima.

**Esperado:** as abas 1 e 3 são preenchidas, a aba 4 é **pulada** e a tela final
avisa que a aba da vítima não estava aberta, pedindo para abrir o cadastro e
clicar em Preencher de novo. A ferramenta **não** clica em "Cadastrar uma nova
vítima": esse clique é do operador.

**Por que isso importa:** a regra do produto é que a ferramenta só preenche
campos; nunca aciona botão do sistema oficial.

### 2.13 Formatação automática e listas dinâmicas

**Como reproduzir:** digite apenas números em **Data Ofício** (`12032024`),
**Suposta data/hora** (`100320241430`), **Data de nascimento** (`05071980`) e
**CPF** (`12345678900`).

**Esperado:** a tela completa a pontuação sozinha: `12/03/2024`,
`10/03/2024 14:30`, `05/07/1980`, `123.456.789-00`.

**Cidade e Bairro (aba 3):** a Cidade traz as **223 cidades da Paraíba** (base
do IBGE). Ao escolher Campina Grande, o Bairro lista só bairros de Campina
Grande; ao trocar para João Pessoa, a lista muda. "Pesquisar CEP" seleciona a
cidade e os bairros dela.

**Cidade Nascimento e Cidade (endereço):** ao escolher a UF, a lista traz os
municípios daquela UF (IBGE). O Bairro do endereço é populado pela cidade.

**Combos de órgão/autoridade:** um valor fora da lista fictícia **não é
apagado** — permanece no campo para o operador corrigir — e é registrado em
`window.__simulacao.valoresExtraidos` com `naLista: false`. Valores que existem
na lista entram com `naLista: true`.

**Pesquisar vítima:** abre uma tela própria, diferente do cadastro, com o
seletor **Pesquisar por:** (opções `NIC`, `NOME` e `CPF`) e o botão
**Pesquisar**. O cadastro só aparece pelo outro botão.

**Continuar o preenchimento:** quando a aba da vítima é pulada, a tela final
oferece o botão "Continuar o preenchimento". O operador abre o cadastro da
vítima no Chrome, digita o NIC e volta; o botão "Preencher" é liberado.

### 2.14 Requisição real (layout da Polícia Civil PB)

**Como rodar:**

```bat
npm run requisicao-real -- "C:\caminho\requisicao.pdf"
```

O runner usa o motor de extração do projeto, monta o JSON dos campos mapeados e
preenche a simulação campo a campo (para não parar no primeiro erro). Ele lê o
layout real da Central de Flagrantes/NUMOL (rótulos `Exame Requisitado`,
`Delegado(a) de Polícia Civil`, `Ref.: APF`, `Periciando(a)`, `Histórico`,
`Local da ocorrência`). O PDF real é um scan com camada de texto; o motor usa
essa camada quando ela está legível e o OCR do projeto quando não está.

**Esperado:** relatório em `testes/saida/requisicao-real-<data>.md` com:

- JSON extraído e tempo de extração;
- campos preenchidos e conferidos;
- valores digitados que não existem nas listas fictícias (permanecem no campo
  para o operador corrigir);
- falhas (se houver);
- `cliquesDeEnvio = 0` e nada cadastrado.

**Por que isso importa:** é o teste com documento real, não com o fixture
sintético. Ele valida o layout, as formatações e a regra de não clicar em botão.

### 2.15 Lote de requisições reais

**Como rodar:**

```bat
npm run teste:lote -- "a.pdf" "b.pdf" "c.pdf"
```

Processa cada PDF com o motor de extração e gera um relatório consolidado com:
layout reconhecido, via (texto digital ou OCR), campos extraídos, obrigatórios
ausentes, avisos, tempo e erro. O JSON ao lado traz os dados completos de cada
arquivo.

O layout real usa o OCR do projeto mesmo quando o PDF tem camada digital, porque
a camada do Adobe Scan confunde `1`/`I`/`l` e mistura colunas. A camada digital
fica como fonte alternativa para números truncados pelo OCR.

**Esperado:** cada requisição do modelo da Polícia Civil deve cair em
`requisicao-pb`. Requisições de outros órgãos (ex.: Polícia Federal) podem ter
layout diferente e são reportadas como falha.

### 2.16 Tolerâncias de extração

- **RG ausente:** o RG é difícil de ler e nem toda requisição o exige. A ausência
  **não bloqueia**: vira aviso no log e em `meta.avisos`; o campo fica em branco
  para o operador. No lote, 15 arquivos seguem normalmente com esse aviso.
- **Arquivo ilegível:** se nenhum campo-núcleo (**número, nome ou data**) for
  lido, a ferramenta para com
  *"A requisição não pôde ser lida. Verifique a legibilidade do arquivo ou
  preencha manualmente."* e **não** segue com JSON vazio. Um único endereço
  solto no cabeçalho não conta como leitura válida.
- **Vários arquivos:** `npm run requisicao-real` aceita um ou mais PDFs e gera
  um relatório consolidado, além dos relatórios individuais.

### 2.17 Listas reais da simulação

**Como rodar:**

```bat
npm run atualizar-listas -- "testes\saida\lote-requisicoes-....json"
```

Lê o JSON do lote, pega os valores únicos de `orgao`, `destinoExame` e
`autoridade`, limpa as variantes de OCR e mescla com as listas fictícias de
`sistema-simulado.html`. As listas fictícias são preservadas para os testes.

**Esperado:** os três campos passam de "fora-da-lista" para "ok" no teste real.
No último lote, as listas ficaram com 34 órgãos/destinos e 22 autoridades.

---

## 3. Checklist de aceitação

Para considerar a entrega aprovada:

- [x] `npm test` termina com **TODOS OS TESTES PASSARAM**
- [x] Os três fixtures extraem 18/18 campos
- [x] A página de simulação tem as 6 abas com os nomes do sistema
- [x] Os catálogos (15 exames, 42 fatos, CVLI, cor/raça, estado civil, gênero, UFs) conferem item a item
- [x] As abas 5 e 6 mostram "Conteúdo a detalhar"
- [x] `NECROPSIA` bloqueia a vítima até o NIC; apagar o NIC re-bloqueia
- [x] Outro exame libera os campos da vítima na abertura
- [x] Datas, data/hora e CPF são formatados automaticamente
- [x] Cidade (PB) e Bairro são dinâmicos; CEP seleciona cidade e bairros
- [x] Cidades de nascimento/residência vêm da UF (base IBGE)
- [x] Combo preserva valor fora da lista e registra em `valoresExtraidos`
- [x] "Pesquisar vítima" abre tela diferente do cadastro
- [x] A tela final oferece "Continuar o preenchimento" quando a vítima é pulada
- [x] O botão "Preencher" é liberado depois que o NIC aparece na tela
- [x] O preenchimento pula a aba da vítima quando o formulário não foi aberto pelo operador
- [x] O preenchimento confirma `cliquesDeEnvio === 0` e `cadastrada === false`
- [x] `npm run teste:janela` termina com **FLUXO COMPLETO APROVADO**
- [x] A janela abre em modo de teste, com o selo visível
- [x] O botão de preencher nunca aparece antes de haver dados lidos
- [ ] Cada caso de erro da seção 2 para o processo, com mensagem em português claro
- [x] O log do dia existe em `logs/` e **não contém dados pessoais**
- [x] Nenhuma dependência paga no `package.json`
- [x] Nenhum aplicativo externo é aberto durante o uso
- [x] Os seletores do sistema oficial continuam como `SUBSTITUIR` até a configuração real

> Os itens desmarcados dependem de infraestrutura que não existe nesta máquina de
> desenvolvimento: os casos de erro da seção 2 exigem o sistema oficial real ou um
> scanner físico. Estão documentados como procedimento para a homologação.

### Evidência do fluxo de janela

Execução registrada em `testes/saida/resultado-janela.json`:

```
[1] janela unica aberta
[1] interface montada
[2] extracao: 18 campo(s), origem "PDF digital (texto lido diretamente)"
[3] tabela editavel: 18 campo(s), botao "Preencher o sistema (18 campos)"
[4] clicando em "Preencher o sistema"...
[5] etapa final: etapa-resultado / rodape: Aguardando revisão do operador
[5] mensagem: 8 campos preenchidos e conferidos no sistema.
[5] aviso de aba da vítima pulada exibido
[5] botão "Continuar o preenchimento" disponível

JANELA: FLUXO COMPLETO APROVADO
```

> Nesta execução a aba da vítima foi pulada, como esperado: o formulário do
> cadastro é aberto pelo operador, e o teste de janela não o abre. A ferramenta
> preencheu as abas 1 e 3, avisou na tela final e não tocou em botão de envio.

---

## 4. Observações sobre precisão do OCR

O Tesseract acerta bem texto impresso e limpo. Erra mais com:

- folha torta, amassada ou com dobra;
- impressão fraca, borrada ou matricial antiga;
- marcação de caneta sobre o texto;
- foto com pouca luz, sombra ou reflexo;
- fonte muito pequena (abaixo de ~9 pt).

Mitigações já aplicadas:

- renderização do PDF em escala 2 (~200 DPI) antes do OCR;
- PSM 6 (bloco uniforme de texto), adequado a formulários;
- idioma `por`, reduzindo troca de acentos e cedilha;
- confiança mínima configurável, que transforma leitura ruim em erro explícito;
- tolerância `ocr` em textos longos, que **avisa** em vez de esconder.

Se a precisão não bastar, nesta ordem e sem custo:

1. **Aumentar `escalaDoRender` para 3.** Mais resolução, leitura melhor, ~2x mais lento.
2. **Digitalizar a 300 DPI** no driver do scanner, em vez de 200.
3. **Preferir o PDF digital** sempre que o documento original existir.
4. **Melhorar a captura** — apoiar a folha, evitar sombra, usar scanner em vez de foto.
5. **Usar o Tesseract de linha de comando** com `--oem 1` e um `tessdata_best`
   (mais preciso, mais lento, ainda gratuito).

Nenhuma dessas alternativas tem custo. Este projeto não sugere serviço pago.
