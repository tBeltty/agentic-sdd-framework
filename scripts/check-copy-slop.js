#!/usr/bin/env node

/**
 * scripts/check-copy-slop.js
 *
 * Linter for AI-generated writing clichés, buzzwords, and banned patterns in prose
 * (.md, .mdx, .txt). Code blocks, inline code and table rows are not checked.
 * Inspired by https://github.com/petergyang/no-ai-slop (MIT License).
 *
 * Config (sdd.config.json -> capabilities.noAiSlop):
 *   enabled      false skips the check (default true)
 *   exclude      path prefixes to skip
 *   maxEmDashes  em dashes allowed per file (default 1)
 */

const { repoRoot, listFiles, readFile, isBinary } = require('./lib/git');
const { loadConfig, getIn } = require('./lib/config');
const { BANNED_PATTERNS } = require('./lib/slop-patterns');

const PROSE_EXTENSIONS = ['.md', '.mdx', '.txt'];

// The skill that defines the banned patterns must quote them; vendored skills are
// synced from their upstream repositories and linted there.
const DEFAULT_EXCLUDE = [
    '.agents/skills/no-ai-slop/',
    '.agents/skills/auditor-executor-protocol/'
];

function lintContent(content, { maxEmDashes = 1 } = {}) {
    const violations = [];
    const emDashLines = [];
    let inFence = false;

    content.split('\n').forEach((rawLine, index) => {
        const trimmed = rawLine.trim();
        if (/^(```|~~~)/.test(trimmed)) {
            inFence = !inFence;
            return;
        }
        if (inFence || trimmed.startsWith('|') || /^-{3,}$/.test(trimmed)) return;

        const line = rawLine.replace(/`[^`]*`/g, '``');
        if (line.includes('—')) emDashLines.push(index + 1);

        for (const pattern of BANNED_PATTERNS) {
            const match = line.match(pattern.regex);
            if (match) {
                violations.push({
                    line: index + 1,
                    pattern: pattern.name,
                    matchedText: match[0].trim(),
                    lineText: trimmed.slice(0, 100)
                });
                break;
            }
        }
    });

    if (emDashLines.length > maxEmDashes) {
        violations.push({
            line: emDashLines[0],
            pattern: `Em Dash Overuse (${emDashLines.length} found, max ${maxEmDashes} per file)`,
            matchedText: '—',
            lineText: `lines ${emDashLines.join(', ')}`
        });
    }
    return violations;
}

function run({ root = repoRoot(), staged = false } = {}) {
    const config = loadConfig(root);
    if (getIn(config, 'capabilities.noAiSlop.enabled', true) === false) {
        return { ok: true, report: '⏭️  No-AI-Slop linter disabled in sdd.config.json.' };
    }
    const exclude = [...DEFAULT_EXCLUDE, ...getIn(config, 'capabilities.noAiSlop.exclude', [])];
    const maxEmDashes = getIn(config, 'capabilities.noAiSlop.maxEmDashes', 1);

    const files = listFiles(root, { staged })
        .filter(f => PROSE_EXTENSIONS.some(ext => f.endsWith(ext)))
        .filter(f => !exclude.some(prefix => f.startsWith(prefix)));

    const violations = [];
    for (const file of files) {
        const buffer = readFile(root, file, { staged });
        if (!buffer || isBinary(buffer)) continue;
        for (const v of lintContent(buffer.toString('utf8'), { maxEmDashes })) {
            violations.push({ file, ...v });
        }
    }

    if (violations.length === 0) {
        return { ok: true, report: `✅ Scanned ${files.length} file(s). Zero AI slop patterns detected.` };
    }
    const lines = [`❌ Found ${violations.length} AI writing pattern violation(s):\n`];
    for (const v of violations) {
        lines.push(`  - File: ${v.file}:${v.line}`);
        lines.push(`    Pattern: ${v.pattern}`);
        lines.push(`    Matched: "${v.matchedText}"`);
        lines.push(`    Context: ${v.lineText}\n`);
    }
    lines.push('Action: Rewrite directly without empty filler or binary contrasts.');
    return { ok: false, report: lines.join('\n') };
}

if (require.main === module) {
    console.log('\n======================================================');
    console.log('  ✍️  Agentic SDD Framework: No-AI-Slop Copy Linter');
    console.log('======================================================\n');
    const result = run({ staged: process.argv.includes('--staged') });
    (result.ok ? console.log : console.error)(result.report + '\n');
    process.exit(result.ok ? 0 : 1);
}

module.exports = { lintContent, run };
