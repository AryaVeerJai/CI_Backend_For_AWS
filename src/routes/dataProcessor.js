/**
 * API Route for testing Data Processor Agent
 */

const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const csv = require('csv-parse');
const dataProcessorAgent = require('../services/agents/dataProcessorAgent');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');
const uploadLimits = require('../config/uploadLimits');
const {
  isHighValueTransactionRequiringBill,
  buildHighValueUploadRequirement,
  HIGH_VALUE_WORKFLOWS
} = require('../config/highValueTransactionPolicy');

const attachHighValueBillUploadRequirements = (response, classified = []) => {
  const pendingBillUpload = classified
    .filter((tx) => isHighValueTransactionRequiringBill(tx))
    .map((tx, index) => ({
      rowIndex: index + 1,
      sourceId: tx.sourceId || `csv-row-${index + 1}`,
      amount: tx.amount,
      actionRequired: true,
      uploadRequest: buildHighValueUploadRequirement(
        tx,
        tx.sourceId || `csv-row-${index + 1}`,
        HIGH_VALUE_WORKFLOWS.ACCOUNTING
      )
    }));

  response.actionRequired = pendingBillUpload.length > 0;
  response.pendingBillUpload = pendingBillUpload;
  if (response.summary) {
    response.summary.pendingBillUpload = pendingBillUpload.length;
  }
  return response;
};

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: uploadLimits.dataProcessorMaxFileBytes },
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'text/csv',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ];
        if (allowedMimes.includes(file.mimetype) ||
            file.originalname.endsWith('.csv') ||
            file.originalname.endsWith('.xlsx') ||
            file.originalname.endsWith('.xls')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV and Excel files are allowed'), false);
        }
    }
});

// Parse CSV file
function parseCSV(buffer) {
    return new Promise((resolve, reject) => {
        const results = [];
        const parser = csv.parse({
            columns: true,
            skip_empty_lines: true,
            trim: true
        });

        parser.on('data', (row) => results.push(row));
        parser.on('end', () => resolve(results));
        parser.on('error', reject);

        parser.write(buffer);
        parser.end();
    });
}

// Parse Excel file
function parseExcel(buffer) {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json(worksheet);
}

// ==========================================
// PREPROCESSING FOR SMS-LIKE INPUTS
// ==========================================

/**
 * Extract amount from unstructured text
 */
function extractAmountFromText(text) {
    if (!text) return null;

    const patterns = [
        /rs\.?\s*([\d,]+(?:\.\d{2})?)/i,     // Rs.600 or Rs 600
        /₹\s*([\d,]+(?:\.\d{2})?)/,          // ₹600
        /inr\s*([\d,]+(?:\.\d{2})?)/i,       // INR 600
        /amount[:\s]*([\d,]+(?:\.\d{2})?)/i, // amount: 600
        /received\s+([\d,]+(?:\.\d{2})?)/i,  // received 600
        /paid\s+([\d,]+(?:\.\d{2})?)/i,      // paid 600
        /bill\s+(?:of\s+)?rs\.?\s*([\d,]+)/i // bill of Rs.600
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            return parseFloat(match[1].replace(/,/g, ''));
        }
    }
    return null;
}

/**
 * Clean SMS text for processing
 */
function cleanSmsText(text) {
    if (!text) return '';
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s₹.,/-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Normalize column names - supports both structured and SMS-like formats
 */
function normalizeColumns(data) {
    return data.map(row => {
        const normalized = {};
        const keys = Object.keys(row);

        // Check if this is SMS-like format (has 'text' column)
        const hasTextColumn = keys.some(k => k.toLowerCase().trim() === 'text');

        keys.forEach(key => {
            const lowerKey = key.toLowerCase().trim();

            // SMS-like format columns
            if (lowerKey === 'text') {
                const rawText = row[key];
                normalized.description = cleanSmsText(rawText);
                // Also try to extract amount from text if not provided
                if (!normalized.amount) {
                    normalized.amount = extractAmountFromText(rawText);
                }
            } else if (lowerKey === 'updateat' || lowerKey === 'update_at' || lowerKey === 'timestamp') {
                normalized.date = row[key];
            } else if (lowerKey === 'senderaddress' || lowerKey === 'sender_address' || lowerKey === 'sender') {
                normalized.vendor = row[key];
            }
            // Standard format columns
            else if (lowerKey.includes('description') || lowerKey.includes('particulars') || lowerKey.includes('narration')) {
                normalized.description = row[key];
            } else if (lowerKey.includes('amount') || lowerKey.includes('value') || lowerKey.includes('debit') || lowerKey.includes('credit')) {
                normalized.amount = row[key];
            } else if (lowerKey.includes('date') || lowerKey.includes('txn')) {
                normalized.date = row[key];
            } else if (lowerKey.includes('vendor') || lowerKey.includes('payee') || lowerKey.includes('merchant')) {
                normalized.vendor = row[key];
            } else if (lowerKey.includes('category')) {
                normalized.category = row[key];
            }
        });

        // Mark as SMS input for UI display
        if (hasTextColumn) {
            normalized._sourceType = 'sms';
        }

        return normalized;
    }).filter(row => row.description || row.amount); // Filter out empty rows
}

/**
 * @route POST /api/data-processor/test
 * @desc Test Data Processor Agent with uploaded file
 * @access Public (for testing)
 */
router.post('/test', upload.single('file'), async (req, res) => {
    try {
        let transactions = [];

        if (req.file) {
            // Parse uploaded file
            const buffer = req.file.buffer;
            const filename = req.file.originalname.toLowerCase();

            if (filename.endsWith('.csv')) {
                transactions = await parseCSV(buffer);
            } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
                transactions = parseExcel(buffer);
            }

            // Normalize column names
            transactions = normalizeColumns(transactions);

        } else if (req.body.transactions) {
            // Use JSON transactions from request body
            if (Array.isArray(req.body.transactions)) {
                transactions = req.body.transactions;
            } else {
                try {
                    transactions = JSON.parse(req.body.transactions);
                } catch {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid transactions JSON'
                    });
                }
            }
        } else {
            return res.status(400).json({
                success: false,
                error: 'No file or transactions provided'
            });
        }

        if (transactions.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid transactions found in the uploaded file'
            });
        }

        logger.info(`Processing ${transactions.length} transactions through Data Processor Agent`);

        // Process through Data Processor Agent
        const startTime = Date.now();
        const result = await dataProcessorAgent.processTransactions(transactions);
        const processingTime = Date.now() - startTime;

        // Handle case where all transactions were filtered
        const totalProcessed = result.statistics.totalProcessed || 1; // Avoid division by zero

        // Prepare response with detailed results
        const response = {
            success: true,
            processingTime: `${processingTime}ms`,
            statistics: result.statistics,
            summary: {
                totalInput: result.statistics.totalInput || transactions.length,
                filteredOut: result.statistics.filteredOut || 0,
                totalProcessed: result.statistics.totalProcessed,
                successfullyClassified: result.statistics.successfullyClassified,
                classificationRate: result.statistics.totalProcessed > 0
                    ? `${((result.statistics.successfullyClassified / totalProcessed) * 100).toFixed(1)}%`
                    : '0%',
                enrichmentRate: result.statistics.totalProcessed > 0
                    ? `${((result.statistics.enrichmentApplied / totalProcessed) * 100).toFixed(1)}%`
                    : '0%',
                validTransactions: result.validated.filter(t => t.isValid).length,
                invalidTransactions: result.validated.filter(t => !t.isValid).length,
                uncertainTransactions: result.statistics.uncertainTransactions || 0,
                documentRequests: result.documentRequests?.length || 0
            },
            categoryBreakdown: {},
            results: {
                cleaned: result.cleaned.slice(0, 50), // Limit response size
                classified: result.classified.slice(0, 50),
                enriched: result.enriched.filter(t => t.enrichmentApplied).slice(0, 20),
                validationErrors: result.validated.filter(t => !t.isValid),
                filtered: (result.filtered || []).slice(0, 20), // Show sample of filtered
                documentRequests: (result.documentRequests || []).slice(0, 20)
            }
        };

        // Calculate category breakdown
        result.classified.forEach(tx => {
            const cat = tx.category || 'unknown';
            if (!response.categoryBreakdown[cat]) {
                response.categoryBreakdown[cat] = { count: 0, totalAmount: 0 };
            }
            response.categoryBreakdown[cat].count++;
            response.categoryBreakdown[cat].totalAmount += tx.amount || 0;
        });

        attachHighValueBillUploadRequirements(response, result.classified);
        res.json(response);

    } catch (error) {
        logger.error('Data Processor test error:', error);
        res.status(500).json({
            success: false,
            ...clientErrorPayload(error)
        });
    }
});

/**
 * @route POST /api/data-processor/test-json
 * @desc Test Data Processor Agent with JSON transactions
 * @access Public (for testing)
 */
router.post('/test-json', async (req, res) => {
    try {
        const { transactions } = req.body;

        if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Please provide an array of transactions'
            });
        }

        const startTime = Date.now();
        const result = await dataProcessorAgent.processTransactions(transactions);
        const processingTime = Date.now() - startTime;

        // Handle case where all transactions were filtered
        const totalProcessed = result.statistics.totalProcessed || 1;

        // Prepare response with detailed results (same format as /test endpoint)
        const response = {
            success: true,
            processingTime: `${processingTime}ms`,
            statistics: result.statistics,
            summary: {
                totalInput: result.statistics.totalInput || transactions.length,
                filteredOut: result.statistics.filteredOut || 0,
                totalProcessed: result.statistics.totalProcessed,
                successfullyClassified: result.statistics.successfullyClassified,
                classificationRate: result.statistics.totalProcessed > 0
                    ? `${((result.statistics.successfullyClassified / totalProcessed) * 100).toFixed(1)}%`
                    : '0%',
                enrichmentRate: result.statistics.totalProcessed > 0
                    ? `${((result.statistics.enrichmentApplied / totalProcessed) * 100).toFixed(1)}%`
                    : '0%',
                validTransactions: result.validated.filter(t => t.isValid).length,
                invalidTransactions: result.validated.filter(t => !t.isValid).length
            },
            categoryBreakdown: {},
            results: {
                cleaned: result.cleaned,
                classified: result.classified,
                enriched: result.enriched.filter(t => t.enrichmentApplied),
                validationErrors: result.validated.filter(t => !t.isValid),
                filtered: (result.filtered || []).slice(0, 20)
            }
        };

        // Calculate category breakdown
        result.classified.forEach(tx => {
            const cat = tx.category || 'unknown';
            if (!response.categoryBreakdown[cat]) {
                response.categoryBreakdown[cat] = { count: 0, totalAmount: 0 };
            }
            response.categoryBreakdown[cat].count++;
            response.categoryBreakdown[cat].totalAmount += tx.amount || 0;
        });

        attachHighValueBillUploadRequirements(response, result.classified);
        res.json(response);

    } catch (error) {
        logger.error('Data Processor JSON test error:', error);
        res.status(500).json({
            success: false,
            ...clientErrorPayload(error)
        });
    }
});

module.exports = router;
