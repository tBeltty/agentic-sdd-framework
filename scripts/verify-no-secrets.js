#!/usr/bin/env node

/**
 * scripts/verify-no-secrets.js
 *
 * Pre-commit / CI Credential Leak Scanner
 * Scans git staged or tracked files for exposed API keys, private keys,
 * and high-entropy credentials before code can be committed or pushed.
 *
 * A match is ignored when the matched value is an obvious placeholder, or when the
 * line carries the explicit pragma "sdd-allow-secret".
 */

const path = require('path');
const { repoRoot, listFiles, readFile, isBinary } = require('./lib/git');

// Ordered from most to least specific; the first match on a line wins.
const SECRET_PATTERNS = [
    { name: 'Private Key Block', regex: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/ },
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
    { name: 'Generic Live Secret Token', regex: /(?:api[_-]?key|secret[_-]?key|auth[_-]?token)\s*[:=]\s*['"][0-9A-Za-z_-]{24,}['"]/i }
];

// Checked against the matched value only; a placeholder elsewhere on the line does not
// hide a real key.
const SAFE_PLACEHOLDERS = [
    'test_secret', 'test-secret', 'your_api_key', 'dummy', 'placeholder',
    'mock_key', 'example', 'xxxxxxxx'
];

const ALLOW_PRAGMA = 'sdd-allow-secret';

const SKIPPED_FILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'verify-no-secrets.js'];

function maskMatch(str) {
    if (str.length <= 8) return '****';
    return str.slice(0, 4) + '...' + str.slice(-4);
}

function scanContent(content) {
    const violations = [];
    content.split('\n').forEach((line, index) => {
        if (line.includes(ALLOW_PRAGMA)) return;
        for (const pattern of SECRET_PATTERNS) {
            const match = line.match(pattern.regex);
            if (!match) continue;
            const value = match[0].toLowerCase();
            if (SAFE_PLACEHOLDERS.some(p => value.includes(p))) continue;
            violations.push({ line: index + 1, patternName: pattern.name, snippet: maskMatch(match[0]) });
            break;
        }
    });
    return violations;
}

function run({ root = repoRoot(), staged = false } = {}) {
    const files = listFiles(root, { staged }).filter(f =>
        !f.includes('node_modules/') && !f.endsWith('.lock') && !SKIPPED_FILES.includes(path.basename(f)));

    const violations = [];
    for (const file of files) {
        const buffer = readFile(root, file, { staged });
        if (!buffer || isBinary(buffer)) continue;
        for (const v of scanContent(buffer.toString('utf8'))) {
            violations.push({ file, ...v });
        }
    }

    if (violations.length === 0) {
        return { ok: true, report: `✅ Scanned ${files.length} files. Zero unmasked secrets found.` };
    }
    const lines = ['❌ CRITICAL ERROR: Potential secrets detected in codebase!\n'];
    for (const v of violations) {
        lines.push(`  - File: ${v.file}:${v.line}`);
        lines.push(`    Pattern: ${v.patternName}`);
        lines.push(`    Detected: ${v.snippet}\n`);
    }
    lines.push('Action Required: Move secrets to Tier 3 Vault (~/secrets/<app>/.vault) or environment variables before committing.');
    lines.push(`False positive? Add the comment "${ALLOW_PRAGMA}" to that line.`);
    return { ok: false, report: lines.join('\n') };
}

if (require.main === module) {
    console.log('\n======================================================');
    console.log('  🔒 Agentic SDD Framework: Secret Leak Scanner');
    console.log('======================================================\n');
    const result = run({ staged: process.argv.includes('--staged') });
    (result.ok ? console.log : console.error)(result.report + '\n');
    process.exit(result.ok ? 0 : 1);
}

module.exports = { SECRET_PATTERNS, scanContent, run };
