#!/usr/bin/env node

/**
 * scripts/check-spec.js
 *
 * Verifies that the active specification backs its claims with evidence.
 *
 * Lite mode (docs/SPEC.md):
 *   - The "Verification Gate" section exists.
 *   - Every checked task has pasted evidence.
 *   - Status "In Progress" or "Completed": the verification command and expected
 *     output are filled in, not template placeholders.
 *   - Status "Completed": every task is checked and "Last Verified" records a PASS
 *     (written by `sdd-verify --record`).
 *
 * Rigor mode (docs/roadmap/): delegates to `auditkit lint`, which cross-checks the
 * execution guide against the compliance log and rejects DONE reports without
 * pasted verify output. Install: pipx install git+https://github.com/tBeltty/auditor-executor-protocol
 *
 * Config (sdd.config.json -> specification):
 *   mode         lite | rigor
 *   specFile     Lite spec path (default docs/SPEC.md)
 *   roadmapDir   Rigor document directory (default docs/roadmap)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { repoRoot, readFile } = require('./lib/git');
const { loadConfig, getIn } = require('./lib/config');
const { parseSpec } = require('./lib/spec');

const AUDITKIT_INSTALL = 'pipx install git+https://github.com/tBeltty/auditor-executor-protocol';

function lintLiteSpec(text) {
    const spec = parseSpec(text);
    const problems = [];
    const status = spec.status || 'draft';

    if (!spec.gate) {
        problems.push('No "Verification Gate" section. Every specification needs one.');
    }
    for (const task of spec.tasks.filter(t => t.checked && !t.evidence)) {
        problems.push(`${task.id} is checked but has no evidence. Paste the command you ran and its output under **Evidence:**.`);
    }
    if (spec.gate && status !== 'draft') {
        if (!spec.gate.command) problems.push(`Status is "${status}" but the verification command is still a placeholder.`);
        if (!spec.gate.expected) problems.push(`Status is "${status}" but the expected output is still a placeholder.`);
    }
    if (status === 'completed') {
        for (const task of spec.tasks.filter(t => !t.checked)) {
            problems.push(`Status is "completed" but ${task.id} is not checked.`);
        }
        if (spec.gate && !/\bPASS\b/.test(spec.gate.lastVerified)) {
            problems.push('Status is "completed" but "Last Verified" has no PASS. Run sdd-verify --record.');
        }
    }
    return { status, spec, problems };
}

function runAuditkit(root, roadmapDir) {
    const bin = process.env.SDD_AUDITKIT || 'auditkit';
    const result = spawnSync(bin, ['lint', roadmapDir], { cwd: root, encoding: 'utf8' });
    if (result.error && result.error.code === 'ENOENT') {
        return {
            ok: false,
            report: `❌ Rigor mode is checked by auditkit, which is not installed.\nInstall it with: ${AUDITKIT_INSTALL}`
        };
    }
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    return {
        ok: result.status === 0,
        report: `${result.status === 0 ? '✅' : '❌'} auditkit lint ${roadmapDir}\n${output}`
    };
}

function run({ root = repoRoot(), staged = false } = {}) {
    const config = loadConfig(root);
    const type = getIn(config, 'project.type', 'application');
    const mode = getIn(config, 'specification.mode', 'lite');
    if (type === 'framework') {
        return { ok: true, report: '⏭️  Not applicable (the framework repository has no project specification).' };
    }

    if (mode === 'rigor') {
        const roadmapDir = getIn(config, 'specification.roadmapDir', 'docs/roadmap');
        if (!fs.existsSync(path.join(root, roadmapDir, 'execution-guide.md'))) {
            return { ok: false, report: `❌ Rigor mode: ${roadmapDir}/execution-guide.md not found. Run sdd-init --mode=rigor.` };
        }
        return runAuditkit(root, roadmapDir);
    }

    const specFile = getIn(config, 'specification.specFile', 'docs/SPEC.md');
    const buffer = readFile(root, specFile, { staged });
    if (!buffer) {
        return { ok: false, report: `❌ Lite mode: ${specFile} not found. Run sdd-init or create it from docs/SPEC_TEMPLATE.md.` };
    }
    const { status, spec, problems } = lintLiteSpec(buffer.toString('utf8'));
    const done = spec.tasks.filter(t => t.checked).length;
    const summary = `${specFile}: status "${status}", ${done}/${spec.tasks.length} task(s) checked`;
    if (problems.length === 0) {
        return { ok: true, report: `✅ ${summary}.` };
    }
    return {
        ok: false,
        report: [`❌ ${summary}, ${problems.length} problem(s):\n`, ...problems.map(p => `  - ${p}`)].join('\n')
    };
}

if (require.main === module) {
    console.log('\n======================================================');
    console.log('  📋 Agentic SDD Framework: Specification Check');
    console.log('======================================================\n');
    const result = run({ staged: process.argv.includes('--staged') });
    (result.ok ? console.log : console.error)(result.report + '\n');
    process.exit(result.ok ? 0 : 1);
}

module.exports = { lintLiteSpec, run };
