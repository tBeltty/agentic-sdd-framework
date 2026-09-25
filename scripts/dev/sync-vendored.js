#!/usr/bin/env node

/**
 * scripts/dev/sync-vendored.js
 *
 * Keeps the files vendored from tBeltty/auditor-executor-protocol identical to their
 * canonical copies: the protocol skill (SKILL.md and references/) and the Rigor
 * templates used by `auditkit init`. Framework-maintenance only; not installed into
 * projects.
 *
 * Usage:
 *   node scripts/dev/sync-vendored.js <canonical-checkout>           copy canonical -> framework
 *   node scripts/dev/sync-vendored.js <canonical-checkout> --check   exit 1 on any difference
 */

const fs = require('fs');
const path = require('path');

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..');

// Checkouts may use CRLF (Windows with core.autocrlf); compare and write LF content.
const readNormalized = file => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
const SKILL_DIR = '.agents/skills/auditor-executor-protocol';
const TEMPLATE_DIR = 'docs/roadmap/templates';

function mappings(canonical) {
    const pairs = [[path.join(canonical, 'SKILL.md'), path.join(SKILL_DIR, 'SKILL.md')]];
    for (const name of fs.readdirSync(path.join(canonical, 'references')).filter(f => f.endsWith('.md')).sort()) {
        pairs.push([path.join(canonical, 'references', name), path.join(SKILL_DIR, 'references', name)]);
    }
    for (const name of ['plan-of-record.md', 'execution-guide.md', 'compliance-log.md']) {
        pairs.push([path.join(canonical, 'src/auditkit/templates', name), path.join(TEMPLATE_DIR, name)]);
    }
    return pairs;
}

// Vendored files that no longer exist upstream.
function orphans(canonical) {
    const upstream = new Set(fs.readdirSync(path.join(canonical, 'references')));
    const local = path.join(FRAMEWORK_ROOT, SKILL_DIR, 'references');
    return fs.existsSync(local)
        ? fs.readdirSync(local).filter(f => !upstream.has(f)).map(f => path.join(SKILL_DIR, 'references', f))
        : [];
}

function main() {
    const [canonicalArg, flag] = process.argv.slice(2);
    if (!canonicalArg) {
        console.error('Usage: node scripts/dev/sync-vendored.js <canonical-checkout> [--check]');
        process.exit(2);
    }
    const canonical = path.resolve(canonicalArg);
    const check = flag === '--check';
    const drift = [];

    for (const [src, rel] of mappings(canonical)) {
        const dest = path.join(FRAMEWORK_ROOT, rel);
        const upstream = readNormalized(src);
        const same = fs.existsSync(dest) && readNormalized(dest) === upstream;
        if (same) continue;
        drift.push(rel.split(path.sep).join('/'));
        if (!check) {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, upstream);
        }
    }
    for (const rel of orphans(canonical)) {
        drift.push(`${rel.split(path.sep).join('/')} (removed upstream)`);
        if (!check) fs.rmSync(path.join(FRAMEWORK_ROOT, rel));
    }

    if (drift.length === 0) {
        console.log('✅ Vendored protocol files match the canonical repository.');
        return;
    }
    const verb = check ? 'differ from' : 'updated from';
    console.log(`${check ? '❌' : '🔄'} ${drift.length} vendored file(s) ${verb} the canonical repository:`);
    for (const rel of drift) console.log(`  - ${rel}`);
    if (check) {
        console.log('\nRun: node scripts/dev/sync-vendored.js <canonical-checkout>');
        process.exit(1);
    }
}

main();
