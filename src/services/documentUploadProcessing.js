/**
 * Shared upload / bulk / reprocess entry (BE-110, BE-111).
 * Same lifecycle, execution guard, and bootstrap failure handling as single upload.
 */

const fs = require('fs').promises;
const Document = require('../models/Document');
const documentLifecycle = require('./documentLifecycle');
const documentProcessingService = require('./documentProcessingService');
const documentProcessingExecution = require('./documentProcessingExecution');

/**
 * @param {import('mongoose').Types.ObjectId | string} documentId
 */
async function loadDocument(documentId) {
  return Document.findById(documentId);
}

/**
 * Read file from disk and run processDocument with execution single-flight.
 * @param {import('mongoose').Document} document
 * @param {string} filePath
 * @param {{ source?: string }} [options]
 */
async function readFileAndProcess(document, filePath, options = {}) {
  const documentId = document._id;

  if (!filePath) {
    const fresh = await loadDocument(documentId);
    if (fresh) {
      return documentLifecycle.failProcessingEntry(fresh, new Error('Upload file path is missing'), {
        stage: options.source === 'reprocess' ? 'reprocess_read' : 'upload_read'
      });
    }
    return {
      success: false,
      errors: ['Upload file path is missing'],
      warnings: [],
      processingTime: 0
    };
  }

  let fileBuffer;
  try {
    fileBuffer = await fs.readFile(filePath);
  } catch (readError) {
    const fresh = await loadDocument(documentId);
    if (fresh) {
      return documentLifecycle.failProcessingEntry(fresh, readError, {
        stage: options.source === 'reprocess' ? 'reprocess_read' : 'upload_read'
      });
    }
    throw readError;
  }

  if (!documentLifecycle.isValidFileBuffer(fileBuffer)) {
    const fresh = await loadDocument(documentId);
    if (fresh) {
      return documentLifecycle.failProcessingEntry(
        fresh,
        new Error('Uploaded file is empty or could not be read'),
        { stage: options.source === 'reprocess' ? 'reprocess_empty_file' : 'upload_empty_file' }
      );
    }
    return {
      success: false,
      errors: ['Uploaded file is empty or could not be read'],
      warnings: [],
      processingTime: 0
    };
  }

  const fresh = await loadDocument(documentId);
  if (!fresh) {
    return {
      success: false,
      errors: ['Document not found for processing'],
      warnings: [],
      processingTime: 0
    };
  }

  return documentProcessingService.processDocument(fresh, fileBuffer, {
    processingSource: options.source || 'upload',
    forceFreshAnalyze: Boolean(options.forceFreshAnalyze)
  });
}

/**
 * Process when buffer is already in memory (bulk path).
 * @param {import('mongoose').Document} document
 * @param {Buffer} fileBuffer
 * @param {{ source?: string }} [options]
 */
async function processWithBuffer(document, fileBuffer, options = {}) {
  if (!documentLifecycle.isValidFileBuffer(fileBuffer)) {
    return documentLifecycle.failProcessingEntry(
      document,
      new Error('Uploaded file is empty or could not be read'),
      { stage: 'bulk_empty_file' }
    );
  }

  const fresh = await loadDocument(document._id);
  if (!fresh) {
    return {
      success: false,
      errors: ['Document not found for processing'],
      warnings: [],
      processingTime: 0
    };
  }

  return documentProcessingService.processDocument(fresh, fileBuffer, {
    processingSource: options.source || 'bulk',
    forceFreshAnalyze: Boolean(options.forceFreshAnalyze)
  });
}

/**
 * BE-111: Validate reprocess preconditions before reading file.
 * @returns {{ ok: true, document } | { ok: false, statusCode: number, message: string }}
 */
function validateReprocessRequest(document) {
  if (!document) {
    return { ok: false, statusCode: 404, message: 'Document not found' };
  }

  const status = documentLifecycle.normalizeStatus(document.status);
  if (status === 'processing' && documentProcessingExecution.isExecutionActive(document._id)) {
    return {
      ok: false,
      statusCode: 409,
      message: 'Document is already being processed'
    };
  }

  if (!documentLifecycle.isReprocessAllowedStatus(status) && status !== 'processing') {
    return {
      ok: false,
      statusCode: 400,
      message: `Document status "${status}" cannot be reprocessed`
    };
  }

  return { ok: true, document };
}

module.exports = {
  loadDocument,
  readFileAndProcess,
  processWithBuffer,
  validateReprocessRequest
};
