/**
 * Local secret scanner — Smart Shopping
 *
 * Scans the workspace for likely-secret values and reports ONLY file paths,
 * line numbers, and redacted kinds. NEVER prints the matched value.
 *
 * Patterns (redacted output):
 *   - Google Gemini / generic API keys:   AIza[...], classic API-key shapes
 *   - AWS access keys / private keys
 *   - .=assignments of KEY/SECRET/TOKEN/PASSWORD/HASH
 *   - inline token assignments
 *
 * Usage:
 *   node scripts/scan_secrets.js [path]
 * Exit code 0 = no hits, 2 = secrets found. Use in pre-commit/CI.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || '.');
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', '.tmp-dryrun']);
const MAX_LINE = 4 * 1024 * 1024;

const PATTERNS = [
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_\-]{20,}\b/ },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'aws-secret',     re: /aws_secret_access_key\s*=\s*['"][^'"]{20,}['"]/i },
  { name: 'private-key',    re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'generic-secret', re: /(['"]?)((?:api|gemini|admin_secret|auth|fb_capi|recovery|bearer)?_?(?:api_?key|secret|token|password))\1\s*[:=]\s*['"][^'"]{16,}['"]/i },
  { name: 'bearer-token',   re: /\bBearer\s+[A-Za-z0-9_\-\.=]{20,}/i },
];

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, out); continue; }
    if (out.files >= 2000) return out;
    let size;
    try { size = fs.statSync(full).size; } catch { continue; }
    if (size > MAX_LINE) continue;
    scanFile(full, out);
  }
  return out;
}

function scanFile(full, out) {
  let text;
  try { text = fs.readFileSync(full, 'utf8'); } catch { try { text = fs.readFileSync(full, 'latin1'); } catch { return; } }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of PATTERNS) {
      if (p.re.test(line)) {
        out.files++;
        out.hits.push({ file: full.replace(ROOT + path.sep, ''), line: i + 1, kind: p.name });
        break;
      }
    }
  }
}

const out = { files: 0, hits: [] };
walk(ROOT, out);

for (const h of out.hits) {
  // redacted line content: only show matched kind + line number
  console.log(`${h.kind.padEnd(16)} ${h.file}:${h.line}`);
}

if (out.hits.length === 0) {
  console.log('SECRET_SCAN: 0 hits (clean)');
  process.exit(0);
} else {
  console.log(`SECRET_SCAN: ${out.hits.length} hit(s) — review/redact before commit`);
  process.exit(2);
}