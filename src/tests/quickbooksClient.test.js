const QuickBooksClient = require('../services/connectors/quickbooksClient');

describe('QuickBooksClient', () => {
  test('reports configuration status when disabled', () => {
    const client = new QuickBooksClient({ enabled: false });
    expect(client.isConfigured()).toBe(false);
    expect(client.getConfigurationStatus()).toEqual(expect.objectContaining({
      enabled: false,
      configured: false
    }));
  });

  test('reports configured when required credentials are present', () => {
    const client = new QuickBooksClient({
      enabled: true,
      clientId: 'client',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      realmId: 'realm-1'
    });

    expect(client.isConfigured()).toBe(true);
    expect(client.getConfigurationStatus().configured).toBe(true);
  });

  test('maps QuickBooks purchases to parser-friendly rows', () => {
    const client = new QuickBooksClient({ enabled: false });
    const mapped = client.mapPurchase({
      Id: 'P-1',
      TxnDate: '2026-04-10',
      TotalAmt: 2200,
      PrivateNote: 'Diesel purchase',
      DocNumber: 'PO-22',
      VendorRef: { name: 'HP Fuel Station' }
    });

    expect(mapped).toEqual(expect.objectContaining({
      Id: 'P-1',
      TxnDate: '2026-04-10',
      TotalAmt: 2200,
      PrivateNote: 'Diesel purchase',
      DocNumber: 'PO-22',
      TxnType: 'Purchase'
    }));
  });

  test('maps QuickBooks bills to parser-friendly rows', () => {
    const client = new QuickBooksClient({ enabled: false });
    const mapped = client.mapBill({
      Id: 'B-1',
      TxnDate: '2026-04-12',
      TotalAmt: 1500,
      Memo: 'Electricity bill',
      VendorRef: { name: 'State Electricity Board' }
    });

    expect(mapped).toEqual(expect.objectContaining({
      Id: 'B-1',
      TxnType: 'Bill',
      TotalAmt: 1500
    }));
  });
});
