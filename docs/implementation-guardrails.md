# Implementation guardrails (RC-1+)

All roadmap work must comply with these rules.

## 1. No dataset-specific or vendor-specific logic

Do **not** hard-code vendors, GSTIN/invoice/date patterns, bill types, or golden-set behavior in lifecycle, queue, or execution code. Use existing extraction/config modules for field rules.

## 2. Business duplicate detection is unchanged

- **`checkForDuplicates`** and **`duplicateDetectionService`** remain the authority for duplicate **bills**.
- Lifecycle status **`duplicate`** still means “business duplicate detection matched,” not “skipped a second worker.”

## 3. Execution deduplication only

- **`documentProcessingExecution`** prevents overlapping **`processDocument`** runs for the same **document id** when `DOCUMENT_PROCESSING_SINGLE_FLIGHT=true`.
- Skipping a second worker does **not** change duplicate bill outcomes.

## 4. Configuration, state machine, or contract

| Concern | Mechanism |
|---------|-----------|
| Allowed statuses | State machine: `documentLifecycle.js` |
| Timeouts | Env: `AI_REQUEST_TIMEOUT`, etc. (`config/documentProcessingLifecycle.js`) |
| Heartbeat (future) | Env: `DOCUMENT_PROCESSING_HEARTBEAT_INTERVAL_MS` |
| Queue (future) | Env: `DOCUMENT_PROCESSING_QUEUE_ENABLED` |
| Execution dedup | Env: `DOCUMENT_PROCESSING_SINGLE_FLIGHT` |

## 5–7. No inline timeouts / heartbeat / queue constants

Read from `backend/src/config/documentProcessingLifecycle.js` or `backend/src/config/aiService.js`. Defaults live in config module, not scattered in services.

## 8. Backward compatibility

- API response shapes for upload/process unchanged.
- Terminal statuses unchanged: `processed`, `failed`, `duplicate`.
- Optional metadata: `metadata.processingLifecycle` (additive).
- With `DOCUMENT_PROCESSING_SINGLE_FLIGHT=false`, behavior matches pre-guard concurrent execution.

## 9. No test shortcuts

Tests assert state machine and execution guard generically, not fixed GSTIN/invoice values.

## 10. Reject dataset-specific fixes

If a failure appears only on one bill file, fix via generic lifecycle, provenance, or contract — not file-specific branches.

## Related docs

- `document-lifecycle-state-machine.md`
- `timing-contract.md`
