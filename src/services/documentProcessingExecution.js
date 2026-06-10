/**
 * Execution-scope guards for document processing (RC-1).
 *
 * Prevents duplicate concurrent processDocument runs for the SAME document id.
 * This is NOT duplicate bill detection (see checkForDuplicates in documentProcessingService).
 */

const crypto = require('crypto');
const lifecycleConfig = require('../config/documentProcessingLifecycle');

/** @type {Map<string, { token: string, startedAt: number }>} */
const activeExecutions = new Map();

function executionKey(documentId) {
  return String(documentId);
}

/**
 * Begin a single processing execution for a document.
 * @returns {{ acquired: boolean, token?: string, reason?: string }}
 */
function tryBeginExecution(documentId) {
  if (!lifecycleConfig.config.singleFlightEnabled) {
    return { acquired: true, token: crypto.randomUUID() };
  }

  const key = executionKey(documentId);
  if (activeExecutions.has(key)) {
    return {
      acquired: false,
      reason: 'processing_execution_already_active'
    };
  }

  const token = crypto.randomUUID();
  activeExecutions.set(key, { token, startedAt: Date.now() });
  return { acquired: true, token };
}

/**
 * End a processing execution. No-op if token does not match (safety).
 */
function endExecution(documentId, token) {
  if (!lifecycleConfig.config.singleFlightEnabled) {
    return;
  }
  const key = executionKey(documentId);
  const current = activeExecutions.get(key);
  if (current && current.token === token) {
    activeExecutions.delete(key);
  }
}

function getActiveExecutionCount() {
  return activeExecutions.size;
}

function isExecutionActive(documentId) {
  if (!lifecycleConfig.config.singleFlightEnabled) {
    return false;
  }
  return activeExecutions.has(executionKey(documentId));
}

module.exports = {
  tryBeginExecution,
  endExecution,
  getActiveExecutionCount,
  isExecutionActive
};
