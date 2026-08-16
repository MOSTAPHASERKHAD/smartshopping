<#
.SYNOPSIS
  Secure, owner-run provisioning of the CUSTOMER_PEPPER Worker secret.

.DESCRIPTION
  This script exists ONLY to let the repository owner push the REAL legacy
  customer_pepper value (currently stored in the original Google Apps Script
  project's PropertiesService / Script Properties under the key
  "customer_pepper") into Cloudflare Workers as a secret, WITHOUT that value
  ever touching:
    - the terminal history / process list (no command-line argument)
    - any log file
    - any file on disk (nothing is written before or after provisioning)
    - this chat/session transcript
    - git (this script itself contains no secret material)

  It does NOT invent, derive, or guess the pepper. It does NOT read the
  secret back after setting it (Cloudflare secrets are write-only via the
  API/CLI). It only verifies success by SECRET NAME, using
  `wrangler secret list`.

.NOTES
  - Requires PowerShell 5.1+ (Windows) with `wrangler` available on PATH
    (or run from cloudflare-worker/ with `npx wrangler`).
  - Run this manually. It is never invoked automatically by any agent,
    build step, or CI pipeline.
  - Defaults to STAGING. Production requires the explicit -Environment
    Production flag AND a typed confirmation, so it can never be provisioned
    by accident.

.PARAMETER Environment
  "Staging" (default) or "Production". Selects which Worker environment
  receives the secret.

.EXAMPLE
  # From cloudflare-worker/
  .\scripts\provision_customer_pepper.ps1 -Environment Staging

.EXAMPLE
  .\scripts\provision_customer_pepper.ps1 -Environment Production
#>

[CmdletBinding()]
param(
    [ValidateSet('Staging', 'Production')]
    [string]$Environment = 'Staging'
)

$ErrorActionPreference = 'Stop'

function Write-Section($text) {
    Write-Host ''
    Write-Host "== $text ==" -ForegroundColor Cyan
}

# ── 0. Locate wrangler & confirm working directory ──
Write-Section 'Phase 3B — CUSTOMER_PEPPER Secure Provisioning'

$wranglerCmd = Get-Command wrangler -ErrorAction SilentlyContinue
if (-not $wranglerCmd) {
    Write-Host 'wrangler not found on PATH; will use "npx wrangler" instead.' -ForegroundColor Yellow
    $wranglerExe = 'npx'
    $wranglerBaseArgs = @('wrangler')
} else {
    $wranglerExe = 'wrangler'
    $wranglerBaseArgs = @()
}

if (-not (Test-Path './wrangler.toml')) {
    throw 'wrangler.toml not found in current directory. Run this script from cloudflare-worker/.'
}

$secretName = 'CUSTOMER_PEPPER'
$envArgs = @()
$targetLabel = 'PRODUCTION (smart-shopping-api)'
if ($Environment -eq 'Staging') {
    $envArgs = @('--env', 'staging')
    $targetLabel = 'STAGING (smart-shopping-api-staging)'
}

Write-Host "Target: $targetLabel"
Write-Host "Secret name: $secretName"

# ── 1. Hard guard for Production ──
if ($Environment -eq 'Production') {
    Write-Host ''
    Write-Host 'WARNING: You are about to write a secret to the PRODUCTION Worker.' -ForegroundColor Red
    Write-Host 'This does NOT deploy code and does NOT touch D1 data, but it DOES' -ForegroundColor Red
    Write-Host 'change production auth behavior for p1: customer accounts.' -ForegroundColor Red
    $confirm = Read-Host 'Type EXACTLY "PROVISION PRODUCTION" to continue (anything else aborts)'
    if ($confirm -ne 'PROVISION PRODUCTION') {
        Write-Host 'Aborted. No changes made.' -ForegroundColor Yellow
        exit 1
    }
}

# ── 2. Prompt for the secret with no echo (SecureString) ──
Write-Section 'Enter the real customer_pepper value'
Write-Host 'This value is normally found in the ORIGINAL Google Apps Script project:'
Write-Host '  Apps Script Editor -> Project Settings -> Script Properties -> "customer_pepper"'
Write-Host 'The value is NEVER displayed, logged, or written to disk by this script.'
Write-Host ''

$secure1 = Read-Host -Prompt 'CUSTOMER_PEPPER value' -AsSecureString
$secure2 = Read-Host -Prompt 'Confirm CUSTOMER_PEPPER value' -AsSecureString

# Convert only transiently, in-memory, to compare + validate + pipe to wrangler.
$bstr1 = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure1)
$bstr2 = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure2)
try {
    $plain1 = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr1)
    $plain2 = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr2)

    # ── 3. Structural validation ONLY (never semantic/guessing) ──
    if ($plain1 -ne $plain2) {
        throw 'The two entries did not match. Aborted, nothing sent.'
    }
    if ([string]::IsNullOrWhiteSpace($plain1)) {
        throw 'Empty value. Aborted, nothing sent.'
    }
    if ($plain1 -ne $plain1.Trim()) {
        throw 'Value has leading/trailing whitespace, which almost certainly does not match the original pepper. Aborted.'
    }
    if ($plain1.Length -lt 8 -or $plain1.Length -gt 256) {
        throw "Unexpected length ($($plain1.Length) chars) for a pepper value. Expected roughly 8-256 chars (GAS Utilities.getUuid() is 36). Aborted."
    }

    Write-Host ''
    Write-Host "Structural validation passed (length=$($plain1.Length), no whitespace, values match)." -ForegroundColor Green
    Write-Host 'The value itself will never be printed.' -ForegroundColor Green

    # ── 4. Final go/no-go ──
    $go = Read-Host "Proceed to write this secret to $targetLabel via 'wrangler secret put'? (yes/no)"
    if ($go -ne 'yes') {
        Write-Host 'Aborted by user. No changes made.' -ForegroundColor Yellow
        exit 1
    }

    # ── 5. Pipe securely to wrangler via STDIN (never as a CLI argument) ──
    Write-Section "Provisioning $secretName"
    $putArgs = $wranglerBaseArgs + @('secret', 'put', $secretName) + $envArgs

    # Use PowerShell's native pipeline to send the value to the child
    # process's stdin. This avoids System.Diagnostics.ProcessStartInfo's
    # ArgumentList property, which only exists on .NET Core (PowerShell 7+)
    # and is NULL on Windows PowerShell 5.1 (.NET Framework), and works
    # identically on both. The value is never passed as a CLI argument and
    # never appears in this process's argument list or command history
    # (only the variable reference is in history, not its runtime value).
    $LASTEXITCODE = 0
    $plain1 | & $wranglerExe @putArgs
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        throw "wrangler secret put exited with code $exitCode."
    }

    Write-Host "$secretName submitted to $targetLabel." -ForegroundColor Green
}
finally {
    # ── 6. Cleanup: scrub plaintext copies from memory ASAP ──
    if ($bstr1) { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr1) }
    if ($bstr2) { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr2) }
    Remove-Variable -Name plain1, plain2 -ErrorAction SilentlyContinue
    [System.GC]::Collect()
}

# ── 7. Verify by NAME ONLY (never read the value back) ──
Write-Section 'Verifying by name only'
$listArgs = $wranglerBaseArgs + @('secret', 'list') + $envArgs
& $wranglerExe @listArgs

Write-Host ''
Write-Host 'Done. Only secret NAMES are shown above; no value was ever displayed, logged, or written to a file.' -ForegroundColor Green
Write-Host 'No temporary files were created by this script (nothing to clean up).' -ForegroundColor Green
