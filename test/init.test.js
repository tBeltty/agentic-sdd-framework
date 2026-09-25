const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { tempDir, tempRepo, git, writeFiles } = require('./helpers');

const FRAMEWORK_ROOT = path.resolve(__dirname, '..');
const INIT = path.join(FRAMEWORK_ROOT, 'scripts/sdd-init.js');

function init(cwd, ...flags) {
    return execFileSync(process.execPath, [INIT, '--express', ...flags], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (root, rel) => fs.existsSync(path.join(root, rel));

test('install mode provisions an existing project from another working directory', () => {
    const project = tempRepo();
    init(tempDir(), `--target=${project}`, '--name=shop', '--runtime=go-1.23', '--hardware=$5 VPS');

    for (const rel of [
        'sdd.config.json', '.agents/AGENTS.md', '.agents/CONTEXT.md', 'docs/SPEC.md',
        'docs/decisions/ADR-0001-stack-and-architecture.md', 'AGENTS.md', 'CLAUDE.md',
        '.sdd/scripts/quality-gate.js', '.agents/skills/strategic-cto/SKILL.md',
        '.claude/skills/strategic-cto/SKILL.md'
    ]) {
        assert.ok(exists(project, rel), `${rel} should exist`);
    }
    assert.match(read(project, 'AGENTS.md'), /node \.sdd\/scripts\/quality-gate\.js/);
    assert.match(read(project, 'CLAUDE.md'), /^@\.agents\/AGENTS\.md$/m);
    assert.match(read(project, '.agents/CONTEXT.md'), /\*\*Primary Runtime:\*\* go-1\.23/);
    assert.match(read(project, 'docs/decisions/ADR-0001-stack-and-architecture.md'), /Hardware and Deployment:\*\* \$5 VPS/);
    assert.ok(fs.lstatSync(path.join(project, '.claude/skills/strategic-cto')).isSymbolicLink());

    const config = JSON.parse(read(project, 'sdd.config.json'));
    assert.strictEqual(config.project.name, 'shop');
    assert.strictEqual(config.project.type, 'application');

    // The copied gate runs standalone and passes on the freshly provisioned project.
    git(project, 'add', '-A');
    execFileSync(process.execPath, ['.sdd/scripts/quality-gate.js'], { cwd: project, stdio: 'pipe' });
});

test('rerunning is idempotent and preserves user edits and custom config keys', () => {
    const project = tempRepo();
    init(project, '--name=app');
    fs.appendFileSync(path.join(project, '.agents/AGENTS.md'), '\n## 9. Custom rule\n');
    const config = JSON.parse(read(project, 'sdd.config.json'));
    config.custom = { keep: true };
    config.architecture.maxLocPerFile = 250;
    fs.writeFileSync(path.join(project, 'sdd.config.json'), JSON.stringify(config));

    init(project, '--name=app', '--mode=rigor');

    assert.match(read(project, '.agents/AGENTS.md'), /Custom rule/);
    const merged = JSON.parse(read(project, 'sdd.config.json'));
    assert.deepStrictEqual(merged.custom, { keep: true });
    assert.strictEqual(merged.architecture.maxLocPerFile, 250);
    assert.strictEqual(merged.specification.mode, 'rigor');
    for (const doc of ['PLAN_OF_RECORD', 'EXECUTION_GUIDE', 'COMPLIANCE_LOG']) {
        assert.ok(exists(project, `docs/roadmap/${doc}.md`), `${doc}.md should exist`);
    }
    assert.match(read(project, 'AGENTS.md'), /docs\/roadmap\/.*Rigor mode/);
});

test('unmanaged AGENTS.md and CLAUDE.md are never overwritten', () => {
    const project = tempRepo();
    writeFiles(project, { 'AGENTS.md': '# Mine\n', 'CLAUDE.md': '# Mine too\n' });
    const output = init(project);
    assert.strictEqual(read(project, 'AGENTS.md'), '# Mine\n');
    assert.strictEqual(read(project, 'CLAUDE.md'), '# Mine too\n');
    assert.match(output, /AGENTS\.md exists and is not managed/);
});

test('invalid flags fail loudly instead of silently defaulting', () => {
    const project = tempRepo();
    assert.throws(() => init(project, '--ast=grep'), /Unknown AST adapter "grep"/);
});

test('pre-push hook works in linked worktrees and chains an existing hook', () => {
    const project = tempRepo();
    writeFiles(project, { 'README.md': '# app\n' });
    git(project, 'add', '-A');
    git(project, 'commit', '-q', '-m', 'init');
    const hookPath = path.join(project, '.git/hooks/pre-push');
    fs.writeFileSync(hookPath, '#!/bin/sh\necho previous-hook-ran\n', { mode: 0o755 });

    const worktree = path.join(tempDir(), 'wt');
    git(project, 'worktree', 'add', '-q', worktree);
    init(worktree);

    assert.match(fs.readFileSync(hookPath, 'utf8'), /sdd:managed/);
    assert.match(fs.readFileSync(`${hookPath}.local`, 'utf8'), /previous-hook-ran/);

    git(worktree, 'add', '-A');
    const output = execFileSync(hookPath, [], { cwd: worktree, input: '', encoding: 'utf8' });
    assert.match(output, /previous-hook-ran/);
    assert.match(output, /Quality gate passed/);
});

test('a hook from an earlier framework version is replaced, not chained', () => {
    const project = tempRepo();
    const hookPath = path.join(project, '.git/hooks/pre-push');
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, '#!/usr/bin/env bash\n# Pre-push hook: Agentic SDD Quality Gate\nnpm run quality-gate\n');
    init(project);
    assert.match(fs.readFileSync(hookPath, 'utf8'), /sdd:managed/);
    assert.ok(!fs.existsSync(`${hookPath}.local`));
});

test('clone mode uses templates in place and does not copy tooling', () => {
    const clone = tempRepo();
    for (const rel of ['scripts', '.agents', 'docs', 'package.json', 'sdd.config.json']) {
        fs.cpSync(path.join(FRAMEWORK_ROOT, rel), path.join(clone, rel), { recursive: true });
    }
    execFileSync(process.execPath, ['scripts/sdd-init.js', '--express', '--name=cloned'], { cwd: clone, stdio: 'pipe' });

    assert.ok(!exists(clone, '.sdd'));
    assert.match(read(clone, 'AGENTS.md'), /node scripts\/quality-gate\.js/);
    assert.strictEqual(JSON.parse(read(clone, 'sdd.config.json')).project.type, 'application');
});
