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

// Parses `ls-files -s -z` ("<mode> <oid> <stage>\t<path>") or `ls-tree -r -z`
// ("<mode> <type> <oid>\t<path>") output. Paths may contain any byte except NUL.
function parseEntries(output, format) {
    const entries = [];
    for (const record of output.split('\0')) {
        if (!record) continue;
        const tab = record.indexOf('\t');
        const fields = record.slice(0, tab).split(' ');
        const entry = format === 'ls-tree'
            ? { mode: fields[0], oid: fields[2], stage: '0', path: record.slice(tab + 1) }
            : { mode: fields[0], oid: fields[1], stage: fields[2], path: record.slice(tab + 1) };
        if (entry.mode !== GITLINK_MODE) entries.push(entry);
    }
    return entries;
}

// Path -> blob id for every tracked file in an index or commit source. During a merge
// conflict the index holds several stages; stage 0 wins, otherwise "ours" (stage 2).
function entriesOf(root, source) {
    let entries;
    try {
        entries = source.kind === 'ref'
            ? parseEntries(git(['ls-tree', '-r', '-z', source.ref], root), 'ls-tree')
            : parseEntries(git(['ls-files', '-s', '-z'], root), 'ls-files');
    } catch (error) {
        throw new Error(`Cannot list files from the ${describeSource(source)}: ${describeGitError(error)}`);
    }
    const byPath = new Map();
    for (const entry of entries) {
        const current = byPath.get(entry.path);
        if (!current || entry.stage === '0' || (current.stage !== '0' && entry.stage === '2')) byPath.set(entry.path, entry);
    }
    return byPath;
}

// Files a check should look at. Submodule entries (gitlinks) are not files and are skipped.
// For the index, only files the next commit changes; use listTrackedFiles for all of them.
function listFiles(root, source = WORKTREE, { changedOnly = true } = {}) {
    const paths = [...entriesOf(root, source).keys()];
    if (source.kind !== 'index' || !changedOnly) return paths;
    let names;
    try {
        names = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], root);
    } catch (error) {
        throw new Error(`Cannot list staged changes: ${describeGitError(error)}`);
    }
    const staged = new Set(names.split('\0').filter(Boolean));
    return paths.filter(p => staged.has(p));
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

// Reads blobs by object id in one `git cat-file --batch` process. Object ids never contain
// newlines, so arbitrary file names cannot desynchronize the batch; every response is
// checked against the id that was requested.
function readBlobs(root, oids) {
    const result = new Map();
    const unique = [...new Set(oids)];
    if (unique.length === 0) return result;
    const proc = spawnSync('git', ['cat-file', '--batch'], { cwd: root, input: unique.join('\n') + '\n', maxBuffer: MAX_BUFFER });
    if (proc.error || proc.status !== 0) {
        throw new Error(`git cat-file failed: ${proc.error ? proc.error.message : proc.stderr.toString().trim()}`);
    }
    const out = proc.stdout;
    let offset = 0;
    for (const oid of unique) {
        const newline = out.indexOf(10, offset);
        const header = newline === -1 ? '' : out.subarray(offset, newline).toString();
        const [gotOid, type, sizeText] = header.split(' ');
        if (gotOid !== oid || type !== 'blob') {
            throw new Error(`git cat-file returned "${header}" for object ${oid}; the repository may be corrupt.`);
        }
        const size = Number(sizeText);
        offset = newline + 1;
        result.set(oid, out.subarray(offset, offset + size));
        offset += size + 1;
    }
    return result;
}

// Map<file, Buffer|null>; null means the file does not exist in that source.
function readFiles(root, files, source = WORKTREE) {
    if (source.kind === 'worktree') {
        return new Map(files.map(f => [f, readWorktreeFile(root, f)]));
    }
    const entries = entriesOf(root, source);
    const blobs = readBlobs(root, files.filter(f => entries.has(f)).map(f => entries.get(f).oid));
    return new Map(files.map(f => [f, entries.has(f) ? blobs.get(entries.get(f).oid) : null]));
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
