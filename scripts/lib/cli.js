/**
 * scripts/lib/cli.js
 *
 * Shared entry point for the check scripts: parses the source flags, prints the banner,
 * and turns any thrown error into a failing exit code instead of a stack trace.
 */

const { repoRoot } = require('./git');

const SOURCE_USAGE = '[--staged | --ref=<commit>]';

// Strict flag parsing: --staged -> index, --ref=<commit> or --ref <commit> -> that commit,
// no flag -> the working tree. With allowPush, --push [remote] selects pre-push mode.
// Unknown flags are errors, so a typo never silently checks the working tree instead.
function parseCheckArgs(argv, { allowPush = false } = {}) {
    const usage = `Usage: ${SOURCE_USAGE}${allowPush ? ' | --push [remote]' : ''}`;
    const options = { source: { kind: 'worktree' }, push: false, remoteName: '' };
    const chosen = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--staged') {
            options.source = { kind: 'index' };
            chosen.push(arg);
        } else if (arg === '--ref' || arg.startsWith('--ref=')) {
            const ref = arg === '--ref' ? argv[++i] : arg.slice('--ref='.length);
            if (!ref || ref.startsWith('-')) throw new Error(`--ref needs a commit. ${usage}`);
            options.source = { kind: 'ref', ref };
            chosen.push('--ref');
        } else if (allowPush && arg === '--push') {
            options.push = true;
            chosen.push(arg);
            if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) options.remoteName = argv[++i];
            // git passes the remote URL as a second argument to pre-push hooks.
            if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) i++;
        } else if (arg === '--help' || arg === '-h') {
            throw new Error(usage);
        } else {
            throw new Error(`Unknown argument "${arg}". ${usage}`);
        }
    }
    if (chosen.length > 1) throw new Error(`${chosen.join(' and ')} are separate modes. ${usage}`);
    return options;
}

function runCheckCli(title, run, argv = process.argv.slice(2)) {
    console.log('\n======================================================');
    console.log(`  ${title}`);
    console.log('======================================================\n');
    let result;
    try {
        const { source } = parseCheckArgs(argv);
        result = run({ root: repoRoot(), source });
    } catch (error) {
        result = { ok: false, report: `❌ ${error.message}` };
    }
    (result.ok ? console.log : console.error)(result.report + '\n');
    process.exit(result.ok ? 0 : 1);
}

module.exports = { parseCheckArgs, runCheckCli };
