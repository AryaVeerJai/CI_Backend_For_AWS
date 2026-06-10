/**
 * Indian MSME accounting software connectors.
 * `import` = batch payload via POST /api/transactions/import-accounting
 * `api` = live sync when env credentials are configured
 */
const INDIAN_ACCOUNTING_CONNECTORS = [
  {
    id: 'tally',
    name: 'TallyPrime',
    vendor: 'Tally Solutions',
    integrationTypes: ['import', 'api'],
    description: 'Import voucher exports or sync Day Book via TallyPrime HTTP API (JSON/XML).'
  },
  {
    id: 'zoho',
    name: 'Zoho Books',
    vendor: 'Zoho Corporation',
    integrationTypes: ['import', 'api'],
    description: 'Self-serve connect with your Zoho Books API credentials, or import exports.'
  },
  {
    id: 'busy',
    name: 'Busy Accounting',
    vendor: 'Busy Infotech',
    integrationTypes: ['import'],
    description: 'Import voucher and ledger exports from Busy Accounting.'
  },
  {
    id: 'marg',
    name: 'Marg ERP',
    vendor: 'Marg Compusoft',
    integrationTypes: ['import'],
    description: 'Import billing and purchase exports from Marg ERP.'
  },
  {
    id: 'vyapar',
    name: 'Vyapar',
    vendor: 'Simply Vyapar Apps',
    integrationTypes: ['import'],
    description: 'Import transaction exports from Vyapar billing app.'
  },
  {
    id: 'mybillbook',
    name: 'myBillBook',
    vendor: 'Flobiz (FloBiz)',
    integrationTypes: ['import'],
    description: 'Import invoice and expense exports from myBillBook.'
  },
  {
    id: 'khatabook',
    name: 'Khatabook',
    vendor: 'Khatabook',
    integrationTypes: ['import'],
    description: 'Import ledger entry exports from Khatabook.'
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    vendor: 'Intuit',
    integrationTypes: ['import', 'api'],
    description: 'Import QuickBooks exports or sync via QuickBooks Online API (India companies).'
  },
  {
    id: 'erpnext',
    name: 'ERPNext',
    vendor: 'Frappe Technologies',
    integrationTypes: ['import'],
    description: 'Import GL entries, payment entries, and purchase invoices from ERPNext.'
  },
  {
    id: 'odoo',
    name: 'Odoo',
    vendor: 'Odoo S.A.',
    integrationTypes: ['import'],
    description: 'Import journal entry exports from Odoo Accounting.'
  },
  {
    id: 'clear',
    name: 'Clear',
    vendor: 'ClearTax',
    integrationTypes: ['import'],
    description: 'Import transaction exports from Clear (ClearTax) accounting.'
  },
  {
    id: 'profitbooks',
    name: 'ProfitBooks',
    vendor: 'ProfitBooks',
    integrationTypes: ['import'],
    description: 'Import voucher exports from ProfitBooks.'
  },
  {
    id: 'hostbooks',
    name: 'HostBooks',
    vendor: 'HostBooks',
    integrationTypes: ['import'],
    description: 'Import transaction exports from HostBooks.'
  }
];

const PROVIDER_ALIASES = {
  tally_erp9: 'tally',
  tally_prime: 'tally',
  tallyerp: 'tally',
  zoho_books: 'zoho',
  zohobooks: 'zoho',
  busy_accounting: 'busy',
  busyerp: 'busy',
  marg_erp: 'marg',
  margerp: 'marg',
  quickbooks_online: 'quickbooks',
  quickbooks_india: 'quickbooks',
  qb: 'quickbooks',
  frappe: 'erpnext',
  erp_next: 'erpnext',
  odoo_accounting: 'odoo',
  cleartax: 'clear',
  host_books: 'hostbooks'
};

const PROVIDER_FIELD_MAPS = {
  tally: {
    amount: ['amount', 'debit', 'credit', 'value', 'debit amount', 'credit amount', 'Debit Amount', 'Credit Amount'],
    date: ['date', 'voucher_date', 'voucherDate', 'Date', 'Voucher Date'],
    description: ['description', 'narration', 'particulars', 'voucher_type', 'Narration', 'Ledger Name', 'ledger_name'],
    vendor: ['party_name', 'vendor', 'ledger_name', 'counterparty', 'Party A/c Name', 'Party Ledger Name', 'partyledgername'],
    ledger: ['ledger_name', 'Ledger Name', 'ledgername'],
    voucherType: ['voucher_type', 'voucherType', 'Voucher Type', 'vouchertypename'],
    transactionType: ['transactionType'],
    category: ['category'],
    subcategory: ['subcategory'],
    currency: ['currency'],
    sourceIdKeys: ['id', 'transaction_id', 'transactionId', 'voucher_number', 'voucherNumber', 'reference', 'refNo', 'Voucher Number'],
    creditIndicator: { field: 'credit', debitField: 'debit' }
  },
  zoho: {
    amount: ['amount', 'total', 'debit', 'credit', 'Amount INR', 'Amount (INR)', 'amount_inr'],
    date: ['date', 'transaction_date', 'created_time', 'created_at', 'Date'],
    description: ['description', 'reference_number', 'notes', 'item_name', 'Description'],
    vendor: ['vendor_name', 'customer_name', 'contact_name', 'payee', 'Contact Name', 'contact_name'],
    voucherType: ['transaction_type', 'Transaction Type', 'transaction type'],
    transactionType: ['transactionType', 'type'],
    category: ['category', 'Category'],
    subcategory: ['subcategory'],
    currency: ['currency_code', 'currency'],
    sourceIdKeys: ['id', 'transaction_id', 'transactionId', 'voucher_number', 'reference', 'refNo', 'Reference No', 'reference_no'],
    incomeTypes: ['income', 'invoice', 'sales'],
    creditField: 'credit'
  },
  busy: {
    amount: ['amount', 'debit', 'credit', 'Debit', 'Credit', 'value', 'Amt'],
    date: ['date', 'voucher_date', 'VchDate', 'bill_date'],
    description: ['narration', 'particulars', 'description', 'Narration'],
    vendor: ['party_name', 'AccountName', 'ledger_name', 'PartyName'],
    voucherType: ['voucher_type', 'VchType'],
    transactionType: ['transactionType'],
    category: ['category'],
    subcategory: ['subcategory'],
    currency: ['currency'],
    sourceIdKeys: ['VchNo', 'voucher_number', 'id', 'transaction_id', 'reference'],
    creditIndicator: { field: 'credit', debitField: 'debit' }
  },
  marg: {
    amount: ['amount', 'bill_amount', 'net_amount', 'total', 'grand_total'],
    date: ['bill_date', 'date', 'invoice_date'],
    description: ['product_name', 'item_name', 'description', 'narration', 'bill_type'],
    vendor: ['party_name', 'customer_name', 'supplier_name'],
    voucherType: ['bill_type', 'voucher_type'],
    transactionType: ['transactionType', 'type'],
    category: ['category'],
    subcategory: ['subcategory'],
    currency: ['currency'],
    sourceIdKeys: ['bill_no', 'bill_number', 'invoice_no', 'id', 'transaction_id']
  },
  vyapar: {
    amount: ['amount', 'total', 'payment_amount'],
    date: ['date', 'transaction_date', 'bill_date'],
    description: ['description', 'item_name', 'notes', 'category_name'],
    vendor: ['party_name', 'customer_name', 'supplier_name', 'name'],
    voucherType: ['transaction_type', 'type'],
    transactionType: ['transactionType', 'type'],
    category: ['category'],
    subcategory: ['subcategory'],
    currency: ['currency'],
    sourceIdKeys: ['transaction_id', 'id', 'bill_number', 'invoice_number']
  },
  mybillbook: {
    amount: ['total_amount', 'amount', 'total', 'grand_total'],
    date: ['invoice_date', 'date', 'bill_date', 'created_at'],
    description: ['description', 'item_name', 'notes', 'invoice_type'],
    vendor: ['party_name', 'customer_name', 'vendor_name', 'contact_name'],
    voucherType: ['invoice_type', 'type'],
    transactionType: ['transactionType', 'type'],
    category: ['category'],
    subcategory: ['subcategory'],
    currency: ['currency'],
    sourceIdKeys: ['invoice_number', 'invoice_id', 'id', 'transaction_id']
  },
  khatabook: {
    amount: ['amount', 'payment_amount', 'credit_amount', 'debit_amount', 'balance'],
    date: ['date', 'entry_date', 'created_at'],
    description: ['note', 'description', 'notes', 'remark', 'entry_type'],
    vendor: ['contact_name', 'party_name', 'name'],
    voucherType: ['entry_type', 'type'],
    transactionType: ['transactionType', 'type'],
    category: ['category'],
    subcategory: ['subcategory'],
    currency: ['currency'],
    sourceIdKeys: ['entry_id', 'id', 'transaction_id', 'reference_id'],
    creditIndicator: { field: 'credit_amount', debitField: 'debit_amount' }
  },
  quickbooks: {
    amount: ['TotalAmt', 'total', 'amount', 'Amount'],
    date: ['TxnDate', 'date', 'transaction_date'],
    description: ['PrivateNote', 'description', 'DocNumber', 'Memo'],
    vendor: ['EntityRef.name', 'VendorRef.name', 'CustomerRef.name', 'vendor_name'],
    voucherType: ['TxnType', 'transaction_type'],
    transactionType: ['transactionType', 'type'],
    category: ['category'],
    subcategory: ['subcategory'],
    currency: ['CurrencyRef.value', 'currency'],
    sourceIdKeys: ['Id', 'id', 'transaction_id', 'DocNumber'],
    nestedVendorPaths: true
  },
  erpnext: {
    amount: ['debit', 'credit', 'paid_amount', 'grand_total', 'amount'],
    date: ['posting_date', 'transaction_date', 'date', 'creation'],
    description: ['remarks', 'description', 'title', 'against'],
    vendor: ['party', 'supplier', 'customer', 'party_name'],
    voucherType: ['voucher_type', 'doctype'],
    transactionType: ['transactionType'],
    category: ['category'],
    subcategory: ['subcategory'],
    currency: ['currency', 'default_currency'],
    sourceIdKeys: ['name', 'id', 'transaction_id', 'voucher_no'],
    creditIndicator: { field: 'credit', debitField: 'debit' }
  },
  odoo: {
    amount: ['amount_total', 'amount', 'debit', 'credit', 'balance'],
    date: ['date', 'invoice_date', 'accounting_date'],
    description: ['name', 'ref', 'narration', 'label'],
    vendor: ['partner_name', 'partner_id', 'commercial_partner_id'],
    voucherType: ['move_type', 'type'],
    transactionType: ['transactionType'],
    category: ['category'],
    subcategory: ['subcategory'],
    currency: ['currency', 'currency_id'],
    sourceIdKeys: ['move_id', 'id', 'name', 'ref']
  },
  clear: {
    amount: ['amount', 'total', 'txnAmount'],
    date: ['txnDate', 'date', 'transaction_date'],
    description: ['description', 'narration', 'remarks', 'category'],
    vendor: ['partyName', 'vendor_name', 'payee', 'counterparty'],
    voucherType: ['txnType', 'type'],
    transactionType: ['transactionType', 'type'],
    category: ['category'],
    subcategory: ['subcategory'],
    currency: ['currency'],
    sourceIdKeys: ['transactionId', 'id', 'txnId', 'reference']
  },
  profitbooks: {
    amount: ['amount', 'debit', 'credit', 'total'],
    date: ['voucher_date', 'date', 'bill_date'],
    description: ['narration', 'description', 'particulars'],
    vendor: ['ledger', 'party_name', 'vendor', 'account_name'],
    voucherType: ['voucher_type'],
    transactionType: ['transactionType'],
    category: ['category'],
    subcategory: ['subcategory'],
    currency: ['currency'],
    sourceIdKeys: ['voucher_no', 'id', 'transaction_id', 'reference'],
    creditIndicator: { field: 'credit', debitField: 'debit' }
  },
  hostbooks: {
    amount: ['amount', 'total', 'debit', 'credit'],
    date: ['transaction_date', 'date', 'voucher_date'],
    description: ['description', 'narration', 'particulars'],
    vendor: ['payee', 'party_name', 'vendor_name', 'ledger_name'],
    voucherType: ['voucher_type', 'transaction_type'],
    transactionType: ['transactionType', 'type'],
    category: ['category'],
    subcategory: ['subcategory'],
    currency: ['currency'],
    sourceIdKeys: ['reference', 'id', 'transaction_id', 'voucher_number'],
    creditIndicator: { field: 'credit', debitField: 'debit' }
  }
};

const SUPPORTED_IMPORT_PROVIDERS = INDIAN_ACCOUNTING_CONNECTORS
  .filter((connector) => connector.integrationTypes.includes('import'))
  .map((connector) => connector.id);

const API_CONNECTOR_IDS = INDIAN_ACCOUNTING_CONNECTORS
  .filter((connector) => connector.integrationTypes.includes('api'))
  .map((connector) => connector.id);

const resolveProviderId = (providerId) => {
  const normalized = String(providerId || '').trim().toLowerCase();
  if (!normalized) return null;
  if (SUPPORTED_IMPORT_PROVIDERS.includes(normalized)) return normalized;
  if (PROVIDER_ALIASES[normalized]) return PROVIDER_ALIASES[normalized];
  return null;
};

const getConnectorById = (providerId) => {
  const resolved = resolveProviderId(providerId);
  if (!resolved) return null;
  return INDIAN_ACCOUNTING_CONNECTORS.find((connector) => connector.id === resolved) || null;
};

const getFieldMapForProvider = (providerId) => {
  const resolved = resolveProviderId(providerId);
  if (!resolved) return null;
  return PROVIDER_FIELD_MAPS[resolved] || null;
};

const listConnectors = ({ includeConfiguration = false } = {}) => INDIAN_ACCOUNTING_CONNECTORS.map((connector) => {
  const entry = {
    id: connector.id,
    name: connector.name,
    vendor: connector.vendor,
    integrationTypes: connector.integrationTypes,
    description: connector.description,
    supportsImport: connector.integrationTypes.includes('import'),
    supportsApiSync: connector.integrationTypes.includes('api')
  };

  if (includeConfiguration) {
    entry.importEndpoint = '/api/transactions/import-accounting';
    if (connector.integrationTypes.includes('api')) {
      entry.syncEndpoint = `/api/transactions/accounting/${connector.id}/sync`;
      entry.statusEndpoint = `/api/transactions/accounting/${connector.id}/status`;
    }
  }

  return entry;
});

const getAliasesForProvider = (providerId) => Object.entries(PROVIDER_ALIASES)
  .filter(([, target]) => target === providerId)
  .map(([alias]) => alias);

module.exports = {
  INDIAN_ACCOUNTING_CONNECTORS,
  PROVIDER_ALIASES,
  PROVIDER_FIELD_MAPS,
  SUPPORTED_IMPORT_PROVIDERS,
  API_CONNECTOR_IDS,
  resolveProviderId,
  getConnectorById,
  getFieldMapForProvider,
  getAliasesForProvider,
  listConnectors
};
