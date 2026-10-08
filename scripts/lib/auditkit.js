/**
 * scripts/lib/auditkit.js
 *
 * The Auditor-Executor protocol is an external dependency: the framework keeps no copy
 * of its skill or its Rigor templates. Both come from the installed `auditkit` CLI
 * (PyPI package auditor-executor-protocol), which also lints Rigor documents. Any
 * release at or above MIN_AUDITKIT is accepted; there is no upper bound, so upgrading
 * auditkit is how a project picks up a new protocol version.
 *
 * The project's copy of the protocol skill is not committed: syncSkill() rewrites it from
 * the installed auditkit whenever they differ, on every sdd-init and every gate run, so a
 * `pipx upgrade` reaches the project without any manual step.
 *
 * SDD_AUDITKIT overrides the binary (tests point it at a stub or a missing path).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PACKAGE = 'auditor-executor-protocol';
const INSTALL = `pipx install ${PACKAGE}`;
const UPGRADE = `pipx upgrade ${PACKAGE}`;
// 0.5.1 is the first release whose scaffolded execution guide puts verify output in a
// fenced block, which is what its own `lint` counts as evidence. With older releases a
// report written as the template shows fails the gate.
const MIN_AUDITKIT = [0, 5, 1];

const bin = () => process.env.SDD_AUDITKIT || 'auditkit';

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

// { ok: true, version } or { ok: false, problem } with the command that fixes it.
function check() {
    const result = spawnSync(bin(), ['--version'], { encoding: 'utf8' });
    if (result.error) {
        return { ok: false, problem: `auditkit is not installed. Install it with: ${INSTALL}` };
    }
    const version = parseVersion(result.stdout);
    if (!version || !versionAtLeast(version, MIN_AUDITKIT)) {
        const shown = version ? version.join('.') : '(unknown version)';
        return { ok: false, problem: `auditkit ${shown} is older than ${MIN_AUDITKIT.join('.')}, which this framework requires. Upgrade with: ${UPGRADE}` };
    }
    return { ok: true, version: version.join('.') };
}

// Runs auditkit and throws with its output when it exits non-zero.
function run(args, options = {}) {
    const result = spawnSync(bin(), args, { encoding: 'utf8', ...options });
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    if (result.error || result.status !== 0) {
        throw new Error(`auditkit ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ` (exit ${result.status})`}\n${output}`);
    }
    return output;
}

const SKILL = 'auditor-executor-protocol';
const SKILL_PATHS = [`.agents/skills/${SKILL}/`, `.claude/skills/${SKILL}`];
// Written by provision.js into .claude/skills copies made where symlinks are unavailable.
const COPY_MARKER = '.sdd-managed-copy';

// Relative path -> content for every file under dir (empty when dir is missing).
function snapshot(dir, ignore = []) {
    const files = new Map();
    const walk = rel => {
        for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
            const child = rel ? `${rel}/${entry.name}` : entry.name;
            if (ignore.includes(child)) continue;
            if (entry.isDirectory()) walk(child);
            else files.set(child, fs.readFileSync(path.join(dir, child), 'utf8'));
        }
    };
    if (fs.existsSync(dir)) walk('');
    return files;
}

function sameFiles(a, b) {
    return a.size === b.size && [...a].every(([rel, content]) => b.get(rel) === content);
}

function replaceDir(dest, source, extra = {}) {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(source, dest, { recursive: true });
    for (const [rel, content] of Object.entries(extra)) fs.writeFileSync(path.join(dest, rel), content);
}

/**
 * Makes the project's protocol skill (.agents/skills/auditor-executor-protocol, plus a
 * .claude/skills copy where one was made instead of a link) identical to what the installed
 * auditkit ships. Never throws for a missing or old auditkit; the caller decides whether
 * that matters. Returns { status: 'current' | 'updated' | 'skipped', version?, problem? }.
 */
function syncSkill(root) {
    const installed = check();
    if (!installed.ok) return { status: 'skipped', problem: installed.problem };
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-protocol-skill-'));
    try {
        run(['install-skill', '--dest', `${fresh}${path.sep}`, '--force']);
        const expected = snapshot(fresh);
        let updated = false;
        const skillDir = path.join(root, '.agents', 'skills', SKILL);
        if (!sameFiles(snapshot(skillDir), expected)) {
            replaceDir(skillDir, fresh);
            updated = true;
        }
        const claudeDir = path.join(root, '.claude', 'skills', SKILL);
        if (fs.existsSync(path.join(claudeDir, COPY_MARKER)) && !sameFiles(snapshot(claudeDir, [COPY_MARKER]), expected)) {
            replaceDir(claudeDir, fresh, { [COPY_MARKER]: fs.readFileSync(path.join(claudeDir, COPY_MARKER), 'utf8') });
            updated = true;
        }
        return { status: updated ? 'updated' : 'current', version: installed.version };
    } finally {
        fs.rmSync(fresh, { recursive: true, force: true });
    }
}

module.exports = {
    PACKAGE, INSTALL, UPGRADE, MIN_AUDITKIT, SKILL, SKILL_PATHS, COPY_MARKER,
    bin, parseVersion, versionAtLeast, check, run, syncSkill
};
