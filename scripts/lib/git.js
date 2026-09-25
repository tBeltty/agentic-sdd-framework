/**
 * scripts/lib/git.js
 *
 * Git access for the quality gate checks. Every check reads files from a *source*:
 *
 *   { kind: 'worktree' }          tracked files as they are on disk (default)
 *   { kind: 'index' }             the staged content (what the next commit will contain)
 *   { kind: 'ref', ref: '<sha>' } the content of a commit (used by the pre-push hook)
 *
 * Failures are errors, never empty results: a check that cannot read the repository
 * must fail instead of reporting "0 files, all clean".
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_BUFFER = 256 * 1024 * 1024;
const WORKTREE = Object.freeze({ kind: 'worktree' });
const GITLINK_MODE = '160000';

function git(args, cwd, options = {}) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options
    });
}

function describeGitError(error) {
    const stderr = error.stderr ? error.stderr.toString().trim() : '';
    return stderr || error.message;
}

function repoRoot(cwd = process.cwd()) {
    try {
        return git(['rev-parse', '--show-toplevel'], cwd).trim();
    } catch (error) {
        throw new Error(`Not inside a usable git repository (${cwd}): ${describeGitError(error)}`);
    }
}

function describeSource(source = WORKTREE) {
    if (source.kind === 'index') return 'staged changes';
    if (source.kind === 'ref') return `commit ${source.ref.slice(0, 12)}`;
    return 'working tree';
}

function parseEntries(output) {
    // "<mode> <type-or-sha> <sha-or-stage>\t<path>" records, NUL-terminated.
    return output.split('\0').filter(Boolean).map(record => {
        const tab = record.indexOf('\t');
        const [mode] = record.slice(0, tab).split(' ');
        return { mode, path: record.slice(tab + 1) };
    });
}

// Files a check should look at. Submodule entries (gitlinks) are not files and are skipped.
// For the index, only files the next commit changes; use listTrackedFiles for all of them.
function listFiles(root, source = WORKTREE, { changedOnly = true } = {}) {
    let entries;
    try {
        if (source.kind === 'index' && changedOnly) {
            // Only what this commit changes: added, copied, modified, renamed.
            const names = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], root);
            const staged = new Set(names.split('\0').filter(Boolean));
            entries = parseEntries(git(['ls-files', '-s', '-z'], root)).filter(e => staged.has(e.path));
        } else if (source.kind === 'ref') {
            entries = parseEntries(git(['ls-tree', '-r', '-z', source.ref], root));
        } else {
            entries = parseEntries(git(['ls-files', '-s', '-z'], root));
        }
    } catch (error) {
        throw new Error(`Cannot list files from the ${describeSource(source)}: ${describeGitError(error)}`);
    }
    return [...new Set(entries.filter(e => e.mode !== GITLINK_MODE).map(e => e.path))];
}

// Every tracked file in the source (for the index: the full staged tree).
function listTrackedFiles(root, source = WORKTREE) {
    return listFiles(root, source, { changedOnly: false });
}

function readWorktreeFile(root, file) {
    const full = path.join(root, file);
    let stat;
    try {
        stat = fs.lstatSync(full);
    } catch (error) {
        if (error.code === 'ENOENT') return null; // tracked but deleted in the working tree
        throw new Error(`Cannot read ${file}: ${error.message}`);
    }
    // Git stores a symlink as its target path; read that, never the file it points to.
    if (stat.isSymbolicLink()) return Buffer.from(fs.readlinkSync(full));
    if (!stat.isFile()) return null;
    try {
        return fs.readFileSync(full);
    } catch (error) {
        throw new Error(`Cannot read ${file}: ${error.message}`);
    }
}

// Reads many objects in one `git cat-file --batch` process. Returns Map<file, Buffer|null>.
function readObjects(root, specs) {
    const result = new Map();
    if (specs.length === 0) return result;
    const input = specs.map(s => `${s.object}\n`).join('');
    const proc = spawnSync('git', ['cat-file', '--batch'], { cwd: root, input, maxBuffer: MAX_BUFFER });
    if (proc.error || proc.status !== 0) {
        throw new Error(`git cat-file failed: ${proc.error ? proc.error.message : proc.stderr.toString().trim()}`);
    }
    const out = proc.stdout;
    let offset = 0;
    for (const spec of specs) {
        const newline = out.indexOf(10, offset);
        const header = out.subarray(offset, newline).toString();
        offset = newline + 1;
        if (header.endsWith(' missing')) {
            result.set(spec.file, null);
            continue;
        }
        const size = Number(header.split(' ')[2]);
        result.set(spec.file, out.subarray(offset, offset + size));
        offset += size + 1;
    }
    return result;
}

// Map<file, Buffer|null>; null means the file does not exist in that source.
function readFiles(root, files, source = WORKTREE) {
    if (source.kind === 'worktree') {
        return new Map(files.map(f => [f, readWorktreeFile(root, f)]));
    }
    const prefix = source.kind === 'index' ? ':' : `${source.ref}:`;
    return readObjects(root, files.map(file => ({ file, object: `${prefix}${file}` })));
}

function readFile(root, file, source = WORKTREE) {
    return readFiles(root, [file], source).get(file);
}

function isBinary(buffer) {
    return buffer.subarray(0, 8000).includes(0);
}

module.exports = {
    WORKTREE, git, describeGitError, repoRoot, describeSource, listFiles, listTrackedFiles, readFiles, readFile, isBinary
};
