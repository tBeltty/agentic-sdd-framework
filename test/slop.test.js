const test = require('node:test');
const assert = require('node:assert');
const { lintContent, run } = require('../scripts/check-copy-slop');
const { tempRepo, git, writeFiles } = require('./helpers');

const flagged = text => lintContent(text).map(v => v.pattern);

test('flags binary contrast', () => {
    assert.match(flagged('It is not a tool, it is an operating system.')[0], /Binary Contrast/);
    assert.match(flagged("It's not a library; it's a runtime.")[0], /Binary Contrast/);
    assert.match(flagged("That's not a bug, but rather a contract.")[0], /Binary Contrast/);
});

test('does not flag ordinary sentences that contain "not"', () => {
    assert.deepStrictEqual(flagged('It is not cached because it is generated per request.'), []);
    assert.deepStrictEqual(flagged('This is not supported on Windows.'), []);
});

test('flags buzzwords listed in the no-ai-slop skill', () => {
    for (const word of ['robust', 'seamless', 'utilize', 'leveraging', 'cutting-edge', 'paradigm shift']) {
        assert.deepStrictEqual(flagged(`A ${word} design.`), ['AI Buzzword'], word);
    }
});

test('ignores fenced code, inline code and table rows', () => {
    const text = [
        '```',
        'const robust = true; // leverage',
        '```',
        'Set `robust: true` in the config.',
        '| robust | seamless |'
    ].join('\n');
    assert.deepStrictEqual(flagged(text), []);
});

test('enforces the em dash budget per file', () => {
    assert.deepStrictEqual(flagged('One — dash.'), []);
    assert.match(flagged('One — dash.\nTwo — dashes.')[0], /Em Dash Overuse \(2 found, max 1/);
    assert.deepStrictEqual(lintContent('a — b\nc — d', { maxEmDashes: 2 }), []);
});

test('honors enabled=false and exclude from sdd.config.json', () => {
    const repo = tempRepo();
    writeFiles(repo, { 'docs/a.md': 'A robust plan.\n', 'vendor/b.md': 'A seamless plan.\n' });
    git(repo, 'add', '.');
    assert.strictEqual(run({ root: repo }).ok, false);

    writeFiles(repo, { 'sdd.config.json': JSON.stringify({ capabilities: { noAiSlop: { exclude: ['docs/', 'vendor/'] } } }) });
    assert.strictEqual(run({ root: repo }).ok, true);

    writeFiles(repo, { 'sdd.config.json': JSON.stringify({ capabilities: { noAiSlop: { enabled: false } } }) });
    assert.match(run({ root: repo }).report, /disabled/);
});
