const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { scanContent, sensitiveFileName, run } = require('../scripts/verify-no-secrets');
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
const found = text => scanContent(text).violations;

for (const [name, key] of Object.entries(KEYS)) {
    test(`detects ${name}`, () => {
        const [violation] = found(`value = ${key}`);
        assert.ok(violation, `expected ${name} to be detected`);
        assert.strictEqual(violation.patternName, name);
        assert.ok(!violation.snippet.includes(key), 'snippet must be masked');
    });
}

test('F12: detects PGP private key blocks', () => {
    assert.strictEqual(found('-----BEGIN PGP ' + 'PRIVATE KEY BLOCK-----')[0].patternName, 'Private Key Block');
});

test('F14: detects credentials embedded in URLs, ignores placeholders and variables', () => {
    assert.strictEqual(found('DATABASE_URL=postgres://admin:' + 'S3cr3tPassw0rd99@db.internal:5432/prod')[0].patternName, 'Credentials in URL');
    assert.deepStrictEqual(found('url = "postgres://user:${DB_PASSWORD}@localhost/db"'), []);
    assert.deepStrictEqual(found('url = "postgres://user:<password>@localhost/db"'), []);
    assert.deepStrictEqual(found('see https://example.com/docs'), []);
});

test('F15: detects high-entropy values assigned to secret-named keys', () => {
    for (const line of [
        'DB_PASSWORD=Xk9' + '#mQ2vL7pR4tZ8',
        'client_secret: "' + alnum(20) + '"',
        'ACCESS_TOKEN=' + alnum(32),
        'refresh-token = \'' + alnum(24) + '\''
    ]) {
        assert.strictEqual(found(line)[0]?.patternName, 'Secret Assignment', line);
    }
});

test('F15: ordinary code that mentions secret-named keys is not reported', () => {
    for (const line of [
        'const password = process.env.DB_PASSWORD;',
        'password = os.environ["DB_PASSWORD"]',
        'api_key = getApiKey(config)',
        'PASSWORD_MIN_LENGTH=12',
        'password: str',
        'secret_key = settings.SECRET_KEY_FALLBACK',
        'access_token = "${ACCESS_TOKEN}"',
        'password = "changeme12345"'
    ]) {
        assert.deepStrictEqual(found(line), [], line);
    }
});

test('a placeholder word elsewhere on the line does not hide a real key', () => {
    assert.strictEqual(found(`key = "${KEYS['Stripe Live Key']}" # placeholder`).length, 1);
});

test('placeholder values are ignored', () => {
    assert.deepStrictEqual(found('key = sk' + '_live_dummy1234567890abcdef'), []);
    assert.deepStrictEqual(found('API_KEY = "YOUR' + '_API_KEY_GOES_HERE_1234567"'), []);
});

test('F10: the pragma suppresses a line and the suppression is counted', () => {
    const result = scanContent(`${KEYS['GitHub Token']} // sdd-allow-secret`);
    assert.deepStrictEqual(result.violations, []);
    assert.strictEqual(result.suppressed, 1);
});

test('identifiers that start with re_ are not Resend keys', () => {
    assert.deepStrictEqual(found('secure_mode=are' + '_abcdefghijklmnopqrstuvwxyz'), []);
    assert.deepStrictEqual(found('const re' + '_compiled_pattern_for_matching = 1;'), []);
});

test('CRLF content is scanned line by line', () => {
    assert.strictEqual(scanContent(`a\r\nkey=${KEYS['GitHub Token']}\r\n`).violations[0].line, 2);
});

test('F14: sensitive file names', () => {
    for (const file of ['.env', 'config/.env.production', 'id_rsa', 'deploy/server.key', 'certs/app.p12']) {
        assert.ok(sensitiveFileName(file), file);
    }
    for (const file of ['.env.example', '.env.sample', 'id_rsa.pub', 'keys.md', 'src/key.js']) {
        assert.strictEqual(sensitiveFileName(file), null, file);
    }
});

test('F14: a tracked .env fails the scan unless listed in security.allowFiles', () => {
    const repo = tempRepo();
    writeFiles(repo, { '.env': 'MODE=development\n' });
    git(repo, 'add', '-f', '.env');
    const result = run({ root: repo });
    assert.strictEqual(result.ok, false);
    assert.match(result.report, /Tracked Environment file/);

    writeFiles(repo, { 'sdd.config.json': JSON.stringify({ security: { allowFiles: ['.env'] } }) });
    git(repo, 'add', 'sdd.config.json');
    assert.strictEqual(run({ root: repo }).ok, true);
});

test('index source scans the staged content, not the working tree', () => {
    const repo = tempRepo();
    writeFiles(repo, { 'app.txt': `TOKEN=${KEYS['GitHub Token']}\n` });
    git(repo, 'add', 'app.txt');
    writeFiles(repo, { 'app.txt': 'TOKEN=removed-from-working-tree-only\n' });

    assert.strictEqual(run({ root: repo, source: { kind: 'index' } }).ok, false);
    assert.strictEqual(run({ root: repo }).ok, true);
});

test('ref source scans the commit, not the working tree', () => {
    const repo = tempRepo();
    writeFiles(repo, { 'app.txt': `TOKEN=${KEYS['GitHub Token']}\n` });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'leak');
    writeFiles(repo, { 'app.txt': 'TOKEN=removed\n' });
    assert.strictEqual(run({ root: repo, source: { kind: 'ref', ref: 'HEAD' } }).ok, false);
});

test('binary files are skipped', () => {
    const repo = tempRepo();
    writeFiles(repo, { 'blob.bin': Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(KEYS['GitHub Token'])]) });
    git(repo, 'add', '.');
    assert.strictEqual(run({ root: repo }).ok, true);
});

test('F1: a tracked symlink is read as its link text, never followed', { skip: process.platform === 'win32' && 'symlinks need developer mode' }, () => {
    const repo = tempRepo();
    const outside = path.join(require('os').tmpdir(), `sdd-outside-${process.pid}.txt`);
    fs.writeFileSync(outside, `TOKEN=${KEYS['GitHub Token']}\n`);
    fs.symlinkSync(outside, path.join(repo, 'link.txt'));
    git(repo, 'add', 'link.txt');
    try {
        assert.strictEqual(run({ root: repo }).ok, true);
    } finally {
        fs.rmSync(outside);
    }
});
