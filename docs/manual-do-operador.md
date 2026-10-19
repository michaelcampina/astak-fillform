# Preenchedor de Requisições de Exame

Ferramenta local que lê a requisição de exame (papel digitalizado ou PDF/imagem),
extrai os dados e **preenche o sistema oficial sozinha — parando sempre antes do
botão de cadastrar**. Quem confere e conclui é você, o operador.

- Roda 100% nesta máquina. Nenhum dado sai do computador.
- Custo zero. Só bibliotecas gratuitas e de código aberto.
- Não acessa banco de dados, API interna ou arquivo do sistema. Só o navegador.
- **Nunca** clica em *cadastrar*, *finalizar*, *enviar* ou similares.

---

## Sumário

1. [O que você precisa ter instalado](#1-o-que-você-precisa-ter-instalado)
2. [Instalação](#2-instalação)
3. [Preparar a sessão do Chrome](#3-preparar-a-sessão-do-chrome)
4. [Uso diário, passo a passo](#4-uso-diário-passo-a-passo)
5. [Configurar os campos e seletores](#5-configurar-os-campos-e-seletores)
6. [Digitalizar pelo scanner](#6-digitalizar-pelo-scanner)
7. [Quando dá erro](#7-quando-dá-erro)
8. [Onde ficam os registros](#8-onde-ficam-os-registros)
9. [Perguntas frequentes](#9-perguntas-frequentes)

---

## 1. O que você precisa ter instalado

| Item | Versão mínima | Para quê |
|---|---|---|
| Node.js | 20 | Rodar a ferramenta |
| Google Chrome | qualquer versão recente | O sistema oficial roda nele |
| Driver do scanner | — | Só se for digitalizar papel |

> O **Google Chrome precisa estar instalado**. A ferramenta usa o Chrome de
> verdade com o seu perfil, para aproveitar a sessão já autenticada no sistema.

Para conferir a versão do Node, abra o Prompt de Comando e digite:

```
node --version
```

Precisa aparecer `v20` ou maior.

---

## 2. Instalação

Faça uma vez, na pasta da ferramenta.

```bat
npm install --ignore-scripts
npm run idioma-ocr
npm run exemplos
```

O que cada comando faz:

- `npm install --ignore-scripts` — baixa as bibliotecas. Não executa scripts de
  terceiros durante a instalação.
- `npm run idioma-ocr` — prepara o arquivo de idioma português do OCR. Se a
  máquina não tiver internet, copie a pasta `recursos/tessdata` de outro
  computador onde a ferramenta já esteja instalada.
- `npm run exemplos` — cria as requisições de exemplo na pasta `testes/fixtures`.
  Serve para você testar sem usar papel.

Para abrir a ferramenta:

```bat
npm start
```

### Se o Electron não estiver baixado

Algumas redes corporativas bloqueiam o download do Electron. Se `npm start`
reclamar que o Electron não existe:

```bat
set electron_config_cache=%~dp0.electron-cache
set ELECTRON_CACHE=%~dp0.electron-cache
node node_modules\electron\install.js
```

---

## 3. Preparar a sessão do Chrome

Esta é a parte mais importante da configuração. A ferramenta não faz login: ela
usa a sessão que **você** já abriu.

### Como funciona

A ferramenta abre o Chrome com um perfil próprio, na pasta `perfis/chrome-operador`.
Esse perfil é separado do seu Chrome do dia a dia. Você entra no sistema **uma vez**
nesse perfil, e a sessão fica gravada ali.

### Passo a passo (só na primeira vez)

1. Abra a ferramenta: `npm start`.
2. Na tela inicial, arraste qualquer requisição de exemplo da pasta
   `testes/fixtures` para a janela.
3. Clique em **Preencher o sistema**.
4. O Chrome abre. Se aparecer a tela de login do sistema, **entre normalmente**,
   com seu usuário e senha.
5. Navegue até a tela de cadastro de requisição.
6. Volte na janela da ferramenta e clique em **Preencher o sistema** de novo.
   Desta vez ele preenche, porque a sessão já está ativa.

> **Importante:** não feche a janela do Chrome entre um preenchimento e outro.
> A ferramenta reaproveita a janela aberta. Se você fechar, ela abre outra na
> próxima vez, e a sessão continua salva no perfil.

### Se a sessão expirar

A ferramenta avisa: *"A sessão do sistema expirou. Entre no sistema nessa janela,
abra a tela de cadastro e clique em Preencher de novo."*

Faça exatamente isso: entre na janela do Chrome que já está aberta e repita o
preenchimento. Nada é perdido.

---

## 4. Uso diário, passo a passo

1. **Abra a ferramenta** (`npm start`).
2. **Entregue a requisição**, de um destes dois jeitos:
   - arraste o arquivo (PDF, PNG ou JPG) para a área pontilhada;
   - clique em **Escanear papel**, se o papel estiver no scanner.
3. **Aguarde o processamento.** A tela mostra o andamento:
   - *Processando a requisição…*
   - *Digitalizando a folha…*
   - *Preenchendo o sistema…*
4. **Confira os dados.** Aparece uma tabela com todos os campos lidos. Veja se
   está tudo certo:
   - os campos com `*` são obrigatórios;
   - campos marcados *"não encontrado — preencha se necessário"* ficaram em branco;
   - **você pode corrigir qualquer valor ali mesmo**, clicando e digitando.
5. **Clique em Preencher o sistema.** O Chrome abre e lança os dados campo por
   campo, nas abas certas.
6. **Revise e conclua você mesmo.** A ferramenta para. Confira os dados na tela
   do sistema e clique em *Cadastrar* com a sua mão.

### A garantia que interessa

Depois de preencher, a ferramenta **lê de volta cada campo** e compara com o que
digitou. Se algum valor não ficou exatamente como deveria, ela para na hora e
avisa, em vez de continuar e gravar errado.

---

## 5. Configurar os campos e seletores

Toda a configuração fica na pasta `config`. Nenhum seletor ou regra está escrito
no código.

| Arquivo | Para que serve |
|---|---|
| `configuracao.json` | Modo de teste, escala do OCR, navegador, scanner, logs |
| `campos.json` | Quais campos existem, com que nomes aparecem na requisição |
| `seletores.json` | Onde cada campo está na tela do sistema |
| `formatacao.json` | Como cada tipo de dado é formatado (data, CPF, RG…) |

### Ligar no sistema oficial

Por padrão a ferramenta abre em **modo de teste**, apontando para a página de
simulação. Para usar no sistema real:

1. Abra `config/configuracao.json` e mude:

   ```json
   "MODO_TESTE": false
   ```

2. Abra `config/seletores.json` e preencha o bloco `sistemaOficial`. Os valores
   estão como `SUBSTITUIR...` justamente para você não rodar por engano.

3. Para descobrir o seletor de um campo: abra a tela do sistema no Chrome,
   clique com o botão direito no campo, escolha **Inspecionar**, e copie o `id`
   do elemento. Um campo com `id="cpf"` vira o seletor `#cpf`.

### Tipos de campo aceitos

| Tipo | Quando usar | Exemplo |
|---|---|---|
| `texto` | Campo de texto comum | `#nome` |
| `areaTexto` | Caixa de texto grande | `#observacoes` |
| `selectNativo` | Lista suspensa tradicional | `#destinoExame` |
| `caixaPesquisavel` | Campo que filtra uma lista ao digitar | `#orgao` |

### Caixas pesquisáveis (o caso mais delicado)

Muitos sistemas têm campos onde você digita e uma lista aparece para escolher.
A ferramenta trata esse caso assim:

1. clica no campo;
2. digita o valor extraído, para filtrar;
3. espera a lista aparecer;
4. **confere se exatamente uma opção corresponde**;
5. clica na opção;
6. confirma com Tab (nunca Enter);
7. lê o campo de volta para conferir.

**Se duas ou mais opções corresponderem, a ferramenta para e avisa.** Ela não
escolhe no escuro. Isso é de propósito: escolher a opção errada seria pior do que
parar.

> **Acentos importam.** Se o extrato diz `Instituto Médico Legal` e o sistema
> tem `Instituto Medico Legal`, o filtro pode não retornar nada. A ferramenta
> tenta variações (sem parênteses, sem o trecho após a vírgula, sem acento) até
> conseguir uma única opção. Se mesmo assim não conseguir, ela para e pede que
> você ajuste.

---

## 6. Digitalizar pelo scanner

A ferramenta digitaliza pelo serviço de imagem do próprio Windows (WIA). Ela
**não abre** o aplicativo "Digitalizar" do Windows nem qualquer outro programa.

Requisitos:

- o scanner ou multifuncional precisa ter o **driver WIA** instalado;
- a ferramenta precisa estar aberta na mesma máquina do aparelho.

Ao abrir, a ferramenta mostra na tela se encontrou scanner:

- *"Scanner pronto: nome do aparelho"* — pode usar o botão.
- *"Nenhum scanner detectado. Use o arrastar e soltar."* — digitalize por fora e
  arraste o arquivo, ou instale o driver WIA.

Se a tela mostrar *"Scanner indisponível"*, veja a seção de erros abaixo.

---

## 7. Quando dá erro

A ferramenta sempre para e explica em linguagem simples. Nada é preenchido pela
metade sem aviso.

| Mensagem | O que aconteceu | O que fazer |
|---|---|---|
| **"Não foi possível ler a requisição"** | Documento ilegível, torto ou fora do padrão | Endireite a folha, escaneie de novo com mais qualidade |
| **"A requisição não trouxe os campos obrigatórios: …"** | Faltou um dado essencial | Digite o campo faltante na tabela ou use outra requisição |
| **"Alguns dados foram lidos, mas não puderam ser interpretados…"** | O valor existe, mas está num formato estranho | Confira o documento; corrija o campo na tabela |
| **"A sessão do sistema expirou…"** | O sistema pediu login de novo | Entre na janela do Chrome já aberta e clique em Preencher outra vez |
| **"O campo … não apareceu na tela do sistema"** | O layout mudou ou o seletor está errado | Atualize o seletor em `config/seletores.json` |
| **"O campo … não ficou com o valor esperado"** | O sistema recusou ou formatou o valor | Confira o campo na tela e preencha à mão se necessário |
| **"Mais de uma opção corresponde a …"** | A lista tem nomes parecidos | Escolha você mesmo na tela do sistema |
| **"A ferramenta se recusou a interagir com …"** | Um seletor aponta para um botão de envio | Corrija `config/seletores.json` — é proteção, não defeito |
| **"O Windows bloqueou a abertura do Chrome pela ferramenta"** | Antivírus ou política de rede impede executar o navegador | Peça ao TI para liberar o Chrome na pasta da ferramenta |
| **"O Windows não deixou a ferramenta criar a pasta temporária de trabalho"** | A pasta `Temp` do usuário está restrita por política | A ferramenta já tenta uma pasta própria; se persistir, libere escrita na pasta da ferramenta |
| **"Nenhum scanner detectado"** | Sem driver WIA, ou aparelho desconectado | Instale o driver WIA ou digitalize por fora e arraste |

### Sobre qualidade do OCR

O OCR acerta muito bem texto impresso e limpo. Ele erra mais quando:

- a folha está torta ou amassada;
- a impressão está fraca ou borrada;
- há marcação de caneta em cima do texto;
- a foto foi tirada com pouca luz.

Em caso de dúvida, prefira o PDF digital (quando existir) — nesse caso a leitura
é exata, sem OCR. E confira sempre a tabela antes de clicar em Preencher: é
justamente para isso que ela existe.

---

## 8. Onde ficam os registros

A pasta `logs/` guarda um arquivo por dia, com o que a ferramenta fez:

- quais campos foram preenchidos e verificados;
- quantas linhas foram lidas, a confiança do OCR;
- erros e a causa técnica deles.

**O log não guarda dados pessoais.** Ele registra o nome do campo e se deu certo,
nunca o conteúdo — nem nome, nem CPF, nem endereço.

Para abrir a pasta, clique em **Registros** no canto superior direito. Esse é o
único momento em que a ferramenta abre algo fora dela, e só quando você pede.

Os dados extraídos ficam **apenas na memória**. Ao fechar a janela, somem.

---

## 9. Perguntas frequentes

**A ferramenta cadastra sozinha?**
Não. Ela preenche e para. O botão de cadastrar nunca é clicado por ela, e existe
uma proteção no código que recusa interagir com qualquer botão de envio.

**Preciso de internet?**
Não, depois de instalada. A leitura do documento e o OCR rodam na máquina.

**Meus dados vão para algum servidor?**
Não. Nada sai do computador. Não há telemetria, nuvem ou API paga.

**E se o sistema mudar de layout?**
A ferramenta para com a mensagem *"O campo … não apareceu na tela"*. É só
atualizar o seletor em `config/seletores.json`. O resto continua funcionando.

**Posso corrigir um dado que o OCR leu errado?**
Sim, e é recomendado. A tabela de conferência é editável: corrija ali e clique
em Preencher.

**Quantas requisições por vez?**
Uma. A ferramenta processa um documento, você confere, preenche, e depois clica
em **Nova requisição** para a próxima.
