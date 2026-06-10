const { AccountingSyncService } = require('../services/accountingSyncService');
const MSME = require('../models/MSME');

describe('AccountingSyncService', () => {
  const zohoBooksClient = {
    isConfigured: () => true,
    getConfigurationStatus: () => ({ enabled: true, configured: true }),
    fetchAllTransactions: jest.fn().mockResolvedValue({
      transactions: [
        {
          transaction_id: 'BT-1',
          transaction_date: '2026-04-10',
          description: 'Diesel',
          total: 1800,
          vendor_name: 'HP'
        }
      ],
      pageContext: { bank: { has_more_page: false } }
    }),
    fetchBankTransactions: jest.fn()
  };

  const quickbooksClient = {
    isConfigured: () => true,
    getConfigurationStatus: () => ({ enabled: true, configured: false }),
    fetchAllTransactions: jest.fn().mockResolvedValue({
      transactions: [
        {
          Id: 'QB-1',
          TxnDate: '2026-04-11',
          TotalAmt: 900,
          PrivateNote: 'Office supplies'
        }
      ],
      startPosition: 1,
      maxResults: 200
    }),
    fetchPurchases: jest.fn()
  };

  const tallyPrimeClient = {
    isConfigured: () => true,
    getConfigurationStatus: () => ({ enabled: true, configured: true }),
    fetchAllTransactions: jest.fn().mockResolvedValue({
      transactions: [
        {
          voucher_number: 'VCH-1',
          voucher_date: '2026-04-20',
          narration: 'Electricity bill April',
          amount: '3500.50',
          party_name: 'State Electricity Board'
        }
      ],
      meta: { reportId: 'DayBook', voucherCount: 1 }
    })
  };

  const service = new AccountingSyncService({ zohoBooksClient, quickbooksClient, tallyPrimeClient });

  test('lists API connector statuses', async () => {
    const statuses = await service.listConnectorStatuses();
    expect(statuses.map((entry) => entry.id)).toEqual(expect.arrayContaining(['zoho', 'quickbooks', 'tally']));
    expect(statuses.find((entry) => entry.id === 'zoho').api.configured).toBe(true);
  });

  test('rejects API sync for import-only providers', async () => {
    await expect(service.fetchTransactionsFromProvider('busy')).rejects.toMatchObject({
      statusCode: 400
    });
  });

  test('syncs Tally Day Book vouchers through parser', async () => {
    const result = await service.syncProviderTransactions('tally', {
      fromDate: '2026-04-01',
      toDate: '2026-04-30',
      legalName: 'Green Craft Industries'
    });

    expect(tallyPrimeClient.fetchAllTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        fromDate: '2026-04-01',
        toDate: '2026-04-30',
        companyName: 'Green Craft Industries'
      })
    );
    expect(result.provider).toBe('tally');
    expect(result.parsedResult.validRows[0].parsed.source).toBe('tally');
    expect(result.parsedResult.validRows[0].parsed.category).toBe('utilities');
  });

  test('syncs Zoho transactions through parser and returns fetch meta', async () => {
    const result = await service.syncProviderTransactions('zoho', { syncAllPages: true });

    expect(zohoBooksClient.fetchAllTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ syncAllPages: true })
    );
    expect(result.provider).toBe('zoho');
    expect(result.fetchedCount).toBe(1);
    expect(result.parsedResult.validRows).toHaveLength(1);
    expect(result.parsedResult.validRows[0].parsed.source).toBe('zoho');
    expect(result.fetchMeta.syncAllPages).toBe(true);
  });

  test('resolves Tally company name from MSME profile when legalName is absent', async () => {
    const findById = jest.spyOn(MSME, 'findById').mockReturnValue({
      select: () => ({
        lean: async () => ({ companyName: 'Peenya Metal Fab MSME' })
      })
    });

    await service.fetchTransactionsFromProvider('tally', {
      msmeId: '507f1f77bcf86cd799439011',
      fromDate: '2026-04-01',
      toDate: '2026-04-30'
    });

    expect(tallyPrimeClient.fetchAllTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Peenya Metal Fab MSME'
      })
    );

    findById.mockRestore();
  });

  test('syncs QuickBooks purchases and bills when syncAllPages is enabled', async () => {
    const result = await service.syncProviderTransactions('quickbooks', { syncAllPages: true });

    expect(quickbooksClient.fetchAllTransactions).toHaveBeenCalled();
    expect(result.provider).toBe('quickbooks');
    expect(result.parsedResult.validRows[0].parsed.source).toBe('quickbooks');
  });
});
