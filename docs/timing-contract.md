# Processing timing contract (ARCH-101)

**Root cause:** RC-1 / RC-2 (document only; automation values **not changed** in RC-1 Step 1)

This document records **current** timeouts and **expectations** so backend, AI, and automation can be aligned in later sprints.

## Configuration module (single source)

**`backend/src/config/documentProcessingLifecycle.js`** — reads env vars below; services must not duplicate default literals.

## Environment variables (backend)

| Variable | Default | Location | Purpose |
|----------|---------|----------|---------|
| `AI_REQUEST_TIMEOUT` | `420000` (7 min) | `config/aiService.js`, `config/documentProcessingLifecycle.js` | Max wait for ai-model `POST /analyze` |
| `AI_SKIP_BACKEND_OCR_MIN_CONFIDENCE` | `0.45` | `documentProcessingService.processDocument` | Skip backend OCR when AI confidence ≥ threshold |
| `SKIP_MULTI_OCR_CHECK` | `0` | `processDocument` | Skip multi-engine OCR reconciliation when `1` |
| `DOCUMENT_PROCESSING_SINGLE_FLIGHT` | `true` | `config/documentProcessingLifecycle.js` | Block overlapping execution per document id (not duplicate bills) |
| `DOCUMENT_PROCESSING_HEARTBEAT_ENABLED` | `true` | same | Enable BE-103 processing heartbeats |
| `DOCUMENT_PROCESSING_HEARTBEAT_INTERVAL_MS` | `30000` | same | BE-103 interval between heartbeat ticks |
| `DOCUMENT_BULK_PROCESSING_CONCURRENCY` | `1` | same | Bulk parallelism (sequential when 1) |
| `DOCUMENT_PROCESSING_QUEUE_ENABLED` | `false` | same | Future BE-104 queue (setImmediate when false) |
| `DOCUMENT_LIFECYCLE_ENFORCE_TRANSITIONS` | `true` | `documentLifecycle.js` | Enforce state machine transitions |
| `DOCUMENT_LARGE_FILE_WARN_BYTES` | `2097152` | `documentProcessingService.processDocument` | Large-file log threshold only |

## Environment variables (automation — documented only, unchanged)

| Variable | Default | Location | Purpose |
|----------|---------|----------|---------|
| `AUTOMATION_STALE_PROCESSING_MS` | `120000` (2 min) | `automation_system/configs/default.config.js` | Stale `processing` if no document activity |
| `AUTOMATION_POLL_TIMEOUT_MS` | `600000` (10 min) | same | Max poll duration |
| `AUTOMATION_POLL_INTERVAL_MS` | `3000` | same | Poll interval |

## Contract rules (target alignment — RC-2)

1. **`AI_REQUEST_TIMEOUT` ≥ `AUTOMATION_STALE_PROCESSING_MS` + safety margin**  
   - Current gap: 420s vs 120s → automation may mark stale while backend still processing.  
   - **RC-1 Step 1 does not change automation.** Record for RC-2.

2. **`AUTOMATION_POLL_TIMEOUT_MS` ≥ `AI_REQUEST_TIMEOUT` + backend post-AI work + margin**  
   - Post-AI: OCR fallback, reconcile, carbon, Mongo save (often 30s–120s+).

3. **Processing expectations (backend)**  
   - `uploaded` → `processing`: first `save` at start of `processDocument`.  
   - `processing` duration: dominated by AI call (0–420s) + optional backend OCR + save.  
   - Terminal save: `processed`, `failed`, or `duplicate`.

4. **Heartbeat expectations (BE-103 — implemented)**  
   - While `status === processing`, `emitProcessingHeartbeat` runs on `DOCUMENT_PROCESSING_HEARTBEAT_INTERVAL_MS` and on each stage change.  
   - Persists `metadata.processingLifecycle` (`currentStage`, `lastHeartbeatAt`, `heartbeatCount`) and `processingResults.heartbeatAt` / `heartbeatSeq`.  
   - Does **not** change document status; automation activity keys can advance during long `callAIModel`.  
   - **RC-2:** For reliable stale avoidance, set `DOCUMENT_PROCESSING_HEARTBEAT_INTERVAL_MS` &lt; `AUTOMATION_STALE_PROCESSING_MS` (automation env unchanged in RC-1).

## Frontend (reference only — out of scope RC-1 Step 1)

- `DocumentManagement` polls every **8s** when any doc is `uploaded` or `processing`.

## AI model (reference only — out of scope RC-1 Step 1)

- Analyze pipeline runs OCR + extraction in-process; no separate HTTP timeout inside service beyond backend client.

## Operational SLA (informal)

| Stage | Expected P50 | Expected worst case |
|-------|----------------|---------------------|
| Upload ACK | &lt; 1s | &lt; 2s |
| `uploaded` → `processing` | &lt; 2s | &lt; 10s (event loop) |
| `processing` → terminal | 30s–90s | **420s+** (large PDF / slow AI) |

## Version

- **Contract version:** 1.0  
- **Introduced:** RC-1 Step 1 (BE-101, ARCH-101)  
- **Next change:** RC-2 (align stale vs AI timeout; optional heartbeat BE-103)
