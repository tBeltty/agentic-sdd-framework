#!/usr/bin/env node

/**
 * scripts/check-file-size.js
 *
 * Enforces architecture.maxLocPerFile from sdd.config.json on tracked source files.
 * Documentation, data and lockfiles are not counted.
 *
 * Config (sdd.config.json -> architecture):
 *   maxLocPerFile   line limit per source file (default 400; 0 disables the check)
 *   maxLocExclude   path prefixes to skip (for example generated code)
 */

const path = require('path');
const { listFiles, readFiles, isBinary, WORKTREE } = require('./lib/git');
const { loadConfig, getIn } = require('./lib/config');
const { runCheckCli } = require('./lib/cli');

const SOURCE_EXTENSIONS = new Set([
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.vue', '.svelte',
    '.py', '.go', '.rs', '.java', '.kt', '.kts', '.scala', '.rb', '.php', '.cs',
    '.c', '.h', '.cc', '.cpp', '.hpp', '.m', '.swift', '.dart', '.ex', '.exs',
    '.sh', '.bash', '.zsh', '.lua', '.sql'
]);

function countLines(text) {
    if (text.length === 0) return 0;
    const normalized = text.replace(/\r\n?/g, '\n');
    return normalized.split('\n').length - (normalized.endsWith('\n') ? 1 : 0);
}

function run({ root, source = WORKTREE } = {}) {
    const config = loadConfig(root, source);
    const limit = getIn(config, 'architecture.maxLocPerFile', 400);
    if (!limit) {
        return { ok: true, report: '⏭️  File size limit disabled (architecture.maxLocPerFile is 0).' };
    }
    const exclude = getIn(config, 'architecture.maxLocExclude', []);

    const files = listFiles(root, source)
        .filter(f => SOURCE_EXTENSIONS.has(path.extname(f).toLowerCase()))
        .filter(f => !exclude.some(prefix => f.startsWith(prefix)));

    const oversized = [];
    for (const [file, buffer] of readFiles(root, files, source)) {
        if (!buffer || isBinary(buffer)) continue;
        const lines = countLines(buffer.toString('utf8'));
        if (lines > limit) oversized.push({ file, lines });
    }

    if (oversized.length === 0) {
        return { ok: true, report: `✅ ${files.length} source file(s) within ${limit} lines.` };
    }
    const report = [`❌ ${oversized.length} source file(s) exceed architecture.maxLocPerFile (${limit}):\n`];
    for (const { file, lines } of oversized.sort((a, b) => b.lines - a.lines)) {
        report.push(`  - ${file}: ${lines} lines`);
    }
    report.push('\nAction: Split the file by responsibility, or add generated paths to architecture.maxLocExclude.');
    return { ok: false, report: report.join('\n') };
}

if (require.main === module) {
    runCheckCli('📏 Agentic SDD Framework: File Size Limit', run);
}

module.exports = { countLines, run };
