# Feature Specification: [Feature Name]

**Specification Mode:** Lite (Single-Document Execution)  
**Status:** Draft | In Progress | Completed  
**Author:** [Author Name]  
**Target Completion:** [Date]  

> The quality gate enforces this document. Status must be `Draft`, `In Progress`, or `Completed`. A checked task needs evidence: record it with `sdd-verify --task <ID> -- <command>`, or paste the command and its output. `In Progress` and `Completed` need a real verification command and expected output. `Completed` needs every task checked and a PASS recorded by `sdd-verify --record` for the exact content being completed; change a file afterwards and the PASS no longer counts. Keep to plain Markdown (spaces for indentation, closed fences, no raw HTML): the gate rejects markup it cannot read exactly as it renders.

---

## 1. Context and Problem Statement

State the exact problem or user requirement. Document the operational root cause or feature motivation without filler or marketing language.

* **Current Behavior:** Describe what happens today.
* **Desired Behavior:** Describe what should happen after implementation.
* **Non-Goals:** Explicitly list what this change will not address.

---

## 2. Technical Architecture and Constraints

List every component, file, and interface impacted by this specification.

* **Components Affected:**
  * Component A: [Brief description of changes]
  * Component B: [Brief description of changes]
* **Data Models & Contracts:** Detail input/output schemas, schema migrations, or API payloads.
* **Dependencies:** Name any external libraries needed. If none, state "None".
* **Architectural Boundaries:** State constraints (for example: Domain must not import Infrastructure).

---

## 3. Implementation Tasks

List atomic, sequential tasks. Each task must name target files and concrete actions. Check a task only after pasting the command you ran and its literal output under **Evidence**.

* [ ] **T1:** [Action description]
  * **Files:** `path/to/fileA.ext`
  * **Details:** Specific functions, types, or configuration keys to add or modify.
  * **Evidence:** [command run and its literal output]
* [ ] **T2:** [Action description]
  * **Files:** `path/to/fileB.ext`
  * **Details:** Integration and orchestration logic.
  * **Evidence:** [command run and its literal output]
* [ ] **T3:** [Action description]
  * **Files:** `path/to/tests/feature.test.ext`
  * **Details:** Unit and integration test coverage.
  * **Evidence:** [command run and its literal output]

---

## 4. Verification Gate

The specification is not complete until this command exits with code 0 and returns expected output. `sdd-verify --record` runs it in `/bin/sh` (macOS, Linux) or `cmd.exe` (Windows) unless `specification.verifyShell` says otherwise, and checks that every non-empty line of the expected output appears in the actual output (a line wrapped in `/slashes/` is a regular expression).

* **Verification Command:**
  ```bash
  [command to run tests or validation scripts]
  ```
* **Expected Output:**
  ```text
  [exact pattern or output line confirming success]
  ```
* **Manual Verification (If applicable):** Specific manual steps to observe expected behavior.
* **Last Verified:** [recorded by sdd-verify --record]

`sdd-verify --record` writes `Last Verified` with a hash over the result, the command, and the expected output. Do not edit it by hand: changing any of them reopens the spec until you record again.

---

## 5. Decision Rationale

Record trade-offs and alternatives rejected during implementation.

* **Decision 1:** [Why option A was selected over option B].
* **Origin:** [Incident, performance measurement, or architectural requirement driving the decision].
