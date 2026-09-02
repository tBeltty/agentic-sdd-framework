# Remediation Order: ANNEX_[LETTER]

**Initiative:** [Initiative Name]  
**Auditor:** [Name / Role]  
**Supersedes:** [Task ID or Gate ID, e.g. P1-T2 or P1-G1]  
**Issued Date:** [YYYY-MM-DD]  
**Status:** Open | Remediated | Closed  

---

## 1. Reason for Remediation

Document the exact defect, test failure, or regression observed during the audit.

* **Target Task / Gate:** [ID]
* **Failure Observed:** [Paste failing command output or traceback]
* **Root Cause Analysis:** Explain why the defect occurred without guessing.

---

## 2. Remediation Instructions

Provide unambiguous, self-contained steps to repair the defect. The Executor must not need prior conversation context to complete this order.

### Steps:
1. **Target File:** `path/to/file.ext`
2. **Action:** [Describe required modification]
3. **Guardrail:** [State what must not break]

---

## 3. Re-Verification Command

* **Command:**
  ```bash
  [command to verify defect is resolved]
  ```
* **Expected Output:**
  ```text
  [expected success pattern]
  ```
* **Compliance Action:** Report evidence directly in the next available row of the Compliance Log.
