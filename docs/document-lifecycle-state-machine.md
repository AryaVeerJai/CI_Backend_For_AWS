# Document lifecycle state machine (BE-101)

**Root cause:** RC-1 Processing Lifecycle  
**Status enum source:** `backend/src/models/Document.js`

## States

| State | Terminal | Description |
|-------|----------|-------------|
| `uploaded` | No | Record created; async processing not started or not yet set to `processing` |
| `processing` | No | `processDocument` has started; AI/OCR/save in progress |
| `processed` | Yes | Extraction saved successfully |
| `failed` | Yes | Processing or bootstrap error; see `processingResults.errors` |
| `duplicate` | Yes | Duplicate detection matched an existing document |

## Allowed transitions

Enforced in code: `backend/src/services/documentLifecycle.js`

| From \\ To | uploaded | processing | processed | failed | duplicate |
|------------|:--------:|:----------:|:---------:|:------:|:---------:|
| **uploaded** | — | ✓ | ✗ | ✓ | ✗ |
| **processing** | ✗ | — | ✓ | ✓ | ✓ |
| **processed** | ✗ | ✓ (reprocess) | — | ✗ | ✗ |
| **failed** | ✗ | ✓ (reprocess) | ✗ | — | ✗ |
| **duplicate** | ✗ | ✓ (reprocess) | ✗ | ✗ | — |

**Note:** `processed` → `processing`, `failed` → `processing`, and `duplicate` → `processing` are **valid** via `POST /api/documents/:id/reprocess`, not bugs.

## Invalid transitions (examples)

| From | To | Why invalid |
|------|-----|-------------|
| `uploaded` | `processed` | Skips processing |
| `uploaded` | `duplicate` | Duplicate checked during processing |
| `processing` | `uploaded` | No rollback to uploaded |
| `processed` | `failed` | Must use reprocess → `processing` → `failed` |
| `processed` | `duplicate` | Duplicate set only from `processing` |
| `failed` | `processed` | Must reprocess |
| `duplicate` | `processed` | Must reprocess |

## Assignment map (production code)

All `document.status` assignments on the **Document** model in the bill upload path:

| # | File | Function / route | From (typical) | To | Trigger |
|---|------|------------------|----------------|-----|---------|
| 1 | `routes/documents.js` | `POST /upload` `setImmediate` catch | `uploaded` | `failed` | File read / bootstrap error (BE-102) |
| 2 | `documentProcessingService.js` | `processDocument` | `uploaded` | `failed` | Empty/invalid buffer (bootstrap) |
| 3 | `documentProcessingService.js` | `processDocument` | `uploaded` \| terminal | `processing` | Processing started / reprocess |
| 4 | `documentProcessingService.js` | `rejectDocumentForOcrQuality` | `processing` | `failed` | AI 422 OCR quality rejection |
| 5 | `documentProcessingService.js` | `processDocument` | `processing` | `duplicate` | `checkForDuplicates` match |
| 6 | `documentProcessingService.js` | `finalizeAndSaveProcessedDocument` | `processing` | `processed` | Successful save |
| 7 | `documentProcessingService.js` | `processDocument` `catch` | `processing` | `failed` \| `duplicate` | Uncaught error / duplicate message |

**Default on create:** `uploaded` (schema default, no explicit assignment in route).

**Not document lifecycle:** Other services use `status: 'failed'` on agents, billing, orchestration events — not `Document.status`.

## Stuck-state analysis

### Forever `uploaded`

| Path | Mitigation in RC-1 Step 1 |
|------|---------------------------|
| `setImmediate` throws before `processDocument` (e.g. `readFile`) | Upload catch calls `failBootstrap` → `failed` |
| Empty file buffer | `failBootstrap` from route or `processDocument` bootstrap check |
| Server never runs `setImmediate` | Operational / future queue (out of scope) |

### Forever `processing`

| Path | Mitigation in RC-1 Step 1 |
|------|---------------------------|
| Long `callAIModel` (up to `AI_REQUEST_TIMEOUT`) | BE-103 heartbeats refresh metadata during processing (see below) |
| Hang without throw | Future watchdog; not in this step |
| Error after `processing` save but outside `catch` | Rare; `catch` covers `try` body |

## Metadata

`metadata.processingLifecycle` records `lastFrom`, `lastTo`, `lastTransitionAt`, `lastStage`, `lastFailureStage` when using `documentLifecycle` helpers.

### BE-103 processing heartbeat (stages)

Emitted on interval (`DOCUMENT_PROCESSING_HEARTBEAT_INTERVAL_MS`) and when the stage changes in `processDocument`:

| Stage key | When |
|-----------|------|
| `processing_started` | After `transitionToProcessing`, heartbeat session start |
| `ai_analyze` | Before `callAIModel` |
| `ai_extraction_only` | AI confident; skipping backend OCR |
| `backend_ocr` | Backend OCR path |
| `ocr_accuracy_check` | Multi-engine OCR reconciliation |
| `reconcile` | Field reconciliation |
| `duplicate_check` | Before `checkForDuplicates` |
| `finalize_save` | Before persist / terminal transition |

Implementation: `documentProcessingHeartbeat.js` → `documentLifecycle.emitProcessingHeartbeat`.

## BE-110 bulk upload parity

| Concern | Single upload | Bulk upload |
|---------|---------------|-------------|
| Entry | `readFileAndProcess` in `setImmediate` | Per-file read + `processWithBuffer` in `processMultipleDocuments` |
| Lifecycle | `transitionToProcessing` → terminals via `processDocument` | Same |
| Read failure | `failProcessingEntry` (`upload_read`) | `failProcessingEntry` (`bulk_read`); null buffer skipped in batch loop |
| Execution guard | `tryBeginExecution` in `processDocument` | Same per document |
| Bootstrap empty buffer | `failProcessingEntry` | Same (`bulk_empty_file`) |

Shared module: `documentUploadProcessing.js`.

## BE-111 reprocess hardening

| Rule | Behavior |
|------|----------|
| Allowed sources | `uploaded`, `processed`, `failed`, `duplicate`, or stale `processing` (no active execution) |
| Concurrent reprocess | `409` when `processing` and `isExecutionActive` |
| Invalid status | `400` when status cannot reprocess |
| Terminal guarantee | `readFileAndProcess` → `processDocument` catch/`markDocumentFailed`; route catch → `failProcessingEntry` |
| Response | Reloads document; `success` requires terminal status (`processed` \| `failed` \| `duplicate`) |

Route: `POST /api/documents/:id/reprocess` → `validateReprocessRequest` → `readFileAndProcess({ source: 'reprocess' })`.

## Execution deduplication vs business duplicate

| Mechanism | Purpose | Config |
|-----------|---------|--------|
| `documentProcessingExecution` | Prevents two concurrent **processDocument** runs for the same document id | `DOCUMENT_PROCESSING_SINGLE_FLIGHT` |
| `checkForDuplicates` | Business **duplicate bill** detection (unchanged) | Existing duplicate detection config |

Skipping a duplicate **execution** does not set status `duplicate` and does not call `checkForDuplicates`.

## Related

- Guardrails: `backend/docs/implementation-guardrails.md`
- Timing expectations: `backend/docs/timing-contract.md` (ARCH-101)
- Config: `backend/src/config/documentProcessingLifecycle.js`
- State machine: `backend/src/services/documentLifecycle.js`
- Execution guard: `backend/src/services/documentProcessingExecution.js`
