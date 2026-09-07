param(
  [int]$Port = 3000,
  [string]$Root = ''
)

# Minimal single-threaded static file server used ONLY for local preview.
# Rationale: this machine has no Node.js/Python, so the Express API cannot run.
# The customer PWA (apps/customer-pwa) is pure static HTML/CSS/JS with a
# DEFAULT_CATALOG fallback, so it renders standalone without the API.

$ErrorActionPreference = 'Stop'

if (-not $Root) { $Root = (Get-Location).Path }
$Root = (Resolve-Path $Root).Path

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

$contentTypes = @{
  '.html'       = 'text/html; charset=utf-8'
  '.htm'        = 'text/html; charset=utf-8'
  '.css'        = 'text/css; charset=utf-8'
  '.js'         = 'application/javascript; charset=utf-8'
  '.mjs'        = 'application/javascript; charset=utf-8'
  '.json'       = 'application/json; charset=utf-8'
  '.webmanifest'= 'application/manifest+json; charset=utf-8'
  '.svg'        = 'image/svg+xml'
  '.png'        = 'image/png'
  '.jpg'        = 'image/jpeg'
  '.jpeg'       = 'image/jpeg'
  '.gif'        = 'image/gif'
  '.webp'       = 'image/webp'
  '.ico'        = 'image/x-icon'
  '.txt'        = 'text/plain; charset=utf-8'
  '.wasm'       = 'application/wasm'
  '.woff'       = 'font/woff'
  '.woff2'      = 'font/woff2'
  '.ttf'        = 'font/ttf'
  '.map'        = 'application/json; charset=utf-8'
}

function Send-Response([System.Net.Sockets.NetworkStream]$Stream, [int]$Status, [string]$StatusText, [string]$ContentType, [byte[]]$Body) {
  $head = "HTTP/1.1 $Status $StatusText`r`n" +
          "Content-Type: $ContentType`r`n" +
          "Content-Length: $($Body.Length)`r`n" +
          "Cache-Control: no-store`r`n" +
          "Connection: close`r`n`r`n"
  $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
  $Stream.Write($headBytes, 0, $headBytes.Length)
  if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
  $Stream.Flush()
}

function Get-FileBytes([string]$FullPath, [switch]$Head) {
  if ($Head) { return [byte[]]::new(0) }
  return [System.IO.File]::ReadAllBytes($FullPath)
}

Write-Output "READY http://127.0.0.1:$Port/ root=$Root"
Write-Output "PID $PID"

try {
  while ($true) {
    $client = $null
    try {
      $client = $listener.AcceptTcpClient()
      $client.NoDelay = $true
      $stream = $client.GetStream()
      $stream.ReadTimeout = 10000

      # Read request head up to CRLFCRLF
      $sb = New-Object System.Text.StringBuilder
      $buf = New-Object byte[] 8192
      $headText = $null
      while ($sb.Length -lt 131072) {
        $n = $stream.Read($buf, 0, $buf.Length)
        if ($n -le 0) { break }
        [void]$sb.Append([System.Text.Encoding]::ASCII.GetString($buf, 0, $n))
        if ($sb.ToString().Contains("`r`n`r`n")) { break }
      }
      $headText = $sb.ToString()
      if (-not $headText) { continue }

      $lines = $headText.Split("`r`n")
      $requestLine = $lines[0].Split(' ')
      if ($requestLine.Length -lt 2) { continue }
      $method = $requestLine[0].ToUpperInvariant()
      $rawPath = $requestLine[1]
      if ($method -ne 'GET' -and $method -ne 'HEAD') {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Method Not Allowed')
        Send-Response -Stream $stream -Status 405 -StatusText 'Method Not Allowed' -ContentType 'text/plain; charset=utf-8' -Body $body
        continue
      }

      $isHead = ($method -eq 'HEAD')
      $pathOnly = $rawPath
      $q = $rawPath.IndexOf('?')
      if ($q -ge 0) { $pathOnly = $rawPath.Substring(0, $q) }
      $decoded = ''
      try { $decoded = [System.Uri]::UnescapeDataString($pathOnly) } catch { $decoded = $pathOnly }

      # Directory index
      if ($decoded.EndsWith('/')) { $decoded = $decoded + 'index.html' }
      if ($decoded -eq '') { $decoded = 'index.html' }

      $rel = $decoded.TrimStart('/').Replace('/', '\')
      if ($rel -eq '' -or $rel.Contains('..')) {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
        Send-Response -Stream $stream -Status 404 -StatusText 'Not Found' -ContentType 'text/plain; charset=utf-8' -Body $body
        continue
      }

      $full = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))
      if (-not $full.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
        Send-Response -Stream $stream -Status 404 -StatusText 'Not Found' -ContentType 'text/plain; charset=utf-8' -Body $body
        continue
      }

      if ([System.IO.File]::Exists($full)) {
        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        $ct = 'application/octet-stream'
        if ($contentTypes.ContainsKey($ext)) { $ct = $contentTypes[$ext] }
        $body = Get-FileBytes -FullPath $full -Head:$isHead
        Send-Response -Stream $stream -Status 200 -StatusText 'OK' -ContentType $ct -Body $body
      } else {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
        Send-Response -Stream $stream -Status 404 -StatusText 'Not Found' -ContentType 'text/plain; charset=utf-8' -Body $body
      }
    } catch {
      try { Write-Output ("[serve-static] request error: " + $_.Exception.Message) } catch {}
    } finally {
      if ($client) { try { $client.Close() } catch {} }
    }
  }
} finally {
  try { $listener.Stop() } catch {}
}
