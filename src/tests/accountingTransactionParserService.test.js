const parserService = require('../services/accountingTransactionParserService');

describe('accountingTransactionParserService', () => {
  test('should parse valid Tally transactions', () => {
    const result = parserService.parseTransactions({
      provider: 'tally',
      transactions: [{
        voucher_number: 'VCH-101',
        voucher_date: '2026-04-20',
        narration: 'Electricity bill April',
        amount: '3500.50',
        party_name: 'State Electricity Board'
      }]
    });

    expect(result.provider).toBe('tally');
    expect(result.parsedCount).toBe(1);
    expect(result.invalidRows).toHaveLength(0);
    expect(result.validRows[0].parsed.source).toBe('tally');
    expect(result.validRows[0].parsed.transactionType).toBe('expense');
    expect(result.validRows[0].parsed.category).toBe('utilities');
    expect(result.validRows[0].parsed.subcategory).toBe('electricity_grid');
    expect(result.validRows[0].parsed.amount).toBe(3500.5);
    expect(result.validRows[0].parsed.metadata.classification).toEqual(
      expect.objectContaining({
        category: 'utilities',
        subcategory: 'electricity_grid',
        confidence: expect.any(Number)
      })
    );
  });

  test('should parse valid Zoho transactions', () => {
    const result = parserService.parseTransactions({
      provider: 'zoho',
      transactions: [{
        transaction_id: 'ZH-220',
        transaction_date: '2026-04-18',
        description: 'Freight charges for shipment',
        total: 2500,
        vendor_name: 'Blue Dart'
      }]
    });

    expect(result.provider).toBe('zoho');
    expect(result.parsedCount).toBe(1);
    expect(result.invalidRows).toHaveLength(0);
    expect(result.validRows[0].parsed.source).toBe('zoho');
    expect(result.validRows[0].parsed.category).toBe('transportation');
    expect(result.validRows[0].parsed.subcategory).toBe('freight_logistics');
    expect(result.validRows[0].parsed.amount).toBe(2500);
  });

  test('should resolve provider aliases', () => {
    const result = parserService.parseTransactions({
      provider: 'zoho_books',
      transactions: [{
        transaction_id: 'ZH-ALIAS-1',
        transaction_date: '2026-04-10',
        description: 'Office internet bill',
        total: 999
      }]
    });

    expect(result.provider).toBe('zoho');
    expect(result.validRows[0].parsed.source).toBe('zoho');
  });

  test('should parse Busy accounting voucher exports', () => {
    const result = parserService.parseTransactions({
      provider: 'busy',
      transactions: [{
        VchNo: 'BUSY-88',
        VchDate: '2026-03-15',
        Narration: 'Diesel purchase for fleet',
        Debit: 4200,
        PartyName: 'HP Petrol Pump'
      }]
    });

    expect(result.provider).toBe('busy');
    expect(result.validRows[0].parsed.source).toBe('busy');
    expect(result.validRows[0].parsed.category).toBe('transportation');
    expect(result.validRows[0].parsed.amount).toBe(4200);
  });

  test('should parse Marg ERP bill exports', () => {
    const result = parserService.parseTransactions({
      provider: 'marg',
      transactions: [{
        bill_no: 'MARG-501',
        bill_date: '2026-02-01',
        product_name: 'Steel raw material purchase',
        net_amount: 18500,
        supplier_name: 'Metro Metals'
      }]
    });

    expect(result.provider).toBe('marg');
    expect(result.validRows[0].parsed.source).toBe('marg');
    expect(result.validRows[0].parsed.category).toBe('raw_materials');
    expect(result.validRows[0].parsed.amount).toBe(18500);
  });

  test('should parse ERPNext GL entries', () => {
    const result = parserService.parseTransactions({
      provider: 'erpnext',
      transactions: [{
        name: 'ACC-JV-2026-00012',
        posting_date: '2026-01-20',
        remarks: 'Water tanker supply',
        debit: 1800,
        party: 'Aqua Logistics'
      }]
    });

    expect(result.provider).toBe('erpnext');
    expect(result.validRows[0].parsed.category).toBe('utilities');
    expect(result.validRows[0].parsed.subcategory).toBe('water_supply');
  });

  test('should parse Vyapar and Khatabook exports', () => {
    const vyapar = parserService.parseTransactions({
      provider: 'vyapar',
      transactions: [{
        transaction_id: 'VY-1',
        date: '2026-04-01',
        description: 'Annual maintenance AMC contract',
        amount: 6500,
        party_name: 'Precision Service Co'
      }]
    });

    const khatabook = parserService.parseTransactions({
      provider: 'khatabook',
      transactions: [{
        entry_id: 'KB-9',
        entry_date: '2026-04-02',
        note: 'Courier shipment charges',
        amount: 450,
        contact_name: 'DTDC'
      }]
    });

    expect(vyapar.validRows[0].parsed.source).toBe('vyapar');
    expect(vyapar.validRows[0].parsed.category).toBe('maintenance');
    expect(khatabook.validRows[0].parsed.source).toBe('khatabook');
    expect(khatabook.validRows[0].parsed.category).toBe('transportation');
  });

  test('should parse QuickBooks purchase exports', () => {
    const result = parserService.parseTransactions({
      provider: 'quickbooks',
      transactions: [{
        Id: 'QB-100',
        TxnDate: '2026-04-11',
        TotalAmt: 7600,
        PrivateNote: 'Petrol for delivery fleet',
        EntityRef: { name: 'Indian Oil' }
      }]
    });

    expect(result.validRows[0].parsed.source).toBe('quickbooks');
    expect(result.validRows[0].parsed.category).toBe('transportation');
    expect(result.validRows[0].parsed.subcategory).toBe('fuel_petrol');
  });

  test('should parse myBillBook invoice exports', () => {
    const result = parserService.parseTransactions({
      provider: 'mybillbook',
      transactions: [{
        invoice_number: 'MB-9001',
        invoice_date: '2026-04-01',
        description: 'Annual AMC service contract',
        total_amount: 12500,
        vendor_name: 'Service Partner'
      }]
    });

    expect(result.validRows[0].parsed.source).toBe('mybillbook');
    expect(result.validRows[0].parsed.category).toBe('maintenance');
  });

  test('should parse Clear and HostBooks exports', () => {
    const clear = parserService.parseTransactions({
      provider: 'clear',
      transactions: [{
        transactionId: 'CL-1',
        txnDate: '2026-04-03',
        description: 'Electricity bill payment',
        amount: 2100,
        partyName: 'BESCOM'
      }]
    });

    const hostbooks = parserService.parseTransactions({
      provider: 'hostbooks',
      transactions: [{
        reference: 'HB-22',
        transaction_date: '2026-04-04',
        narration: 'Freight charges',
        amount: 900,
        payee: 'Delhivery'
      }]
    });

    expect(clear.validRows[0].parsed.source).toBe('clear');
    expect(clear.validRows[0].parsed.category).toBe('utilities');
    expect(hostbooks.validRows[0].parsed.source).toBe('hostbooks');
    expect(hostbooks.validRows[0].parsed.category).toBe('transportation');
  });

  test('should preserve explicit category and subcategory when supplied', () => {
    const result = parserService.parseTransactions({
      provider: 'zoho',
      transactions: [{
        transaction_id: 'ZH-900',
        transaction_date: '2026-04-01',
        description: 'Monthly service bill',
        total: 4200,
        category: 'energy',
        subcategory: 'boiler_fuel'
      }]
    });

    expect(result.invalidRows).toHaveLength(0);
    expect(result.validRows[0].parsed.category).toBe('energy');
    expect(result.validRows[0].parsed.subcategory).toBe('boiler_fuel');
    expect(result.validRows[0].parsed.metadata.classification.confidence).toBeCloseTo(0.98, 2);
  });

  test('should mark invalid rows when required fields are missing', () => {
    const result = parserService.parseTransactions({
      provider: 'zoho',
      transactions: [{
        transaction_id: 'ZH-404',
        description: 'Missing key fields'
      }]
    });

    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0].errors).toEqual(
      expect.arrayContaining(['Invalid or missing date', 'Invalid or missing amount'])
    );
  });

  test('should list accounting providers with metadata', () => {
    const providers = parserService.listAccountingProviders();
    const ids = providers.map((item) => item.id);

    expect(ids).toEqual(expect.arrayContaining([
      'tally',
      'zoho',
      'busy',
      'marg',
      'erpnext',
      'clear',
      'hostbooks'
    ]));
    expect(providers.find((item) => item.id === 'zoho')).toEqual(
      expect.objectContaining({
        displayName: 'Zoho Books',
        aliases: expect.arrayContaining(['zoho_books'])
      })
    );
  });

  test('should throw on unsupported provider', () => {
    expect(() => parserService.parseTransactions({
      provider: 'sap',
      transactions: []
    })).toThrow(/Provider must be one of/);
  });
});
