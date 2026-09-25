/**
 * scripts/lib/provision.js
 *
 * Writes the SDD governance structure into a target project. Every step is
 * idempotent: documents that already exist are kept, sdd.config.json is merged
 * (unknown keys survive), and generated entry points are only rewritten while they
 * still carry the sdd:managed marker.
 *
 * Clone mode:   target is the framework checkout itself; templates are used in place.
 * Install mode: target is another project; templates, skills and the quality gate
 *               tooling (.sdd/scripts/) are copied into it first.
 */

const fs = require('fs');
const path = require('path');
const { install: installHook } = require('../install-git-hooks');

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..');
const MANAGED_MARKER = 'sdd:managed';
const SPEC_MODES = ['lite', 'rigor'];
const AST_ADAPTERS = ['ast-grep', 'graphify', 'ripgrep', 'lsp'];
const TOOL_DIR = '.sdd/scripts';
const TOOL_FILES = [
    'quality-gate.js', 'verify-no-secrets.js', 'check-copy-slop.js', 'check-file-size.js', 'check-spec.js',
    'check-versions.js', 'check-system-prerequisites.js', 'install-git-hooks.js', 'sdd-verify.js', 'lib'
];
const TEMPLATES = [
    '.agents/AGENTS.template.md',
    '.agents/CONTEXT.template.md',
    'docs/SPEC_TEMPLATE.md',
    'docs/decisions/ADR_TEMPLATE.md',
    'docs/incidents/0000-00-00-incident-template.md',
    'docs/roadmap/templates/plan-of-record.md',
    'docs/roadmap/templates/execution-guide.md',
    'docs/roadmap/templates/compliance-log.md',
    'docs/guides/AGENT_CREDENTIALS.md',
    'docs/guides/GITHUB_CLI_SETUP.md',
    'docs/guidelines/AST_NAVIGATION.md'
];
// Rigor documents use the auditkit format (tBeltty/auditor-executor-protocol) so `auditkit lint` can check them.
const RIGOR_DOCS = ['plan-of-record', 'execution-guide', 'compliance-log'];
const ICONS = { created: '✅', updated: '🔄', linked: '🔗', copied: '📄', kept: '⏭️ ', skipped: '⚠️ ', unchanged: '⏭️ ' };

// String.prototype.replace would interpret "$5" in answers like "$5 VPS".
const replaceLiteral = (text, from, to) => text.split(from).join(to);

function readJson(file) {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
    const result = { ...base };
    for (const [key, value] of Object.entries(override || {})) {
        result[key] = isPlainObject(value) && isPlainObject(result[key]) ? deepMerge(result[key], value) : value;
    }
    return result;
}

function sameDir(a, b) {
    try {
        return fs.realpathSync(a) === fs.realpathSync(b);
    } catch {
        return false;
    }
}

function normalizeAnswers(answers) {
    const specMode = answers.specMode === 'strict' ? 'rigor' : answers.specMode;
    if (!SPEC_MODES.includes(specMode)) {
        throw new Error(`Unknown mode "${answers.specMode}". Valid: ${SPEC_MODES.join(', ')}.`);
    }
    if (!AST_ADAPTERS.includes(answers.astAdapter)) {
        throw new Error(`Unknown AST adapter "${answers.astAdapter}". Valid: ${AST_ADAPTERS.join(', ')}.`);
    }
    return { ...answers, specMode };
}

function buildConfig(answers, existing) {
    const defaults = {
        architecture: { style: 'clean-architecture', maxLocPerFile: 400 },
        capabilities: { noAiSlop: { enabled: true } }
    };
    const generated = {
        version: readJson(path.join(FRAMEWORK_ROOT, 'package.json')).version,
        project: { name: answers.projectName, type: 'application', runtime: answers.runtime },
        specification: { mode: answers.specMode, allowedModes: SPEC_MODES },
        discovery: { concurrency: answers.concurrency, hardware: answers.hardware, workload: answers.workload },
        capabilities: {
            astNavigation: { adapter: answers.astAdapter },
            i18n: { enabled: answers.i18n },
            pwa: { enabled: answers.pwa }
        }
    };
    const merged = deepMerge(deepMerge(defaults, existing || {}), generated);
    const order = ['version', 'project', 'specification', 'discovery', 'architecture', 'capabilities'];
    return Object.fromEntries([
        ...order.filter(k => k in merged).map(k => [k, merged[k]]),
        ...Object.entries(merged).filter(([k]) => !order.includes(k))
    ]);
}

function fillContext(text, answers, config) {
    const onOff = flag => (flag ? 'Enabled' : 'Disabled');
    const pairs = [
        ['[Project Name]', answers.projectName],
        ['Lite | Rigor', answers.specMode === 'lite' ? 'Lite' : 'Rigor'],
        ['[e.g. Node.js 24 LTS, Go 1.23, Python 3.12]', answers.runtime],
        ['Clean Architecture | Standard MVC | Modular Monolith', config.architecture.style],
        ['No-AI-Slop Linter: [Enabled / Disabled]', `No-AI-Slop Linter: ${onOff(config.capabilities.noAiSlop.enabled !== false)}`],
        ['[graphify / ast-grep / ripgrep / lsp]', answers.astAdapter],
        ['Internationalization (i18n): [Enabled / Disabled]', `Internationalization (i18n): ${onOff(answers.i18n)}`],
        ['Progressive Web App (PWA): [Enabled / Disabled]', `Progressive Web App (PWA): ${onOff(answers.pwa)}`]
    ];
    return pairs.reduce((out, [from, to]) => replaceLiteral(out, from, to), text);
}

function fillAdr(text, answers, date) {
    const required = flag => (flag ? 'required' : 'not required');
    const recorded = [
        '',
        `**Recorded answers (sdd-init, ${date}):**`,
        '',
        `* **Scale and Concurrency:** ${answers.concurrency}`,
        `* **Hardware and Deployment:** ${answers.hardware}`,
        `* **Data and Workload:** ${answers.workload}`,
        `* **Modularity:** i18n ${required(answers.i18n)}, PWA ${required(answers.pwa)}`,
        `* **Runtime Preference:** ${answers.runtime}`,
        ''
    ].join('\n');
    let out = replaceLiteral(text, '# ADR-[NNNN]: [Decision Title]', '# ADR-0001: Technology Stack and Architecture Selection');
    out = replaceLiteral(out, '**Status:** Accepted | Proposed | Superseded', '**Status:** Proposed');
    out = replaceLiteral(out, '**Date:** [YYYY-MM-DD]', `**Date:** ${date}`);
    return out.replace(/(4\. \*\*Modularity and Localization:\*\*[^\n]*\n)/, match => match + recorded);
}

function renderEntrypoint(answers, gateCommand) {
    const specLocation = answers.specMode === 'lite'
        ? '`docs/SPEC.md`: the active specification (Lite mode).'
        : '`docs/roadmap/`: `plan-of-record.md`, `execution-guide.md`, `compliance-log.md`, and `annexes/` (Rigor mode).';
    const toolDir = gateCommand.replace(/^node /, '').replace(/\/quality-gate\.js$/, '');
    const specCheck = answers.specMode === 'lite'
        ? `Close \`docs/SPEC.md\` by running \`node ${toolDir}/sdd-verify.js --record\`; the gate rejects a \`Completed\` spec without a recorded PASS.`
        : 'The gate runs `auditkit lint docs/roadmap`; a `DONE` report without pasted verify output fails it.';
    const values = {
        SPEC_CHECK: specCheck,
        PROJECT_NAME: answers.projectName,
        SPEC_LOCATION: specLocation,
        AST_ADAPTER: answers.astAdapter,
        RUNTIME: answers.runtime,
        SPEC_MODE: answers.specMode,
        GATE_COMMAND: gateCommand
    };
    const template = fs.readFileSync(path.join(FRAMEWORK_ROOT, '.agents/ENTRYPOINT.template.md'), 'utf8');
    return Object.entries(values).reduce((out, [key, value]) => replaceLiteral(out, `{{${key}}}`, value), template);
}

const CLAUDE_ENTRYPOINT = `<!-- ${MANAGED_MARKER}. Generated by sdd-init; rerun it to refresh. Put project rules in .agents/AGENTS.md. -->
@AGENTS.md
@.agents/AGENTS.md
@.agents/CONTEXT.md
`;

function provision(rawAnswers, { target = process.cwd(), force = false, log = console.log, date } = {}) {
    const answers = normalizeAnswers(rawAnswers);
    const root = path.resolve(target);
    const installMode = !sameDir(root, FRAMEWORK_ROOT);
    const today = date || new Date().toISOString().slice(0, 10);
    const at = rel => path.join(root, rel);
    const record = (status, what) => log(`  ${ICONS[status]} ${what} (${status})`);

    const write = (rel, content) => {
        fs.mkdirSync(path.dirname(at(rel)), { recursive: true });
        fs.writeFileSync(at(rel), content);
    };
    const createFromTemplate = (templateRel, destRel, transform = t => t) => {
        if (fs.existsSync(at(destRel))) return record('kept', destRel);
        write(destRel, transform(fs.readFileSync(at(templateRel), 'utf8')));
        record('created', destRel);
    };
    const writeManaged = (rel, content) => {
        if (fs.existsSync(at(rel))) {
            const current = fs.readFileSync(at(rel), 'utf8');
            if (!current.includes(MANAGED_MARKER)) return record('skipped', `${rel} exists and is not managed by sdd-init`);
            if (current === content) return record('unchanged', rel);
            write(rel, content);
            return record('updated', rel);
        }
        write(rel, content);
        record('created', rel);
    };

    // 1. Framework assets (install mode only). Tooling is framework-owned and always
    //    refreshed; skills and templates are refreshed only with --force.
    if (installMode) {
        for (const file of TOOL_FILES) {
            fs.cpSync(path.join(FRAMEWORK_ROOT, 'scripts', file), at(path.join(TOOL_DIR, file)), { recursive: true });
        }
        record('updated', `${TOOL_DIR}/ (quality gate tooling)`);
        const skillsRoot = path.join(FRAMEWORK_ROOT, '.agents/skills');
        for (const skill of fs.readdirSync(skillsRoot, { withFileTypes: true }).filter(d => d.isDirectory())) {
            const rel = `.agents/skills/${skill.name}`;
            if (fs.existsSync(at(rel)) && !force) { record('kept', rel); continue; }
            fs.cpSync(path.join(skillsRoot, skill.name), at(rel), { recursive: true });
            record('copied', rel);
        }
        for (const rel of TEMPLATES) {
            if (fs.existsSync(at(rel)) && !force) continue;
            fs.mkdirSync(path.dirname(at(rel)), { recursive: true });
            fs.copyFileSync(path.join(FRAMEWORK_ROOT, rel), at(rel));
        }
        record('copied', 'templates and guides referenced by the skills');
    }

    // 2. Capability manifest.
    const configPath = at('sdd.config.json');
    const existingConfig = readJson(configPath);
    const config = buildConfig(answers, existingConfig);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    record(existingConfig ? 'updated' : 'created', 'sdd.config.json');

    // 3. Governance documents.
    createFromTemplate('.agents/AGENTS.template.md', '.agents/AGENTS.md');
    createFromTemplate('.agents/CONTEXT.template.md', '.agents/CONTEXT.md', t => fillContext(t, answers, config));
    if (answers.specMode === 'lite') {
        createFromTemplate('docs/SPEC_TEMPLATE.md', 'docs/SPEC.md');
    } else {
        for (const doc of RIGOR_DOCS) {
            createFromTemplate(`docs/roadmap/templates/${doc}.md`, `docs/roadmap/${doc}.md`,
                t => replaceLiteral(t, '{{PROJECT_NAME}}', answers.projectName));
        }
        if (!fs.existsSync(at('docs/roadmap/annexes/.gitkeep'))) write('docs/roadmap/annexes/.gitkeep', '');
    }
    createFromTemplate('docs/decisions/ADR_TEMPLATE.md', 'docs/decisions/ADR-0001-stack-and-architecture.md',
        t => fillAdr(t, answers, today));

    // 4. Agent entry points: AGENTS.md (Codex, Cursor, others), CLAUDE.md and
    //    .claude/skills/ (Claude Code) so the rules load without a manual prompt.
    const gateScript = installMode ? at(`${TOOL_DIR}/quality-gate.js`) : path.join(FRAMEWORK_ROOT, 'scripts/quality-gate.js');
    const gateCommand = `node ${path.relative(root, gateScript).split(path.sep).join('/')}`;
    writeManaged('AGENTS.md', renderEntrypoint(answers, gateCommand));
    writeManaged('CLAUDE.md', CLAUDE_ENTRYPOINT);
    for (const skill of fs.readdirSync(at('.agents/skills'), { withFileTypes: true }).filter(d => d.isDirectory())) {
        const rel = `.claude/skills/${skill.name}`;
        if (fs.existsSync(at(rel)) || isSymlink(at(rel))) { record('kept', rel); continue; }
        fs.mkdirSync(path.dirname(at(rel)), { recursive: true });
        try {
            fs.symlinkSync(path.join('..', '..', '.agents', 'skills', skill.name), at(rel), 'dir');
            record('linked', rel);
        } catch {
            fs.cpSync(at(`.agents/skills/${skill.name}`), at(rel), { recursive: true });
            record('copied', rel);
        }
    }

    // 5. Pre-push hook.
    let hookInstalled = false;
    try {
        const { preserved } = installHook({ root, gateScript });
        record('created', `pre-push quality gate hook${preserved ? ' (previous hook kept as pre-push.local)' : ''}`);
        hookInstalled = true;
    } catch (error) {
        record('skipped', `pre-push hook: ${error.message}`);
    }

    return { installMode, root, gateCommand, hookInstalled, config };
}

function isSymlink(file) {
    try {
        return fs.lstatSync(file).isSymbolicLink();
    } catch {
        return false;
    }
}

module.exports = { FRAMEWORK_ROOT, SPEC_MODES, AST_ADAPTERS, provision, buildConfig, deepMerge };
