const {
  normalizeBoundary,
  buildProductAttributionFromNames,
  applyClassificationToTransaction
} = require('../services/transactionClassificationService');

describe('transactionClassificationService', () => {
  const msmeProfile = {
    business: {
      primaryProducts: 'Eco Panel, Solar Frame',
      manufacturingWorkflow: {
        units: [{
          unitId: 'unit_1',
          products: ['Eco Panel']
        }]
      }
    },
    manufacturingProfile: {
      keyProducts: ['Solar Frame']
    }
  };

  test('normalizeBoundary defaults to company for invalid values', () => {
    expect(normalizeBoundary('product')).toBe('product');
    expect(normalizeBoundary('company')).toBe('company');
    expect(normalizeBoundary('invalid')).toBe('company');
    expect(normalizeBoundary()).toBe('company');
  });

  test('buildProductAttributionFromNames maps profile catalog entries', () => {
    const attribution = buildProductAttributionFromNames(['Eco Panel'], msmeProfile);
    expect(attribution).toBeTruthy();
    expect(attribution.assignedProducts).toHaveLength(1);
    expect(attribution.assignedProducts[0].productName).toBe('Eco Panel');
    expect(attribution.assignmentMethod).toBe('manual_classification');
  });

  test('applyClassificationToTransaction sets company boundary and clears products', () => {
    const transaction = {
      amount: 1000,
      category: 'energy',
      description: 'Electricity bill',
      metadata: { extractedData: { source: 'document_upload' } },
      productAttribution: {
        assignedProducts: [{ productName: 'Eco Panel', allocationPercent: 100 }]
      }
    };

    applyClassificationToTransaction(transaction, {
      emissionBoundary: 'company',
      msmeProfile
    });

    expect(transaction.emissionBoundary).toBe('company');
    expect(transaction.emissionClassification.level).toBe('company');
    expect(transaction.productAttribution.assignedProducts).toHaveLength(0);
    expect(transaction.metadata.extractedData.transactionMapping).toBe('company');
    expect(transaction.carbonFootprint).toBeDefined();
  });

  test('applyClassificationToTransaction assigns products for product boundary', () => {
    const transaction = {
      amount: 2500,
      category: 'raw_materials',
      description: 'Steel purchase for Eco Panel',
      metadata: { extractedData: { source: 'document_upload' } }
    };

    applyClassificationToTransaction(transaction, {
      emissionBoundary: 'product',
      productNames: ['Eco Panel'],
      msmeProfile
    });

    expect(transaction.emissionBoundary).toBe('product');
    expect(transaction.emissionClassification.level).toBe('product');
    expect(transaction.productAttribution.assignedProducts[0].productName).toBe('Eco Panel');
    expect(transaction.metadata.extractedData.emissionBoundary).toBe('product');
    expect(transaction.carbonFootprint).toBeDefined();
  });
});
