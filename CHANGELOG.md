# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Install a specific release
with `npx github:tBeltty/agentic-sdd-framework#v<version>`.

## [Unreleased]

## [1.4.0] - 2026-09-25

Records written by 1.3.0 use the old format: run `sdd-verify --record` (and `sdd-verify --task`
for recorded evidence) again before pushing a `Completed` spec.

### Changed
- `Last Verified` now ends with `check <hash>`, a hash over the date, result, commit, exit code,
  state, verification command, and expected output. Editing FAIL to PASS, or changing the command
  or expected output after recording, reopens the spec. Recorded task evidence hashes the date and
  exit code together with the transcript.
- `sdd-verify --record` refuses to run while untracked files exist; they took part in the run but
  not in the recorded state.
- `sdd-init` reuses the answers stored in an existing `sdd.config.json` as defaults; only explicit
  flags override them. The spec and Rigor documents are created at the configured
  `specification.specFile` and `specification.roadmapDir`.
- Rigor mode requires `auditkit` 0.3.9 or newer, which tightens negative-control validation. CI
  pins the protocol repository to v0.3.9.
- Check scripts reject unknown flags (a typo checked the working tree instead) and accept
  `--ref <commit>` as well as `--ref=<commit>`.
- Config paths must be canonical (`docs/SPEC.md`, not `./docs/SPEC.md`), and `specFile` and
  `roadmapDir` must not end with `/`; other forms broke the spec check.
- CI uses `actions/checkout@v7` and `actions/setup-node@v7`, which run on Node.js 24.

### Fixed
- Files were read by path through `git show`/`cat-file`, so a name containing a newline, or a
  staged file named like `0:path`, was read wrongly or skipped. Blobs are now read by object id and
  every `cat-file` header is validated.
- A secret introduced only by a merge commit, or in a file that replaced a symlink, was not
  scanned in push mode or with `--staged`.
- Reading more than 256 MB of tracked content from a commit or the index failed with ENOBUFS;
  blobs are now read in bounded batches.
- With `core.autocrlf` (the Windows default), a committed spec checked out with CRLF line endings
  was treated as uncommitted, so a later commit that did not touch the spec reopened it. The spec
  is now compared by Git object id with Git's line-ending filters applied.
- In a shallow clone, a Completed spec failed with a misleading state mismatch. A depth-1 clone
  whose newest commit completed the spec now passes; otherwise the failure explains that the full
  history is needed.
- The spec parser read some Markdown differently from GitHub, which could hide an unchecked
  task, swap the Status, or make `sdd-verify` run a command other than the rendered one (nine
  review rounds found cases: comments, fences left open or opened on a list marker, tabs,
  escaped backticks, link titles and definitions, footnotes, entities, invisible and look-alike
  characters, indented code before the command). The spec is now parsed with a CommonMark
  parser (markdown-it 14.3.2, vendored under `scripts/lib/vendor/`, MIT; no npm dependency), and
  tasks, the Status, evidence, and the command are read from the parsed structure. A small
  subset keeps GitHub's renderer and the parser in agreement: no raw HTML or comments, no link
  definitions or footnotes, no entities or invisible characters, no tabs deciding indentation,
  and the fields written exactly as in the template. `scripts/dev/fuzz-spec-markup.js` compares
  the gate's reading with cmark-gfm (GitHub's renderer): no bypass in 300,000 random specs,
  where the previous parser had several.
- A list item followed by an under-indented continuation line starting with `>`, `#`, or a
  fence marker could be read differently than GitHub renders it, silently hiding an unchecked
  task or swapping the verification command. This case is now rejected instead of guessed at.
- A spec containing a GFM table used to crash the check; it's now rejected with a clear error.
- A checked task titled like `**Status:** Completed` could slip past detection; it's now caught.
- A checkbox preceded by a list marker on an over-indented continuation line was not recognized
  as a hidden task; it's now caught.
- An unclosed code fence was accepted even though the template requires closed fences, which
  could let verification info end up hidden inside it; unclosed fences are now rejected.
- `sdd-verify --task` could misplace evidence, or fail to check the box, when a task's list
  marker was nested on the same line.
- `sdd-verify --task` could silently delete a task nested under the previous task's evidence.
- `sdd-verify --task` now refuses to run on a spec with unresolved problems, matching the check
  `--record` already performed.
- `sdd-verify --task` wrote evidence at 2 spaces under numbered tasks, which rendered outside
  the list item; evidence now goes at the item's content column.
- The secret scanner flagged pnpm/yarn lockfile dependency specifiers ending in `token` (a
  scoped package name such as `@solana/spl-token`) as a secret assignment; a value containing
  the parens a peer-dependency range uses is no longer treated as a credential.
- The secret scanner skipped any file named `verify-no-secrets.js`, any lockfile, and any path
  containing `node_modules/`; it now skips only its own installed paths and `node_modules/` path
  segments, as documented in the README. Lockfiles are scanned: a private-registry URL can embed
  a token.
- Where symlinks are unavailable, the skill copies in `.claude/skills/` failed a fresh project's
  prose check; they are excluded like the `.agents/skills/` originals.
- Plain-text values in Windows batch files (`set API_TOKEN=...`, `setx NAME value`) were not
  scanned as literals, and Go/Pascal `:=` assignments were never scanned.
- `scripts/dev/sync-vendored.js` treated a mistyped flag as a write; unknown flags are errors.
- The secret scanner reported expressions assigned to secret-named keys (`password = getPassword()`)
  and missed unquoted values in config, rc, shell, and Docker files and keys such as `SECRET_KEY`; one placeholder on a line hid a real key later on the
  same line; a NUL byte or UTF-16 encoding hid a file from the scan.
- The specification parser read `Status` lines and tasks inside code fences and HTML comments,
  accepted several `Status` lines, and ignored tasks inside blockquotes. A `<!--` inside inline
  code hid every task up to the next `-->`, and a verification command inside an HTML comment
  was run and recorded instead of the visible one. Only a line starting with `<!--` opens a
  comment now, the gate is read from rendered lines, and a comment that holds tasks, Status, gate
  fields, or code fences fails the check. Evidence containing
  backtick fences could end the recorded block early.
- On timeout, `sdd-verify` killed only the shell; background processes started by the command kept
  running. The whole process tree is now killed, and output is decoded as a UTF-8 stream.
- The framework exemption in the specification check applied to any project with
  `project.type: framework`; it now also requires the framework's package name.
- The config validator accepted inherited object keys such as `toString`, and empty path strings.
- The prose linter skipped all of `docs/roadmap/` even when `roadmapDir` pointed elsewhere; it now
  skips the configured `roadmapDir` and the vendored templates.
- `sdd-init` next steps named the default spec paths instead of the configured ones, and guided
  mode crashed on a target directory that did not exist; it now offers to create it.
- Test temporary directories are removed on exit; the hook tests run on Windows through `sh`.

## [1.3.0] - 2026-09-25

### Fixed
- The pre-push hook checked the working tree instead of the pushed commits, so a committed secret
  removed only from the working tree was pushed. The hook now passes the push to
  `quality-gate.js --push`, which checks each pushed commit and scans every new commit for secrets.
- Git failures were swallowed: outside a repository, or when Git errored, every check reported
  "0 files" and passed. Checks now fail with the Git error.
- `sdd.config.json` was not validated: a typo or wrong type silently disabled a check (for example
  `"exclude": "docs/"` switched the prose linter off). The file is validated against
  `scripts/lib/sdd.config.schema.json` on every run; custom keys use an `x-` prefix. A UTF-8 BOM is
  accepted.
- Specification check bypasses: CRLF line endings hid every task; an unknown status such as "Done"
  disabled the rules; checkbox tasks without a bold `**ID:**` were ignored; any `Last Verified`
  containing "PASS" was accepted; and a PASS stayed valid after the verified files changed.
- The secret scanner missed PGP private keys, credentials in URLs, secret-named assignments
  (`password`, `client_secret`, `access_token`, ...), and tracked secret files (`.env`, `id_rsa`,
  `*.key`, `*.p12`). Pragma suppressions are now counted in the report.
- `maxEmDashes` counted lines instead of dashes; fences closed on any fence marker.
- The pre-push hook installer wrote into a `core.hooksPath` directory shared by other repositories;
  it now leaves hook managers alone and prints the command to add. The hook falls back to the
  absolute Node.js path when `node` is not on PATH, and the relative gate path is computed between
  real (symlink-resolved) paths.
- `sdd-init` ignored `--target <dir>` (space form) and unknown or misspelled flags; both are
  handled now, and `--help` prints usage. When an existing `AGENTS.md` or `CLAUDE.md` is left
  untouched, the next steps say so instead of claiming the rules load automatically.
- `.claude/skills/` copies (used where symlinks are unavailable) were never refreshed; `--force`
  refreshes them.
- `--staged` was inconsistent: the Rigor check and the version check read the working tree.
- Rigor mode accepted any `auditkit` version; it now requires 0.3.0 or newer.

### Added
- `sdd-verify --task <ID> -- <command>` records a command's transcript as task evidence with its
  exit code and a hash; the gate rejects edited or failing recorded evidence, counts hand-written
  evidence, and rejects it when `specification.requireRecordedEvidence` is true.
- `sdd-verify --record` writes a state fingerprint and fails when the command modifies tracked files.
- `specification.verifyTimeoutSeconds` (default 900) and `specification.verifyShell`.
- `quality-gate.js --ref=<commit>` and `--push [remote]`. In push mode, a ref whose commit is
  already on the remote (such as a tag on a published commit) publishes nothing new and is skipped.
- `security.allowFiles` for tracked files with sensitive names.
- `.sdd/VERSION` in installed projects; the wizard reports tooling upgrades.
- CI runs on Linux, macOS, and Windows; `.gitattributes` keeps line endings consistent.

### Changed
- The README describes what the framework does and what each check enforces, including its limits.
- `package.json` no longer declares a `main` entry (requiring the package ran the wizard).

## [1.2.0] - 2026-09-25

### Added
- The quality gate checks the specification: Lite specs need evidence for checked tasks and a
  recorded PASS to be completed; Rigor documents are checked with `auditkit lint`.
- `sdd-verify` runs the spec's verification command and records the result.
- Rigor documents use the auditkit format, vendored from auditor-executor-protocol, with a CI check
  that the vendored files match the canonical repository.

## [1.1.0] - 2026-09-25

### Added
- Root `AGENTS.md`, `CLAUDE.md`, and `.claude/skills/` so agents load the rules without a prompt.
- Install into an existing project with `npx github:tBeltty/agentic-sdd-framework`.
- File size limit check; `node:test` suites; single-process quality gate.

### Changed
- Node.js 22 LTS or newer is required.

## [1.0.0] - 2026-09-02

### Added
- Initial release: constitution and context templates, Lite and Rigor specification templates,
  strategic-cto, no-ai-slop, ast-navigator, and auditor-executor-protocol skills, bootstrapping
  wizard, and quality gate scripts.
