/**
 * scripts/lib/git.js
 *
 * Git helpers shared by the quality gate checks.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_BUFFER = 64 * 1024 * 1024;

function git(args, cwd) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

function repoRoot(cwd = process.cwd()) {
    try {
        return git(['rev-parse', '--show-toplevel'], cwd).trim();
    } catch {
        return cwd;
    }
}

// Tracked files, or only added/copied/modified/renamed staged files when staged is true.
function listFiles(root, { staged = false } = {}) {
    const args = staged
        ? ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']
        : ['ls-files', '-z'];
    try {
        return git(args, root).split('\0').filter(Boolean);
    } catch {
        return [];
    }
}

// In staged mode the index blob is read, so the check sees exactly what will be committed.
function readFile(root, file, { staged = false } = {}) {
    try {
        if (staged) {
            return execFileSync('git', ['show', `:${file}`], {
                cwd: root,
                maxBuffer: MAX_BUFFER,
                stdio: ['ignore', 'pipe', 'ignore']
            });
        }
        return fs.readFileSync(path.join(root, file));
    } catch {
        return null;
    }
}

function isBinary(buffer) {
    return buffer.subarray(0, 8000).includes(0);
}

module.exports = { git, repoRoot, listFiles, readFile, isBinary };
