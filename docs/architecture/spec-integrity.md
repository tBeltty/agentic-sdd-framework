# Specification Integrity: How the Gate Reads and Verifies the Spec

This document covers the internals behind the "cryptographic proofs" and "zero-trust gate"
claims in the [README](../../README.md): how `docs/SPEC.md` is parsed, how evidence is hashed,
and what the gate does and does not guarantee. Read this if you are auditing the framework,
contributing to it, or curious about the mechanism. Skip it if you just want to use it.

## The spec is read the way it renders

The gate does not scan `docs/SPEC.md` line by line. It parses it with a real CommonMark parser
(markdown-it, vendored in [`scripts/lib/vendor/`](../../scripts/lib/vendor/), MIT, no npm
dependency) and takes tasks, the Status, the evidence, and the verification command from the
parsed token tree: a line counts only if it renders as what it claims to be.

On top of that, a small Markdown subset keeps GitHub's renderer (cmark-gfm) and the parser in
agreement, for the narrow set of cases where they could still differ:

- no raw HTML outside code (HTML comments included);
- no link reference definitions or footnotes (inline links only);
- no HTML entities, invisible characters, or non-ASCII whitespace outside code;
- spaces instead of tabs for indentation;
- the Status and gate fields written exactly as in the template (a line that reads as a field
  name followed by a colon, or emphasized, in any other spelling, is an error);
- a line right after a list item, indented 4 or more spaces but fewer than that item's own
  content column, and starting with `>`, `#`, or a fence, is rejected: cmark-gfm and
  markdown-it can disagree on whether it continues the item or starts indented code.

Code (fenced or indented) is taken verbatim and never checked against these rules. Anything
outside the subset fails with the line number and what to change; the template and everything
`sdd-verify` writes stay inside it.

[`scripts/dev/fuzz-spec-markup.js`](../../scripts/dev/fuzz-spec-markup.js) compares the gate's
reading against cmark-gfm on tens of thousands of randomly generated specs on every change to
the parser, looking for a rendered unchecked task the gate does not see, a rendered Status
different from the parsed one, or a gate command different from the rendered one. This subset
and parser have been through ten rounds of adversarial review closing bypasses found this way.

## Recorded evidence and the verification hash chain

`sdd-verify --record` runs the spec's verification command, checks that every expected line
appears in the output (`/.../` lines are regular expressions), fails if the command modified
tracked files, and writes:

```text
Last Verified: <date> PASS|FAIL (commit <sha>, exit <code>, state <fingerprint>, check <hash>)
```

- **`state <fingerprint>`** is a hash over every tracked file except the spec itself, computed
  at record time. The gate recomputes it for the commit that completed the spec (or the
  uncommitted state); a file changed after recording invalidates the PASS.
- **`check <hash>`** covers the other fields plus the verification command and expected output,
  so hand-editing the result, or changing the command after recording, reopens the spec.
- Task evidence recorded by `sdd-verify --task <ID> -- <command>` carries its own hash over the
  date, exit code, and transcript, so an edited transcript is detected the same way.

Later commits that do not touch the spec do not reopen it: catching regressions after a spec is
closed is the job of CI and tests, not the gate.

**These are integrity checks, not signatures.** They catch hand edits and stale records, but
anyone who can run `sdd-verify` can also write a matching record; there is no key involved.
For an authoritative result, have CI run `sdd-verify` again. Recorded evidence also cannot prove
a verification command is meaningful; that remains the reviewer's call.

## Execution environment

Commands run in `specification.verifyShell` (default `/bin/sh` on macOS and Linux, `cmd.exe` on
Windows) with a limit of `specification.verifyTimeoutSeconds` (default 900 seconds). The gate
never runs a command from the spec on its own initiative; it only checks recorded results. On
timeout, the whole process tree is killed, including background processes the command started,
and output is decoded as a UTF-8 stream.

The check finds the commit that completed the spec in Git history, so CI needs the full history:
in GitHub Actions, use `actions/checkout` with `fetch-depth: 0`. In a shallow clone, the check
fails and says so instead of guessing.
