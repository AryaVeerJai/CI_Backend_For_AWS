/**
 * Document processing lifecycle state machine (RC-1 / BE-101).
 *
 * Canonical statuses match backend/src/models/Document.js enum.
 * Business duplicate bill detection is unchanged — see checkForDuplicates;
 * status `duplicate` only records that outcome via transitionToDuplicate.
 */

const { config: lifecycleConfig } = require('../config/documentProcessingLifecycle');
const Document = require('../models/Document');

const TERMINAL_STATUSES = Object.freeze(['processed', 'failed', 'duplicate']);

const ALLOWED_TRANSITIONS = Object.freeze({
  uploaded: new Set(['processing', 'failed']),
  processing: new Set(['processed', 'failed', 'duplicate']),
  processed: new Set(['processing']),
  failed: new Set(['processing']),
  duplicate: new Set(['processing'])
});

const ASSIGNMENT_LOCATIONS = Object.freeze([
  {
    file: 'backend/src/routes/documents.js',
    handler: 'POST /upload setImmediate bootstrap',
    from: 'uploaded',
    to: 'failed',
    note: 'File read / bootstrap failure (BE-102)'
  },
  {
    file: 'backend/src/services/documentProcessingService.js',
    handler: 'processDocument (bootstrap)',
    from: 'uploaded',
    to: 'failed',
    note: 'Invalid or empty file buffer before processing'
  },
  {
    file: 'backend/src/services/documentProcessingService.js',
    handler: 'processDocument',
    from: 'uploaded|processed|failed|duplicate',
    to: 'processing',
    note: 'Start processing or reprocess'
  },
  {
    file: 'backend/src/services/documentProcessingService.js',
    handler: 'rejectDocumentForOcrQuality',
    from: 'processing',
    to: 'failed'
  },
  {
    file: 'backend/src/services/documentProcessingService.js',
    handler: 'processDocument duplicate branch',
    from: 'processing',
    to: 'duplicate'
  },
  {
    file: 'backend/src/services/documentProcessingService.js',
    handler: 'finalizeAndSaveProcessedDocument',
    from: 'processing',
    to: 'processed'
  },
  {
    file: 'backend/src/services/documentProcessingService.js',
    handler: 'processDocument catch',
    from: 'processing',
    to: 'failed|duplicate'
  }
]);

function normalizeStatus(status) {
  return String(status || 'uploaded').trim().toLowerCase();
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(normalizeStatus(status));
}

function canTransition(fromStatus, toStatus) {
  const from = normalizeStatus(fromStatus);
  const to = normalizeStatus(toStatus);
  if (from === to) {
    return true;
  }
  const allowed = ALLOWED_TRANSITIONS[from];
  return Boolean(allowed && allowed.has(to));
}

function assertValidTransition(fromStatus, toStatus) {
  const from = normalizeStatus(fromStatus);
  const to = normalizeStatus(toStatus);
  if (from === to) {
    return { from, to, valid: true, idempotent: true };
  }
  if (!canTransition(from, to)) {
    const error = new Error(`Invalid document status transition: ${from} -> ${to}`);
    error.code = 'INVALID_DOCUMENT_STATUS_TRANSITION';
    error.fromStatus = from;
    error.toStatus = to;
    if (lifecycleConfig.enforceTransitions) {
      throw error;
    }
    console.warn('[documentLifecycle]', error.message);
  }
  return { from, to, valid: true, idempotent: false };
}

function touchLifecycleMetadata(document, patch = {}) {
  const existing = (document.metadata && document.metadata.processingLifecycle) || {};
  document.metadata = {
    ...(document.metadata || {}),
    processingLifecycle: {
      ...existing,
      ...patch,
      lastTransitionAt: new Date().toISOString()
    }
  };
}

/** Terminal states that may enter reprocess (transition to processing). */
const REPROCESS_ALLOWED_FROM = new Set(['uploaded', 'processed', 'failed', 'duplicate']);

function isReprocessAllowedStatus(status) {
  return REPROCESS_ALLOWED_FROM.has(normalizeStatus(status));
}

/**
 * BE-103: Persist heartbeat without changing terminal status.
 * Uses atomic updateOne/findOneAndUpdate — never document.save() — to avoid
 * ParallelSaveError when processDocument saves the same Mongoose doc concurrently.
 */
async function emitProcessingHeartbeat(document, { stage, save = true } = {}) {
  if (!stage || !document?._id) {
    return document;
  }

  const heartbeatAt = new Date().toISOString();

  if (!save) {
    const existing = (document.metadata && document.metadata.processingLifecycle) || {};
    const heartbeatCount = Number(existing.heartbeatCount || 0) + 1;
    touchLifecycleMetadata(document, {
      currentStage: stage,
      lastHeartbeatAt: heartbeatAt,
      heartbeatCount
    });
    const priorResults = document.processingResults || {};
    document.processingResults = {
      ...priorResults,
      confidence: priorResults.confidence ?? 0,
      processingTime: priorResults.processingTime ?? 0,
      errors: priorResults.errors || [],
      warnings: priorResults.warnings || [],
      heartbeatAt,
      heartbeatSeq: heartbeatCount
    };
    if (typeof document.markModified === 'function') {
      document.markModified('metadata');
      document.markModified('processingResults');
    }
    return document;
  }

  const updated = await Document.findOneAndUpdate(
    { _id: document._id, status: 'processing' },
    {
      $inc: {
        'metadata.processingLifecycle.heartbeatCount': 1,
        'processingResults.heartbeatSeq': 1
      },
      $set: {
        'metadata.processingLifecycle.currentStage': stage,
        'metadata.processingLifecycle.lastHeartbeatAt': heartbeatAt,
        'metadata.processingLifecycle.lastTransitionAt': heartbeatAt,
        'processingResults.heartbeatAt': heartbeatAt
      }
    },
    {
      new: true,
      projection: { metadata: 1, processingResults: 1, status: 1 }
    }
  );

  if (!updated) {
    return document;
  }

  document.metadata = {
    ...(document.metadata || {}),
    ...(updated.metadata || {})
  };
  document.processingResults = {
    ...(document.processingResults || {}),
    ...(updated.processingResults || {})
  };
  if (typeof document.markModified === 'function') {
    document.markModified('metadata');
    document.markModified('processingResults');
  }

  return document;
}

/**
 * Bootstrap failure when not yet in processing (uploaded) vs reprocess/bootstrap from terminal.
 */
async function failProcessingEntry(document, error, options = {}) {
  const message =
    (error && error.message) ||
    (typeof error === 'string' ? error : 'Document processing could not start');
  const stage = options.stage || 'bootstrap';
  const status = normalizeStatus(document.status);

  if (status === 'uploaded') {
    return failBootstrap(document, error);
  }

  if (status !== 'processing' && isReprocessAllowedStatus(status)) {
    await transitionToProcessing(document);
  } else if (status !== 'processing') {
    await markDocumentFailed(document, {
      message,
      errors: [message],
      stage,
      processingTime: options.processingTime || 0
    });
    return {
      success: false,
      extractedData: null,
      errors: [message],
      warnings: [],
      processingTime: options.processingTime || 0
    };
  }

  await markDocumentFailed(document, {
    message,
    errors: [message],
    stage,
    processingTime: options.processingTime || 0
  });
  return {
    success: false,
    extractedData: null,
    errors: [message],
    warnings: [],
    processingTime: options.processingTime || 0
  };
}

function isValidFileBuffer(fileBuffer) {
  return Buffer.isBuffer(fileBuffer) && fileBuffer.length > 0;
}

async function transitionDocument(document, toStatus, options = {}) {
  const { save = true, lifecycleMeta = {} } = options;
  const from = normalizeStatus(document.status);
  const to = normalizeStatus(toStatus);
  const transition = assertValidTransition(from, to);
  document.status = to;
  touchLifecycleMetadata(document, {
    lastFrom: transition.from,
    lastTo: transition.to,
    ...lifecycleMeta
  });
  if (save) {
    await document.save();
  }
  return document;
}

async function markDocumentFailed(document, options = {}) {
  const {
    message = 'Document processing failed',
    errors = [],
    warnings = [],
    processingTime = 0,
    stage = 'processing',
    save = true,
    ocrValidation = null,
    metadataOcr = null
  } = options;

  const errorList = errors.length > 0 ? errors : [message];
  await transitionDocument(document, 'failed', {
    save: false,
    lifecycleMeta: { lastFailureStage: stage }
  });

  document.processingResults = {
    confidence: 0,
    processingTime,
    errors: errorList,
    warnings: warnings || [],
    ...(ocrValidation ? { ocrValidation } : {})
  };

  if (metadataOcr) {
    document.metadata = {
      ...(document.metadata || {}),
      ocr: {
        ...((document.metadata && document.metadata.ocr) || {}),
        ...metadataOcr
      }
    };
  }

  if (save) {
    await document.save();
  }
  return document;
}

/**
 * Bootstrap failure before or without entering processing (uploaded -> failed).
 */
async function failBootstrap(document, error) {
  const message =
    (error && error.message) ||
    (typeof error === 'string' ? error : 'Document upload processing could not start');
  await markDocumentFailed(document, {
    message,
    errors: [message],
    warnings: [],
    processingTime: 0,
    stage: 'bootstrap'
  });
  return {
    success: false,
    extractedData: null,
    errors: [message],
    warnings: [],
    processingTime: 0
  };
}

async function transitionToProcessing(document) {
  return transitionDocument(document, 'processing', {
    lifecycleMeta: { lastStage: 'processing_started' }
  });
}

/**
 * Apply terminal status after business duplicate detection (checkForDuplicates).
 * Does not perform duplicate matching — caller supplies duplicateDetection payload.
 */
async function transitionToDuplicate(document, duplicateDetection) {
  await transitionDocument(document, 'duplicate', {
    save: false,
    lifecycleMeta: { lastStage: 'business_duplicate_detected' }
  });
  if (duplicateDetection) {
    document.duplicateDetection = duplicateDetection;
  }
  await document.save();
  return document;
}

function buildInvalidTransitionReport() {
  const invalidExamples = [
    { from: 'uploaded', to: 'processed', reason: 'Must enter processing first' },
    { from: 'uploaded', to: 'duplicate', reason: 'Duplicate is detected during processing' },
    { from: 'processing', to: 'uploaded', reason: 'Cannot revert to uploaded' },
    { from: 'processed', to: 'failed', reason: 'Use reprocess -> processing -> failed' },
    { from: 'processed', to: 'duplicate', reason: 'Duplicate branch runs from processing' },
    { from: 'failed', to: 'processed', reason: 'Must reprocess through processing' },
    { from: 'duplicate', to: 'processed', reason: 'Must reprocess through processing' }
  ];
  return invalidExamples.filter((row) => !canTransition(row.from, row.to));
}

function getStuckStatePaths() {
  return Object.freeze([
    {
      status: 'uploaded',
      cause: 'setImmediate handler throws before processDocument (e.g. fs.readFile)',
      mitigation: 'BE-102: failBootstrap in upload catch'
    },
    {
      status: 'uploaded',
      cause: 'processDocument never invoked (server crash, unscheduled job)',
      mitigation: 'Operational: reprocess; future job queue (RC-1 later)'
    },
    {
      status: 'processing',
      cause: 'Long callAIModel without intermediate save; automation may mark stale',
      mitigation: 'ARCH-101 timing; BE-103 heartbeat during processing'
    },
    {
      status: 'processing',
      cause: 'Unhandled hang (no throw, no return) inside processDocument',
      mitigation: 'Future watchdog; AI_REQUEST_TIMEOUT eventually throws or returns'
    },
    {
      status: 'processing',
      cause: 'processDocument throw after partial work without reaching catch',
      mitigation: 'catch block sets failed/duplicate'
    }
  ]);
}

module.exports = {
  TERMINAL_STATUSES,
  ALLOWED_TRANSITIONS,
  REPROCESS_ALLOWED_FROM,
  ASSIGNMENT_LOCATIONS,
  normalizeStatus,
  isTerminalStatus,
  isReprocessAllowedStatus,
  canTransition,
  assertValidTransition,
  isValidFileBuffer,
  transitionDocument,
  markDocumentFailed,
  failBootstrap,
  failProcessingEntry,
  transitionToProcessing,
  transitionToDuplicate,
  emitProcessingHeartbeat,
  buildInvalidTransitionReport,
  getStuckStatePaths
};
