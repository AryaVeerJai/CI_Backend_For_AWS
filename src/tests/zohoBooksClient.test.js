const ZohoBooksClient = require('../services/connectors/zohoBooksClient');

describe('ZohoBooksClient', () => {
  test('reports configuration status when disabled', () => {
    const client = new ZohoBooksClient({ enabled: false });
    expect(client.isConfigured()).toBe(false);
    expect(client.getConfigurationStatus()).toEqual(expect.objectContaining({
      enabled: false,
      configured: false
    }));
  });

  test('reports configured when required credentials are present', () => {
    const client = new ZohoBooksClient({
      enabled: true,
      clientId: 'client',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      organizationId: 'org-1'
    });

    expect(client.isConfigured()).toBe(true);
    expect(client.getConfigurationStatus().configured).toBe(true);
  });

  test('maps Zoho expenses to parser-friendly rows', () => {
    const client = new ZohoBooksClient({ enabled: false });
    const mapped = client.mapExpense({
      expense_id: 'EXP-1',
      date: '2026-04-11',
      description: 'Office internet',
      total: 999,
      vendor_name: 'Airtel'
    });

    expect(mapped).toEqual(expect.objectContaining({
      transaction_id: 'EXP-1',
      transaction_date: '2026-04-11',
      description: 'Office internet',
      total: 999,
      vendor_name: 'Airtel',
      type: 'expense'
    }));
  });

  test('maps Zoho bank transactions to parser-friendly rows', () => {
    const client = new ZohoBooksClient({ enabled: false });
    const mapped = client.mapBankTransaction({
      banktransaction_id: 'BT-1',
      date: '2026-04-10',
      description: 'Diesel purchase',
      amount: 1800,
      debit_or_credit: 1,
      payee: 'HP Fuel Station'
    });

    expect(mapped).toEqual(expect.objectContaining({
      transaction_id: 'BT-1',
      transaction_date: '2026-04-10',
      description: 'Diesel purchase',
      total: 1800,
      vendor_name: 'HP Fuel Station',
      type: 'expense'
    }));
  });
});
