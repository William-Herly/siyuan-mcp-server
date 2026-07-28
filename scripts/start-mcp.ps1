$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $repoRoot "dist/index.js"

npm --prefix $repoRoot run build

node $entry
