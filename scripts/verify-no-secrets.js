#!/usr/bin/env node

/**
 * scripts/verify-no-secrets.js
 * 
 * Pre-commit / CI Credential Leak Scanner
 * Scans git staged or tracked files for exposed API keys, private keys,
 * and high-entropy credentials before code can be committed or pushed.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Patterns that identify potential credentials
const SECRET_PATTERNS = [
    { name: 'Private Key Block', regex: /-----BEGIN\s+([A-Z\s]+)?PRIVATE\s+KEY-----/ },
    { name: 'OpenAI / Stripe Live Key', regex: /sk_live_[0-9a-zA-Z]{16,}/ },
    { name: 'Anthropic API Key', regex: /sk-ant-api[0-9a-zA-Z_-]{20,}/ },
    { name: 'GitHub Personal Token', regex: /gh[pousr]_[0-9a-zA-Z]{36}/ },
    { name: 'Resend API Key', regex: /re_[0-9a-zA-Z]{24,}/ },
    { name: 'AWS Access Key ID', regex: /\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/ },
    { name: 'Google API Key', regex: /AIza[0-9A-Za-z\\-_]{35}/ },
    { name: 'Generic Live Secret Token', regex: /(api[_-]?key|secret[_-]?key|auth[_-]?token)\s*[:=]\s*['"][0-9a-zA-Z_-]{24,}['"]/i }
];

// Whitelist of harmless placeholders and test fixtures
const SAFE_PLACEHOLDERS = [
    'test_secret', 'test-secret', 'ci_test_secret', 'YOUR_API_KEY',
    'sk_live_dummy', 'placeholder', 'mock_key', 'example_key'
];

function getFilesToScan() {
    try {
        const isStagedOnly = process.argv.includes('--staged');
        let cmd = isStagedOnly 
            ? 'git diff --name-only --cached --diff-filter=ACMR'
            : 'git ls-files';
        
        const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        if (!output) return [];
        return output.split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

function maskMatch(str) {
    if (str.length <= 8) return '****';
    return str.slice(0, 4) + '...' + str.slice(-4);
}

const files = getFilesToScan();
const violations = [];

files.forEach(file => {
    // Skip binary files, lockfiles, node_modules, and verification scripts themselves
    if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.lock') || 
        file.endsWith('package-lock.json') || file.includes('node_modules') || 
        file === 'scripts/verify-no-secrets.js') {
        return;
    }

    if (!fs.existsSync(file)) return;

    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, lineIndex) => {
        // Skip lines that contain deliberate safe test placeholders
        const isSafe = SAFE_PLACEHOLDERS.some(placeholder => line.includes(placeholder));
        if (isSafe) return;

        for (const pattern of SECRET_PATTERNS) {
            const match = line.match(pattern.regex);
            if (match) {
                violations.push({
                    file,
                    line: lineIndex + 1,
                    patternName: pattern.name,
                    snippet: maskMatch(match[0])
                });
                break;
            }
        }
    });
});

console.log('\n======================================================');
console.log('  🔒 Agentic SDD Framework: Secret Leak Scanner');
console.log('======================================================\n');

if (violations.length > 0) {
    console.error('❌ CRITICAL ERROR: Potential secrets detected in codebase!\n');
    violations.forEach(v => {
        console.error(`  - File: ${v.file}:${v.line}`);
        console.error(`    Pattern: ${v.patternName}`);
        console.error(`    Detected: ${v.snippet}\n`);
    });
    console.error('Action Required: Move secrets to Tier 3 Vault (~/secrets/.vault) or environment variables before committing.\n');
    process.exit(1);
} else {
    console.log(`✅ Scanned ${files.length} files. Zero unmasked secrets found.\n`);
    process.exit(0);
}
