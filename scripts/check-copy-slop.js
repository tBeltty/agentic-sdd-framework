#!/usr/bin/env node

/**
 * scripts/check-copy-slop.js
 *
 * Linter for AI-generated writing cliches, buzzwords, and banned patterns in prose
 * (.md, .mdx, .txt). Code blocks, inline code and table rows are not checked.
 * Inspired by https://github.com/petergyang/no-ai-slop (MIT License).
 *
 * Config (sdd.config.json -> capabilities.noAiSlop):
 *   enabled      false skips the check (default true)
 *   exclude      path prefixes to skip
 *   maxEmDashes  em dashes allowed per file, counted individually (default 1)
 */

const { listFiles, readFiles, isBinary, WORKTREE } = require('./lib/git');
const { loadConfig, getIn } = require('./lib/config');
const { runCheckCli } = require('./lib/cli');
const { normalizeEol, createFenceTracker } = require('./lib/markdown');
const { BANNED_PATTERNS } = require('./lib/slop-patterns');

const PROSE_EXTENSIONS = ['.md', '.mdx', '.txt'];

// The skill that defines the banned patterns must quote them; vendored skills and the
// Rigor templates are synced from their upstream repositories and linted there. Rigor
// documents (specification.roadmapDir) are records in the protocol's format and hold
// pasted command output.
// sdd-init copies the skills into .claude/skills/ where symlinks are unavailable (Windows
// without Developer Mode), so those copies are excluded too.
const DEFAULT_EXCLUDE = [
    '.agents/skills/no-ai-slop/',
    '.agents/skills/auditor-executor-protocol/',
    '.claude/skills/no-ai-slop/',
    '.claude/skills/auditor-executor-protocol/',
    'docs/roadmap/templates/'
];

function lintContent(content, { maxEmDashes = 1 } = {}) {
    const violations = [];
    const emDashLines = [];
    let emDashes = 0;
    const fence = createFenceTracker();

    normalizeEol(content).split('\n').forEach((rawLine, index) => {
        const trimmed = rawLine.trim();
        if (fence.update(rawLine) || fence.inside) return;
        if (trimmed.startsWith('|') || /^-{3,}$/.test(trimmed)) return;

        const line = rawLine.replace(/`[^`]*`/g, '``');
        const dashes = (line.match(/—/g) || []).length;
        if (dashes > 0) {
            emDashes += dashes;
            emDashLines.push(index + 1);
        }

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

    if (emDashes > maxEmDashes) {
        violations.push({
            line: emDashLines[0],
            pattern: `Em Dash Overuse (${emDashes} found, max ${maxEmDashes} per file)`,
            matchedText: '—',
            lineText: `lines ${emDashLines.join(', ')}`
        });
    }
    return violations;
}

function run({ root, source = WORKTREE } = {}) {
    const config = loadConfig(root, source);
    if (getIn(config, 'capabilities.noAiSlop.enabled', true) === false) {
        return { ok: true, report: '⏭️  No-AI-Slop linter disabled in sdd.config.json.' };
    }
    const roadmapDir = `${getIn(config, 'specification.roadmapDir', 'docs/roadmap').replace(/\/+$/, '')}/`;
    const exclude = [...DEFAULT_EXCLUDE, roadmapDir, ...getIn(config, 'capabilities.noAiSlop.exclude', [])];
    const maxEmDashes = getIn(config, 'capabilities.noAiSlop.maxEmDashes', 1);

    const files = listFiles(root, source)
        .filter(f => PROSE_EXTENSIONS.some(ext => f.endsWith(ext)))
        .filter(f => !exclude.some(prefix => f.startsWith(prefix)));

    const violations = [];
    for (const [file, buffer] of readFiles(root, files, source)) {
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
    runCheckCli('✍️  Agentic SDD Framework: No-AI-Slop Copy Linter', run);
}

module.exports = { lintContent, run };
