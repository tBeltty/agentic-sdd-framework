/**
 * scripts/lib/state.js
 *
 * Content fingerprint of the tracked files, excluding the specification itself (which
 * records the fingerprint). `sdd-verify --record` stores it next to a PASS; the gate
 * recomputes it for the state the Completed spec belongs to and rejects a mismatch.
 *
 * The state a spec belongs to:
 *   - if the spec in the checked source differs from HEAD (not committed yet), the
 *     checked source itself (working tree or index);
 *   - otherwise the last commit that changed the spec (for --ref: the last such commit
 *     reachable from that ref).
 * A later commit that does not touch the spec does not invalidate it: detecting
 * regressions after a spec is closed is the job of CI and tests, not of the spec record.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { git, WORKTREE } = require('./git');

function tryGit(args, root) {
    try {
        return git(args, root).trim();
    } catch {
        return '';
    }
}

// Tree object for a source. The working tree is captured with `git stash create`, which
// writes a commit object for tracked changes without touching the working tree or index.
function treeOf(root, source) {
    if (source.kind === 'ref') return git(['rev-parse', `${source.ref}^{tree}`], root).trim();
    if (source.kind === 'index') return git(['write-tree'], root).trim();
    const hasHead = tryGit(['rev-parse', '--verify', '--quiet', 'HEAD'], root) !== '';
    if (!hasHead) return git(['write-tree'], root).trim(); // before the first commit: the index
    const stash = tryGit(['stash', 'create'], root);
    return git(['rev-parse', `${stash || 'HEAD'}^{tree}`], root).trim();
}

function fingerprintTree(root, tree, excludePath) {
    const entries = git(['ls-tree', '-r', '-z', tree], root)
        .split('\0')
        .filter(Boolean)
        .filter(entry => entry.slice(entry.indexOf('\t') + 1) !== excludePath);
    return crypto.createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 16);
}

function stateOf(root, source, excludePath) {
    return fingerprintTree(root, treeOf(root, source), excludePath);
}

// Commits where a shallow clone's history is cut off. `git log -- path` reports such a
// commit as touching every file, since it has no parent to compare with.
function shallowBoundaries(root) {
    const file = tryGit(['rev-parse', '--git-path', 'shallow'], root);
    const full = file && path.resolve(root, file);
    if (!full || !fs.existsSync(full)) return new Set();
    return new Set(fs.readFileSync(full, 'utf8').split('\n').filter(Boolean));
}

// The last commit (from `rev`) that changed `specPath`, as a ref source. In a shallow clone
// the history may end before that commit; then the result is the boundary commit, marked
// `shallow`, and a state mismatch there cannot be told apart from a real one.
function lastSpecCommit(root, rev, specPath) {
    const commit = tryGit(['--literal-pathspecs', 'log', '-1', '--format=%H', rev, '--', specPath], root);
    if (!commit) return null;
    return { kind: 'ref', ref: commit, shallow: shallowBoundaries(root).has(commit) };
}

// The blob id the spec has in `source` (null when absent).
function specBlobId(root, source, specPath) {
    if (source.kind === 'worktree') {
        const full = path.join(root, specPath);
        if (!fs.existsSync(full)) return null;
        return tryGit(['hash-object', `--path=${specPath}`, full], root) || null;
    }
    const listing = source.kind === 'ref'
        ? tryGit(['--literal-pathspecs', 'ls-tree', '-z', source.ref, '--', specPath], root)
        : tryGit(['--literal-pathspecs', 'ls-files', '-s', '-z', '--', specPath], root);
    const record = listing.split('\0').find(Boolean);
    if (!record) return null;
    const fields = record.slice(0, record.indexOf('\t')).split(' ');
    return source.kind === 'ref' ? fields[2] : fields[1];
}

// The source whose state a spec at `specPath` must match, per the rules above.
function referenceSourceFor(root, source, specPath) {
    if (source.kind === 'ref') {
        return lastSpecCommit(root, source.ref, specPath) || source;
    }
    const headHasCommit = tryGit(['rev-parse', '--verify', '--quiet', 'HEAD'], root) !== '';
    if (!headHasCommit) return source;
    // Compared as Git object ids, with the working-tree file passed through Git's filters,
    // so line-ending conversion (core.autocrlf) does not look like an uncommitted edit.
    const current = specBlobId(root, source, specPath);
    const committed = specBlobId(root, { kind: 'ref', ref: 'HEAD' }, specPath);
    if (!committed || !current || current !== committed) return source;
    return lastSpecCommit(root, 'HEAD', specPath) || source;
}

function currentCommit(root) {
    const sha = tryGit(['rev-parse', '--short', 'HEAD'], root);
    return sha || 'no-commit';
}

module.exports = { WORKTREE, stateOf, referenceSourceFor, currentCommit };
