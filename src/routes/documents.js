const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const mongoose = require('mongoose');
const router = express.Router();

const Document = require('../models/Document');
const documentProcessingService = require('../services/documentProcessingService');
const documentLifecycle = require('../services/documentLifecycle');
const documentUploadProcessing = require('../services/documentUploadProcessing');
const ocrBenchmarkService = require('../services/ocrBenchmarkService');
const ocrAutomationService = require('../services/ocrAutomationService');
const auth = require('../middleware/auth');
const { requireMsmeDocumentCapacity } = require('../middleware/enforceMsmePlanLimits');

const SUPPORTED_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);




const SUPPORTED_UPLOAD_EXTENSIONS = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.tif',
  '.tiff',
  '.bmp',
  '.txt',
  '.csv',
  '.xlsx',
  '.xls',
]);

const SUPPORTED_UPLOAD_TYPE_LABEL = 'PDF, JPG, JPEG, PNG, WEBP, TIFF, BMP, TXT, CSV,XLSX,XLS';
const { HIGH_VALUE_WORKFLOWS } = require('../config/highValueTransactionPolicy');

const HIGH_VALUE_SMS_WORKFLOW = HIGH_VALUE_WORKFLOWS.SMS;
const HIGH_VALUE_ACCOUNTING_WORKFLOW = HIGH_VALUE_WORKFLOWS.ACCOUNTING;
const HIGH_VALUE_BILL_WORKFLOWS = new Set([
  HIGH_VALUE_SMS_WORKFLOW,
  HIGH_VALUE_ACCOUNTING_WORKFLOW
]);
const HIGH_VALUE_BILL_REQUIRED_MIME_TYPE = 'application/pdf';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const extension = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${extension}`);
  }
});

const fileFilter = (req, file, cb) => {
  const mimeType = String(file.mimetype || '').toLowerCase();
  const extension = path.extname(file.originalname || '').toLowerCase();
  const isSupportedMimeType = SUPPORTED_UPLOAD_MIME_TYPES.has(mimeType);
  const isSupportedExtension = SUPPORTED_UPLOAD_EXTENSIONS.has(extension);

  if (isSupportedMimeType || isSupportedExtension) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type. Allowed types: ${SUPPORTED_UPLOAD_TYPE_LABEL}`), false);
  }
};

const uploadLimits = require('../config/uploadLimits');
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: uploadLimits.maxFileBytes,
    files: uploadLimits.bulkMaxFiles,
  }
});

const { buildOrgDataFilter, getOrgScope, withOrgPayload } = require('../utils/orgDataScope');

const requireOperationalContext = [
  auth,
  auth.requireRole('msme', 'enterprise'),
  auth.requireOrganizationProfile
];

const requireOrgContext = (req, res, next) => {
  if (!req.user?.organizationId) {
    return res.status(404).json({
      success: false,
      message: 'Organization profile not found'
    });
  }
  return next();
};

const ALLOWED_DOCUMENT_TYPES = new Set(['bill', 'receipt', 'invoice', 'statement', 'other']);
const ALLOWED_TRANSACTION_MAPPINGS = new Set(['company', 'product']);

const normalizeSourceWorkflow = (value = '') => String(value || '').trim().toLowerCase();
const normalizeTransactionMapping = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return ALLOWED_TRANSACTION_MAPPINGS.has(normalized) ? normalized : 'company';
};
const normalizeSelectedProducts = (value) => {
  if (!value) return [];

  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      parsed = value.split(/[,;|]/g);
    }
  }

  if (!Array.isArray(parsed)) {
    parsed = [parsed];
  }

  const seen = new Set();
  return parsed
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const removeUploadedFiles = async (files = []) => {
  const normalizedFiles = Array.isArray(files) ? files : [files];
  await Promise.all(
    normalizedFiles
      .filter(file => file?.path)
      .map(async (file) => {
        try {
          await fs.unlink(file.path);
        } catch (error) {
          // Ignore cleanup failures for already removed files.
        }
      })
  );
};

const validateWorkflowUploadCompliance = ({
  sourceWorkflow,
  mimeType,
  documentType
}) => {
  if (!HIGH_VALUE_BILL_WORKFLOWS.has(sourceWorkflow)) {
    return null;
  }

  if (mimeType !== HIGH_VALUE_BILL_REQUIRED_MIME_TYPE) {
    return 'High-value transaction workflows accept bill uploads in PDF format only.';
  }

  if (documentType !== 'bill') {
    return 'High-value transaction workflows require documentType to be "bill".';
  }

  return null;
};

const normalizeDocumentTypes = (rawTypes, totalFiles, fallbackType = 'bill') => {
  const fallback = ALLOWED_DOCUMENT_TYPES.has(fallbackType) ? fallbackType : 'bill';

  if (!rawTypes) {
    return Array.from({ length: totalFiles }, () => fallback);
  }

  let parsedTypes = rawTypes;
  if (typeof rawTypes === 'string') {
    try {
      parsedTypes = JSON.parse(rawTypes);
    } catch (error) {
      parsedTypes = [rawTypes];
    }
  }

  if (!Array.isArray(parsedTypes)) {
    parsedTypes = [parsedTypes];
  }

  const sanitizedTypes = parsedTypes.map(type => {
    const normalized = String(type || '').toLowerCase();
    return ALLOWED_DOCUMENT_TYPES.has(normalized) ? normalized : fallback;
  });

  return Array.from({ length: totalFiles }, (_, index) => sanitizedTypes[index] || sanitizedTypes[0] || fallback);
};

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const buildPublicError = (message, error) => ({
  success: false,
  message,
  ...(process.env.NODE_ENV === 'development' ? { error: error.message } : {})
});

// @route   POST /api/documents/upload
// @desc    Upload and process a document
// @access  Private
router.post('/upload', ...requireOperationalContext, requireMsmeDocumentCapacity(1), upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { documentType, notes, linkedMessageId, linkedSourceId, linkedTransactionId } = req.body;
    const sourceWorkflow = normalizeSourceWorkflow(req.body.sourceWorkflow);
    const transactionMapping = normalizeTransactionMapping(req.body.transactionMapping);
    const selectedProducts = normalizeSelectedProducts(req.body.selectedProducts);

    const scope = getOrgScope(req);
    const msmeId = scope.msmeId;
    const orgFilter = buildOrgDataFilter(req);
    const resolvedDocumentType = ALLOWED_DOCUMENT_TYPES.has(String(documentType || '').toLowerCase())
      ? String(documentType).toLowerCase()
      : 'bill';
    const workflowValidationError = validateWorkflowUploadCompliance({
      sourceWorkflow,
      mimeType: String(req.file.mimetype || '').toLowerCase(),
      documentType: resolvedDocumentType
    });
    if (workflowValidationError) {
      await removeUploadedFiles(req.file);
      return res.status(400).json({
        success: false,
        message: workflowValidationError
      });
    }

    // Create document record
    const document = new Document(withOrgPayload(req, {
  fileName: req.file.filename,
  originalName: req.file.originalname,
  filePath: req.file.path,
  fileSize: req.file.size,
  mimeType: req.file.mimetype,
  documentType: resolvedDocumentType,

  duplicateDetection: {
    isDuplicate: false,
    duplicateType: null,
    similarityScore: 0,
    matchedDocumentId: null,
    duplicateReasons: []
  },

  metadata: {
    uploadSource: 'web',
    userAgent: req.get('User-Agent'),
    ipAddress: req.ip,
    processingVersion: '1.0.0',
    sourceWorkflow: sourceWorkflow || null,
    linkedMessageId: linkedMessageId || null,
    linkedSourceId: linkedSourceId || null,
    linkedTransactionId: linkedTransactionId || null,
    transactionMapping,
    selectedProducts
  },

  notes: notes || ''
}));

    await document.save();

    // Process document asynchronously (RC-1 / BE-102 / BE-110 shared path)
    const documentId = document._id;
    const filePath = req.file.path;
    setImmediate(async () => {
      try {
        console.log('🔥 START PROCESSING...');
        const result = await documentUploadProcessing.readFileAndProcess(
          document,
          filePath,
          { source: 'upload' }
        );
        console.log('✅ PROCESS RESULT:', result);
      } catch (error) {
        console.error('❌ FULL ERROR:', error);
      }
    });

    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      document: {
        id: document._id,
        fileName: document.fileName,
        originalName: document.originalName,
        documentType: document.documentType,
        status: document.status,
        sourceWorkflow: document.metadata?.sourceWorkflow || null,
        transactionMapping: document.metadata?.transactionMapping || 'company',
        selectedProducts: document.metadata?.selectedProducts || [],
        linkedMessageId: document.metadata?.linkedMessageId || null,
        linkedSourceId: document.metadata?.linkedSourceId || null,
        createdAt: document.createdAt
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json(buildPublicError('Error uploading document', error));
  }
});

// @route   POST /api/documents/upload/bulk
// @desc    Upload and process multiple documents using AI batch parsing
// @access  Private
router.post('/upload/bulk', ...requireOperationalContext, requireMsmeDocumentCapacity((req) => {
  const files = Array.isArray(req.files) ? req.files.length : 0;
  return Math.max(files, 1);
}), upload.array('documents', uploadLimits.bulkMaxFiles), async (req, res) => {
  try {
    const scope = getOrgScope(req);
    const msmeId = scope.msmeId;
    const orgFilter = buildOrgDataFilter(req);
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const sourceWorkflow = normalizeSourceWorkflow(req.body.sourceWorkflow);
    const transactionMapping = normalizeTransactionMapping(req.body.transactionMapping);
    const selectedProducts = normalizeSelectedProducts(req.body.selectedProducts);
    const fallbackDocumentType = req.body.documentType || 'bill';
    const documentTypes = normalizeDocumentTypes(
      req.body.documentTypes,
      req.files.length,
      fallbackDocumentType
    );
    if (HIGH_VALUE_BILL_WORKFLOWS.has(sourceWorkflow)) {
      const nonCompliantFile = req.files.find((file, index) => {
        const mimeType = String(file.mimetype || '').toLowerCase();
        const documentType = documentTypes[index] || 'bill';
        return Boolean(
          validateWorkflowUploadCompliance({
            sourceWorkflow,
            mimeType,
            documentType
          })
        );
      });
      if (nonCompliantFile) {
        await removeUploadedFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'High-value transaction bulk workflow requires all files to be PDF bills.'
        });
      }
    }
    const notes = req.body.notes || '';

    const documents = [];
    const fileBuffers = [];

    for (let index = 0; index < req.files.length; index += 1) {
      const file = req.files[index];
      const document = new Document(withOrgPayload(req, {
        fileName: file.filename,
        originalName: file.originalname,
        filePath: file.path,
        fileSize: file.size,
        mimeType: file.mimetype,
        documentType: documentTypes[index] || 'bill',
        metadata: {
          uploadSource: 'web',
          userAgent: req.get('User-Agent'),
          ipAddress: req.ip,
          processingVersion: '2.0.0-batch-ai',
          sourceWorkflow: sourceWorkflow || null,
          linkedMessageId: req.body.linkedMessageId || null,
          linkedSourceId: req.body.linkedSourceId || null,
          linkedTransactionId: req.body.linkedTransactionId || null,
          transactionMapping,
          selectedProducts
        },
        notes
      }));

      await document.save();
      documents.push(document);

      try {
        fileBuffers.push(await fs.readFile(file.path));
      } catch (readError) {
        fileBuffers.push(null);
        await documentLifecycle.failProcessingEntry(document, readError, { stage: 'bulk_read' });
      }
    }

    const batchResult = await documentProcessingService.processMultipleDocuments(
      documents,
      fileBuffers,
      {
        msmeId: scope.msmeId,
        organizationId: scope.organizationId,
        aggregationPeriod: req.body.aggregationPeriod,
        startDate: req.body.startDate,
        endDate: req.body.endDate
      }
    );

    res.status(201).json({
      success: true,
      message: 'Documents uploaded and processed successfully',
      data: {
        documents: documents.map(document => ({
          id: document._id,
          fileName: document.fileName,
          originalName: document.originalName,
          documentType: document.documentType,
          status: document.status,
          sourceWorkflow: document.metadata?.sourceWorkflow || null,
          transactionMapping: document.metadata?.transactionMapping || 'company',
          selectedProducts: document.metadata?.selectedProducts || [],
          linkedMessageId: document.metadata?.linkedMessageId || null,
          createdAt: document.createdAt
        })),
        batchResult
      }
    });
  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json(buildPublicError('Error uploading documents in bulk', error));
  }
});

// @route   GET /api/documents
// @desc    Get all documents for an MSME
// @access  Private
router.get('/', ...requireOperationalContext, async (req, res) => {
  try {
    const { page = 1, limit = 10, status, documentType, startDate, endDate } = req.query;
    const scope = getOrgScope(req);
    const msmeId = scope.msmeId;
    const orgFilter = buildOrgDataFilter(req);

    const query = { ...orgFilter };
    
    if (status) query.status = status;
    if (documentType) query.documentType = documentType;
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const documents = await Document.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-filePath'); // Exclude file path for security

    const total = await Document.countDocuments(query);

    res.json({
      success: true,
      documents,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });

  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json(buildPublicError('Error fetching documents', error));
  }
});

// @route   GET /api/documents/ocr/benchmark/reports
router.get('/ocr/benchmark/reports', ...requireOperationalContext, async (req, res) => {
  try {
    const reports = await ocrBenchmarkService.listReports(Number(req.query.limit) || 20);
    res.json({ success: true, reports });
  } catch (error) {
    console.error('OCR benchmark list error:', error);
    res.status(500).json(buildPublicError('Error listing OCR benchmark reports', error));
  }
});

// @route   GET /api/documents/ocr/benchmark/latest
router.get('/ocr/benchmark/latest', ...requireOperationalContext, async (req, res) => {
  try {
    const report = await ocrBenchmarkService.getLatestReport();
    res.json({ success: true, report: report.summary, results: report.full?.results || [] });
  } catch (error) {
    console.error('OCR benchmark latest error:', error);
    res.status(500).json(buildPublicError('Error fetching latest OCR benchmark', error));
  }
});

// @route   POST /api/documents/ocr/benchmark/run
router.post('/ocr/benchmark/run', ...requireOperationalContext, async (req, res) => {
  try {
    const body = req.body || {};
    const report = await ocrBenchmarkService.runBenchmark({
      organizationId: req.user?.organizationId,
      runBy: req.user?.id,
      automation: body.automation !== false,
      workers: body.workers,
      writeBaseline: body.writeBaseline,
      rerunFailed: body.rerunFailed,
      folderScan: body.folderScan,
      caseIds: body.caseIds,
      extractionOnly: body.extractionOnly,
      manifestPath: body.manifestPath
    });
    res.json({ success: true, report });
  } catch (error) {
    console.error('OCR benchmark run error:', error);
    res.status(500).json(buildPublicError('Error running OCR benchmark', error));
  }
});

// --- OCR automation testing APIs ---
router.get('/ocr/automation/reports', ...requireOperationalContext, async (req, res) => {
  try {
    const reports = await ocrAutomationService.listReports(Number(req.query.limit) || 20);
    res.json({ success: true, reports });
  } catch (error) {
    console.error('OCR automation list error:', error);
    res.status(500).json(buildPublicError('Error listing automation reports', error));
  }
});

router.get('/ocr/automation/latest', ...requireOperationalContext, async (req, res) => {
  try {
    const report = await ocrAutomationService.getLatestAutomationReport();
    res.json({
      success: true,
      report: report.summary,
      full: report.full,
      results: report.full?.results || []
    });
  } catch (error) {
    console.error('OCR automation latest error:', error);
    res.status(500).json(buildPublicError('Error fetching latest automation report', error));
  }
});

router.get('/ocr/automation/metrics', ...requireOperationalContext, async (req, res) => {
  try {
    const metrics = await ocrAutomationService.getMetrics(req.query.reportId || null);
    res.json({ success: true, metrics });
  } catch (error) {
    console.error('OCR automation metrics error:', error);
    res.status(500).json(buildPublicError('Error fetching OCR metrics', error));
  }
});

router.get('/ocr/automation/failed', ...requireOperationalContext, async (req, res) => {
  try {
    const data = await ocrAutomationService.getFailedInvoices(req.query.reportId || null);
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('OCR automation failed invoices error:', error);
    res.status(500).json(buildPublicError('Error fetching failed invoices', error));
  }
});

router.get('/ocr/automation/regression', ...requireOperationalContext, async (req, res) => {
  try {
    const regression = await ocrAutomationService.getRegression(req.query.reportId || null);
    res.json({ success: true, regression });
  } catch (error) {
    console.error('OCR automation regression error:', error);
    res.status(500).json(buildPublicError('Error fetching regression report', error));
  }
});

router.get('/ocr/automation/failure-analysis', ...requireOperationalContext, async (req, res) => {
  try {
    const analysis = await ocrAutomationService.getFailureAnalysis(req.query.reportId || null);
    res.json({ success: true, analysis });
  } catch (error) {
    console.error('OCR failure analysis error:', error);
    res.status(500).json(buildPublicError('Error fetching failure analysis', error));
  }
});

router.post('/ocr/automation/run', ...requireOperationalContext, async (req, res) => {
  try {
    const body = req.body || {};
    const report = await ocrAutomationService.runAutomation({
      organizationId: req.user?.organizationId,
      runBy: req.user?.id,
      workers: body.workers,
      writeBaseline: body.writeBaseline,
      folderScan: body.folderScan,
      caseIds: body.caseIds,
      extractionOnly: body.extractionOnly,
      manifestPath: body.manifestPath
    });
    res.json({ success: true, report });
  } catch (error) {
    console.error('OCR automation run error:', error);
    res.status(500).json(buildPublicError('Error running OCR automation', error));
  }
});

router.post('/ocr/automation/rerun-failed', ...requireOperationalContext, async (req, res) => {
  try {
    const report = await ocrAutomationService.rerunFailed({
      organizationId: req.user?.organizationId,
      runBy: req.user?.id
    });
    res.json({ success: true, report });
  } catch (error) {
    console.error('OCR automation rerun error:', error);
    res.status(500).json(buildPublicError('Error rerunning failed OCR tests', error));
  }
});

router.get('/ocr/automation/:reportId', ...requireOperationalContext, async (req, res) => {
  try {
    const report = await ocrAutomationService.getReportById(req.params.reportId);
    res.json({ success: true, report });
  } catch (error) {
    console.error('OCR automation get error:', error);
    res.status(404).json(buildPublicError('Automation report not found', error));
  }
});

// @route   GET /api/documents/ocr/benchmark/:reportId
router.get('/ocr/benchmark/:reportId', ...requireOperationalContext, async (req, res) => {
  try {
    const report = await ocrBenchmarkService.getReportById(req.params.reportId);
    res.json({ success: true, report });
  } catch (error) {
    console.error('OCR benchmark get error:', error);
    res.status(404).json(buildPublicError('Benchmark report not found', error));
  }
});

// @route   GET /api/documents/statistics/overview
// @desc    Get document statistics
// @access  Private
router.get('/statistics/overview', ...requireOperationalContext, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const scope = getOrgScope(req);
    const msmeId = scope.msmeId;
    const orgFilter = buildOrgDataFilter(req);

    const statistics = await documentProcessingService.getDocumentStatistics(
      orgFilter,
      startDate ? new Date(startDate) : null,
      endDate ? new Date(endDate) : null
    );

    res.json({
      success: true,
      statistics
    });

  } catch (error) {
    console.error('Statistics error:', error);
    res.status(500).json(buildPublicError('Error fetching statistics', error));
  }
});

// @route   GET /api/documents/duplicates
// @desc    Get duplicate documents
// @access  Private
router.get('/duplicates', ...requireOperationalContext, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const scope = getOrgScope(req);
    const msmeId = scope.msmeId;
    const orgFilter = buildOrgDataFilter(req);

    const documents = await Document.find({
      ...orgFilter,
      'duplicateDetection.isDuplicate': true
    })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('duplicateDetection.matchedDocumentId', 'originalName createdAt extractedData.amount')
      .select('-filePath');

    const total = await Document.countDocuments({
      msmeId,
      'duplicateDetection.isDuplicate': true
    });

    res.json({
      success: true,
      documents,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });

  } catch (error) {
    console.error('Get duplicates error:', error);
    res.status(500).json(buildPublicError('Error fetching duplicates', error));
  }
});

// @route   GET /api/documents/analytics
// @desc    Get document analytics overview for MSME
// @access  Private
router.get('/analytics', ...requireOperationalContext, async (req, res) => {
  try {
    const scope = getOrgScope(req);
    const msmeId = scope.msmeId;
    const orgFilter = buildOrgDataFilter(req);
    const documents = await Document.find(orgFilter).select('status documentType fileSize carbonFootprint createdAt');

    const analytics = {
      totalDocuments: documents.length,
      byStatus: {},
      byType: {},
      totalFileSizeBytes: 0,
      totalCarbonFootprint: 0
    };

    documents.forEach((doc) => {
      const status = doc.status && doc.status !== 'unknown' ? doc.status : 'not_assessed';
      const type = doc.documentType || 'other';
      analytics.byStatus[status] = (analytics.byStatus[status] || 0) + 1;
      analytics.byType[type] = (analytics.byType[type] || 0) + 1;
      analytics.totalFileSizeBytes += Number(doc.fileSize) || 0;
      analytics.totalCarbonFootprint += Number(doc.carbonFootprint?.co2Emissions) || 0;
    });

    return res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Document analytics error:', error);
    return res.status(500).json(buildPublicError('Error fetching document analytics', error));
  }
});

// @route   GET /api/documents/:id/ocr-validation
router.get('/:id/ocr-validation', ...requireOperationalContext, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid document id' });
    }
    const document = await Document.findOne({
      _id: req.params.id,
      ...buildOrgDataFilter(req)
    }).select('extractedData processingResults ocrValidation metadata');
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }
    const payload = ocrBenchmarkService.buildUploadOcrPayload(document);
    res.json({ success: true, ...payload });
  } catch (error) {
    console.error('OCR validation error:', error);
    res.status(500).json(buildPublicError('Error fetching OCR validation', error));
  }
});

// @route   GET /api/documents/:id
// @desc    Get a specific document
// @access  Private
router.get('/:id', ...requireOperationalContext, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document id'
      });
    }

    const document = await Document.findOne({
      _id: req.params.id,
      ...buildOrgDataFilter(req)
    }).select('-filePath');

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    res.json({
      success: true,
      document
    });

  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json(buildPublicError('Error fetching document', error));
  }
});

// @route   GET /api/documents/:id/download
// @desc    Download a document
// @access  Private
router.get('/:id/download', ...requireOperationalContext, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document id'
      });
    }

    const document = await Document.findOne({
      _id: req.params.id,
      ...buildOrgDataFilter(req)
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Check if file exists
    try {
      await fs.access(document.filePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'File not found on server'
      });
    }

    res.download(document.filePath, document.originalName);

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json(buildPublicError('Error downloading document', error));
  }
});

// @route   PUT /api/documents/:id
// @desc    Update document metadata
// @access  Private
router.put('/:id', ...requireOperationalContext, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document id'
      });
    }

    const { notes, tags, documentType } = req.body;
    
    const document = await Document.findOne({
      _id: req.params.id,
      ...buildOrgDataFilter(req)
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    if (notes !== undefined) document.notes = notes;
    if (tags !== undefined) document.tags = tags;
    if (documentType !== undefined) document.documentType = documentType;

    await document.save();

    res.json({
      success: true,
      message: 'Document updated successfully',
      document
    });

  } catch (error) {
    console.error('Update document error:', error);
    res.status(500).json(buildPublicError('Error updating document', error));
  }
});

// @route   DELETE /api/documents/:id
// @desc    Delete a document
// @access  Private
router.delete('/:id', ...requireOperationalContext, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document id'
      });
    }

    const document = await Document.findOne({
      _id: req.params.id,
      ...buildOrgDataFilter(req)
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Delete file from filesystem
    try {
      await fs.unlink(document.filePath);
    } catch (error) {
      console.error('Error deleting file:', error);
    }

    // Delete document from database
    await Document.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });

  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json(buildPublicError('Error deleting document', error));
  }
});

// @route   POST /api/documents/:id/reprocess
// @desc    Reprocess a document
// @access  Private
router.post('/:id/reprocess', ...requireOperationalContext, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document id'
      });
    }

    const document = await Document.findOne({
      _id: req.params.id,
      ...buildOrgDataFilter(req)
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    const validation = documentUploadProcessing.validateReprocessRequest(document);
    if (!validation.ok) {
      return res.status(validation.statusCode).json({
        success: false,
        message: validation.message
      });
    }

    let result;
    try {
      const forceFreshAnalyze = Boolean(
        req.body?.forceFreshAnalyze
        || req.body?.freshAnalyze
        || req.query?.forceFreshAnalyze
        || req.query?.freshAnalyze
      );
      result = await documentUploadProcessing.readFileAndProcess(validation.document, document.filePath, {
        source: 'reprocess',
        forceFreshAnalyze
      });
    } catch (error) {
      const fresh = await Document.findById(document._id);
      if (fresh) {
        result = await documentLifecycle.failProcessingEntry(fresh, error, {
          stage: 'reprocess_route'
        });
      } else {
        throw error;
      }
    }

    const freshAfter = await Document.findById(document._id);
    const reachedTerminal = documentLifecycle.isTerminalStatus(freshAfter?.status);

    res.json({
      success: Boolean(result?.success) && reachedTerminal,
      message: reachedTerminal
        ? 'Document reprocessed successfully'
        : 'Document reprocess completed without terminal status',
      document: freshAfter
        ? {
            id: freshAfter._id,
            status: freshAfter.status
          }
        : null,
      result
    });

  } catch (error) {
    console.error('Reprocess error:', error);
    res.status(500).json(buildPublicError('Error reprocessing document', error));
  }
});

module.exports = router;