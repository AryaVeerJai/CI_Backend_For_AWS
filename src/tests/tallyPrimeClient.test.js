const TallyPrimeClient = require('../services/connectors/tallyPrimeClient');

describe('TallyPrimeClient', () => {
  test('reports configuration status when disabled', () => {
    const client = new TallyPrimeClient({ enabled: false });
    expect(client.isConfigured()).toBe(false);
    expect(client.getConfigurationStatus()).toEqual(expect.objectContaining({
      enabled: false,
      configured: false
    }));
  });

  test('reports configured when company name is set', () => {
    const client = new TallyPrimeClient({
      enabled: true,
      companyName: 'Demo Company Pvt Ltd',
      host: 'localhost',
      port: 9000
    });

    expect(client.isConfigured()).toBe(true);
    expect(client.getConfigurationStatus().configured).toBe(true);
    expect(client.getConfigurationStatus().companyNameConfigured).toBe(true);
  });

  test('uses MSME legal name when env company name is unset', () => {
    const client = new TallyPrimeClient({
      enabled: true,
      companyName: '',
      host: 'localhost',
      port: 9000
    });

    expect(client.isConfigured()).toBe(false);
    expect(client.isConfigured({ legalName: 'Green Craft Industries' })).toBe(true);
    expect(client.getConfigurationStatus({ legalName: 'Green Craft Industries' })).toEqual(
      expect.objectContaining({
        companyName: 'Green Craft Industries',
        companyNameConfigured: true,
        configured: true
      })
    );
    expect(client.resolveCompanyName('Green Craft Industries')).toBe('Green Craft Industries');
  });

  test('normalizes ISO dates to Tally YYYYMMDD', () => {
    const client = new TallyPrimeClient({ enabled: false });
    expect(client.toTallyDate('2026-04-20')).toBe('20260420');
    expect(client.toTallyDate('20260420')).toBe('20260420');
    expect(client.toTallyDate('01042026')).toBe('20260401');
    expect(client.formatTallyDateForDisplay('01042026')).toBe('2026-04-01');
  });

  test('builds JSON export body with mandatory static variables', () => {
    const client = new TallyPrimeClient({ enabled: false });
    const body = client.buildJsonExportBody({
      companyName: 'Acme Ltd',
      fromDate: '20260101',
      toDate: '20260331'
    });

    const names = body.static_variables.map((entry) => entry.name);
    expect(names).toEqual(expect.arrayContaining([
      'SVExportFormat',
      'SVCurrentCompany',
      'SVFROMDATE',
      'SVTODATE',
      'SVExportInPlainFormat'
    ]));
    expect(body.static_variables.find((entry) => entry.name === 'SVCurrentCompany').value).toBe('Acme Ltd');
  });

  test('maps Tally voucher objects to parser-friendly rows', () => {
    const client = new TallyPrimeClient({ enabled: false });
    const mapped = client.mapVoucherToTransaction({
      VOUCHERNUMBER: 'VCH-101',
      DATE: '20260420',
      NARRATION: 'Electricity bill April',
      AMOUNT: '-3500.50',
      PARTYLEDGERNAME: 'State Electricity Board',
      VOUCHERTYPENAME: 'Payment'
    });

    expect(mapped).toEqual(expect.objectContaining({
      voucher_number: 'VCH-101',
      voucher_date: '2026-04-20',
      narration: 'Electricity bill April',
      amount: '3500.5',
      party_name: 'State Electricity Board',
      voucher_type: 'Payment'
    }));
  });

  test('extracts vouchers from nested JSONEx-style response', () => {
    const client = new TallyPrimeClient({ enabled: false });
    const parsed = {
      status: '1',
      tallymessage: [
        {
          voucher: {
            DATE: '20260421',
            NARRATION: 'Diesel',
            AMOUNT: '1800',
            VOUCHERNUMBER: 'VCH-102'
          }
        }
      ]
    };

    const result = client.parseJsonResponse(parsed);
    expect(result.vouchers.length).toBeGreaterThanOrEqual(1);
    const mapped = client.mapVoucherToTransaction(result.vouchers[0]);
    expect(mapped.voucher_number).toBe('VCH-102');
    expect(mapped.narration).toBe('Diesel');
  });

  test('parses XML Day Book voucher response', () => {
    const client = new TallyPrimeClient({ enabled: false });
    const xml = `
      <ENVELOPE>
        <HEADER><STATUS>1</STATUS></HEADER>
        <BODY>
          <DATA>
            <TALLYMESSAGE>
              <VOUCHER>
                <DATE>20260422</DATE>
                <VOUCHERNUMBER>VCH-103</VOUCHERNUMBER>
                <NARRATION>Office rent</NARRATION>
                <AMOUNT>12000</AMOUNT>
                <PARTYLEDGERNAME>Landlord</PARTYLEDGERNAME>
                <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
              </VOUCHER>
            </TALLYMESSAGE>
          </DATA>
        </BODY>
      </ENVELOPE>
    `;

    const result = client.parseXmlResponse(xml);
    expect(result.vouchers).toHaveLength(1);
    const mapped = client.mapVoucherToTransaction(result.vouchers[0]);
    expect(mapped).toEqual(expect.objectContaining({
      voucher_number: 'VCH-103',
      voucher_date: '2026-04-22',
      narration: 'Office rent',
      party_name: 'Landlord'
    }));
  });

  test('fetchDayBookTransactions maps export result to transactions', async () => {
    const client = new TallyPrimeClient({
      enabled: true,
      companyName: 'Demo Co'
    });

    client.exportDayBook = jest.fn().mockResolvedValue({
      vouchers: [{
        DATE: '20260423',
        NARRATION: 'Internet',
        AMOUNT: '999',
        VOUCHERNUMBER: 'VCH-104',
        PARTYLEDGERNAME: 'ISP'
      }],
      companyName: 'Demo Co',
      reportId: 'DayBook',
      fromDate: '20260401',
      toDate: '20260430',
      apiFormat: 'json'
    });

    const result = await client.fetchDayBookTransactions({
      fromDate: '2026-04-01',
      toDate: '2026-04-30'
    });

    expect(client.exportDayBook).toHaveBeenCalled();
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].voucher_number).toBe('VCH-104');
    expect(result.meta.reportId).toBe('DayBook');
  });
});
