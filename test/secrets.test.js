const test = require('node:test');
const assert = require('node:assert');
const { scanContent, run } = require('../scripts/verify-no-secrets');
const { tempRepo, git, writeFiles } = require('./helpers');

// Fixtures are assembled at runtime so this file never contains a literal key.
const alnum = n => 'aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zC'.repeat(4).slice(0, n);
const KEYS = {
    'Anthropic API Key': 'sk-' + 'ant-api03-' + alnum(40),
    'OpenAI API Key': 'sk-' + 'proj-' + alnum(40),
    'OpenAI Legacy API Key': 'sk-' + alnum(48),
    'Stripe Live Key': 'sk' + '_live_' + alnum(24),
    'GitHub Token': 'ghp' + '_' + alnum(36),
    'GitHub Fine-Grained Token': 'github' + '_pat_' + alnum(22) + '_' + alnum(59),
    'Slack Token': 'xox' + 'b-' + alnum(24),
    'Resend API Key': 're' + '_' + alnum(8) + '_' + alnum(24),
    'AWS Access Key ID': 'AKIA' + 'IOSFODNN7EXAMPL1',
    'Google API Key': 'AIza' + alnum(20) + '-_' + alnum(13),
    'Private Key Block': '-----BEGIN ' + 'RSA PRIVATE KEY-----'
};

for (const [name, key] of Object.entries(KEYS)) {
    test(`detects ${name}`, () => {
        const [violation] = scanContent(`value = ${key}`);
        assert.ok(violation, `expected ${name} to be detected`);
        assert.strictEqual(violation.patternName, name);
        assert.ok(!violation.snippet.includes(key), 'snippet must be masked');
    });
}

test('a placeholder word elsewhere on the line does not hide a real key', () => {
    const line = `key = "${KEYS['Stripe Live Key']}" # placeholder`;
    assert.strictEqual(scanContent(line).length, 1);
});

test('placeholder values are ignored', () => {
    assert.deepStrictEqual(scanContent('key = sk' + '_live_dummy1234567890abcdef'), []);
    assert.deepStrictEqual(scanContent('API_KEY = "YOUR' + '_API_KEY_GOES_HERE_1234567"'), []);
});

test('explicit pragma allows a known false positive', () => {
    assert.deepStrictEqual(scanContent(`${KEYS['GitHub Token']} // sdd-allow-secret`), []);
});

test('identifiers that start with re_ are not Resend keys', () => {
    assert.deepStrictEqual(scanContent('secure_mode=are' + '_abcdefghijklmnopqrstuvwxyz'), []);
    assert.deepStrictEqual(scanContent('const re' + '_compiled_pattern_for_matching = 1;'), []);
});

test('staged mode scans the index, not the working tree', () => {
    const repo = tempRepo();
    writeFiles(repo, { 'app.env': `TOKEN=${KEYS['GitHub Token']}\n` });
    git(repo, 'add', 'app.env');
    writeFiles(repo, { 'app.env': 'TOKEN=removed-from-working-tree-only\n' });

    assert.strictEqual(run({ root: repo, staged: true }).ok, false);
    assert.strictEqual(run({ root: repo, staged: false }).ok, true);
});

test('binary files are skipped', () => {
    const repo = tempRepo();
    writeFiles(repo, { 'blob.bin': Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(KEYS['GitHub Token'])]) });
    git(repo, 'add', '.');
    assert.strictEqual(run({ root: repo }).ok, true);
});
