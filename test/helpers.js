const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function tempDir(prefix = 'sdd-test-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

module.exports = { tempDir, tempRepo, git, writeFiles };
