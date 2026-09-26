#!/usr/bin/env node

/**
 * scripts/sdd-add-rule.js
 *
 * The sanctioned way to add a rule to .agents/AGENTS.md after day-0. Appends a correctly
 * numbered, tagged rule block instead of an agent freehanding "always do X" into chat
 * memory, CLAUDE.md, or an unrelated doc -- none of which every agent reads, and none of
 * which the constitution check ever looks at.
 *
 * Usage:
 *   sdd-add-rule --title "<title>" --rule "<the operating rule>" --why "<why this rule exists>"
 *                [--fulfills=<id>]
 *
 *   --fulfills replaces one of the 8 default rules with the caller's own equivalent: the
 *   new block is tagged with that rule's id, so the constitution check recognizes it as
 *   fulfilling that slot even though the heading and text are entirely custom. See
 *   scripts/lib/constitution-rules.js for the known ids.
 */

const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./lib/git');
const { RULES } = require('./lib/constitution-rules');

const CONSTITUTION_PATH = '.agents/AGENTS.md';
const FLAGS = ['title', 'rule', 'why', 'fulfills'];
const PLACEHOLDER = /\[.*\]/;
const USAGE = 'Usage: sdd-add-rule --title "<title>" --rule "<rule>" --why "<why this rule exists>" [--fulfills=<id>]';

function parseArgs(argv) {
    const values = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const match = arg.match(/^--([a-z]+)(?:=(.*))?$/);
        if (!match || !FLAGS.includes(match[1])) throw new Error(`Unknown argument "${arg}". ${USAGE}`);
        const [, name, inline] = match;
        const value = inline !== undefined ? inline : argv[++i];
        if (value === undefined || (inline === undefined && value.startsWith('--'))) {
            throw new Error(`--${name} needs a value. ${USAGE}`);
        }
        values[name] = value;
    }
    return values;
}

function slugify(title) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-rule';
}

function nextNumber(text) {
    const numbers = [...text.matchAll(/^## (\d+)\./gm)].map(m => Number(m[1]));
    return numbers.length ? Math.max(...numbers) + 1 : 1;
}

function run({ root, argv }) {
    let values;
    try {
        values = parseArgs(argv);
    } catch (error) {
        return { ok: false, report: `❌ ${error.message}` };
    }
    const { title, rule, why, fulfills } = values;
    const missing = ['title', 'rule', 'why'].filter(name => !values[name] || !values[name].trim());
    if (missing.length > 0) {
        return { ok: false, report: `❌ --${missing.join(', --')} required and cannot be empty. A rule with no stated rationale is exactly the placeholder problem this command exists to avoid.` };
    }
    if ([title, rule, why].some(v => PLACEHOLDER.test(v))) {
        return { ok: false, report: '❌ --title, --rule, and --why must be real text, not a bracketed placeholder.' };
    }
    if (fulfills && !RULES[fulfills]) {
        return { ok: false, report: `❌ Unknown --fulfills id "${fulfills}". Known ids: ${Object.keys(RULES).join(', ')}.` };
    }

    const file = path.join(root, CONSTITUTION_PATH);
    if (!fs.existsSync(file)) {
        return { ok: false, report: `❌ ${CONSTITUTION_PATH} does not exist. Run sdd-init first.` };
    }
    const text = fs.readFileSync(file, 'utf8');
    const number = nextNumber(text);
    const id = fulfills || slugify(title);
    const tier = fulfills ? RULES[fulfills].tier : 'custom';
    const block = [
        '---', '',
        `<!-- sdd:rule id="${id}" tier="${tier}" -->`,
        `## ${number}. ${title}`,
        `* **Rule:** ${rule}`,
        '* **Why this rule exists:**',
        `  > ${why}`,
        ''
    ].join('\n');
    fs.writeFileSync(file, `${text.replace(/\n*$/, '')}\n\n${block}`);
    const recognized = fulfills ? ` Recognized by the gate as fulfilling the "${fulfills}" ${tier} rule.` : '';
    return { ok: true, report: `✅ Added rule ${number} ("${title}") to ${CONSTITUTION_PATH}.${recognized}` };
}

if (require.main === module) {
    let result;
    try {
        result = run({ root: repoRoot(), argv: process.argv.slice(2) });
    } catch (error) {
        result = { ok: false, report: `❌ ${error.message}` };
    }
    (result.ok ? console.log : console.error)(result.report);
    process.exit(result.ok ? 0 : 1);
}

module.exports = { run, slugify, nextNumber };
