const fieldContract = require('../../../shared/fieldContract');

describe('fieldContract v1', () => {
  test('readReferenceNumber resolves aliases in priority order', () => {
    expect(fieldContract.readReferenceNumber({ referenceNumber: 'A' })).toBe('A');
    expect(fieldContract.readReferenceNumber({ invoice_number: 'B' })).toBe('B');
    expect(fieldContract.readReferenceNumber({ raw: { invoice_number: 'C' } })).toBe('C');
  });

  test('readGstin resolves seller_gstin and nested gst', () => {
    expect(fieldContract.readGstin({ seller_gstin: '27AABCU9603R1ZP' })).toBe('27AABCU9603R1ZP');
    expect(fieldContract.readGstin({ gst: { seller_gstin: '29FOO1234B1Z5' } })).toBe('29FOO1234B1Z5');
    expect(fieldContract.readGstin({ gstin: '27AABCU9603R1ZP' })).toBe('27AABCU9603R1ZP');
  });

  test('readVendorName resolves string and object vendor', () => {
    expect(fieldContract.readVendorName({ vendor: 'Acme Ltd' })).toBe('Acme Ltd');
    expect(fieldContract.readVendorName({ vendor: { name: 'Acme Pvt Ltd' } })).toBe('Acme Pvt Ltd');
    expect(fieldContract.readVendorName({ raw: { vendor_details: { name: 'From Raw' } } })).toBe('From Raw');
  });

  test('applyFieldContractWrite sets canonical and alias fields', () => {
    const data = {
      vendor: 'Vendor One',
      invoice_number: 'INV-9',
      seller_gstin: '27AABCU9603R1ZP'
    };
    fieldContract.applyFieldContractWrite(data);
    expect(data.referenceNumber).toBe('INV-9');
    expect(data.invoice_number).toBe('INV-9');
    expect(data.gstin).toBe('27AABCU9603R1ZP');
    expect(data.seller_gstin).toBe('27AABCU9603R1ZP');
    expect(data.vendor).toEqual({ name: 'Vendor One', rawName: 'Vendor One' });
    expect(data.fieldContract.version).toBe('1.0');
  });

  test('applyFieldContractWrite prefers referenceNumber over invoice_number', () => {
    const data = {
      referenceNumber: 'REF-1',
      invoice_number: 'INV-OLD'
    };
    fieldContract.applyFieldContractWrite(data);
    expect(data.referenceNumber).toBe('REF-1');
    expect(data.invoice_number).toBe('REF-1');
  });
});
