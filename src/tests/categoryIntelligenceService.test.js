const categoryIntelligenceService = require('../services/categoryIntelligenceService');

describe('CategoryIntelligenceService', () => {
  test('taxonomy has 21 top-level categories', () => {
    expect(categoryIntelligenceService.categories).toHaveLength(21);
  });

  test('classifies electricity utility bill', () => {
    const result = categoryIntelligenceService.classify({
      text: 'BESCOM electricity bill kWh energy charges industrial',
      vendor: 'Bangalore Electricity Supply'
    });
    expect(result.category_id).toBe('utilities');
    expect(result.subcategory_id).toBe('electricity_bill');
    expect(result.emission_scope).toBe('Scope 2');
    expect(result.backend_category).toBe('utilities');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  test('classifies diesel fuel transport', () => {
    const result = categoryIntelligenceService.classify({
      text: 'HP petrol pump diesel HSD fuel fleet',
      vendor: 'Indian Oil',
      items: [{ name: 'High Speed Diesel', total: 8000 }]
    });
    expect(['transport_logistics', 'energy_industrial_fuel']).toContain(result.category_id);
    expect(result.carbon_factor).toBeGreaterThanOrEqual(2);
  });

  test('classifies consulting and service fees as services backend category', () => {
    const result = categoryIntelligenceService.classify({
      text: 'Management consulting services professional fee invoice',
      vendor: 'ABC Consulting Pvt Ltd',
      items: [{ name: 'Consulting fee', total: 25000 }]
    });
    expect(result.category_id).toBe('business_services');
    expect(result.backend_category).toBe('services');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  test('classifies plumbing and maintenance services', () => {
    const result = categoryIntelligenceService.classify({
      text: 'plumbing and electrical services water tank repair works',
      items: [{ name: 'plumbing and electrical services', total: 800 }]
    });
    expect(result.backend_category).toBe('services');
    expect(['maintenance_services', 'general_services', 'consulting_services']).toContain(result.subcategory_id);
  });

  test('maps to backend fields', () => {
    const classification = categoryIntelligenceService.classify({
      text: 'TMT steel bars fabrication',
      items: [{ name: 'TMT Steel', total: 50000 }]
    });
    const mapped = categoryIntelligenceService.toBackendFields(classification);
    expect(mapped.category).toBe('raw_materials');
    expect(mapped.subcategory).toBe('steel');
    expect(mapped.classificationContext.invoiceCategory).toBe('Manufacturing');
  });

  test('fallback for ambiguous text', () => {
    const result = categoryIntelligenceService.classify({ text: 'xyz payment' });
    expect(result.category_id).toBe('general_msme');
    expect(result.classification_method).toBe('Confidence Fallback');
  });
});
