param(
  [string]$CliPath = "",
  [string]$Output = ""
)

$ErrorActionPreference = "Stop"
$Source = $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $Source "manifest.json") -Raw | ConvertFrom-Json
$Version = $manifest.version

if (-not $CliPath) {
  $cmd = Get-Command icuewidget -ErrorAction SilentlyContinue
  if ($cmd) { $CliPath = $cmd.Source }
}
if (-not $CliPath) { throw "icuewidget CLI not found on PATH." }
if (-not $Output) {
  $Output = Join-Path (Split-Path $Source -Parent) ("Local-AI-Monitor-" + $Version + ".icuewidget")
}

$Stage = Join-Path $env:TEMP ("local-ai-monitor-xl-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
try {
  foreach ($item in @("index.html","manifest.json","translation.json","preview.png","resources","scripts","styles","common")) {
    Copy-Item -LiteralPath (Join-Path $Source $item) -Destination $Stage -Recurse -Force
  }

  $htmlPath = Join-Path $Stage "index.html"
  $html = [IO.File]::ReadAllText($htmlPath)
  if (-not $html.StartsWith("<!DOCTYPE html>")) { throw "index.html must start with <!DOCTYPE html>." }
  $headMatch = [regex]::Match($html, '(?s)<head>.*?</head>')
  if (-not $headMatch.Success) { throw "Missing <head>." }
  [xml]$headXml = $headMatch.Value
  if (-not $headXml.head.title) { throw "Missing widget title." }

  $properties = @($headXml.SelectNodes('//meta[@name="x-icue-property"]') | ForEach-Object { $_.content })
  foreach ($node in $headXml.SelectNodes('//script[@id="x-icue-groups"]')) {
    $groups = $node.InnerText | ConvertFrom-Json
    foreach ($group in $groups) {
      if (-not $group.title) { throw "Property group without title." }
      foreach ($property in $group.properties) {
        if ($properties -notcontains $property) { throw "Unknown property in group: $property" }
      }
    }
  }

  $translations = Get-Content -LiteralPath (Join-Path $Stage "translation.json") -Raw | ConvertFrom-Json
  if (-not $translations.en.translation) { throw "translation.json must contain en.translation." }
  $translationKeys = @($translations.en.translation.PSObject.Properties.Name)
  foreach ($match in [regex]::Matches($html, "tr\('([^']+)'\)")) {
    $key = $match.Groups[1].Value
    if ($translationKeys -notcontains $key) { throw "Missing English translation key: $key" }
  }

  foreach ($match in [regex]::Matches($html, '(?:src|href)\s*=\s*["'']([^"'']+)["'']')) {
    $asset = $match.Groups[1].Value
    if ($asset -match '^(https?://|data:|#)') { continue }
    $assetPath = [IO.Path]::GetFullPath((Join-Path $Stage (($asset -split '[?#]')[0])))
    $prefix = [IO.Path]::GetFullPath($Stage).TrimEnd('\') + '\'
    if (-not $assetPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Escaping asset path: $asset" }
    if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) { throw "Missing asset: $asset" }
  }

  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    & $node.Source --check (Join-Path $Stage "scripts\main.js")
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed." }
  }

  & $CliPath validate $Stage
  if ($LASTEXITCODE -ne 0) { throw "icuewidget validate failed." }

  $CliPackage = Join-Path $env:TEMP ("local-ai-monitor-cli-" + [guid]::NewGuid().ToString("N") + ".icuewidget")
  & $CliPath package $Stage --output $CliPackage
  if ($LASTEXITCODE -ne 0) { throw "icuewidget package failed." }

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }
  $zip = [IO.Compression.ZipFile]::Open($Output, [IO.Compression.ZipArchiveMode]::Create)
  try {
    $stageFull = [IO.Path]::GetFullPath($Stage).TrimEnd('\')
    $files = @(Get-ChildItem -LiteralPath $Stage -Recurse -File | ForEach-Object {
      [PSCustomObject]@{ File = $_; Relative = $_.FullName.Substring($stageFull.Length + 1).Replace('\','/') }
    })
    $priority = @("index.html","manifest.json","translation.json","resources/icon.svg")
    $ordered = @()
    foreach ($name in $priority) { $ordered += $files | Where-Object { $_.Relative -eq $name } }
    $ordered += $files | Where-Object { $priority -notcontains $_.Relative } | Sort-Object Relative
    foreach ($item in $ordered) {
      $entry = $zip.CreateEntry($item.Relative, [IO.Compression.CompressionLevel]::Optimal)
      $entryStream = $entry.Open()
      $fileStream = [IO.File]::OpenRead($item.File.FullName)
      try { $fileStream.CopyTo($entryStream) }
      finally { $fileStream.Dispose(); $entryStream.Dispose() }
    }
  } finally { $zip.Dispose() }

  $check = [IO.Compression.ZipFile]::OpenRead($Output)
  try {
    if ($check.Entries.Count -eq 0 -or $check.Entries[0].FullName -ne "index.html") { throw "Final archive does not start with index.html." }
    $expected = @(Get-ChildItem -LiteralPath $Stage -Recurse -File).Count
    if ($check.Entries.Count -ne $expected) { throw "Final archive file-count mismatch." }
  } finally { $check.Dispose() }

  Write-Host "READY: $Output"
  Get-FileHash -LiteralPath $Output -Algorithm SHA256 | Format-List
}
finally {
  if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
}

