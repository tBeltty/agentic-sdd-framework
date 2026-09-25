#!/usr/bin/env node

/**
 * scripts/verify-no-secrets.js
 *
 * Credential leak scanner. Reads tracked files from the working tree, the index
 * (--staged) or a commit (--ref=<sha>) and reports:
 *   - provider keys and private key blocks (pattern match on content);
 *   - credentials in URLs and high-entropy values assigned to secret-named keys;
 *   - tracked files whose name marks them as secret (.env, id_rsa, *.key, *.p12, ...).
 *
 * A content match is ignored when the matched value is an obvious placeholder, or when
 * the line carries the pragma "sdd-allow-secret"; suppressed lines are counted in the
 * report. A sensitive file name is accepted only when listed in security.allowFiles.
 */

const path = require('path');
const { listFiles, readFiles, isBinary, WORKTREE } = require('./lib/git');
const { loadConfig, getIn } = require('./lib/config');
const { runCheckCli } = require('./lib/cli');

// Shannon entropy in bits per character.
function entropy(value) {
    const counts = {};
    for (const ch of value) counts[ch] = (counts[ch] || 0) + 1;
    return Object.values(counts).reduce((sum, n) => {
        const p = n / value.length;
        return sum - p * Math.log2(p);
    }, 0);
}

// A value assigned to a secret-named key is reported only if it looks like a literal
// secret: letters and digits, high entropy, and not a reference to somewhere else.
function looksLikeLiteralSecret(value) {
    if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return false;
    if (/^[A-Za-z_$][\w$]*(\.[\w$]+)+$/.test(value)) return false; // process.env.X, config.db.password
    if (/^[A-Z0-9_]+$/.test(value)) return false; // CONSTANT_NAME
    if (/^\$|^%|\$\{|\{\{|<[^>]*>/.test(value)) return false; // $VAR, %VAR%, ${VAR}, {{var}}, <value>
    return entropy(value) >= 3.0;
}

// Ordered from most to least specific; the first match on a line wins.
const SECRET_PATTERNS = [
    { name: 'Private Key Block', regex: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
    { name: 'Anthropic API Key', regex: /\bsk-ant-[0-9A-Za-z_-]{20,}/ },
    { name: 'OpenAI API Key', regex: /\bsk-(?:proj|svcacct|admin)-[0-9A-Za-z_-]{20,}/ },
    { name: 'OpenAI Legacy API Key', regex: /\bsk-[0-9A-Za-z]{32,}\b/ },
    { name: 'Stripe Live Key', regex: /\b[rs]k_live_[0-9A-Za-z]{16,}/ },
    { name: 'GitHub Token', regex: /\bgh[pousr]_[0-9A-Za-z]{36}\b/ },
    { name: 'GitHub Fine-Grained Token', regex: /\bgithub_pat_[0-9A-Za-z_]{22,}/ },
    { name: 'Slack Token', regex: /\bxox[abposr]-[0-9A-Za-z-]{10,}/ },
    // Requires both a digit and a letter so identifiers like re_compiled_pattern_list pass.
    { name: 'Resend API Key', regex: /\bre_(?=[A-Za-z_]*\d)(?=[0-9_]*[A-Za-z])[0-9A-Za-z_]{24,}/ },
    { name: 'AWS Access Key ID', regex: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/ },
    { name: 'Google API Key', regex: /\bAIza[0-9A-Za-z_-]{35}/ },
    {
        name: 'Credentials in URL',
        regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:([^\s@/'"]{6,})@/i,
        group: 1,
        accept: value => !/^\$|\$\{|\{\{|<[^>]*>|^\*+$/.test(value)
    },
    {
        name: 'Secret Assignment',
        regex: /(?:^|[^A-Za-z0-9])(?:(?:api|secret|private|access|refresh|auth|client|bearer)[_-]?(?:key|token|secret)|password|passwd|pwd)["']?\s*[:=]\s*["']?([^\s"'`,;()]{12,})/i,
        group: 1,
        accept: looksLikeLiteralSecret
    }
];

// Checked against the matched value only; a placeholder elsewhere on the line does not
// hide a real key.
const SAFE_PLACEHOLDERS = [
    'test_secret', 'test-secret', 'your_api_key', 'your-api-key', 'dummy', 'placeholder',
    'mock_key', 'example', 'xxxxxxxx', 'changeme', 'redacted'
];

const ALLOW_PRAGMA = 'sdd-allow-secret';

const SKIPPED_FILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'verify-no-secrets.js'];

const SENSITIVE_FILES = [
    {
        name: 'Environment file',
        test: base => /^\.env(\..+)?$/.test(base) && !/^\.env\.(example|sample|template|dist|defaults)$/.test(base)
    },
    { name: 'SSH private key', test: base => /^id_(rsa|dsa|ecdsa|ed25519)$/.test(base) },
    { name: 'Key or keystore file', test: base => /\.(key|p12|pfx|jks|keystore|ppk|kdbx)$/i.test(base) }
];

function maskMatch(str) {
    if (str.length <= 8) return '****';
    return str.slice(0, 4) + '...' + str.slice(-4);
}

function scanContent(content) {
    const violations = [];
    let suppressed = 0;
    content.split(/\r?\n/).forEach((line, index) => {
        for (const pattern of SECRET_PATTERNS) {
            const match = line.match(pattern.regex);
            if (!match) continue;
            const value = pattern.group ? match[pattern.group] : match[0];
            if (SAFE_PLACEHOLDERS.some(p => value.toLowerCase().includes(p))) continue;
            if (pattern.accept && !pattern.accept(value)) continue;
            if (line.includes(ALLOW_PRAGMA)) {
                suppressed++;
                break;
            }
            violations.push({ line: index + 1, patternName: pattern.name, snippet: maskMatch(value) });
            break;
        }
    });
    return { violations, suppressed };
}

function sensitiveFileName(file) {
    const rule = SENSITIVE_FILES.find(r => r.test(path.posix.basename(file)));
    return rule ? rule.name : null;
}

// `files` restricts the scan (the pre-push hook passes the files each new commit changed).
function run({ root, source = WORKTREE, files: only = null } = {}) {
    const config = loadConfig(root, source);
    const allowFiles = new Set(getIn(config, 'security.allowFiles', []));
    const files = (only || listFiles(root, source)).filter(f =>
        !f.includes('node_modules/') && !f.endsWith('.lock') && !SKIPPED_FILES.includes(path.posix.basename(f)));

    const violations = [];
    let suppressed = 0;
    for (const file of files) {
        const fileRule = sensitiveFileName(file);
        if (fileRule && !allowFiles.has(file)) {
            violations.push({ file, line: 0, patternName: `Tracked ${fileRule}`, snippet: 'file should not be in git' });
        }
    }
    for (const [file, buffer] of readFiles(root, files, source)) {
        if (!buffer || isBinary(buffer)) continue;
        const result = scanContent(buffer.toString('utf8'));
        suppressed += result.suppressed;
        for (const v of result.violations) violations.push({ file, ...v });
    }

    const suppressedNote = suppressed > 0 ? ` ${suppressed} line(s) suppressed with "${ALLOW_PRAGMA}".` : '';
    if (violations.length === 0) {
        return { ok: true, report: `✅ Scanned ${files.length} files. Zero unmasked secrets found.${suppressedNote}` };
    }
    const lines = ['❌ CRITICAL ERROR: Potential secrets detected in codebase!\n'];
    for (const v of violations) {
        lines.push(`  - File: ${v.file}${v.line ? `:${v.line}` : ''}`);
        lines.push(`    Pattern: ${v.patternName}`);
        lines.push(`    Detected: ${v.snippet}\n`);
    }
    lines.push('Action Required: Move secrets to Tier 3 Vault (~/secrets/<app>/.vault) or environment variables, and remove secret files from git.');
    lines.push(`False positive? Add the comment "${ALLOW_PRAGMA}" to that line, or list the file in security.allowFiles.`);
    if (suppressedNote) lines.push(suppressedNote.trim());
    return { ok: false, report: lines.join('\n') };
}

if (require.main === module) {
    runCheckCli('🔒 Agentic SDD Framework: Secret Leak Scanner', run);
}

module.exports = { SECRET_PATTERNS, entropy, looksLikeLiteralSecret, scanContent, sensitiveFileName, run };
