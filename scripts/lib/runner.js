/**
 * scripts/lib/runner.js
 *
 * Runs a verification command through a shell with a time limit and captures its output.
 * The shell is specification.verifyShell when set, otherwise the platform default
 * (/bin/sh on macOS and Linux, cmd.exe on Windows). On timeout the whole process tree is
 * killed (a process group on macOS/Linux, `taskkill /T` on Windows), so background
 * processes started by the command do not keep running.
 */

const { spawn, spawnSync } = require('child_process');

const DEFAULT_TIMEOUT_SECONDS = 900;
const MAX_OUTPUT = 64 * 1024 * 1024;

function killTree(pid) {
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
        return;
    }
    try {
        process.kill(-pid, 'SIGKILL');
    } catch {
        // Already gone.
    }
}

function runCommand(command, { cwd, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS, shell } = {}) {
    return new Promise(resolve => {
        const child = spawn(command, {
            cwd,
            shell: shell || true,
            detached: process.platform !== 'win32', // own process group, killed as a whole
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        });
        let output = '';
        const append = chunk => {
            if (output.length < MAX_OUTPUT) output += chunk;
        };
        // Decode as UTF-8 streams so a multibyte character split across chunks survives.
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', append);
        child.stderr.on('data', append);
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            killTree(child.pid);
        }, timeoutSeconds * 1000);
        child.on('error', error => {
            clearTimeout(timer);
            resolve({ exit: 'error', output: `${output}\n(${error.message})` });
        });
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            if (timedOut) resolve({ exit: 'timeout', output: `${output}\n(timed out after ${timeoutSeconds}s)` });
            else if (code === null) resolve({ exit: `signal ${signal}`, output });
            else resolve({ exit: String(code), output });
        });
    });
}

// Quotes argv tokens back into one command line (used for `sdd-verify --task ID -- cmd ...`).
function joinCommand(tokens) {
    if (tokens.length === 1) return tokens[0];
    return tokens.map(t => (/[\s"'$`\\]/.test(t) ? `"${t.replace(/(["\\$`])/g, '\\$1')}"` : t)).join(' ');
}

module.exports = { DEFAULT_TIMEOUT_SECONDS, runCommand, joinCommand };
