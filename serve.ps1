Add-Type -AssemblyName System.Web
$base = (Get-Location).Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:5500/")
$listener.Start()
Write-Host "Preview at http://localhost:5500/"
while ($true) {
  $ctx = $listener.GetContext()
  try {
    $path = [System.Web.HttpUtility]::UrlDecode($ctx.Request.Url.LocalPath.TrimStart('/'))
if ([string]::IsNullOrWhiteSpace($path)) { $path = 'index.html' }
    $full = Join-Path $base $path
    if (-not (Test-Path $full)) {
      $ctx.Response.StatusCode = 404
      $ctx.Response.Close()
      continue
    }
    $bytes = [System.IO.File]::ReadAllBytes($full)
    $ext = [System.IO.Path]::GetExtension($full).ToLower()
    $ct = 'text/plain'
    switch ($ext) {
      '.html' { $ct = 'text/html' }
      '.css'  { $ct = 'text/css' }
      '.js'   { $ct = 'application/javascript' }
      '.png'  { $ct = 'image/png' }
      '.jpg'  { $ct = 'image/jpeg' }
      '.jpeg' { $ct = 'image/jpeg' }
      '.xlsx' { $ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    }
    $ctx.Response.ContentType = $ct
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
  } catch {
    try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch { }
  }
}