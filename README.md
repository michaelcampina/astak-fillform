# FillForm

**Astak Systems**

Ferramenta auxiliar de preenchimento automatizado de formulários, com extração de dados de requisições em PDF/imagem, OCR local e preenchimento assistido do sistema de destino.

O FillForm foi projetado para reduzir o retrabalho de digitação sem assumir o controle do operador: ele lê o documento, monta os campos e preenche a tela campo a campo, sempre com conferência. **Nenhum botão de envio é clicado pela ferramenta.**

## Principais recursos

- Leitura de PDFs digitais, PDFs escaneados e imagens.
- OCR local com Tesseract.js, sem enviar documentos para a nuvem.
- Extração configurável por rótulos e regras de negócio.
- Preenchimento campo a campo com leitura de volta e conferência.
- Proteção contra cliques acidentais em botões de envio.
- Página de simulação para validação antes de usar o sistema oficial.
- Relatórios de teste com tempo, acertos, falhas e valores não encontrados nas listas.

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Aplicação desktop | Electron |
| OCR | Tesseract.js |
| Automação do navegador | Playwright |
| Leitura de PDF | pdfjs-dist |
| Renderização de páginas | @napi-rs/canvas |
| Linguagem | JavaScript (Node.js) |

## Requisitos

- Node.js 18.17 ou superior.
- Windows 10/11 (o fluxo de janela e a simulação foram validados nesse ambiente).
- Chrome/Chromium disponível para o Playwright.

## Instalação

```bash
git clone https://github.com/michaelcampina/astak-fillform.git
cd astak-fillform
npm install
npm run idioma-ocr
```

O comando `npm run idioma-ocr` baixa o pacote de idioma português usado pelo Tesseract. Ele precisa ser executado uma vez.

## Uso

```bash
npm start
```

1. Abra o FillForm.
2. Selecione a requisição em PDF ou imagem.
3. Confira os campos extraídos na tabela editável.
4. Clique em **Preencher o sistema**.
5. O operador abre o cadastro da vítima no sistema de destino, quando necessário.
6. Revise os campos preenchidos antes de finalizar manualmente.

O preenchimento é feito na página de simulação por padrão. Para apontar para o sistema oficial, configure os seletores em `config/seletores.json` (bloco `sistemaOficial`). Enquanto houver qualquer `SUBSTITUIR` nesse bloco, a ferramenta se recusa a abrir o navegador.

## Estrutura do projeto

```text
config/                 Configuração de campos, seletores e formatação
docs/                   Documentação e plano de testes
recursos/               Recursos locais (idioma do OCR)
simulacao/              Página de simulação do formulário
src/                    Código da aplicação (Electron, extração, preenchimento)
testes/                 Testes automatizados e runners de lote
```

## Configuração

- `config/campos.json`: campos extraídos, rótulos, formatos e obrigatoriedade.
- `config/seletores.json`: seletores da simulação e do sistema oficial.
- `config/formatacao.json`: regras de formatação (data, CPF, RG etc.).
- `config/diretores.json`: nomes que nunca devem ser usados como autoridade ou nome de pessoa.

## Testes

```bash
npm test                 # extração, simulação e preenchimento
npm run teste:janela     # fluxo da janela Electron
npm run teste:lote -- "a.pdf" "b.pdf"
npm run requisicao-real -- "requisicao.pdf"
```

Os relatórios são gravados em `testes/saida/`, que não é versionado.

## Privacidade e segurança

- O OCR e a extração acontecem localmente.
- Os documentos reais de requisição ficam em `requisições/` e são ignorados pelo Git.
- Perfis de navegador, logs e relatórios de teste também são ignorados.
- A ferramenta não clica em botões de envio nem cadastra registros.
- A decisão final e o envio continuam sendo do operador.

## Licença

Projeto interno da **Astak Systems**. Todos os direitos reservados.

---

**Astak Systems** · FillForm
