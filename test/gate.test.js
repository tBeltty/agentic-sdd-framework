const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { runChecks, runPush } = require('../scripts/quality-gate');
const { install } = require('../scripts/install-git-hooks');
const { validateConfig, loadConfig } = require('../scripts/lib/config');
const { collectChecks } = require('../scripts/check-system-prerequisites');
const { tempDir, tempRepo, git, writeFiles, runHook } = require('./helpers');

const GATE = path.join(__dirname, '../scripts/quality-gate.js');
const quiet = () => {};
const TOKEN = 'ghp' + '_' + 'aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zC1234';
const FRAMEWORK_CONFIG = JSON.stringify({ version: '1.0.0', project: { type: 'framework' } });

function gateCli(cwd, args = [], input = '') {
    return spawnSync(process.execPath, [GATE, ...args], { cwd, input, encoding: 'utf8' });
}

test('F2: outside a git repository the gate fails instead of scanning 0 files', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'leak.txt'), `TOKEN=${TOKEN}\n`);
    const result = gateCli(dir);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Not inside a usable git repository/);
    for (const script of ['verify-no-secrets.js', 'check-copy-slop.js', 'check-file-size.js', 'check-spec.js']) {
        const single = spawnSync(process.execPath, [path.join(__dirname, '../scripts', script)], { cwd: dir, encoding: 'utf8' });
        assert.strictEqual(single.status, 1, script);
    }
});

test('F7: config validation rejects unknown keys, wrong types, bad enums and unsafe paths', () => {
    const errors = validateConfig({
        specification: { mode: 'rigr', specFile: '../outside.md' },
        architecture: { maxLocPerFle: 10, maxLocPerFile: '400' },
        capabilities: { noAiSlop: { exclude: 'docs/' } },
        'x-team': { anything: true }
    }).join('\n');
    assert.match(errors, /specification\.mode: "rigr" is not one of "lite", "rigor"/);
    assert.match(errors, /specification\.specFile: must be a path relative/);
    assert.match(errors, /architecture\.maxLocPerFle: unknown key/);
    assert.match(errors, /architecture\.maxLocPerFile: expected integer, got string/);
    assert.match(errors, /capabilities\.noAiSlop\.exclude: expected array, got string/);
    assert.doesNotMatch(errors, /x-team/);
});

test('F7: every check fails on an invalid config instead of falling back to defaults', () => {
    const repo = tempRepo();
    writeFiles(repo, { 'sdd.config.json': JSON.stringify({ capabilities: { noAiSlop: { exclude: 'docs/' } } }), 'docs.md': 'A robust plan.\n' });
    git(repo, 'add', '-A');
    const failed = runChecks({ root: repo, source: { kind: 'worktree' }, log: quiet });
    assert.deepStrictEqual(failed.sort(), ['File Size Limit', 'No-AI-Slop Copy Linter', 'Secret Leak Scanner', 'Specification Check', 'Version Sync Check'].sort());
});

test('F6: a UTF-8 BOM in sdd.config.json is accepted', () => {
    const repo = tempRepo();
    writeFiles(repo, { 'sdd.config.json': `﻿${FRAMEWORK_CONFIG}` });
    assert.strictEqual(loadConfig(repo).project.type, 'framework');
});

function pushRepo() {
    const repo = tempRepo();
    writeFiles(repo, { 'sdd.config.json': FRAMEWORK_CONFIG, 'package.json': '{"name": "agentic-sdd-framework", "version": "1.0.0"}\n', 'README.md': '# app\n' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    return repo;
}
const pushLine = (repo, remoteSha = '0'.repeat(40)) => `refs/heads/main ${git(repo, 'rev-parse', 'HEAD').trim()} refs/heads/main ${remoteSha}\n`;

test('F38: push mode checks the pushed commit, not the working tree', () => {
    const repo = pushRepo();
    writeFiles(repo, { 'cfg.txt': `k=${TOKEN}\n` });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'leak');
    writeFiles(repo, { 'cfg.txt': 'k=removed\n' });
    assert.deepStrictEqual(runChecks({ root: repo, source: { kind: 'worktree' }, log: quiet }), []);
    const failed = runPush({ root: repo, input: pushLine(repo), remoteName: 'origin', log: quiet });
    assert.ok(failed.some(f => f.startsWith('Secret Leak Scanner')), failed.join());
});

test('F38: a secret added and removed in the pushed history is still caught', () => {
    const repo = pushRepo();
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    writeFiles(repo, { 'cfg.txt': `k=${TOKEN}\n` });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'leak');
    writeFiles(repo, { 'cfg.txt': 'k=removed\n' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'remove');
    const failed = runPush({ root: repo, input: pushLine(repo, base), remoteName: 'origin', log: quiet });
    assert.deepStrictEqual(failed, ['Secrets in pushed history [refs/heads/main]']);
    assert.deepStrictEqual(runPush({ root: repo, input: `refs/heads/x ${'0'.repeat(40)} refs/heads/x ${base}\n`, remoteName: 'origin', log: quiet }), []);
});

test('N3: a secret introduced only by a merge commit is caught', () => {
    const repo = pushRepo();
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    git(repo, 'checkout', '-q', '-b', 'side');
    writeFiles(repo, { 'side.txt': 'side\n' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'side');
    git(repo, 'checkout', '-q', '-');
    writeFiles(repo, { 'main.txt': 'main\n' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'main');
    git(repo, 'merge', '-q', '--no-ff', '--no-commit', 'side');
    writeFiles(repo, { 'merge.txt': `k=${TOKEN}\n` });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'merge');
    git(repo, 'rm', '-q', 'merge.txt');
    git(repo, 'commit', '-q', '-m', 'remove');
    const failed = runPush({ root: repo, input: pushLine(repo, base), remoteName: 'origin', log: quiet });
    assert.deepStrictEqual(failed, ['Secrets in pushed history [refs/heads/main]']);
});

test('N14/N17: inherited object keys and empty paths are rejected by the config schema', () => {
    const errors = validateConfig({
        toString: 'x',
        project: { constructor: 'x' },
        specification: { specFile: '', roadmapDir: '' },
        security: { allowFiles: [''] }
    }).join('\n');
    assert.match(errors, /toString: unknown key/);
    assert.match(errors, /project\.constructor: unknown key/);
    assert.match(errors, /specification\.specFile/);
    assert.match(errors, /specification\.roadmapDir/);
    assert.match(errors, /security\.allowFiles/);
});

test('R3: a file that replaced a symlink in a pushed commit is scanned', { skip: process.platform === 'win32' && 'symlinks need developer mode' }, () => {
    const repo = pushRepo();
    fs.symlinkSync('README.md', path.join(repo, 'config.txt'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'link');
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    fs.rmSync(path.join(repo, 'config.txt'));
    writeFiles(repo, { 'config.txt': `k=${TOKEN}\n` });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'leak');
    writeFiles(repo, { 'config.txt': 'k=removed\n' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'remove');
    const failed = runPush({ root: repo, input: pushLine(repo, base), remoteName: 'origin', log: quiet });
    assert.deepStrictEqual(failed, ['Secrets in pushed history [refs/heads/main]']);
});

test('R8: check scripts reject unknown flags and accept "--ref <commit>"', () => {
    const repo = pushRepo();
    writeFiles(repo, { 'cfg.txt': `k=${TOKEN}\n` });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'leak');
    writeFiles(repo, { 'cfg.txt': 'k=clean\n' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'clean');
    const scanner = path.join(__dirname, '../scripts/verify-no-secrets.js');
    const scan = args => spawnSync(process.execPath, [scanner, ...args], { cwd: repo, encoding: 'utf8' });
    assert.strictEqual(scan(['--ref', 'HEAD~1']).status, 1, 'space form checks that commit');
    assert.strictEqual(scan(['--ref=HEAD~1']).status, 1);
    assert.strictEqual(scan([]).status, 0);
    const typo = scan(['--stagd']);
    assert.strictEqual(typo.status, 1);
    assert.match(typo.stderr, /Unknown argument "--stagd"/);
    assert.match(scan(['--staged', '--ref=HEAD']).stderr, /separate modes/);
    const gate = gateCli(repo, ['--bogus']);
    assert.strictEqual(gate.status, 1);
    assert.match(gate.stderr, /Unknown argument "--bogus"/);
    assert.strictEqual(gateCli(repo, ['--ref', 'HEAD~1']).status, 1);
});

test('R9: non-canonical config paths are rejected with the canonical form', () => {
    for (const specFile of ['./docs/SPEC.md', 'docs//SPEC.md', 'docs\\SPEC.md', 'docs/./SPEC.md']) {
        assert.match(validateConfig({ specification: { specFile } }).join(), /canonical form[\s\S]*"docs\/SPEC\.md"/, specFile);
    }
    assert.match(validateConfig({ specification: { roadmapDir: 'plans/' } }).join(), /must not end with "\/"/);
    assert.deepStrictEqual(validateConfig({ specification: { specFile: 'docs/SPEC.md', roadmapDir: 'plans' }, capabilities: { noAiSlop: { exclude: ['docs/'] } } }), []);
});

test('a ref whose commit is already on the remote is not re-checked (tags on published commits)', () => {
    const repo = pushRepo();
    writeFiles(repo, { 'notes.md': 'A robust plan.\n' }); // violates the current prose rules
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'old content');
    const published = git(repo, 'rev-parse', 'HEAD').trim();
    git(repo, 'update-ref', 'refs/remotes/origin/main', published);
    git(repo, 'tag', '-a', 'v0.1.0', '-m', 'old release', published);
    const tagSha = git(repo, 'rev-parse', 'v0.1.0').trim();
    const lines = [];
    const failed = runPush({ root: repo, input: `refs/tags/v0.1.0 ${tagSha} refs/tags/v0.1.0 ${'0'.repeat(40)}\n`, remoteName: 'origin', log: l => lines.push(l) });
    assert.deepStrictEqual(failed, []);
    assert.match(lines.join('\n'), new RegExp(`commit ${published.slice(0, 12)}[\\s\\S]*Already on the remote`));

    // The same content on a new commit is checked.
    writeFiles(repo, { 'more.md': 'next\n' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'new');
    const head = git(repo, 'rev-parse', 'HEAD').trim();
    const failedNew = runPush({ root: repo, input: `refs/heads/main ${head} refs/heads/main ${published}\n`, remoteName: 'origin', log: quiet });
    assert.deepStrictEqual(failedNew, ['No-AI-Slop Copy Linter [refs/heads/main]']);
});

test('F38/F37: the installed hook feeds the push to the gate and falls back to an absolute node path', () => {
    const repo = pushRepo();
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    const { hookPath } = install({ root: repo, gateScript: GATE });
    const hook = fs.readFileSync(hookPath, 'utf8');
    assert.match(hook, /--push "\$1"/);
    assert.ok(hook.includes(`NODE_BIN="${process.execPath.split(path.sep).join('/')}"`));

    writeFiles(repo, { 'cfg.txt': `k=${TOKEN}\n` });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'leak');
    writeFiles(repo, { 'cfg.txt': 'k=removed\n' });
    // Without node on PATH the hook must fall back to the absolute path (POSIX only: on
    // Windows, PATH also has to keep sh and git reachable).
    const env = process.platform === 'win32' ? process.env : { ...process.env, PATH: '/usr/bin:/bin' };
    const run = input => runHook(hookPath, ['origin', 'url'], { cwd: repo, input, env });
    const blocked = run(pushLine(repo, base));
    assert.strictEqual(blocked.status, 1, blocked.stdout + blocked.stderr);
    assert.match(blocked.stderr, /Quality gate failed: Secret Leak Scanner \[refs\/heads\/main\], Secrets in pushed history/);
    const clean = run(`refs/heads/main ${base} refs/heads/main ${base}\n`);
    assert.strictEqual(clean.status, 0, clean.stdout + clean.stderr);
});

test('F40: core.hooksPath is left alone and the manual command is reported', () => {
    const repo = pushRepo();
    const shared = tempDir();
    fs.writeFileSync(path.join(shared, 'pre-push'), '#!/bin/sh\necho shared\n');
    git(repo, 'config', 'core.hooksPath', shared);
    assert.throws(() => install({ root: repo, gateScript: GATE }), /core\.hooksPath is set[\s\S]*--push "\$1"/);
    assert.deepStrictEqual(fs.readdirSync(shared), ['pre-push']);
});

test('F46: prerequisite diagnostics are testable and flag an old Node.js', () => {
    const checks = collectChecks({ nodeVersion: 'v20.11.0', env: { CI: 'true' }, homedir: tempDir() });
    const byName = Object.fromEntries(checks.map(c => [c.name, c.status]));
    assert.strictEqual(byName['Node.js Runtime'], 'FAIL');
    assert.strictEqual(byName['SSH Keys'], 'WARN');
    assert.strictEqual(collectChecks({ nodeVersion: 'v24.1.0', env: { CI: 'true' } })[0].status, 'PASS');
});

test('quality gate CLI: --staged and --ref select the source', () => {
    const repo = pushRepo();
    writeFiles(repo, { 'cfg.txt': `k=${TOKEN}\n` });
    git(repo, 'add', '-A');
    fs.writeFileSync(path.join(repo, 'cfg.txt'), 'k=clean\n');
    assert.strictEqual(gateCli(repo).status, 0);
    const staged = gateCli(repo, ['--staged']);
    assert.strictEqual(staged.status, 1);
    assert.match(staged.stderr, /Quality gate failed: Secret Leak Scanner\./);
    execFileSync('git', ['commit', '-q', '-m', 'x'], { cwd: repo });
    const ref = gateCli(repo, ['--ref=HEAD']);
    assert.strictEqual(ref.status, 1);
    assert.match(ref.stderr, /Quality gate failed: Secret Leak Scanner\./);
});

test('R20: sync-vendored rejects a mistyped flag instead of writing', () => {
    const script = path.join(__dirname, '../scripts/dev/sync-vendored.js');
    const canonical = tempDir();
    fs.writeFileSync(path.join(canonical, 'SKILL.md'), 'upstream copy\n');
    const result = spawnSync(process.execPath, [script, canonical, '--chek'], { encoding: 'utf8' });
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /Unknown argument "--chek"/);
    assert.doesNotMatch(result.stdout, /updated/);
});
