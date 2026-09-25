#!/usr/bin/env node

/**
 * scripts/install-git-hooks.js
 *
 * Installs a pre-push hook that runs the quality gate on the commits being pushed
 * (`quality-gate.js --push`), not on the working tree.
 *
 * The hook goes into the repository's own hooks directory (`git rev-parse --git-path
 * hooks`, shared by linked worktrees). When core.hooksPath is set, the hooks directory is
 * owned by a hook manager or shared across repositories, so nothing is installed and the
 * command to add to that manager is printed instead. An existing unmanaged pre-push hook
 * is preserved as pre-push.local and runs first.
 */

const fs = require('fs');
const path = require('path');
const { git, repoRoot } = require('./lib/git');

const MARKER = 'sdd:managed';
// Signature of the hook written by framework versions before the marker existed.
const LEGACY_SIGNATURE = '# Pre-push hook: Agentic SDD Quality Gate';

const toPosix = p => p.split(path.sep).join('/');

function renderHook(gateScript, nodePath) {
    return `#!/bin/sh
# ${MARKER} pre-push hook installed by the Agentic SDD Framework.
# A pre-existing hook, if any, was moved to pre-push.local and runs first.
HOOK_DIR=$(dirname "$0")
INPUT=$(cat)
if [ -x "$HOOK_DIR/pre-push.local" ]; then
    printf '%s\\n' "$INPUT" | "$HOOK_DIR/pre-push.local" "$@" || exit 1
fi

# GUI git clients may not have node on PATH; fall back to the node that installed the hook.
NODE_BIN=node
command -v node >/dev/null 2>&1 || NODE_BIN="${nodePath}"

if ! printf '%s\\n' "$INPUT" | "$NODE_BIN" "${gateScript}" --push "$1"; then
    echo "Quality gate failed. Push aborted." >&2
    exit 1
fi
`;
}

function configuredHooksPath(root) {
    try {
        return git(['config', '--get', 'core.hooksPath'], root).trim();
    } catch {
        return '';
    }
}

function install({ root = repoRoot(), gateScript = path.join(__dirname, 'quality-gate.js'), nodePath = process.execPath } = {}) {
    // Git runs the hook from the real (symlink-resolved) worktree path, so the relative
    // path must be computed between real paths too.
    const relativeGate = toPosix(path.relative(fs.realpathSync(root), fs.realpathSync(gateScript)));
    const hooksPath = configuredHooksPath(root);
    if (hooksPath) {
        throw new Error(
            `core.hooksPath is set (${hooksPath}); that directory belongs to a hook manager or is shared by other repositories, so no hook was installed. ` +
            `Add this to its pre-push hook, passing the hook's stdin: node ${relativeGate} --push "$1"`
        );
    }
    let hooksDir;
    try {
        hooksDir = path.resolve(root, git(['rev-parse', '--git-path', 'hooks'], root).trim());
    } catch {
        throw new Error(`${root} is not a git repository.`);
    }
    fs.mkdirSync(hooksDir, { recursive: true });

    const hookPath = path.join(hooksDir, 'pre-push');
    const localPath = path.join(hooksDir, 'pre-push.local');
    let preserved = false;
    const current = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, 'utf8') : null;
    if (current !== null && !current.includes(MARKER) && !current.includes(LEGACY_SIGNATURE)) {
        if (fs.existsSync(localPath)) {
            throw new Error(`Both ${hookPath} and pre-push.local exist. Merge them manually, then rerun.`);
        }
        fs.renameSync(hookPath, localPath);
        preserved = true;
    }

    // Git runs hooks from the worktree root, so a root-relative path works in every worktree.
    fs.writeFileSync(hookPath, renderHook(relativeGate, toPosix(nodePath)), { mode: 0o755 });
    fs.chmodSync(hookPath, 0o755);
    return { hookPath, preserved };
}

if (require.main === module) {
    try {
        const { hookPath, preserved } = install();
        if (preserved) console.log('ℹ️  Existing pre-push hook preserved as pre-push.local (runs first).');
        console.log(`✅ Pre-push quality gate hook installed at ${hookPath}\n`);
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exit(1);
    }
}

module.exports = { MARKER, install, renderHook };
