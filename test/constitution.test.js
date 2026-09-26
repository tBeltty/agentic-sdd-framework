const test = require('node:test');
const assert = require('node:assert');
const { run } = require('../scripts/check-constitution');
const { tempRepo, git, writeFiles } = require('./helpers');

const tag = (id, tier) => `<!-- sdd:rule id="${id}" tier="${tier}" -->`;

function ruleBlock(n, id, tier, why) {
    return [tag(id, tier), `## ${n}. ${id}`, '* **Rule:** something.', '* **Why this rule exists:**', `  > ${why}`].join('\n');
}

const PLACEHOLDER_WHY = '[Document the incident or rationale here. For example: something bad happened.]';

test('never fails: no .agents/AGENTS.md at all', () => {
    const repo = tempRepo();
    writeFiles(repo, { 'README.md': '# demo' });
    git(repo, 'add', '-A');
    const result = run({ root: repo });
    assert.strictEqual(result.ok, true);
    assert.match(result.report, /No \.agents\/AGENTS\.md/);
});

test('never fails: zero rules is a deliberate choice, still noted', () => {
    const repo = tempRepo();
    writeFiles(repo, { '.agents/AGENTS.md': '# Agent Constitution\n\nNo rules here on purpose.\n' });
    git(repo, 'add', '-A');
    const result = run({ root: repo });
    assert.strictEqual(result.ok, true);
    assert.match(result.report, /has no rules/);
});

test('moderate warning when critical rules are missing', () => {
    const repo = tempRepo();
    writeFiles(repo, {
        '.agents/AGENTS.md': [
            ruleBlock(1, 'discovery-first', 'moderate', 'A real reason.'),
            ruleBlock(2, 'mandatory-verification', 'critical', PLACEHOLDER_WHY)
        ].join('\n\n---\n\n')
    });
    git(repo, 'add', '-A');
    const result = run({ root: repo });
    assert.strictEqual(result.ok, true);
    assert.match(result.report, /missing 3\/3 critical rule/);
    assert.match(result.report, /Mandatory Verification/);
    assert.match(result.report, /sdd-add-rule --fulfills/);
});

test('light warning once all 3 critical rules are fulfilled, some moderate missing', () => {
    const repo = tempRepo();
    writeFiles(repo, {
        '.agents/AGENTS.md': [
            ruleBlock(1, 'mandatory-verification', 'critical', 'Evidence beats claims.'),
            ruleBlock(2, 'zero-trust-secrets', 'critical', 'Secrets in chat logs are permanent.'),
            ruleBlock(3, 'scope-bounding', 'critical', 'Unbounded edits break handoffs.')
        ].join('\n\n---\n\n')
    });
    git(repo, 'add', '-A');
    const result = run({ root: repo });
    assert.strictEqual(result.ok, true);
    assert.match(result.report, /💡/);
    assert.match(result.report, /all 3 critical rules are set/);
    assert.match(result.report, /5\/5 moderate suggestion/);
});

test('passes cleanly once all 3 critical and 5 moderate defaults are fulfilled', () => {
    const repo = tempRepo();
    const ids = [
        ['mandatory-verification', 'critical'], ['zero-trust-secrets', 'critical'], ['scope-bounding', 'critical'],
        ['discovery-first', 'moderate'], ['evidence-driven-debugging', 'moderate'], ['closed-network-testing', 'moderate'],
        ['factual-copy', 'moderate'], ['author-attribution', 'moderate']
    ];
    writeFiles(repo, {
        '.agents/AGENTS.md': ids.map(([id, tier], i) => ruleBlock(i + 1, id, tier, `Real rationale for ${id}.`)).join('\n\n---\n\n')
    });
    git(repo, 'add', '-A');
    const result = run({ root: repo });
    assert.strictEqual(result.ok, true);
    assert.match(result.report, /✅/);
    assert.match(result.report, /8 rule\(s\), all 3 critical and 5 moderate defaults fulfilled/);
});

test('an expert\'s own equivalent rule (same id, different text) is recognized', () => {
    const repo = tempRepo();
    writeFiles(repo, {
        '.agents/AGENTS.md': [
            tag('mandatory-verification', 'critical'),
            '## 1. Trust Nothing Until It Runs',
            '* **Rule:** our team-specific phrasing of the same idea.',
            '* **Why this rule exists:**',
            '  > We got burned twice by unverified "done" claims.'
        ].join('\n')
    });
    git(repo, 'add', '-A');
    const result = run({ root: repo });
    assert.strictEqual(result.ok, true);
    assert.doesNotMatch(result.report, /Mandatory Verification/);
    assert.match(result.report, /missing 2\/3 critical/);
});
