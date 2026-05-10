# Enable Stack62 Tier-1 (local-model routing) by installing Ollama and
# pulling llama3.1. Run this once on the backend host. After it's done,
# the Coworker will route simple/searchy chat through your local model
# (free, private) instead of Claude.
#
# Requires: Windows 10/11, internet access. ~5 GB disk for the model.

$ErrorActionPreference = "Stop"

Write-Host "→ Installing Ollama (winget)..." -ForegroundColor Cyan
winget install --id Ollama.Ollama --silent --accept-source-agreements --accept-package-agreements

Write-Host "→ Starting Ollama service..." -ForegroundColor Cyan
Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden

Start-Sleep -Seconds 3

Write-Host "→ Pulling llama3.1 (~4.7 GB)..." -ForegroundColor Cyan
& ollama pull llama3.1

Write-Host ""
Write-Host "✓ Tier 1 ready." -ForegroundColor Green
Write-Host "   Stack62 will pick it up automatically on the next chat (15s health-check cache)."
Write-Host "   To verify: curl http://localhost:11434/api/tags"
