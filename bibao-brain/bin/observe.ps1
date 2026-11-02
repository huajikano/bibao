$ErrorActionPreference = 'Continue'
$rep = Get-Content "$env:DSH_HOME\bibao\boot-report.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$port = ($rep.consoleUrl -replace '.*127\.0\.0\.1:(\d+).*', '$1')
$tmp = Join-Path $env:TEMP 'bb-obs.txt'
curl.exe -s -c $tmp -o NUL "$($rep.consoleUrl)"
$raw = curl.exe -s -m 20 -b $tmp "http://127.0.0.1:$port/api/bibao/game/auto"
Write-Output $raw
