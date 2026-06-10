/**
 * Configuration for document processing lifecycle (RC-1).
 * All timeouts, intervals, and execution guards are env-driven — no inline magic numbers in services.
 */

const isTrue = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
};

const config = {
  /** Enforce ALLOWED_TRANSITIONS in documentLifecycle (state-machine-driven). */
  enforceTransitions: isTrue(process.env.DOCUMENT_LIFECYCLE_ENFORCE_TRANSITIONS, true),

  /**
   * Prevent overlapping processDocument runs for the same document id (execution dedup only).
   * Does NOT affect checkForDuplicates / business duplicate bill detection.
   */
  singleFlightEnabled: isTrue(process.env.DOCUMENT_PROCESSING_SINGLE_FLIGHT, true),

  /** BE-103: emit processing heartbeats while status is processing. */
  heartbeatEnabled: isTrue(process.env.DOCUMENT_PROCESSING_HEARTBEAT_ENABLED, true),

  /** Interval between heartbeat persistence ticks (ms). */
  heartbeatIntervalMs: parsePositiveInt(process.env.DOCUMENT_PROCESSING_HEARTBEAT_INTERVAL_MS, 30000),

  /** Max parallel bulk documents when queue disabled (0 = unlimited sequential). */
  bulkProcessingConcurrency: parsePositiveInt(process.env.DOCUMENT_BULK_PROCESSING_CONCURRENCY, 1),

  /**
   * Future job queue (BE-104). When false, setImmediate path remains (backward compatible).
   */
  queueEnabled: isTrue(process.env.DOCUMENT_PROCESSING_QUEUE_ENABLED, false),

  /** Log-only hint when file exceeds this size (bytes). */
  largeFileWarnBytes: parsePositiveInt(process.env.DOCUMENT_LARGE_FILE_WARN_BYTES, 2 * 1024 * 1024),

  /** Re-export timing contract vars (single source for documentation and services). */
  aiRequestTimeoutMs: parsePositiveInt(process.env.AI_REQUEST_TIMEOUT, 420000),

  /**
   * Documented for RC-2 alignment; automation reads its own env — not modified here.
   */
  automationStaleProcessingMs: parsePositiveInt(process.env.AUTOMATION_STALE_PROCESSING_MS, 120000),
  automationPollTimeoutMs: parsePositiveInt(process.env.AUTOMATION_POLL_TIMEOUT_MS, 600000)
};

function getTimingContractSummary() {
  return {
    aiRequestTimeoutMs: config.aiRequestTimeoutMs,
    automationStaleProcessingMs: config.automationStaleProcessingMs,
    automationPollTimeoutMs: config.automationPollTimeoutMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    recommendedStaleLessThanAiTimeout: config.aiRequestTimeoutMs > config.automationStaleProcessingMs
  };
}

module.exports = {
  config,
  getTimingContractSummary,
  isTrue,
  parsePositiveInt
};
