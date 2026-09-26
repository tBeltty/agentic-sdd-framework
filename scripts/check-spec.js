#!/usr/bin/env node

/**
 * scripts/check-spec.js
 *
 * Verifies that the active specification backs its claims with evidence.
 *
 * Lite mode (docs/SPEC.md):
 *   - "**Status:**" is Draft, In Progress, or Completed (the untouched template counts as
 *     Draft; anything else is an error).
 *   - The "Verification Gate" section exists.
 *   - Every checked task has evidence. Evidence recorded by `sdd-verify --task` must be
 *     intact (its hash matches) and exit 0. Hand-written evidence is reported as manual,
 *     and rejected when specification.requireRecordedEvidence is true.
 *   - In Progress / Completed: the verification command and expected output are real.
 *   - Completed: every task is checked, and "Last Verified" is a PASS recorded by
 *     `sdd-verify --record` whose state fingerprint matches the state the spec was
 *     completed in (see lib/state.js).
 *
 * Rigor mode (docs/roadmap/): delegates to `auditkit lint` (>= MIN_AUDITKIT), run on the
 * documents read from the same source as every other check.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readFile, readFiles, listTrackedFiles, describeSource, WORKTREE } = require('./lib/git');
const { loadConfig, getIn } = require('./lib/config');
const { runCheckCli } = require('./lib/cli');
const { parseSpec } = require('./lib/spec');
const { stateOf, referenceSourceFor } = require('./lib/state');

const AUDITKIT_INSTALL = 'pipx install git+https://github.com/tBeltty/auditor-executor-protocol';
const MIN_AUDITKIT = [0, 3, 7];

function lintLiteSpec(text, { requireRecordedEvidence = false, expectedState = null, shallow = false } = {}) {
    const spec = parseSpec(text);
    const problems = [];
    const notes = [];
    // An unknown status is reported as a problem and otherwise held to the draft rules.
    const status = spec.status || 'draft';
    const shownStatus = spec.statusProblem && spec.statusProblem.startsWith('Unknown') ? 'unknown' : status;

    problems.push(...spec.hiddenProblems);
    if (spec.statusProblem) problems.push(spec.statusProblem);
    if (!spec.gate) problems.push('No "Verification Gate" section. Every specification needs one.');

    let manual = 0;
    for (const task of spec.tasks.filter(t => t.checked)) {
        const { text: evidence, recorded } = task.evidence;
        if (!evidence) {
            const how = task.id.startsWith('line ')
                ? 'Give the task an ID (for example `**T4:**`) and record evidence with sdd-verify --task T4 -- <command>'
                : `Record it with sdd-verify --task ${task.id} -- <command>`;
            problems.push(`${task.id} is checked but has no evidence. ${how}, or paste the command and its output under **Evidence:**.`);
        } else if (recorded) {
            if (!recorded.intact) problems.push(`${task.id}: recorded evidence was edited after sdd-verify wrote it (hash mismatch).`);
            else if (recorded.exit !== '0') problems.push(`${task.id}: recorded evidence shows exit ${recorded.exit}, not 0.`);
        } else {
            manual++;
            if (requireRecordedEvidence) problems.push(`${task.id}: evidence is hand-written; specification.requireRecordedEvidence needs sdd-verify --task ${task.id} -- <command>.`);
        }
    }
    if (manual > 0 && !requireRecordedEvidence) notes.push(`${manual} checked task(s) have hand-written evidence (not recorded by sdd-verify).`);

    if (spec.gate && (status === 'in progress' || status === 'completed')) {
        if (!spec.gate.command) problems.push(`Status is "${status}" but the verification command is still a placeholder.`);
        if (!spec.gate.expected) problems.push(`Status is "${status}" but the expected output is still a placeholder.`);
    }
    if (status === 'completed') {
        for (const task of spec.tasks.filter(t => !t.checked)) {
            problems.push(`Status is "completed" but ${task.id} is not checked.`);
        }
        const last = spec.gate && spec.gate.lastVerifiedParsed;
        if (!last) {
            problems.push('Status is "completed" but "Last Verified" is missing or was not written by sdd-verify --record.');
        } else if (!last.intact) {
            problems.push('"Last Verified" was edited after sdd-verify wrote it, or the verification command or expected output changed since. Run sdd-verify --record.');
        } else if (last.result !== 'PASS' || last.exit !== '0') {
            problems.push(`Status is "completed" but the last verification is ${last.result} (exit ${last.exit}). Fix it and run sdd-verify --record.`);
        } else if (expectedState && last.state !== expectedState) {
            problems.push(shallow
                ? `The recorded verification (state ${last.state}) does not match the oldest commit in this shallow clone (state ${expectedState}), and the commit that completed the spec may be older. Fetch the full history (git fetch --unshallow; in GitHub Actions, actions/checkout with fetch-depth: 0).`
                : `The recorded verification (state ${last.state}) does not match the content the spec was completed with (state ${expectedState}). Files changed after sdd-verify ran; run it again.`);
        }
    }
    return { status: shownStatus, spec, problems, notes };
}

function parseVersion(text) {
    const match = String(text).match(/(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
}

function versionAtLeast(actual, minimum) {
    for (let i = 0; i < 3; i++) {
        if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
    }
    return true;
}

function runAuditkit(root, roadmapDir, source) {
    const bin = process.env.SDD_AUDITKIT || 'auditkit';
    const version = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (version.error) {
        return { ok: false, report: `❌ Rigor mode is checked by auditkit, which is not installed.\nInstall it with: ${AUDITKIT_INSTALL}` };
    }
    const actual = parseVersion(version.stdout);
    if (!actual || !versionAtLeast(actual, MIN_AUDITKIT)) {
        return {
            ok: false,
            report: `❌ auditkit ${actual ? actual.join('.') : '(unknown version)'} is older than ${MIN_AUDITKIT.join('.')}, which this gate requires.\nUpgrade with: pipx install --force git+https://github.com/tBeltty/auditor-executor-protocol`
        };
    }

    // auditkit reads files from disk; for the index or a commit, lint a temporary copy.
    let dir = path.join(root, roadmapDir);
    let tmp = null;
    if (source.kind !== 'worktree') {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-roadmap-'));
        const prefix = `${roadmapDir.replace(/\/+$/, '')}/`;
        const files = listTrackedFiles(root, source).filter(f => f.startsWith(prefix));
        for (const [file, buffer] of readFiles(root, files, source)) {
            if (!buffer) continue;
            const target = path.join(tmp, file.slice(prefix.length));
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, buffer);
        }
        dir = tmp;
    }
    try {
        const result = spawnSync(bin, ['lint', dir], { cwd: root, encoding: 'utf8' });
        const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
        return {
            ok: result.status === 0,
            report: `${result.status === 0 ? '✅' : '❌'} auditkit lint ${roadmapDir} (${describeSource(source)})\n${output}`
        };
    } finally {
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// The framework's own repository has no project specification. The exemption requires both
// project.type "framework" and the framework's package name, so it cannot be used as a
// switch to turn the specification check off in a project.
function isFrameworkRepository(root, source, config) {
    if (getIn(config, 'project.type', 'application') !== 'framework') return false;
    const pkg = readFile(root, 'package.json', source);
    try {
        return Boolean(pkg) && JSON.parse(pkg.toString('utf8')).name === 'agentic-sdd-framework';
    } catch {
        return false;
    }
}

function run({ root, source = WORKTREE } = {}) {
    const config = loadConfig(root, source);
    if (isFrameworkRepository(root, source, config)) {
        return { ok: true, report: '⏭️  Not applicable (the framework repository has no project specification).' };
    }

    if (getIn(config, 'specification.mode', 'lite') === 'rigor') {
        const roadmapDir = getIn(config, 'specification.roadmapDir', 'docs/roadmap');
        if (!readFile(root, `${roadmapDir}/execution-guide.md`, source)) {
            return { ok: false, report: `❌ Rigor mode: ${roadmapDir}/execution-guide.md not found. Run sdd-init --mode=rigor.` };
        }
        return runAuditkit(root, roadmapDir, source);
    }

    const specFile = getIn(config, 'specification.specFile', 'docs/SPEC.md');
    const buffer = readFile(root, specFile, source);
    if (!buffer) {
        return { ok: false, report: `❌ Lite mode: ${specFile} not found. Run sdd-init or create it from docs/SPEC_TEMPLATE.md.` };
    }
    const text = buffer.toString('utf8');
    const completed = parseSpec(text).status === 'completed';
    const reference = completed ? referenceSourceFor(root, source, specFile) : null;
    const expectedState = reference ? stateOf(root, reference, specFile) : null;
    const { status, spec, problems, notes } = lintLiteSpec(text, {
        requireRecordedEvidence: getIn(config, 'specification.requireRecordedEvidence', false),
        expectedState,
        shallow: Boolean(reference && reference.shallow)
    });
    const done = spec.tasks.filter(t => t.checked).length;
    const summary = `${specFile}: status "${status}", ${done}/${spec.tasks.length} task(s) checked`;
    const noteLines = notes.map(n => `  ℹ️  ${n}`);
    if (problems.length === 0) {
        return { ok: true, report: [`✅ ${summary}.`, ...noteLines].join('\n') };
    }
    return {
        ok: false,
        report: [`❌ ${summary}, ${problems.length} problem(s):\n`, ...problems.map(p => `  - ${p}`), ...noteLines].join('\n')
    };
}

if (require.main === module) {
    runCheckCli('📋 Agentic SDD Framework: Specification Check', run);
}

module.exports = { MIN_AUDITKIT, lintLiteSpec, parseVersion, versionAtLeast, run };
