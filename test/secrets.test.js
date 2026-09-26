const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { scanContent, sensitiveFileName, textOf, run } = require('../scripts/verify-no-secrets');
const { tempRepo, git, writeFiles } = require('./helpers');
const { readBlobs } = require('../scripts/lib/git');

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
const found = (text, file = '') => scanContent(text, { file }).violations;

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

test('F15: detects literals assigned to secret-named keys (quoted anywhere, unquoted in config files)', () => {
    for (const [line, file] of [
        ['DB_PASSWORD=Xk9' + '#mQ2vL7pR4tZ8', '.env'],
        ['client_secret: "' + alnum(20) + '"', 'src/app.ts'],
        ['ACCESS_TOKEN=' + alnum(32), 'deploy/prod.env'],
        ['refresh-token = \'' + alnum(24) + '\'', 'src/app.py'],
        ['JWT_SECRET=4f9a8b7c' + '6d5e4f3a2b1c9d8e', '.env'],
        ['{"token": "4f9a8b7c' + '6d5e4f3a2b1c"}', 'settings.json'],
        ['secret: 4f9a8b7c' + '6d5e4f3a2b1c9d8e', 'app.yaml'],
        ['DB_PASSWORD=correct' + 'horsebatterystaple', '.env'],
        ['password: "Summer' + '2024!"', 'src/app.ts']
    ]) {
        assert.strictEqual(found(line, file)[0]?.patternName, 'Secret Assignment', `${file}: ${line}`);
    }
});

test('F15/N12: expressions and references assigned to secret-named keys are not reported', () => {
    for (const [line, file] of [
        ['const password = process.env.DB_PASSWORD;', 'a.js'],
        ['password = os.environ["DB_PASSWORD"]', 'a.py'],
        ['api_key = getApiKey(config)', 'a.py'],
        ['PASSWORD_MIN_LENGTH=12', '.env'],
        ['password: str', 'a.py'],
        ['secret_key = settings.SECRET_KEY_FALLBACK', 'a.py'],
        ['access_token = "${ACCESS_TOKEN}"', 'a.toml'],
        ['password = "changeme12345"', 'a.py'],
        ['const accessToken = generateAccessTokenV2(user);', 'a.js'],
        ['password: hashPasswordSha256(input)', 'a.js'],
        ['secretKey = decodeBase64Key2(buf)', 'a.py'],
        ['const privateKey = loadPrivateKey2(keyPath)', 'a.js'],
        ['auth_token: authTokenCache2[userId]', 'a.js'],
        ['max_tokens: 4096', 'c.yaml'],
        ['tokenizer: bert-base-uncased-v2', 'c.yaml'],
        ['"description": "The access token is refreshed hourly"', 'a.json']
    ]) {
        assert.deepStrictEqual(found(line, file), [], `${file}: ${line}`);
    }
});

test('N11: a placeholder match does not hide a real key later on the same line', () => {
    const line = 'const k = "AKIA' + 'IOSFODNN7EXAMPLE"; const real = "' + KEYS['AWS Access Key ID'] + '"';
    assert.strictEqual(found(line)[0]?.patternName, 'AWS Access Key ID');
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

test('N13: a NUL byte or UTF-16 encoding does not hide a secret; binary noise is not reported', () => {
    const repo = tempRepo();
    writeFiles(repo, { 'blob.bin': Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(KEYS['GitHub Token'])]) });
    git(repo, 'add', '.');
    assert.strictEqual(run({ root: repo }).ok, false);

    assert.strictEqual(found(textOf(Buffer.from(`// \u0000\nconst key="${KEYS['AWS Access Key ID']}"`))).length, 1);
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`key=${KEYS['AWS Access Key ID']}`, 'utf16le')]);
    assert.strictEqual(found(textOf(utf16)).length, 1);

    const noise = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256));
    assert.deepStrictEqual(found(textOf(noise)), []);
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

const posixNames = process.platform === 'win32' && 'file name not allowed on Windows';

test('N1: a file whose name contains a newline is scanned in every source', { skip: posixNames }, () => {
    const repo = tempRepo();
    writeFiles(repo, { 'odd\nname.txt': `TOKEN=${KEYS['GitHub Token']}\n` });
    git(repo, 'add', '-A');
    assert.strictEqual(run({ root: repo }).ok, false, 'worktree');
    assert.strictEqual(run({ root: repo, source: { kind: 'index' } }).ok, false, 'index');
    git(repo, 'commit', '-q', '-m', 'odd');
    assert.strictEqual(run({ root: repo, source: { kind: 'ref', ref: 'HEAD' } }).ok, false, 'ref');
});

test('N2: a staged file named like an index stage ("0:...") is read by object id', { skip: posixNames }, () => {
    const repo = tempRepo();
    writeFiles(repo, { '0:leak.txt': `TOKEN=${KEYS['GitHub Token']}\n`, 'leak.txt': 'clean\n' });
    git(repo, 'add', '-A');
    const result = run({ root: repo, source: { kind: 'index' } });
    assert.strictEqual(result.ok, false);
    assert.match(result.report, /0:leak\.txt/);
});

test('R4: secret-named keys ending in _key, and unquoted values in shell, rc and Docker files', () => {
    const value = 'x7Kq9ZxLm2Pw8RtYv3Nc6Bh1Jd5Gs0Ae7Ui';
    for (const [line, file] of [
        [`SECRET_KEY = "${value}"`, 'settings.py'],
        [`aws_secret_key: ${value}`, 'config.yml'],
        [`signing_key = '${value}'`, 'app.rb'],
        [`//registry.npmjs.org/:_authToken=npm_${value}`, '.npmrc'],
        [`export API_TOKEN=${value}`, 'deploy.sh'],
        [`export AWS_SECRET_ACCESS_KEY=${value}`, '.envrc'],
        [`ENV STRIPE_SECRET=${value}`, 'Dockerfile'],
        [`ENV STRIPE_SECRET ${value}`, 'docker/api.Dockerfile'],
        [`set API_TOKEN=${value}`, 'deploy.cmd'],
        ['set DB_PASSWORD=S3cretPassw0rd', 'setup.bat'],
        ['setx DB_PASSWORD Hunter2Secret99', 'deploy.bat'],
        ['password := "hunter2' + 'hunter2"', 'main.go'],
        [`apiKey := "${value}"`, 'main.go'],
        [`setx /M API_TOKEN ${value}`, 'deploy.cmd']
    ]) {
        assert.strictEqual(found(line, file)[0]?.patternName, 'Secret Assignment', `${file}: ${line}`);
    }
    for (const [line, file] of [
        ['export API_TOKEN=$(vault read -field=token secret/api)', 'deploy.sh'],
        ['API_TOKEN="${API_TOKEN:-}"', 'run.sh'],
        ['cache_key: user-profile-v2-abcdef123456', 'c.yml'],
        ['primary_key = compute_primary_key(row)', 'a.py'],
        ['$password = Read-Host "Enter password" -AsSecureString', 'deploy.ps1'],
        ['$credential = Get-Credential', 'deploy.ps1'],
        ['set /p DB_PASSWORD=Enter the database password:', 'setup.bat'],
        ['password := os.Getenv("DB_PASSWORD")', 'main.go'],
        ['set API_TOKEN=%API_TOKEN%', 'deploy.cmd'],
        ['setx PATH "%PATH%;C:\\tools"', 'deploy.cmd'],
        ['$token = Get-AzAccessToken -ResourceUrl $url', 'deploy.ps1'],
        ['$securePassword = ConvertTo-SecureString $plain -AsPlainText -Force', 'deploy.ps1']
    ]) {
        assert.deepStrictEqual(found(line, file), [], `${file}: ${line}`);
    }
});

test('R3: a symlink replaced by a regular file is scanned when staged and in pushed history', { skip: process.platform === 'win32' && 'symlinks need developer mode' }, () => {
    const repo = tempRepo();
    writeFiles(repo, { 'target.txt': 'x\n' });
    fs.symlinkSync('target.txt', path.join(repo, 'config.txt'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'link');
    fs.rmSync(path.join(repo, 'config.txt'));
    writeFiles(repo, { 'config.txt': `aws = ${KEYS['AWS Access Key ID']}\n` });
    git(repo, 'add', '-A');
    assert.match(git(repo, 'diff', '--cached', '--name-status'), /^T\s+config\.txt/m);
    assert.strictEqual(run({ root: repo, source: { kind: 'index' } }).ok, false);
});

test('R5: blobs are read in bounded batches, so large content never overflows the buffer', () => {
    const repo = tempRepo();
    const big = n => Buffer.alloc(n, String.fromCharCode(97 + (n % 26)));
    writeFiles(repo, { 'a.bin': big(300 * 1024), 'b.bin': big(310 * 1024), 'c.bin': big(700 * 1024), 'd.txt': 'small\n' });
    git(repo, 'add', '-A');
    const oids = ['a.bin', 'b.bin', 'c.bin', 'd.txt'].map(f => git(repo, 'rev-parse', `:${f}`).trim());
    const blobs = readBlobs(repo, oids, { batchBytes: 400 * 1024, maxBuffer: 512 * 1024 });
    assert.deepStrictEqual(oids.map(o => blobs.get(o).length), [300 * 1024, 310 * 1024, 700 * 1024, 6]);
});

test('R34: only the scanner itself, known lockfiles, and node_modules segments are skipped', () => {
    const repo = tempRepo();
    const leak = `k=${KEYS['AWS Access Key ID']}\n`;
    const scanned = ['app/verify-no-secrets.js', 'lib/not_node_modules/cfg.py', 'app/deploy.lock', 'ctl.py'];
    const skipped = ['scripts/verify-no-secrets.js', '.sdd/scripts/verify-no-secrets.js', 'web/package-lock.json', 'node_modules/x/index.js', 'pkg/node_modules/y.js'];
    writeFiles(repo, Object.fromEntries([...scanned, ...skipped].map(f => [f, leak])));
    git(repo, 'add', '-A');
    const { report } = run({ root: repo });
    for (const f of scanned) assert.ok(report.includes(f), `${f} must be scanned`);
    for (const f of skipped) assert.ok(!report.includes(`File: ${f}`), `${f} must be skipped`);
});
