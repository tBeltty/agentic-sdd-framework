#!/usr/bin/env node

/**
 * scripts/check-copy-slop.js
 * 
 * Linter for AI-generated writing clichés, buzzwords, and banned patterns.
 * Inspired by https://github.com/petergyang/no-ai-slop (MIT License).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BANNED_PATTERNS = [
    {
        name: 'Binary Contrast ("not X, it is Y")',
        regex: /\b(it['’]?s not\b.+?\bit['’]?s\b|it is not\b.+?\bit is\b|no es\b.+?\bes\b)/i
    },
    {
        name: 'Throat-Clearing Opener',
        regex: /\b(here['’]?s the thing|it is worth noting that|it['’]?s worth noting that|cabe destacar que)\b/i
    },
    {
        name: 'Colon Reveal Hook',
        regex: /\b(the best part|lo mejor)\s*:\s*/i
    },
    {
        name: 'AI Buzzword: Delve / Leverage / Streamline / Supercharge',
        regex: /\b(delve|delving|foster|fostering|leverage|leveraging|streamline|streamlining|supercharge|supercharging|paradigm shift|game changer|tapestry)\b/i
    },
    {
        name: 'Fake-Profound Conclusion',
        regex: /\b(the future is already here|in conclusion|el futuro ya est[aá] aqu[ií]|en conclusi[oó]n)\b/i
    }
];

// Files exempt from linting (e.g. the slop detector definitions themselves)
const EXEMPT_FILES = [
    'scripts/check-copy-slop.js',
    '.agents/skills/no-ai-slop/SKILL.md'
];

function getTargetFiles() {
    try {
        const isStagedOnly = process.argv.includes('--staged');
        let cmd = isStagedOnly 
            ? 'git diff --name-only --cached --diff-filter=ACMR'
            : 'git ls-files';
        
        const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        if (!output) return [];
        return output.split('\n')
            .filter(f => f.endsWith('.md') || f.endsWith('.txt') || f.endsWith('.json'))
            .filter(f => !EXEMPT_FILES.some(exempt => f.endsWith(exempt)));
    } catch {
        return [];
    }
}

const files = getTargetFiles();
const violations = [];

files.forEach(file => {
    if (!fs.existsSync(file)) return;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, lineIndex) => {
        // Skip markdown tables or horizontal rules
        if (line.trim().startsWith('|') || line.trim().startsWith('---')) return;

        for (const pattern of BANNED_PATTERNS) {
            const match = line.match(pattern.regex);
            if (match) {
                violations.push({
                    file,
                    line: lineIndex + 1,
                    pattern: pattern.name,
                    matchedText: match[0].trim(),
                    lineText: line.trim().slice(0, 100)
                });
                break;
            }
        }
    });
});

console.log('\n======================================================');
console.log('  ✍️  Agentic SDD Framework: No-AI-Slop Copy Linter');
console.log('======================================================\n');

if (violations.length > 0) {
    console.error(`❌ Found ${violations.length} AI writing pattern violation(s):\n`);
    violations.forEach(v => {
        console.error(`  - File: ${v.file}:${v.line}`);
        console.error(`    Pattern: ${v.pattern}`);
        console.error(`    Matched: "${v.matchedText}"`);
        console.error(`    Context: ${v.lineText}\n`);
    });
    console.error('Action: Rewrite directly without empty filler or binary contrasts.\n');
    process.exit(1);
} else {
    console.log(`✅ Scanned ${files.length} file(s). Zero AI slop patterns detected.\n`);
    process.exit(0);
}
