#!/usr/bin/env node

/**
 * scripts/check-constitution.js
 *
 * Non-blocking reminder about the project's constitution (.agents/AGENTS.md). It never
 * fails the gate: neither the rule count nor the "why this rule exists" rationale is
 * mandatory, and a project can deliberately ship with none of the 8 defaults, or with
 * its own rules entirely. What this catches is the unattended case -- the wizard's
 * placeholder rationale left standing in for a rule nobody actually wrote -- and nudges
 * toward the 3 critical rules (verification, secrets, scope) before the first push.
 *
 * A rule counts as present only through its "<!-- sdd:rule id="..." tier="..." -->" tag,
 * never by matching heading text. That is what lets an expert replace a default rule with
 * their own equivalent (same id, entirely different title and wording, added with
 * sdd-add-rule --fulfills=<id>) and still have the gate recognize it -- a declared,
 * greppable fact instead of the gate guessing at semantic equivalence.
 */

const { readFile, WORKTREE } = require('./lib/git');
const { runCheckCli } = require('./lib/cli');
const { RULES, CRITICAL_IDS, MODERATE_IDS } = require('./lib/constitution-rules');

const CONSTITUTION_PATH = '.agents/AGENTS.md';
const PLACEHOLDER = /\[Document the incident or rationale here\./;
const RULE_HEADING = /^##\s+\d+\./gm;
const TAG = /<!--\s*sdd:rule\s+id="([\w-]+)"\s+tier="[\w-]+"\s*-->/g;
const ESSENTIALS_HINT = 'secrets handling, mandatory verification, and scope bounding';

// Rule blocks are separated by the template's "\n\n---\n\n"; a tag is only trusted if a
// rule's own content (up to the next tag or end of file) has no unedited placeholder text.
function fulfilledIds(text) {
    const tags = [...text.matchAll(TAG)];
    const fulfilled = new Set();
    tags.forEach((tag, i) => {
        const end = i + 1 < tags.length ? tags[i + 1].index : text.length;
        const body = text.slice(tag.index, end);
        if (!PLACEHOLDER.test(body)) fulfilled.add(tag[1]);
    });
    return fulfilled;
}

function labelsFor(ids) {
    return ids.map(id => RULES[id].label).join(', ');
}

function run({ root, source = WORKTREE } = {}) {
    const buffer = readFile(root, CONSTITUTION_PATH, source);
    if (buffer === null) {
        return {
            ok: true,
            report: `⚠️  No ${CONSTITUTION_PATH}. An agent has no constitution to load. Not required, ` +
                `but worth deciding on purpose -- at least the essentials (${ESSENTIALS_HINT}) go a long way.`
        };
    }

    const text = buffer.toString('utf8');
    const totalHeadings = (text.match(RULE_HEADING) || []).length;
    if (totalHeadings === 0) {
        return {
            ok: true,
            report: `⚠️  ${CONSTITUTION_PATH} has no rules. That can be a deliberate choice, ` +
                `but make sure it is the one you meant to make -- at least the essentials (${ESSENTIALS_HINT}) go a long way.`
        };
    }

    const fulfilled = fulfilledIds(text);
    const criticalFound = CRITICAL_IDS.filter(id => fulfilled.has(id));
    const moderateFound = MODERATE_IDS.filter(id => fulfilled.has(id));
    const missingCritical = CRITICAL_IDS.filter(id => !fulfilled.has(id));
    const missingModerate = MODERATE_IDS.filter(id => !fulfilled.has(id));

    if (missingCritical.length === 0 && missingModerate.length === 0) {
        return { ok: true, report: `✅ ${CONSTITUTION_PATH}: ${totalHeadings} rule(s), all 3 critical and 5 moderate defaults fulfilled.` };
    }

    if (missingCritical.length === 0) {
        return {
            ok: true,
            report: `💡 ${CONSTITUTION_PATH}: all 3 critical rules are set (${labelsFor(CRITICAL_IDS)}). ` +
                `${missingModerate.length}/5 moderate suggestion(s) are not included -- optional: ${labelsFor(missingModerate)}.`
        };
    }

    return {
        ok: true,
        report: `⚠️  ${CONSTITUTION_PATH} is missing ${missingCritical.length}/3 critical rule(s): ${labelsFor(missingCritical)}. ` +
            `These back the framework's core promise (${ESSENTIALS_HINT}). Add them with the wizard, or write your own ` +
            `equivalent with sdd-add-rule --fulfills=<id> -- see scripts/lib/constitution-rules.js for the ids.`
    };
}

if (require.main === module) {
    runCheckCli('📜 Agentic SDD Framework: Constitution Check', run);
}

module.exports = { run, fulfilledIds, PLACEHOLDER, CONSTITUTION_PATH };
