# Feature Specification: [Feature Name]

**Specification Mode:** Lite (Single-Document Execution)  
**Status:** Draft | In Progress | Completed  
**Author:** [Author Name]  
**Target Completion:** [Date]  

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

List atomic, sequential tasks. Each task must name target files and concrete actions.

* [ ] **T1:** [Action description]
  * **Files:** `path/to/fileA.ext`
  * **Details:** Specific functions, types, or configuration keys to add or modify.
* [ ] **T2:** [Action description]
  * **Files:** `path/to/fileB.ext`
  * **Details:** Integration and orchestration logic.
* [ ] **T3:** [Action description]
  * **Files:** `path/to/tests/feature.test.ext`
  * **Details:** Unit and integration test coverage.

---

## 4. Verification Gate

The specification is not complete until this command exits with code 0 and returns expected output.

* **Verification Command:**
  ```bash
  [command to run tests or validation scripts]
  ```
* **Expected Output:**
  ```text
  [exact pattern or output line confirming success]
  ```
* **Manual Verification (If applicable):** Specific manual steps to observe expected behavior.

---

## 5. Decision Rationale

Record trade-offs and alternatives rejected during implementation.

* **Decision 1:** [Why option A was selected over option B].
* **Origin:** [Incident, performance measurement, or architectural requirement driving the decision].
