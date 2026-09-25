#!/usr/bin/env node

/**
 * scripts/quality-gate.js
 *
 * Runs every quality gate check in a single process and exits 1 if any fails.
 * Environment diagnostics are not part of the gate: run check-system-prerequisites.js
 * once during setup instead.
 *
 * Usage:
 *   node scripts/quality-gate.js              check the working tree
 *   node scripts/quality-gate.js --staged     check the index (what the next commit contains)
 *   node scripts/quality-gate.js --ref=<sha>  check the content of a commit
 *   node scripts/quality-gate.js --push [remote] < refs
 *       pre-push mode: reads "<local ref> <local sha> <remote ref> <remote sha>" lines on
 *       stdin (the pre-push hook's input), runs every check on each pushed commit's
 *       content, and scans every new commit's changed files for secrets. A ref whose
 *       commit is already on the remote (for example a tag on a published commit)
 *       publishes nothing new and is not checked again.
 */

const fs = require('fs');
const { git, repoRoot, describeSource } = require('./lib/git');
const { sourceFromArgs } = require('./lib/cli');
const secrets = require('./verify-no-secrets');

const CHECKS = [
    { title: '🔒 Secret Leak Scanner', module: secrets },
    { title: '✍️  No-AI-Slop Copy Linter', module: require('./check-copy-slop') },
    { title: '📏 File Size Limit', module: require('./check-file-size') },
    { title: '📋 Specification Check', module: require('./check-spec') },
    { title: '🏷️  Version Sync Check', module: require('./check-versions') }
];

const ZERO_SHA = /^0+$/;

function runOne(label, fn, log) {
    let result;
    try {
        result = fn();
    } catch (error) {
        result = { ok: false, report: `❌ Check crashed: ${error.message}` };
    }
    log(`\n--- ${label} ---\n${result.report}`);
    return result.ok;
}

function runChecks({ root, source, log }) {
    const failed = [];
    for (const check of CHECKS) {
        const ok = runOne(check.title, () => check.module.run({ root, source }), log);
        if (!ok) failed.push(check.title.replace(/^\S+\s+/, ''));
    }
    return failed;
}

function parsePushInput(text) {
    return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
        const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
        return { localRef, localSha, remoteRef, remoteSha };
    });
}

// Commits the push adds to the remote. For a new remote branch: commits not on any
// remote-tracking branch of that remote.
function newCommits(root, { localSha, remoteSha }, remoteName) {
    const notRemote = remoteName ? `--remotes=${remoteName}` : '--remotes';
    const attempts = ZERO_SHA.test(remoteSha || '')
        ? [['rev-list', localSha, '--not', notRemote]]
        : [['rev-list', `${remoteSha}..${localSha}`], ['rev-list', localSha, '--not', notRemote]];
    for (const args of attempts) {
        try {
            return git(args, root).split('\n').filter(Boolean);
        } catch {
            // The remote sha may be unknown locally (e.g. after a force-push); try the fallback.
        }
    }
    throw new Error(`Cannot list the commits being pushed for ${localSha.slice(0, 12)}.`);
}

function changedFiles(root, commit) {
    return git(['diff-tree', '--no-commit-id', '-r', '-z', '--name-only', '--diff-filter=ACMR', '--root', commit], root)
        .split('\0')
        .filter(Boolean);
}

function runPush({ root, input, remoteName, log }) {
    const updates = parsePushInput(input).filter(u => u.localSha && !ZERO_SHA.test(u.localSha));
    if (updates.length === 0) {
        log('\nNothing to check: the push only deletes refs.');
        return [];
    }
    const failed = [];
    for (const update of updates) {
        // Annotated tags point to a tag object; check the commit it names.
        const commit = git(['rev-parse', `${update.localSha}^{commit}`], root).trim();
        const source = { kind: 'ref', ref: commit };
        const commits = newCommits(root, { ...update, localSha: commit }, remoteName);
        log(`\n=== ${update.localRef} -> ${update.remoteRef} (${describeSource(source)}) ===`);
        if (commits.length === 0) {
            log('Already on the remote: this ref publishes no new commits, so there is nothing new to check.');
            continue;
        }
        failed.push(...runChecks({ root, source, log }).map(name => `${name} [${update.localRef}]`));

        const ok = runOne('🔒 Secrets in pushed history', () => {
            const reports = [];
            for (const commit of commits) {
                const result = secrets.run({ root, source: { kind: 'ref', ref: commit }, files: changedFiles(root, commit) });
                if (!result.ok) reports.push(`Commit ${commit.slice(0, 12)}:\n${result.report}`);
            }
            return reports.length === 0
                ? { ok: true, report: `✅ No secrets added by the ${commits.length} commit(s) being pushed.` }
                : { ok: false, report: `${reports.join('\n\n')}\n\nA secret removed in a later commit is still in the pushed history: rewrite those commits before pushing.` };
        }, log);
        if (!ok) failed.push(`Secrets in pushed history [${update.localRef}]`);
    }
    return failed;
}

function main(argv) {
    console.log('\n======================================================');
    console.log('  🚦 Agentic SDD Framework: Quality Gate');
    console.log('======================================================');
    let failed;
    try {
        const root = repoRoot();
        const pushAt = argv.indexOf('--push');
        if (pushAt !== -1) {
            const next = argv[pushAt + 1];
            const remoteName = next && !next.startsWith('--') ? next : '';
            failed = runPush({ root, input: fs.readFileSync(0, 'utf8'), remoteName, log: console.log });
        } else {
            failed = runChecks({ root, source: sourceFromArgs(argv), log: console.log });
        }
    } catch (error) {
        console.error(`\n❌ ${error.message}\n`);
        return 1;
    }
    if (failed.length === 0) {
        console.log('\n✅ Quality gate passed.\n');
        return 0;
    }
    console.error(`\n❌ Quality gate failed: ${failed.join(', ')}.\n`);
    return 1;
}

if (require.main === module) {
    process.exit(main(process.argv.slice(2)));
}

module.exports = { CHECKS, runChecks, runPush, parsePushInput, newCommits };
