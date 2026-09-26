#!/usr/bin/env node

/**
 * scripts/dev/fuzz-spec-markup.js
 *
 * Differential fuzz for the Lite spec parser: generates random specs from risky Markdown
 * (fences on list markers, tabs, comments, raw HTML, lazy lines, Status variants), and for
 * every spec the parser accepts (no markup problems) compares its reading with a CommonMark
 * renderer. A bypass is a rendered unchecked task the parser does not see, a rendered Status
 * different from the parsed one, or a gate command different from the rendered one.
 *
 *   npm install --no-save markdown-it@14
 *   node scripts/dev/fuzz-spec-markup.js [cases]    # exits 1 on any bypass
 */

let MarkdownIt;
try {
    MarkdownIt = require('markdown-it');
} catch {
    console.error('Needs markdown-it (a dev-only tool, not a framework dependency):\n  npm install --no-save markdown-it@14');
    process.exit(2);
}
const { parseSpec } = require('../lib/spec');
const { skeleton } = require('../lib/spec-markup');
const md = new MarkdownIt({ html: true });
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
];
const SAFE = ['**Status:** Draft', '* [ ] **T2:** open', '* [x] **T3:** done', '  * [ ] **T4:** nested', '', 'plain text',
    '  ```bash', '  echo A', '  ```', '  ~~~', '  echo B', '<!-- x -->', 'a `b` c', '  indented two'];
const pick = () => (Math.random() < 0.8 ? SAFE[rnd(SAFE.length)] : BODY[rnd(BODY.length)]);
function renderedView(text) {
    const html = md.render(text);
    const noCode = html.replace(/<pre>[\s\S]*?<\/pre>/g, '').replace(/<code>[\s\S]*?<\/code>/g, '');
    const tasks = [...noCode.matchAll(/<li>(?:\s*<p>)?\s*\[( |x|X)\]\s/g)].map(m => m[1] !== ' ');
    // Every rendered block that reads as a Status line: "Status" followed by a colon, or
    // emphasized, at the start of the block, however it is spelled.
    const decode = t => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const statuses = [];
    for (const block of noCode.split(/<\/?(?:p|li|h[1-6]|blockquote|ul|ol)[^>]*>|<br\s*\/?>|\n/)) {
        const text = skeleton(decode(block));
        const emphasized = block.trim().match(/^<(strong|em|del|s)>([\s\S]*?)<\/\1>/);
        if (text.startsWith('status:') || (emphasized && skeleton(decode(emphasized[2])).startsWith('status'))) {
            statuses.push(text.slice(text.indexOf(':') + 1) || text.slice('status'.length));
        }
    }
    let command = null;
    const at = html.indexOf('<strong>Verification Command:</strong>');
    if (at !== -1) {
        const m = html.slice(at).match(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/);
        if (m) command = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
    }
    return { tasks, statuses, command };
}
const N = Number(process.argv[2] || 100000);
let accepted = 0, bad = 0;
for (let k = 0; k < N; k++) {
    const body = Array.from({ length: 3 + rnd(10) }, pick);
    const gate = ['## 4. Verification Gate', '', '* **Verification Command:**', ...Array.from({ length: 2 + rnd(8) }, pick),
        '* **Expected Output:**', '  ```text', '  ok', '  ```'];
    const text = ['# Spec', '', ...body, '', ...gate].join('\n') + '\n';
    const spec = parseSpec(text);
    if (spec.hiddenProblems.length > 0 || spec.statusProblem) continue;
    accepted++;
    const r = renderedView(text);
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
}
console.log(`cases ${N}, accepted ${accepted}, bypasses ${bad}`);
process.exitCode = bad === 0 ? 0 : 1;
