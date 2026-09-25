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
const { git, readFile, WORKTREE } = require('./git');

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

// The source whose state a spec at `specPath` must match, per the rules above.
function referenceSourceFor(root, source, specPath) {
    if (source.kind === 'ref') {
        const commit = tryGit(['log', '-1', '--format=%H', source.ref, '--', specPath], root);
        return commit ? { kind: 'ref', ref: commit } : source;
    }
    const headHasCommit = tryGit(['rev-parse', '--verify', '--quiet', 'HEAD'], root) !== '';
    if (!headHasCommit) return source;
    const current = readFile(root, specPath, source);
    let committed = null;
    try {
        committed = readFile(root, specPath, { kind: 'ref', ref: 'HEAD' });
    } catch {
        committed = null;
    }
    if (!committed || !current || !current.equals(committed)) return source;
    const commit = tryGit(['log', '-1', '--format=%H', 'HEAD', '--', specPath], root);
    return commit ? { kind: 'ref', ref: commit } : source;
}

function currentCommit(root) {
    const sha = tryGit(['rev-parse', '--short', 'HEAD'], root);
    return sha || 'no-commit';
}

module.exports = { WORKTREE, stateOf, referenceSourceFor, currentCommit };
