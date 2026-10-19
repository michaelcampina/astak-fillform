'use strict';

/**
 * Acionamento do scanner via WIA (Windows Image Acquisition) por COM.
 *
 * Por que WIA e nao TWAIN: WIA ja vem no Windows e e exposto por COM, sem
 * driver extra e sem janela de interface. A captura acontece dentro da
 * ferramenta, em memoria, e nenhum aplicativo auxiliar (Windows Scan, Paint,
 * visualizador) e aberto.
 *
 * Estrategia de compatibilidade, tentada nesta ordem:
 *   1. PowerShell com .NET chamando COM do WIA (caminho principal, sem instalar nada).
 *   2. Se falhar, tentamos o driver WIA de servico do dispositivo (quando existir).
 *
 * Se o scanner nao expuser WIA, a ferramenta PARA e explica o que fazer.
 * Nunca abre programa externo para compensar.
 */

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const registro = require('../nucleo/registro');

/**
 * Script PowerShell embutido. Lista dispositivos WIA e, quando pedido,
 * captura uma pagina e devolve os bytes em base64 no stdout.
 *
 * Cuidado deliberado: nada aqui interage com a area de trabalho do operador.
 */
const SCRIPT_WIA = String.raw`
param(
  [string]$Acao = 'listar',
  [string]$IdDispositivo = '',
  [int]$Dpi = 300,
  [int]$ModoCor = 2
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
  $gerenciador = New-Object -ComObject WIA.DeviceManager
} catch {
  Write-Output 'ERRO|WIA_INDISPONIVEL|O servico de digitalizacao do Windows nao respondeu neste computador.'
  exit 3
}

$dispositivos = @()
foreach ($info in $gerenciador.DeviceInfos) {
  if ($info.Type -eq 1) {  # 1 = scanner
    $propriedades = @{}
    foreach ($prop in $info.Properties) {
      try { $propriedades[$prop.Name] = [string]$prop.Value } catch { }
    }
    $dispositivos += [pscustomobject]@{
      id    = [string]$info.DeviceID
      nome  = [string]$propriedades['Name']
      tipo  = 'scanner'
    }
  }
}

if ($Acao -eq 'listar') {
  if ($dispositivos.Count -eq 0) {
    Write-Output 'VAZIO|Nenhum scanner WIA encontrado.'
    exit 0
  }
  foreach ($d in $dispositivos) {
    Write-Output ("DISPOSITIVO|{0}|{1}" -f $d.id, $d.nome)
  }
  exit 0
}

if ($Acao -ne 'capturar') {
  Write-Output 'ERRO|ACAO_INVALIDA|Acao desconhecida.'
  exit 4
}

$alvo = $null
foreach ($info in $gerenciador.DeviceInfos) {
  if ($info.Type -eq 1 -and ($IdDispositivo -eq '' -or [string]$info.DeviceID -eq $IdDispositivo)) {
    $alvo = $info
    break
  }
}

if ($null -eq $alvo) {
  Write-Output 'ERRO|SCANNER_NAO_ENCONTRADO|O scanner configurado nao foi localizado.'
  exit 5
}

try {
  $dispositivo = $alvo.Connect()
} catch {
  Write-Output ('ERRO|CONEXAO_FALHOU|{0}' -f $_.Exception.Message)
  exit 6
}

# ---- ajustes de digitalizacao (WIA) ----
function DefinirPropriedade($item, $idPropriedade, $valor) {
  try {
    $prop = $item.Properties.Item($idPropriedade)
    $prop.Value = $valor
    return $true
  } catch {
    return $false
  }
}

# 6146 = resolucao horizontal, 6147 = vertical, 6148 = modo de cor, 6154 = bits por pixel
[void](DefinirPropriedade $dispositivo.Items.Item(1) 6146 $Dpi)
[void](DefinirPropriedade $dispositivo.Items.Item(1) 6147 $Dpi)
[void](DefinirPropriedade $dispositivo.Items.Item(1) 6148 $ModoCor)

$item = $null
foreach ($i in $dispositivo.Items) {
  if ($i.Purpose -in @(1, 0)) { $item = $i; break }
}
if ($null -eq $item) { $item = $dispositivo.Items.Item(1) }

$formato = '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'  # PNG
try {
  $imagem = $item.Transfer($formato)
} catch {
  Write-Output ('ERRO|CAPTURA_FALHOU|{0}' -f $_.Exception.Message)
  exit 7
}

# Grava em arquivo temporario para converter em base64 e apagar em seguida.
$temporario = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), ('wia-' + [guid]::NewGuid().ToString('N') + '.png'))
try {
  $imagem.SaveFile($temporario)
  $bytes = [System.IO.File]::ReadAllBytes($temporario)
  $base64 = [System.Convert]::ToBase64String($bytes)
  Write-Output ('IMAGEM|' + $base64)
} finally {
  if (Test-Path $temporario) { Remove-Item $temporario -Force -ErrorAction SilentlyContinue }
}
exit 0
`;

function executarPowerShell(argumentos, timeoutMs) {
  return new Promise((resolver, rejeitar) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ...argumentos],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (erro, stdout, stderr) => {
        if (erro && !stdout) {
          rejeitar(new Error(stderr || erro.message));
          return;
        }
        resolver({ stdout: stdout || '', stderr: stderr || '', codigo: erro ? erro.code : 0 });
      },
    );
  });
}

/** Interpreta a saida em linhas "TIPO|campo1|campo2". */
function interpretarSaida(stdout) {
  const linhas = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const resultado = { dispositivos: [], imagemBase64: null, erro: null, vazio: false };

  for (const linha of linhas) {
    const partes = linha.split('|');
    const marca = partes[0];
    if (marca === 'DISPOSITIVO') {
      resultado.dispositivos.push({ id: partes[1], nome: partes.slice(2).join('|') });
    } else if (marca === 'VAZIO') {
      resultado.vazio = true;
    } else if (marca === 'IMAGEM') {
      resultado.imagemBase64 = partes[1];
    } else if (marca === 'ERRO') {
      resultado.erro = { codigo: partes[1], mensagem: partes.slice(2).join('|') };
    }
  }

  return resultado;
}

/**
 * Lista os scanners disponiveis.
 * @returns {Promise<{dispositivos: {id: string, nome: string}[], erro: string|null}>}
 */
async function listarScanners(configuracao) {
  const timeout = configuracao?.geral?.scanner?.timeoutMs || 30000;
  try {
    const { stdout } = await executarPowerShell(
      [SCRIPT_WIA, '-Acao', 'listar'],
      Math.min(timeout, 60000),
    );
    const saida = interpretarSaida(stdout);
    if (saida.erro) {
      return { dispositivos: [], erro: saida.erro.mensagem };
    }
    return { dispositivos: saida.dispositivos, erro: null };
  } catch (erro) {
    registro.erro('Falha ao listar scanners WIA', erro.message);
    return { dispositivos: [], erro: 'O servico de digitalizacao do Windows nao respondeu.' };
  }
}

/**
 * Captura uma pagina e devolve a imagem em memoria.
 * @returns {Promise<{buffer: Buffer, nomeArquivo: string}>}
 */
async function capturarPagina(configuracao) {
  const scanner = configuracao.geral.scanner || {};
  const timeout = scanner.timeoutMs || 180000;
  const dispositivo = scanner.idDispositivo || '';

  registro.info('Iniciando captura no scanner', { dpi: scanner.dpi, dispositivo: dispositivo || '(padrao)' });

  let stdout;
  try {
    ({ stdout } = await executarPowerShell(
      [
        SCRIPT_WIA,
        '-Acao', 'capturar',
        '-IdDispositivo', dispositivo,
        '-Dpi', String(scanner.dpi || 300),
        '-ModoCor', String(scanner.modoCor ?? 2),
      ],
      timeout,
    ));
  } catch (erro) {
    throw new Error(
      'A digitalizacao nao respondeu. Verifique se a impressora multifuncional esta ligada e conectada.',
    );
  }

  const saida = interpretarSaida(stdout);

  if (saida.erro) {
    const mensagens = {
      WIA_INDISPONIVEL: 'O servico de digitalizacao do Windows nao esta respondendo. Reinicie o computador e tente de novo.',
      SCANNER_NAO_ENCONTRADO: 'O scanner configurado nao foi encontrado. Confira se a multifuncional esta ligada.',
      CONEXAO_FALHOU: 'A multifuncional foi encontrada, mas nao aceitou a conexao. Feche outros programas que possam estar usando o scanner.',
      CAPTURA_FALHOU: 'A multifuncional nao conseguiu digitalizar. Confira se ha papel no alimentador ou no vidro.',
    };
    throw new Error(mensagens[saida.erro.codigo] || saida.erro.mensagem);
  }

  if (saida.vazio || !saida.imagemBase64) {
    throw new Error('O scanner nao devolveu nenhuma imagem. Confira se a folha esta no vidro ou no alimentador.');
  }

  const buffer = Buffer.from(saida.imagemBase64, 'base64');
  if (buffer.length < 1000) {
    throw new Error('A imagem recebida do scanner veio incompleta. Tente digitalizar novamente.');
  }

  registro.info('Captura concluida', { bytes: buffer.length });
  return { buffer, nomeArquivo: 'digitalizacao-do-scanner.png', tipo: 'imagem' };
}

module.exports = { listarScanners, capturarPagina };
