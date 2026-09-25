const test = require('node:test');
const assert = require('node:assert');
const { countLines, run } = require('../scripts/check-file-size');
const { tempRepo, git, writeFiles } = require('./helpers');

const linesOf = n => 'x\n'.repeat(n);

test('counts lines with and without a trailing newline', () => {
    assert.strictEqual(countLines(''), 0);
    assert.strictEqual(countLines('a'), 1);
    assert.strictEqual(countLines('a\nb\n'), 2);
});

test('fails on source files above maxLocPerFile and ignores docs', () => {
    const repo = tempRepo();
    writeFiles(repo, {
        'sdd.config.json': JSON.stringify({ architecture: { maxLocPerFile: 10 } }),
        'src/ok.ts': linesOf(10),
        'src/big.go': linesOf(11),
        'docs/long.md': linesOf(500)
    });
    git(repo, 'add', '-A');
    const result = run({ root: repo });
    assert.strictEqual(result.ok, false);
    assert.match(result.report, /src\/big\.go: 11 lines/);
    assert.doesNotMatch(result.report, /ok\.ts|long\.md/);
});

test('honors maxLocExclude and a limit of 0', () => {
    const repo = tempRepo();
    writeFiles(repo, { 'gen/big.py': linesOf(50) });
    git(repo, 'add', '-A');

    writeFiles(repo, { 'sdd.config.json': JSON.stringify({ architecture: { maxLocPerFile: 10, maxLocExclude: ['gen/'] } }) });
    assert.strictEqual(run({ root: repo }).ok, true);

    writeFiles(repo, { 'sdd.config.json': JSON.stringify({ architecture: { maxLocPerFile: 0 } }) });
    assert.match(run({ root: repo }).report, /disabled/);
});
