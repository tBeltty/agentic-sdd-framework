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

// Ordered from most to least specific; every match of every pattern on a line is checked,
// so a placeholder earlier on the line cannot hide a real key later on it.
const SECRET_PATTERNS = [
    { name: 'Private Key Block', regex: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
    { name: 'Anthropic API Key', regex: /\bsk-ant-[0-9A-Za-z_-]{20,}/g },
    { name: 'OpenAI API Key', regex: /\bsk-(?:proj|svcacct|admin)-[0-9A-Za-z_-]{20,}/g },
    { name: 'OpenAI Legacy API Key', regex: /\bsk-[0-9A-Za-z]{32,}\b/g },
    { name: 'Stripe Live Key', regex: /\b[rs]k_live_[0-9A-Za-z]{16,}/g },
    { name: 'GitHub Token', regex: /\bgh[pousr]_[0-9A-Za-z]{36}\b/g },
    { name: 'GitHub Fine-Grained Token', regex: /\bgithub_pat_[0-9A-Za-z_]{22,}/g },
    { name: 'Slack Token', regex: /\bxox[abposr]-[0-9A-Za-z-]{10,}/g },
    // Requires both a digit and a letter so identifiers like re_compiled_pattern_list pass.
    { name: 'Resend API Key', regex: /\bre_(?=[A-Za-z_]*\d)(?=[0-9_]*[A-Za-z])[0-9A-Za-z_]{24,}/g },
    { name: 'AWS Access Key ID', regex: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g },
    { name: 'Google API Key', regex: /\bAIza[0-9A-Za-z_-]{35}/g },
    {
        name: 'Credentials in URL',
        regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:([^\s@/'"]{6,})@/gi,
        group: 1,
        accept: value => !isReference(value) && !/^\*+$/.test(value)
    }
];

// Keys whose value is a secret: ends in secret, token, password, pwd, api key, private or
// access key, or credential(s). `max_tokens` or `tokenizer` do not match.
const SECRET_KEY_RE = /(?:^|[^A-Za-z0-9_])([A-Za-z0-9_.-]*?(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|private[_-]?key|access[_-]?key|credentials?))["']?\s*[:=]\s*(.*)$/i;
const PASSWORD_KEY_RE = /passw(?:or)?d|pwd|secret|credential/i;
// Files where an unquoted value is a literal (KEY=value), not a code expression.
const CONFIG_FILE_RE = /(^|\/)\.env(\.[^/]*)?$|\.(env|ini|cfg|conf|properties|toml|ya?ml|json)$/i;

// Shannon entropy in bits per character.
function entropy(value) {
    const counts = {};
    for (const ch of value) counts[ch] = (counts[ch] || 0) + 1;
    return Object.values(counts).reduce((sum, n) => {
        const p = n / value.length;
        return sum - p * Math.log2(p);
    }, 0);
}

// $VAR, ${VAR}, %VAR%, {{var}}, <value>, process.env.X, os.environ[...]
function isReference(value) {
    return /^\$|\$\{|^%\w+%$|\{\{|<[^>]*>|process\.env|os\.environ|getenv/.test(value);
}

// Checked against the matched value only; a placeholder elsewhere on the line does not
// hide a real key.
const SAFE_PLACEHOLDERS = [
    'test_secret', 'test-secret', 'your_api_key', 'your-api-key', 'dummy', 'placeholder',
    'mock_key', 'example', 'xxxxxxxx', 'changeme', 'redacted', 'fake', 'sample'
];
const isPlaceholder = value => SAFE_PLACEHOLDERS.some(p => value.toLowerCase().includes(p))
    || /^(password|secret|token|none|null|undefined|true|false)$/i.test(value);

// The literal assigned to a secret-named key, if any. In code, only quoted values are
// literals (an unquoted value is an expression such as a call or a variable); in config
// files, an unquoted value is a literal too.
function secretAssignment(line, { configFile }) {
    const match = line.match(SECRET_KEY_RE);
    if (!match) return null;
    const [, key, rest] = match;
    const quoted = rest.match(/^(["'`])((?:\\.|(?!\1).)*)\1/);
    let value;
    if (quoted) value = quoted[2];
    // `#` starts a comment only after whitespace (dotenv, YAML), so it can be part of a value.
    else if (configFile) value = (rest.match(/^\S+/) || [''])[0].replace(/[,;]$/, '');
    else return null;
    if (value.length < 8 || isPlaceholder(value) || isReference(value)) return null;
    if (/\s/.test(value)) return null; // prose, not a credential
    // Passwords can be low-entropy words; tokens and keys must look random.
    if (!PASSWORD_KEY_RE.test(key) && (value.length < 16 || entropy(value) < 3.0)) return null;
    return { key, value };
}

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

function findInLine(line, options) {
    for (const pattern of SECRET_PATTERNS) {
        for (const match of line.matchAll(pattern.regex)) {
            const value = pattern.group ? match[pattern.group] : match[0];
            if (isPlaceholder(value)) continue;
            if (pattern.accept && !pattern.accept(value)) continue;
            return { patternName: pattern.name, value };
        }
    }
    const assignment = secretAssignment(line, options);
    return assignment ? { patternName: 'Secret Assignment', value: assignment.value } : null;
}

// `file` (a repository path) decides whether unquoted values count as literals.
function scanContent(content, { file = '' } = {}) {
    const options = { configFile: CONFIG_FILE_RE.test(file) };
    const violations = [];
    let suppressed = 0;
    content.split(/\r?\n/).forEach((line, index) => {
        const hit = findInLine(line, options);
        if (!hit) return;
        if (line.includes(ALLOW_PRAGMA)) {
            suppressed++;
            return;
        }
        violations.push({ line: index + 1, patternName: hit.patternName, snippet: maskMatch(hit.value) });
    });
    return { violations, suppressed };
}

// Text to scan from a file's bytes. UTF-16 files are decoded; other binary files are
// reduced to their printable runs (like `strings`), so a NUL byte cannot hide a secret.
function textOf(buffer) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return Buffer.from(buffer.subarray(2)).swap16().toString('utf16le');
    if (!isBinary(buffer)) return buffer.toString('utf8');
    return (buffer.toString('latin1').match(/[\x20-\x7e]{8,}/g) || []).join('\n');
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
        if (!buffer) continue;
        const result = scanContent(textOf(buffer), { file });
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

module.exports = { SECRET_PATTERNS, entropy, secretAssignment, scanContent, sensitiveFileName, textOf, run };
