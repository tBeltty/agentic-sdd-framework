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
    assert.match(read(project, 'AGENTS.md'), /node \.sdd\/scripts\/sdd-verify\.js --record/);
    assert.ok(exists(project, '.sdd/scripts/check-spec.js'));
    assert.ok(exists(project, 'docs/roadmap/templates/execution-guide.md'));
    assert.match(read(project, 'CLAUDE.md'), /^@\.agents\/AGENTS\.md$/m);
    assert.match(read(project, '.agents/CONTEXT.md'), /\*\*Primary Runtime:\*\* go-1\.23/);
    assert.match(read(project, 'docs/decisions/ADR-0001-stack-and-architecture.md'), /Hardware and Deployment:\*\* \$5 VPS/);
    // Windows without developer mode cannot create symlinks; the wizard copies instead.
    const skillEntry = fs.lstatSync(path.join(project, '.claude/skills/strategic-cto'));
    assert.ok(skillEntry.isSymbolicLink() || (process.platform === 'win32' && skillEntry.isDirectory()));

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
    config['x-team'] = { keep: true };
    config.architecture.maxLocPerFile = 250;
    fs.writeFileSync(path.join(project, 'sdd.config.json'), JSON.stringify(config));

    init(project, '--name=app', '--mode=rigor');

    assert.match(read(project, '.agents/AGENTS.md'), /Custom rule/);
    const merged = JSON.parse(read(project, 'sdd.config.json'));
    assert.deepStrictEqual(merged['x-team'], { keep: true });
    assert.strictEqual(merged.architecture.maxLocPerFile, 250);
    assert.strictEqual(merged.specification.mode, 'rigor');
    for (const doc of ['plan-of-record', 'execution-guide', 'compliance-log']) {
        assert.ok(exists(project, `docs/roadmap/${doc}.md`), `${doc}.md should exist`);
    }
    assert.ok(exists(project, 'docs/roadmap/annexes/.gitkeep'));
    assert.match(read(project, 'docs/roadmap/execution-guide.md'), /^# app . Execution Guide/);
    assert.match(read(project, 'AGENTS.md'), /docs\/roadmap\/.*Rigor mode/);
    assert.match(read(project, 'AGENTS.md'), /auditkit lint docs\/roadmap/);
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

test('pre-push hook works in linked worktrees and chains an existing hook', { skip: process.platform === 'win32' && 'runs the sh hook directly' }, () => {
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
    git(worktree, 'commit', '-q', '-m', 'provision');
    const sha = git(worktree, 'rev-parse', 'HEAD').trim();
    const input = `refs/heads/wt ${sha} refs/heads/wt ${'0'.repeat(40)}\n`;
    const output = execFileSync(hookPath, ['origin'], { cwd: worktree, input, encoding: 'utf8' });
    assert.match(output, /previous-hook-ran/);
    assert.match(output, /Specification Check ---\n✅ docs\/SPEC\.md/);
    assert.match(output, /No secrets added by the \d+ commit\(s\) being pushed/);
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

test('F7: an invalid existing config stops sdd-init with the exact problems', () => {
    const project = tempRepo();
    writeFiles(project, { 'sdd.config.json': JSON.stringify({ architecture: { maxLocPerFle: 10 } }) });
    assert.throws(() => init(project), /architecture\.maxLocPerFle: unknown key/);
});

test('F59: sdd-init rejects unknown flags and accepts "--flag value"', () => {
    const project = tempRepo();
    assert.throws(() => init(project, '--mdoe=rigor'), /Unknown flag "--mdoe=rigor"/);
    const target = tempRepo();
    execFileSync(process.execPath, [INIT, '--express', '--target', target, '--mode', 'rigor'], { cwd: tempDir(), stdio: 'pipe' });
    assert.ok(exists(target, 'docs/roadmap/execution-guide.md'));
    assert.ok(!exists(project, 'AGENTS.md'));
});

test('F72: install mode records the tooling version; F77: entry point follows roadmapDir', () => {
    const project = tempRepo();
    writeFiles(project, { 'sdd.config.json': JSON.stringify({ specification: { roadmapDir: 'plans' } }) });
    init(project, '--mode=rigor');
    const version = JSON.parse(fs.readFileSync(path.join(FRAMEWORK_ROOT, 'package.json'), 'utf8')).version;
    assert.strictEqual(read(project, '.sdd/VERSION').trim(), version);
    assert.match(read(project, 'AGENTS.md'), /auditkit lint plans/);
    assert.match(read(project, 'sdd.config.json'), new RegExp(`agentic-sdd-framework/v${version.replace(/\./g, '\\.')}/scripts/lib/sdd\\.config\\.schema\\.json`));
});

test('F76: a skipped AGENTS.md is reported in the next steps', () => {
    const project = tempRepo();
    writeFiles(project, { 'AGENTS.md': '# Mine\n' });
    assert.match(init(project), /already existed and[\s\S]*will not load the rules/);
});

test('F60: --force refreshes copied .claude/skills directories', () => {
    const project = tempRepo();
    init(project);
    const link = path.join(project, '.claude/skills/no-ai-slop');
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(link, { recursive: true });
    fs.writeFileSync(path.join(link, 'SKILL.md'), 'stale copy');
    fs.writeFileSync(path.join(link, '.sdd-managed-copy'), '');
    init(project);
    assert.strictEqual(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8'), 'stale copy');
    init(project, '--force');
    assert.match(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8'), /No AI Slop/);

    // A directory the user created (no marker) is never replaced, even with --force.
    const own = path.join(project, '.claude/skills/strategic-cto');
    fs.rmSync(own, { recursive: true, force: true });
    fs.mkdirSync(own, { recursive: true });
    fs.writeFileSync(path.join(own, 'SKILL.md'), 'my own skill');
    init(project, '--force');
    assert.strictEqual(fs.readFileSync(path.join(own, 'SKILL.md'), 'utf8'), 'my own skill');
});
