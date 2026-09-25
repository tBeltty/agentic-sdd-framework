#!/usr/bin/env node

/**
 * scripts/quality-gate.js
 *
 * Runs every quality gate check in a single process and exits 1 if any fails.
 * Used by the pre-push hook and CI. Environment diagnostics are not part of the
 * gate: run check-system-prerequisites.js once during setup instead.
 *
 * Usage: node scripts/quality-gate.js [--staged]
 */

const { repoRoot } = require('./lib/git');

const CHECKS = [
    { title: '🔒 Secret Leak Scanner', module: require('./verify-no-secrets') },
    { title: '✍️  No-AI-Slop Copy Linter', module: require('./check-copy-slop') },
    { title: '📏 File Size Limit', module: require('./check-file-size') },
    { title: '📋 Specification Check', module: require('./check-spec') },
    { title: '🏷️  Version Sync Check', module: require('./check-versions') }
];

function run({ root = repoRoot(), staged = false, log = console.log } = {}) {
    const failed = [];
    for (const check of CHECKS) {
        let result;
        try {
            result = check.module.run({ root, staged });
        } catch (error) {
            result = { ok: false, report: `❌ Check crashed: ${error.message}` };
        }
        log(`\n--- ${check.title} ---\n${result.report}`);
        if (!result.ok) failed.push(check.title.replace(/^\S+\s+/, ''));
    }
    return { ok: failed.length === 0, failed };
}

if (require.main === module) {
    console.log('\n======================================================');
    console.log('  🚦 Agentic SDD Framework: Quality Gate');
    console.log('======================================================');
    const result = run({ staged: process.argv.includes('--staged') });
    if (result.ok) {
        console.log('\n✅ Quality gate passed.\n');
        process.exit(0);
    }
    console.error(`\n❌ Quality gate failed: ${result.failed.join(', ')}.\n`);
    process.exit(1);
}

module.exports = { CHECKS, run };
