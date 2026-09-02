# Execution Guide: [Initiative Name]

**Plan of Record:** [Link to Plan of Record]  
**Auditor:** [Name / Role]  
**Active Phase:** Phase 1  

---

## Rules of Engagement for Executors

1. **One task at a time, in strict sequence.** Do not batch tasks. Do not start a phase until its predecessor is marked `APPROVED` in the Compliance Log.
2. **Never invent values declared by the repository.** Read ports, constants, environment keys, and models from existing code.
3. **Observe, do not guess.** Read logs, run queries, and inspect command output directly.
4. **Verification requires running the code.** Reviewing code visually is not verification.
5. **Scope is bounded by the task description.** Record unrelated findings in Observations; do not apply speculative fixes.
6. **Stop and ask immediately** when an instruction contradicts existing code or when a task encounters an unhandled edge case.
7. **If the codebase cannot support a task as written, report the finding and stop.** A well-argued stopping report is a successful task output.
8. **Repository Conventions:** Follow all rules declared in `.agents/AGENTS.md`.

---

## Phase 1: [Phase Name]

### P1-T1: [Imperative Task Title]
* **Goal:** [One sentence stating the exact post-condition].
* **Files:**
  * `path/to/target/fileA.ext`
  * `path/to/target/fileB.ext`
* **Steps:**
  1. [Step 1: Specific modification]
  2. [Step 2: Specific modification]
* **Verification Command:**
  ```bash
  [command to verify this step]
  ```
* **Expected Output:**
  ```text
  [expected terminal output pattern]
  ```

---

### P1-T2: [Imperative Task Title]
* **Goal:** [One sentence stating the exact post-condition].
* **Files:**
  * `path/to/target/fileC.ext`
* **Steps:**
  1. [Step 1: Specific modification]
* **Verification Command:**
  ```bash
  [command to verify this step]
  ```
* **Expected Output:**
  ```text
  [expected terminal output pattern]
  ```

---

### P1-G1 (Phase 1 Gate): [Gate Title]
* **Verification Command:**
  ```bash
  [suite or end-to-end command]
  ```
* **Expected Output:**
  ```text
  [exact exit code and output line]
  ```
* **Negative Control (Required for security or data boundaries):**
  * Step 1: Temporarily remove or bypass the validation rule or protection.
  * Step 2: Run verification command and observe test FAIL.
  * Step 3: Restore the validation rule.
  * Step 4: Run verification command and observe test PASS.
