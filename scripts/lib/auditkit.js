/**
 * scripts/lib/auditkit.js
 *
 * The Auditor-Executor protocol is an external dependency: the framework keeps no copy
 * of its skill or its Rigor templates. Both come from the installed `auditkit` CLI
 * (PyPI package auditor-executor-protocol), which also lints Rigor documents. Any
 * release at or above MIN_AUDITKIT is accepted; there is no upper bound, so upgrading
 * auditkit is how a project picks up a new protocol version.
 *
 * SDD_AUDITKIT overrides the binary (tests point it at a stub or a missing path).
 */

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

module.exports = { PACKAGE, INSTALL, UPGRADE, MIN_AUDITKIT, bin, parseVersion, versionAtLeast, check, run };
