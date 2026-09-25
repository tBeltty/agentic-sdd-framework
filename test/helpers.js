const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const created = [];
process.on('exit', () => {
    for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

// Temporary directories are removed when the test process exits.
function tempDir(prefix = 'sdd-test-') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    created.push(dir);
    return dir;
}

function git(cwd, ...args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Empty repository with a local identity so commits work on CI runners.
function tempRepo() {
    const dir = tempDir();
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.name', 'SDD Test');
    git(dir, 'config', 'user.email', 'sdd-test@example.com');
    return dir;
}

function writeFiles(root, files) {
    for (const [file, content] of Object.entries(files)) {
        const target = path.join(root, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
}

// Runs a git hook as git does: directly on macOS/Linux, through Git for Windows' sh on Windows.
function runHook(hookPath, args, options) {
    const [file, argv] = process.platform === 'win32' ? ['sh', [hookPath, ...args]] : [hookPath, args];
    return spawnSync(file, argv, { encoding: 'utf8', ...options });
}

module.exports = { tempDir, tempRepo, git, writeFiles, runHook };
