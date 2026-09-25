/**
 * scripts/lib/cli.js
 *
 * Shared entry point for the check scripts: parses the source flags, prints the banner,
 * and turns any thrown error into a failing exit code instead of a stack trace.
 */

const { repoRoot } = require('./git');

// --staged -> index, --ref=<commit> -> that commit, otherwise the working tree.
function sourceFromArgs(argv) {
    if (argv.includes('--staged')) return { kind: 'index' };
    const ref = argv.find(a => a.startsWith('--ref='));
    if (ref) return { kind: 'ref', ref: ref.slice('--ref='.length) };
    return { kind: 'worktree' };
}

function runCheckCli(title, run, argv = process.argv.slice(2)) {
    console.log('\n======================================================');
    console.log(`  ${title}`);
    console.log('======================================================\n');
    let result;
    try {
        result = run({ root: repoRoot(), source: sourceFromArgs(argv) });
    } catch (error) {
        result = { ok: false, report: `❌ ${error.message}` };
    }
    (result.ok ? console.log : console.error)(result.report + '\n');
    process.exit(result.ok ? 0 : 1);
}

module.exports = { sourceFromArgs, runCheckCli };
