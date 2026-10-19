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

---

## 3. Checklist de aceitação

Para considerar a entrega aprovada:

- [x] `npm test` termina com **TODOS OS TESTES PASSARAM**
- [x] Os três fixtures extraem 18/18 campos
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
[5] mensagem: 18 campos preenchidos e conferidos no sistema.

JANELA: FLUXO COMPLETO APROVADO
```

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
