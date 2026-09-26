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
- Fixed how some tracked files (unusual names, very large content) were read for the secret scan.
- Fixed secrets not being scanned in some commits.
- Fixed a false positive on committed specs with CRLF line endings.
- Fixed a misleading failure in shallow clones.
- Fixed the spec parser disagreeing with GitHub on some Markdown, which could hide a task,
  change the Status, or run a different verification command.
- Fixed a rare case where the spec parser could read a list item differently than GitHub does.
- Fixed a crash when the spec contains a table.
- Fixed a checked task that could be misread and skip validation.
- Fixed a hidden task not being detected in some cases.
- Fixed unclosed code fences being accepted when the spec requires them closed.
- Fixed `sdd-verify --task` misplacing evidence in some cases.
- Fixed `sdd-verify --task` silently deleting other task data in some cases.
- Fixed `sdd-verify --task` not checking for existing spec problems before writing evidence.
- Fixed where `sdd-verify --task` wrote evidence under numbered tasks.
- Fixed several false positives and false negatives in the secret scanner.
- Fixed which paths the secret scanner skips.
- Fixed a prose-check false positive where symlinks are unavailable.
- Fixed `scripts/dev/sync-vendored.js` accepting a mistyped flag.
- Fixed `sdd-verify` not killing background processes on timeout.
- Fixed the framework exemption in the specification check applying too broadly.
- Fixed the config validator accepting invalid keys.
- Fixed the prose linter's handling of a custom `roadmapDir`.
- Fixed `sdd-init`'s next steps and guided mode in some configurations.
- Fixed test cleanup and Windows hook tests.

## [1.3.0] - 2026-09-25

### Fixed
- Fixed the pre-push hook checking the working tree instead of the pushed commits.
- Fixed Git failures being swallowed instead of failing the check.
- Fixed `sdd.config.json` not being validated.
- Fixed several bypasses in the specification check.
- Fixed the secret scanner missing several kinds of credentials and secret files.
- Fixed `maxEmDashes` and the fence-closing rule.
- Fixed the pre-push hook installer writing into a shared hooks directory.
- Fixed `sdd-init` ignoring some flags and forms.
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
