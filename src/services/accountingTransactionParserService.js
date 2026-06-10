const {
  SUPPORTED_IMPORT_PROVIDERS,
  PROVIDER_ALIASES,
  getConnectorById,
  resolveProviderId,
  getAliasesForProvider,
  listConnectors
} = require('./connectors/accountingConnectorRegistry');
const { normalizeAccountingRecord } = require('./connectors/accountingRecordNormalizer');

const SUPPORTED_PROVIDERS = SUPPORTED_IMPORT_PROVIDERS;

const validateNormalizedRecord = (record) => {
  const errors = [];
  if (!record.sourceId) errors.push('Missing sourceId');
  if (!record.description) errors.push('Missing description');
  if (!record.date) errors.push('Invalid or missing date');
  if (record.amount == null || !Number.isFinite(record.amount) || record.amount <= 0) {
    errors.push('Invalid or missing amount');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

const listAccountingProviders = () => listConnectors().map((connector) => ({
  id: connector.id,
  displayName: connector.name,
  vendor: connector.vendor,
  description: connector.description,
  aliases: getAliasesForProvider(connector.id)
}));

const parseTransactions = ({ provider, transactions }) => {
  const normalizedProvider = resolveProviderId(provider);

  if (!normalizedProvider) {
    throw new Error(`Provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}`);
  }

  if (!getConnectorById(normalizedProvider)) {
    throw new Error(`Unknown accounting connector: ${normalizedProvider}`);
  }

  if (!Array.isArray(transactions)) {
    throw new Error('transactions must be an array');
  }

  const normalized = transactions.map((row, index) => {
    let normalizedRow;
    try {
      normalizedRow = normalizeAccountingRecord(normalizedProvider, row || {}, index);
    } catch (normalizeError) {
      return {
        rowIndex: index,
        original: row,
        parsed: null,
        valid: false,
        errors: [normalizeError.message]
      };
    }

    const validation = validateNormalizedRecord(normalizedRow);

    return {
      rowIndex: index,
      original: row,
      parsed: normalizedRow,
      valid: validation.valid,
      errors: validation.errors
    };
  });

  return {
    provider: normalizedProvider,
    parsedCount: normalized.length,
    validRows: normalized.filter((row) => row.valid),
    invalidRows: normalized.filter((row) => !row.valid)
  };
};

module.exports = {
  SUPPORTED_PROVIDERS,
  PROVIDER_ALIASES,
  listAccountingProviders,
  parseTransactions
};
