const HIGH_VALUE_THRESHOLD_INR = Number(
  process.env.SMS_HIGH_VALUE_THRESHOLD_INR ||
  process.env.HIGH_VALUE_TRANSACTION_THRESHOLD_INR ||
  250000
);

const HIGH_VALUE_BILL_UPLOAD_ENDPOINT = '/api/documents/upload';

const carbonCategoryTaxonomy = require('../../../shared/carbonCategoryTaxonomy');

const HIGH_VALUE_ELIGIBLE_CATEGORIES = new Set(
  carbonCategoryTaxonomy.TRANSACTION_CATEGORIES.filter((cat) => cat !== 'other')
);

const HIGH_VALUE_WORKFLOWS = Object.freeze({
  SMS: 'high_value_sms',
  ACCOUNTING: 'high_value_accounting'
});

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isHighValueTransactionRequiringBill = (transaction = {}) => {
  const amount = toFiniteNumber(transaction.amount, 0);
  if (amount < HIGH_VALUE_THRESHOLD_INR) {
    return false;
  }
  const normalizedCategory = String(transaction.category || '').toLowerCase();
  if (HIGH_VALUE_ELIGIBLE_CATEGORIES.has(normalizedCategory)) {
    return true;
  }
  const normalizedType = String(transaction.transactionType || '').toLowerCase();
  return ['purchase', 'expense', 'utility', 'transport'].includes(normalizedType);
};

const buildHighValueUploadRequirement = (
  transaction = {},
  linkId = null,
  workflow = HIGH_VALUE_WORKFLOWS.SMS
) => {
  const sourceId = transaction.sourceId || linkId;
  const isSmsWorkflow = workflow === HIGH_VALUE_WORKFLOWS.SMS;

  return {
    workflow,
    policyGuideline: 'BRSR Principle 6 + GHG Protocol (Scopes 1, 2, 3)',
    thresholdInr: HIGH_VALUE_THRESHOLD_INR,
    userGuidance:
      'Upload the actual bill or invoice (PDF) for this transaction so line-item breakup can be used for accurate emission calculations.',
    transactionPreview: {
      sourceId,
      messageId: isSmsWorkflow ? linkId : null,
      importRowIndex: transaction.importRowIndex ?? null,
      amount: toFiniteNumber(transaction.amount, 0),
      currency: transaction.currency || 'INR',
      category: transaction.category || 'other',
      subcategory: transaction.subcategory || 'general',
      transactionType: transaction.transactionType || 'other',
      description: transaction.description || '',
      date: transaction.date || new Date(),
      vendor: transaction.vendor || null
    },
    requiredUpload: {
      endpoint: HIGH_VALUE_BILL_UPLOAD_ENDPOINT,
      method: 'POST',
      fileField: 'document',
      allowedMimeTypes: ['application/pdf'],
      requiredPayload: {
        documentType: 'bill',
        sourceWorkflow: workflow,
        ...(isSmsWorkflow ? { linkedMessageId: linkId } : {}),
        linkedSourceId: sourceId,
        linkedTransactionId: transaction._id || null
      }
    },
    agenticArchitecture: {
      stages: [
        'document_analyzer',
        'data_processor',
        'carbon_analyzer',
        'recommendation_engine',
        'report_generator'
      ],
      objective:
        'Extract line-item breakup from bills, map GHG scopes, and compute emissions from verified activity data.'
    }
  };
};

module.exports = {
  HIGH_VALUE_THRESHOLD_INR,
  HIGH_VALUE_BILL_UPLOAD_ENDPOINT,
  HIGH_VALUE_ELIGIBLE_CATEGORIES,
  HIGH_VALUE_WORKFLOWS,
  toFiniteNumber,
  isHighValueTransactionRequiringBill,
  buildHighValueUploadRequirement
};
