#!/usr/bin/env node

/**
 * scripts/dev/fuzz-spec-markup.js
 *
 * Differential fuzz for the Lite spec parser against cmark-gfm, the renderer GitHub uses.
 * It generates random specs from risky Markdown (fences on list markers, tabs, comments,
 * raw HTML, lazy lines, definitions, entities, look-alike and invisible characters, Status
 * variants), and for every spec the parser accepts (no problems) compares its reading with
 * the cmark-gfm rendering. A bypass is a rendered unchecked task the parser does not see, a
 * rendered Status different from the parsed one, or a gate command different from the
 * rendered one.
 *
 *   python3 -m venv /tmp/fuzz-venv && /tmp/fuzz-venv/bin/pip install cmarkgfm
 *   FUZZ_PYTHON=/tmp/fuzz-venv/bin/python node scripts/dev/fuzz-spec-markup.js [cases]
 *
 * Exits 1 on any bypass.
 */

const { spawnSync } = require('child_process');

const PYTHON = process.env.FUZZ_PYTHON || 'python3';
const RENDER = `
import json, sys
import cmarkgfm
from cmarkgfm.cmark import Options
opts = Options.CMARK_OPT_UNSAFE | Options.CMARK_OPT_FOOTNOTES
print(json.dumps([cmarkgfm.github_flavored_markdown_to_html(t, options=opts) for t in json.load(sys.stdin)]))
`;
// Renders a batch of documents with cmark-gfm in one Python process.
function renderAll(texts) {
    const result = spawnSync(PYTHON, ['-c', RENDER], { input: JSON.stringify(texts), encoding: 'utf8', maxBuffer: 1 << 30 });
    if (result.status !== 0) {
        console.error(`cmark-gfm is needed (a dev-only tool, not a framework dependency):\n  python3 -m pip install cmarkgfm\n${result.stderr}`);
        process.exit(2);
    }
    return JSON.parse(result.stdout);
}
const { parseSpec } = require('../lib/spec');
const { skeleton } = require('../lib/spec-markup');
const rnd = n => Math.floor(Math.random() * n);
const BODY = [
    '**Status:** Draft', '**Status:** Completed', '* [ ] **T2:** open', '* [x] **T3:** done', '  * [ ] **T4:** nested',
    '1. [ ] **T5:** num', '  * **Evidence:** ok', '```', '  ```', '~~~', '  ~~~', '    ~~~', '', '', 'plain text', 'lazy line',
    '  indented two', '> quoted', '<!-- x -->', '<!--', '-->', '  <!--', 'a `b` c', '* ~~~', '1. ~~~', '* ```', '> ~~~',
    '* > ~~~', '  * ~~~', '- ~~~', '+ ```', '> * ~~~', '* [ ] ~~~', '  echo A', '  echo B', 'echo C', '    ```', '````',
    '* [x] **T6:** x\n  ~~~', '\t~~~', '* \t~~~', '1) ~~~',
    '[n](https://e.com "t', 'end")', '[n](https://e.com "t")', '**Sta&#116;us:** Completed', '**Sta\u200Btus:** Completed',
    '**\u0405tatus:** Completed', '\u00A0', '  \u00A0', '> x', '>   * [ ] **T7:** q', '  > * [ ] **T8:** q', '[d]: https://e.com',
    '"title"', '[ci]: https://e.com "**Verification Command:**"', '**Status**: Completed', '**Status:**Completed', '&nbsp;',
    '<!-->', '<!--->', '\t<!--', '\t-->', 'notes <!--x@y_z>', '<https://e.com>', '<a@b.co>', '[ref', ']: https://e.com',
    '[^n]: note', '[^n]', '1. **Status:** Draft', '1. **Verification Command:**', '   ```bash', '   echo D', '   ```',
    '**Status** Completed', '__Status:__ Draft', 'Status codes follow RFC 9110', '    rm -rf build', '__Verification Command:__',
    '```\f', '~~~\v', '  ```\f', '* [a]: /u "', '1. [a]: /u "', '"', 'Tracking: <https://e.com/x`y> <!-- `', '      npm test',
    '* [^n]: note', '> [^n]: note',
    // Wide markers ("1.   ", "10.  ") widen the gap between 4 spaces and the item's own
    // content column, where cmark-gfm and markdown-it can read a ">"/"#"/fence line
    // differently (lazy continuation vs. indented code): R45, R46.
    '1.   [x] **T9:** wide marker', '10.  [ ] **T9:** wide marker', '    > shallow quote', '    # shallow heading',
    '    ```', '    ~~~', '     * [ ] **T9:** deep nested',
];
const SAFE = ['**Status:** Draft', '* [ ] **T2:** open', '* [x] **T3:** done', '  * [ ] **T4:** nested', '', 'plain text',
    '  ```bash', '  echo A', '  ```', '  ~~~', '  echo B', '<!-- x -->', 'a `b` c', '  indented two'];
const pick = () => (Math.random() < 0.8 ? SAFE[rnd(SAFE.length)] : BODY[rnd(BODY.length)]);
function renderedView(html) {
    const noCode = html.replace(/<pre>[\s\S]*?<\/pre>/g, '').replace(/<code>[\s\S]*?<\/code>/g, '');
    const tasks = [...noCode.matchAll(/<input type="checkbox"( checked="")? disabled="" \/>/g)].map(m => Boolean(m[1]));
    // Every rendered block that reads as a Status line: "Status" followed by a colon, or
    // emphasized, at the start of the block, however it is spelled.
    const decode = t => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const statuses = [];
    for (const block of noCode.split(/<\/?(?:p|li|h[1-6]|blockquote|ul|ol|td|th)[^>]*>|<br\s*\/?>|\n/)) {
        const clean = block.replace(/^\s*<input[^>]*>\s*/, '');
        const text = skeleton(decode(clean));
        const emphasized = clean.trim().match(/^<(strong|em|del)>([\s\S]*?)<\/\1>/);
        if (text.startsWith('status:') || (emphasized && skeleton(decode(emphasized[2])).startsWith('status'))) {
            statuses.push(text.slice(text.indexOf(':') + 1) || text.slice('status'.length));
        }
    }
    let command = null;
    const label = html.match(/<li>\s*(?:<p>)?<strong>Verification Command:<\/strong>/);
    if (label) {
        const m = html.slice(label.index).match(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/);
        if (m) command = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
    }
    return { tasks, statuses, command };
}

const N = Number(process.argv[2] || 100000);
const BATCH = 5000;
let accepted = 0;
let bad = 0;
for (let done = 0; done < N; done += BATCH) {
    const cases = [];
    for (let k = 0; k < Math.min(BATCH, N - done); k++) {
        const body = Array.from({ length: 3 + rnd(10) }, pick);
        const gate = ['## 4. Verification Gate', '', '* **Verification Command:**', ...Array.from({ length: 2 + rnd(8) }, pick),
            '* **Expected Output:**', '  ```text', '  ok', '  ```'];
        const text = ['# Spec', '', ...body, '', ...gate].join('\n') + '\n';
        const spec = parseSpec(text);
        if (spec.hiddenProblems.length === 0 && !spec.statusProblem) cases.push({ text, spec });
    }
    const html = renderAll(cases.map(c => c.text));
    cases.forEach(({ text, spec }, k) => {
        accepted++;
        const r = renderedView(html[k]);
        const pUnchecked = spec.tasks.filter(t => !t.checked).length;
        const rUnchecked = r.tasks.filter(c => !c).length;
        const rStatus = r.statuses.length === 1 ? r.statuses[0] : null;
        const pStatus = spec.status ? skeleton(spec.status) : null;
        const pCommand = spec.gate && spec.gate.command ? spec.gate.command.trim() : null;
        const problems = [];
        if (rUnchecked > pUnchecked) problems.push('hidden unchecked task');
        if (r.statuses.length > 1 || (rStatus !== null && rStatus !== pStatus)) problems.push(`status p=${pStatus} r=${r.statuses.join('|')}`);
        if (pCommand !== null && pCommand !== r.command) problems.push(`command p=${JSON.stringify(pCommand)} r=${JSON.stringify(r.command)}`);
        if (problems.length) {
            bad++;
            if (bad <= 4) console.log('--- BYPASS', problems.join('; '), '\n' + JSON.stringify(text));
        }
    });
}
console.log(`cases ${N}, accepted ${accepted}, bypasses ${bad}`);
process.exitCode = bad === 0 ? 0 : 1;
