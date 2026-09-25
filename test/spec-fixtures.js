// Shared fixtures for the Lite specification tests (spec.test.js, verify.test.js).
const fs = require('fs');
const path = require('path');
const { tempRepo, git, writeFiles } = require('./helpers');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '../docs/SPEC_TEMPLATE.md'), 'utf8');
const NODE = JSON.stringify(process.execPath);

// Builds a spec from the real template so the tests track its format.
function spec({ status, checked = [], evidence = {}, command = 'npm test', expected = '3 passed', lastVerified }) {
    let text = TEMPLATE.replace('**Status:** Draft | In Progress | Completed', `**Status:** ${status}`);
    text = text.replace('[command to run tests or validation scripts]', command);
    text = text.replace('[exact pattern or output line confirming success]', expected);
    if (lastVerified) text = text.replace('[recorded by sdd-verify --record]', lastVerified);
    for (const id of checked) text = text.replace(`* [ ] **${id}:**`, `* [x] **${id}:**`);
    for (const [id, value] of Object.entries(evidence)) {
        const marker = '  * **Evidence:** [command run and its literal output]';
        const at = text.indexOf(marker, text.indexOf(`**${id}:**`));
        text = text.slice(0, at) + `  * **Evidence:** ${value}` + text.slice(at + marker.length);
    }
    return text;
}
const ALL = ['T1', 'T2', 'T3'];

function liteProject(specText, config = {}) {
    const repo = tempRepo();
    writeFiles(repo, {
        'sdd.config.json': JSON.stringify({ project: { type: 'application' }, specification: { mode: 'lite', ...config } }),
        'docs/SPEC.md': specText,
        'src/app.txt': 'v1\n'
    });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    return repo;
}
const quiet = () => {};
const completedSpec = (command, expected = 'ok') =>
    spec({ status: 'Completed', checked: ALL, evidence: { T1: 'x', T2: 'x', T3: 'x' }, command, expected });


module.exports = { TEMPLATE, NODE, spec, ALL, liteProject, quiet, completedSpec };
