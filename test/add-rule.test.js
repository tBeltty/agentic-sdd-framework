const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { run } = require('../scripts/sdd-add-rule');
const { run: checkConstitution } = require('../scripts/check-constitution');
const { tempRepo, git, writeFiles } = require('./helpers');

function withConstitution(repo, body = '# Agent Constitution\n') {
    writeFiles(repo, { '.agents/AGENTS.md': body });
}

test('refuses when .agents/AGENTS.md does not exist', () => {
    const repo = tempRepo();
    const result = run({ root: repo, argv: ['--title=X', '--rule=Y', '--why=Z'] });
    assert.strictEqual(result.ok, false);
    assert.match(result.report, /does not exist/);
});

test('refuses missing or placeholder fields', () => {
    const repo = tempRepo();
    withConstitution(repo);
    assert.strictEqual(run({ root: repo, argv: ['--title=X', '--rule=Y'] }).ok, false);
    assert.match(run({ root: repo, argv: ['--title=X', '--rule=Y'] }).report, /--why required/);
    assert.strictEqual(
        run({ root: repo, argv: ['--title=X', '--rule=Y', '--why=[fill this in]'] }).ok,
        false
    );
});

test('rejects an unknown --fulfills id', () => {
    const repo = tempRepo();
    withConstitution(repo);
    const result = run({ root: repo, argv: ['--title=X', '--rule=Y', '--why=Z', '--fulfills=not-a-real-id'] });
    assert.strictEqual(result.ok, false);
    assert.match(result.report, /Unknown --fulfills id/);
});

test('appends a correctly numbered, tagged rule block', () => {
    const repo = tempRepo();
    withConstitution(repo, '# Agent Constitution\n\n---\n\n## 1. Existing Rule\n* **Rule:** be careful.\n');
    const result = run({
        root: repo,
        argv: ['--title=No Bare Fetch', '--rule=Always wrap fetch in the retry helper.', '--why=Two outages traced to unretried network calls.']
    });
    assert.strictEqual(result.ok, true);
    assert.match(result.report, /Added rule 2/);

    const text = fs.readFileSync(path.join(repo, '.agents/AGENTS.md'), 'utf8');
    assert.match(text, /## 2\. No Bare Fetch/);
    assert.match(text, /<!-- sdd:rule id="no-bare-fetch" tier="custom" -->/);
    assert.match(text, /Two outages traced to unretried network calls\./);
});

test('--fulfills tags the block with a known critical id, and the gate recognizes it', () => {
    const repo = tempRepo();
    withConstitution(repo);
    const result = run({
        root: repo,
        argv: [
            '--title=Ship It Only When It Ran',
            '--rule=A task is not done until its command exits 0.',
            '--why=Same idea as the default, our own words.',
            '--fulfills=mandatory-verification'
        ]
    });
    assert.strictEqual(result.ok, true);
    assert.match(result.report, /Recognized by the gate as fulfilling the "mandatory-verification" critical rule/);

    git(repo, 'add', '-A');
    const gate = checkConstitution({ root: repo });
    assert.strictEqual(gate.ok, true);
    assert.doesNotMatch(gate.report, /Mandatory Verification/);
});
