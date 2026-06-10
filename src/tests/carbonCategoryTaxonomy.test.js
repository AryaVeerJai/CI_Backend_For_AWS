const carbonCategoryTaxonomy = require('../../../shared/carbonCategoryTaxonomy');

describe('carbonCategoryTaxonomy', () => {
  test('maps SMS expense bills with electricity subcategory to energy/grid', () => {
    const mapped = carbonCategoryTaxonomy.mapSmsExpenseCategory('bills', 'electricity', 'Power bill');
    expect(mapped.category).toBe('energy');
    expect(mapped.subcategory).toBe('grid');
  });

  test('maps SMS water bills to water category', () => {
    const mapped = carbonCategoryTaxonomy.mapSmsExpenseCategory('bills', 'water', 'Water bill paid');
    expect(mapped.category).toBe('water');
    expect(mapped.subcategory).toBe('consumption');
  });

  test('maps telecom recharge keywords to telecom category', () => {
    const mapped = carbonCategoryTaxonomy.mapSmsExpenseCategory(
      'bills',
      'general',
      'Rs 299 recharge successful for Jio prepaid'
    );
    expect(mapped.category).toBe('telecom');
  });

  test('normalizes pipeline fuel category to energy', () => {
    const mapped = carbonCategoryTaxonomy.mapPipelineCategory('fuel', 'diesel.mobile');
    expect(mapped.category).toBe('energy');
    expect(mapped.subcategory).toBe('diesel');
  });

  test('applies OCR invoice subcategory override for water bills', () => {
    const mapped = carbonCategoryTaxonomy.applyInvoiceBackendMapping({
      backend_category: 'utilities',
      backend_subcategory: 'supply',
      subcategory_id: 'water_bill'
    });
    expect(mapped.category).toBe('water');
    expect(mapped.subcategory).toBe('supply');
  });

  test('includes services in transaction categories', () => {
    expect(carbonCategoryTaxonomy.TRANSACTION_CATEGORIES).toContain('services');
  });

  test('classifies service keywords to services category from text', () => {
    expect(carbonCategoryTaxonomy.classifySubcategoryFromText(
      'graphic design fee for brand refresh',
      'services'
    )).toBe('design');
    expect(carbonCategoryTaxonomy.normalizeTransactionCategory('services')).toBe('services');
  });

  test('includes telecom in transaction categories', () => {
    expect(carbonCategoryTaxonomy.TRANSACTION_CATEGORIES).toContain('telecom');
  });

  test('classifies energy electricity vs fuel subcategories', () => {
    expect(carbonCategoryTaxonomy.isEnergyElectricitySubcategory('grid')).toBe(true);
    expect(carbonCategoryTaxonomy.isEnergyElectricitySubcategory('electricity')).toBe(true);
    expect(carbonCategoryTaxonomy.isEnergyFuelSubcategory('diesel')).toBe(true);
    expect(carbonCategoryTaxonomy.isEnergyFuelSubcategory('grid')).toBe(false);
  });

  test('classifies renewable and solar as renewable energy subcategories', () => {
    expect(carbonCategoryTaxonomy.isEnergyRenewableSubcategory('renewable')).toBe(true);
    expect(carbonCategoryTaxonomy.isEnergyRenewableSubcategory('solar')).toBe(true);
    expect(carbonCategoryTaxonomy.isEnergyElectricitySubcategory('renewable')).toBe(false);
  });

  test('normalizes invalid subcategory to general for category', () => {
    expect(carbonCategoryTaxonomy.normalizeSubcategoryForCategory('not_a_real_sub', 'energy'))
      .toBe('general');
    expect(carbonCategoryTaxonomy.normalizeSubcategoryForCategory('diesel', 'energy'))
      .toBe('diesel');
  });
});
