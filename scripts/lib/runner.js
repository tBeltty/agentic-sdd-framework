/**
 * scripts/lib/runner.js
 *
 * Runs a verification command through a shell with a time limit and captures its output.
 * The shell is specification.verifyShell when set, otherwise the platform default
 * (/bin/sh on macOS and Linux, cmd.exe on Windows).
 */

const { spawnSync } = require('child_process');

const DEFAULT_TIMEOUT_SECONDS = 900;
const MAX_BUFFER = 64 * 1024 * 1024;

function runCommand(command, { cwd, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS, shell } = {}) {
    const result = spawnSync(command, {
        cwd,
        shell: shell || true,
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
        timeout: timeoutSeconds * 1000,
        killSignal: 'SIGKILL'
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.error && result.error.code === 'ETIMEDOUT') {
        return { exit: 'timeout', output: `${output}\n(timed out after ${timeoutSeconds}s)` };
    }
    if (result.error) return { exit: 'error', output: `${output}\n(${result.error.message})` };
    if (result.status === null) return { exit: `signal ${result.signal}`, output };
    return { exit: String(result.status), output };
}

// Quotes argv tokens back into one command line (used for `sdd-verify --task ID -- cmd ...`).
function joinCommand(tokens) {
    if (tokens.length === 1) return tokens[0];
    return tokens.map(t => (/[\s"'$`\\]/.test(t) ? `"${t.replace(/(["\\$`])/g, '\\$1')}"` : t)).join(' ');
}

module.exports = { DEFAULT_TIMEOUT_SECONDS, runCommand, joinCommand };
