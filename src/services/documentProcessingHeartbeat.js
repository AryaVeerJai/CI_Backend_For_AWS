/**
 * BE-103: Periodic persistence during long-running document processing.
 * Uses DOCUMENT_PROCESSING_HEARTBEAT_* from documentProcessingLifecycle config.
 */

const { config: lifecycleConfig } = require('../config/documentProcessingLifecycle');
const documentLifecycle = require('./documentLifecycle');

/**
 * @typedef {import('mongoose').Document} MongooseDocument
 */

class DocumentProcessingHeartbeatSession {
  /**
   * @param {MongooseDocument} document
   */
  constructor(document) {
    this.document = document;
    this.enabled = lifecycleConfig.heartbeatEnabled && lifecycleConfig.heartbeatIntervalMs > 0;
    this.intervalMs = lifecycleConfig.heartbeatIntervalMs;
    this.currentStage = 'processing';
    this.timer = null;
    this.stopped = false;
    /** @type {Promise<void>} */
    this.persistChain = Promise.resolve();
  }

  /**
   * Serialize heartbeat persistence so interval ticks and setStage never overlap.
   * @param {() => Promise<void>} fn
   */
  enqueuePersist(fn) {
    this.persistChain = this.persistChain
      .then(fn)
      .catch((err) => {
        console.error('[documentProcessingHeartbeat] persist failed:', err.message);
      });
    return this.persistChain;
  }

  /**
   * @param {string} stage
   */
  setStage(stage) {
    this.currentStage = stage;
    return this.enqueuePersist(() => this.tick());
  }

  start() {
    if (!this.enabled || this.stopped) {
      return;
    }
    this.timer = setInterval(() => {
      this.enqueuePersist(() => this.tick());
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  async tick() {
    if (this.stopped || !this.document) {
      return;
    }
    if (documentLifecycle.normalizeStatus(this.document.status) !== 'processing') {
      return;
    }
    return documentLifecycle.emitProcessingHeartbeat(this.document, {
      stage: this.currentStage
    });
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Drain in-flight heartbeats before processDocument terminal save. */
  async flush() {
    await this.persistChain;
  }
}

/**
 * @param {MongooseDocument} document
 * @param {{ initialStage?: string }} [options]
 */
function startProcessingHeartbeat(document, options = {}) {
  const session = new DocumentProcessingHeartbeatSession(document);
  session.currentStage = options.initialStage || 'processing_started';
  session.start();
  return session.enqueuePersist(() => session.tick()).then(() => session);
}

module.exports = {
  DocumentProcessingHeartbeatSession,
  startProcessingHeartbeat
};
