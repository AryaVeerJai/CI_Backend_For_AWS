jest.mock('../services/fuelPriceService', () => ({
  getFuelPrices: jest.fn()
}));

jest.mock('../services/orchestrationManagerEventService', () => ({
  triggerOrchestration: jest.fn()
}));

const fuelPriceService = require('../services/fuelPriceService');
const orchestrationManagerEventService = require('../services/orchestrationManagerEventService');
const granularCategoryEmissionsService = require('../services/granularCategoryEmissionsService');

describe('GranularCategoryEmissionsService', () => {
  beforeEach(() => {
    orchestrationManagerEventService.triggerOrchestration.mockReset();
    fuelPriceService.getFuelPrices.mockResolvedValue({
      source: { authority: 'PPAC' },
      lastUpdated: '01-May-26',
      location: {
        name: 'Mumbai',
        petrol: 104,
        diesel: 95
      }
    });
  });

  const buildMsmeData = () => ({
    companyType: 'small',
    industry: 'manufacturing',
    businessDomain: 'manufacturing',
    contact: {
      address: {
        state: 'Maharashtra',
        city: 'Pune',
        country: 'India'
      }
    },
    business: {
      annualTurnover: 12000000,
      numberOfEmployees: 85,
      manufacturingUnits: 2,
      primaryProducts: 'Fabricated steel components'
    },
    manufacturingProfile: {
      msmeType: 'Small Enterprise',
      industrySector: 'basic_metal_industries',
      nicCode: '2511',
      yearOfEstablishment: 2014,
      locationCity: 'Pune',
      locationState: 'Maharashtra',
      locationCountry: 'India',
      numberOfEmployees: 85,
      plantAreaSqft: 22000,
      operationalDaysPerYear: 300,
      primaryEnergySource: 'Grid Electricity',
      backupEnergySource: 'Diesel Generator',
      mainFuelsUsed: ['Diesel', 'LPG'],
      waterSource: 'Municipal + Borewell',
      wasteManagementPractice: 'Partial recycling and authorized disposal',
      keyProducts: ['Steel parts', 'Metal structures'],
      productionCapacityPerMonth: 250,
      productionCapacityUnit: 'tons',
      supplyChainType: 'National B2B',
      logisticsMode: 'Road',
      certifications: ['ISO 9001', 'ISO 14001'],
      esgMaturityLevel: 'Basic',
      digitalizationLevel: 'Moderate',
      carbonAccountingPractice: 'Developing',
      regulatoryExposure: ['SPCB', 'EPR'],
      exportActivity: false,
      clusterAssociation: 'MIDC Cluster'
    },
    environmentalCompliance: {
      hasEnvironmentalClearance: true,
      hasPollutionControlBoard: true,
      hasWasteManagement: true
    }
  });

  test('should calculate manufacturing and services category emissions', async () => {
    const result = await granularCategoryEmissionsService.calculateGranularCategoryEmissions({
      msmeData: buildMsmeData(),
      options: {
        includeOrchestration: false
      }
    });

    expect(result).toBeDefined();
    expect(result.totals).toBeDefined();
    expect(result.totals.categoryCount).toBe(38);
    expect(result.totals.manufacturingCO2Emissions).toBeGreaterThan(0);
    expect(result.totals.servicesCO2Emissions).toBeGreaterThan(0);
    expect(result.totals.overallCO2Emissions).toBeGreaterThan(0);

    expect(Array.isArray(result.detailedResults?.manufacturing)).toBe(true);
    expect(result.detailedResults.manufacturing).toHaveLength(20);
    expect(Array.isArray(result.detailedResults?.services)).toBe(true);
    expect(result.detailedResults.services).toHaveLength(18);
    expect(result.fineDetailSignals).toEqual(
      expect.objectContaining({
        profileCompleteness: expect.any(Object),
        employeeCount: expect.any(Number)
      })
    );
    expect(result.orchestration).toEqual(
      expect.objectContaining({
        orchestrationId: null
      })
    );
  });

  test('should include deterministic profile signals in category outputs', async () => {
    const result = await granularCategoryEmissionsService.calculateGranularCategoryEmissions({
      msmeData: buildMsmeData(),
      options: {
        includeOrchestration: false
      }
    });

    const sampleManufacturing = result.detailedResults.manufacturing[0];
    const sampleService = result.detailedResults.services[0];

    expect(sampleManufacturing.value).toBeDefined();
    expect(sampleManufacturing.label).toBeDefined();
    expect(sampleManufacturing.breakdownByCategory).toBeDefined();
    expect(sampleManufacturing.precisionSignals).toEqual(
      expect.objectContaining({
        averageManufacturingProfileFactor: expect.any(Number),
        averageLocationFactor: expect.any(Number),
        categoryClassificationConfidence: expect.any(Number),
        subcategoryClassificationConfidence: expect.any(Number),
        weightedAgentAccuracyScore: expect.any(Number),
        contributingAgents: expect.arrayContaining([
          'textClassifierAgent',
          'subcategoryResolverAgent',
          'emissionFactorVerifierAgent',
          'anomalyReconciliationAgent'
        ])
      })
    );
    expect(sampleManufacturing.transactionCount).toBeGreaterThan(0);
    expect(sampleManufacturing.dataCoverage).toMatch(/historical|synthetic/);

    expect(sampleService.value).toBeDefined();
    expect(sampleService.label).toBeDefined();
    expect(sampleService.precisionSignals).toEqual(
      expect.objectContaining({
        averageManufacturingProfileFactor: expect.any(Number),
        averageLocationFactor: expect.any(Number),
        weightedAgentAccuracyScore: expect.any(Number)
      })
    );
    expect(sampleService.totalCO2Emissions).toBeGreaterThanOrEqual(0);
  });

  describe('per manufacturing sub-sector (NIC-aligned granular categories)', () => {
    const manufacturingCases = [
      { industrySector: 'food_products_industry', nicCode: '1071', keyProducts: ['packaged snacks', 'spices'] },
      { industrySector: 'beverages_tobacco_products', nicCode: '1104', keyProducts: ['soft drinks'] },
      { industrySector: 'cotton_textiles', nicCode: '1311', keyProducts: ['cotton yarn'] },
      { industrySector: 'wool_silk_synthetic_fibre_textiles', nicCode: '1320', keyProducts: ['silk fabric'] },
      { industrySector: 'jute_hemp_mesta_textiles', nicCode: '1313', keyProducts: ['jute bags'] },
      { industrySector: 'hosiery_garments', nicCode: '1410', keyProducts: ['readymade garments'] },
      { industrySector: 'leather_leather_products', nicCode: '1520', keyProducts: ['leather footwear'] },
      { industrySector: 'chemical_chemical_products', nicCode: '2023', keyProducts: ['specialty chemicals'] },
      { industrySector: 'basic_metal_industries', nicCode: '2410', keyProducts: ['steel billets'] },
      { industrySector: 'metal_products', nicCode: '2511', keyProducts: ['metal fabrication'] },
      { industrySector: 'machinery_parts_non_electrical', nicCode: '2811', keyProducts: ['industrial machinery'] },
      { industrySector: 'electrical_machinery_parts', nicCode: '2710', keyProducts: ['electrical motors'] },
      { industrySector: 'rubber_plastic_products', nicCode: '2211', keyProducts: ['molded plastics'] },
      { industrySector: 'non_metallic_mineral_products', nicCode: '2394', keyProducts: ['cement products'] },
      { industrySector: 'paper_products_printing', nicCode: '1701', keyProducts: ['packaging paper'] },
      { industrySector: 'transport_equipment_parts', nicCode: '2930', keyProducts: ['auto components'] },
      { industrySector: 'wood_products_furniture', nicCode: '1620', keyProducts: ['wood furniture'] },
      { industrySector: 'handicrafts_artisanal_products', nicCode: '3212', keyProducts: ['handicrafts'] },
      { industrySector: 'coir_ceramic_glass_products', nicCode: '2393', keyProducts: ['ceramic tiles'] },
      { industrySector: 'miscellaneous_manufacturing_industries', nicCode: '3290', keyProducts: ['sports goods'] }
    ];

    test.each(manufacturingCases)(
      'manufacturing sub-sector $industrySector emits positive CO2 with synthetic baseline',
      async ({ industrySector, nicCode, keyProducts }) => {
        const msmeData = {
          ...buildMsmeData(),
          companyName: `Test MSME ${industrySector}`,
          manufacturingProfile: {
            ...buildMsmeData().manufacturingProfile,
            industrySector,
            nicCode,
            keyProducts
          }
        };

        const result = await granularCategoryEmissionsService.calculateGranularCategoryEmissions({
          msmeData,
          options: { includeOrchestration: false }
        });

        const row = result.detailedResults.manufacturing.find((r) => r.value === industrySector);
        expect(row).toBeDefined();
        expect(row.totalCO2Emissions).toBeGreaterThan(0);
        expect(row.dataCoverage).toBe('synthetic');
        expect(row.transactionCount).toBe(5);
        expect(row.breakdownByCategory.energy).toBeDefined();
      }
    );
  });

  describe('per services sub-sector (NIC-aligned granular categories)', () => {
    const servicesCases = [
      { industrySector: 'wholesale_trade_services', nicCode: '46900' },
      { industrySector: 'retail_trade_services', nicCode: '47110' },
      { industrySector: 'transport_services', nicCode: '49212' },
      { industrySector: 'storage_warehousing', nicCode: '52109' },
      { industrySector: 'hotels_restaurants', nicCode: '55101' },
      { industrySector: 'tourism_travel_services', nicCode: '79110' },
      { industrySector: 'it_services', nicCode: '62011' },
      { industrySector: 'telecommunication_services', nicCode: '61909' },
      { industrySector: 'financial_services_non_banking', nicCode: '66120' },
      { industrySector: 'professional_business_services', nicCode: '70200' },
      { industrySector: 'education_services', nicCode: '85104' },
      { industrySector: 'training_skill_development', nicCode: '85499' },
      { industrySector: 'healthcare_services', nicCode: '86100' },
      { industrySector: 'social_community_services', nicCode: '88911' },
      { industrySector: 'real_estate_services', nicCode: '68201' },
      { industrySector: 'infrastructure_support_services', nicCode: '81100' },
      { industrySector: 'personal_services', nicCode: '96021' },
      { industrySector: 'entertainment_recreation', nicCode: '59112' }
    ];

    test.each(servicesCases)(
      'services sub-sector $industrySector emits non-negative CO2 with synthetic baseline',
      async ({ industrySector, nicCode }) => {
        const msmeData = {
          ...buildMsmeData(),
          companyName: `Test Services ${industrySector}`,
          industry: 'services',
          businessDomain: 'services',
          manufacturingProfile: {
            ...buildMsmeData().manufacturingProfile,
            industrySector,
            nicCode
          }
        };

        const result = await granularCategoryEmissionsService.calculateGranularCategoryEmissions({
          msmeData,
          options: { includeOrchestration: false }
        });

        const row = result.detailedResults.services.find((r) => r.value === industrySector);
        expect(row).toBeDefined();
        expect(row.totalCO2Emissions).toBeGreaterThanOrEqual(0);
        expect(row.dataCoverage).toBe('synthetic');
        expect(row.transactionCount).toBe(5);
      }
    );
  });

  test('startup-scale profile (micro, low turnover) still produces bounded granular totals', async () => {
    const msmeData = {
      ...buildMsmeData(),
      companyType: 'micro',
      companyName: 'DeepTech Startup Labs',
      business: {
        annualTurnover: 2500000,
        numberOfEmployees: 12,
        manufacturingUnits: 1,
        primaryProducts: 'SaaS + edge hardware prototype'
      },
      manufacturingProfile: {
        ...buildMsmeData().manufacturingProfile,
        msmeType: 'Micro Enterprise',
        industrySector: 'electrical_machinery_parts',
        nicCode: '26511',
        numberOfEmployees: 12,
        plantAreaSqft: 3500,
        operationalDaysPerYear: 260,
        esgMaturityLevel: 'Nascent',
        digitalizationLevel: 'High',
        carbonAccountingPractice: 'None'
      }
    };

    const result = await granularCategoryEmissionsService.calculateGranularCategoryEmissions({
      msmeData,
      options: { includeOrchestration: false }
    });

    expect(result.totals.overallCO2Emissions).toBeGreaterThan(0);
    expect(result.totals.overallCO2Emissions).toBeLessThan(500000);
    expect(result.fineDetailSignals.employeeCount).toBe(12);
    expect(result.fineDetailSignals.annualTurnover).toBe(2500000);
  });

  test('historical annual bills match granular sub-sector via industrySector metadata', async () => {
    const industrySector = 'paper_products_printing';
    const historicalTx = {
      category: 'energy',
      subcategory: 'grid',
      amount: 15000,
      description: 'Annual electricity settlement — printing press',
      manufacturingProfile: { industrySector },
      metadata: { billType: 'annual_electricity' }
    };

    const result = await granularCategoryEmissionsService.calculateGranularCategoryEmissions({
      msmeData: buildMsmeData(),
      transactions: [historicalTx],
      options: { includeOrchestration: false }
    });

    const paperRow = result.detailedResults.manufacturing.find((r) => r.value === industrySector);
    expect(paperRow.dataCoverage).toBe('historical');
    expect(paperRow.historicalTransactionCount).toBe(1);
    expect(paperRow.syntheticTransactionCount).toBe(0);
    expect(paperRow.totalCO2Emissions).toBeGreaterThan(0);
  });

  test('historical transactions include sub-category emissions breakdown', async () => {
    const industrySector = 'metal_products';
    const historicalTx = [
      {
        category: 'transportation',
        amount: 8500,
        description: 'Freight and logistics charge for metal assembly shipment',
        manufacturingProfile: { industrySector }
      },
      {
        category: 'raw_materials',
        amount: 13200,
        description: 'Steel and copper purchase for fabrication batch',
        manufacturingProfile: { industrySector }
      }
    ];

    const result = await granularCategoryEmissionsService.calculateGranularCategoryEmissions({
      msmeData: buildMsmeData(),
      transactions: historicalTx,
      options: { includeOrchestration: false }
    });

    const metalRow = result.detailedResults.manufacturing.find((r) => r.value === industrySector);
    expect(metalRow).toBeDefined();
    expect(metalRow.dataCoverage).toBe('historical');
    expect(metalRow.breakdownByCategory.transportation.breakdownBySubcategory.freight_logistics).toBeDefined();
    expect(metalRow.breakdownByCategory.raw_materials.breakdownBySubcategory.metals).toBeDefined();
    expect(metalRow.precisionSignals.weightedAgentAccuracyScore).toBeGreaterThan(0);
  });

  test('includeSyntheticTransactions exposes per-row transactions for audit trail', async () => {
    const result = await granularCategoryEmissionsService.calculateGranularCategoryEmissions({
      msmeData: buildMsmeData(),
      options: {
        includeOrchestration: false,
        includeSyntheticTransactions: true
      }
    });

    expect(Array.isArray(result.simulationTransactions)).toBe(true);
    expect(result.simulationTransactions.length).toBe(result.totals.categoryCount * 5);
    const tagged = result.simulationTransactions.filter(
      (entry) => entry.categoryDetail === 'it_services' && entry.categoryType === 'services'
    );
    expect(tagged.length).toBe(5);
    expect(tagged[0].transaction.metadata?.granularCategory).toBe('it_services');
  });

  test('with orchestration enabled, forwards merged transactions and receives agent outputs', async () => {
    orchestrationManagerEventService.triggerOrchestration.mockResolvedValue({
      orchestrationId: 'orch_granular_test_1',
      warnings: [],
      orchestrationPlan: { stages: ['analyze'] },
      emissionsSummary: { total: 42 },
      valueChainReport: { summary: { totalTransactions: 190 } },
      agentOutputs: { recommendations: [{ title: 'Optimize grid load' }], report: { format: 'json' } }
    });

    const result = await granularCategoryEmissionsService.calculateGranularCategoryEmissions({
      msmeId: '507f1f77bcf86cd799439011',
      msmeData: buildMsmeData(),
      options: { includeOrchestration: true }
    });

    expect(orchestrationManagerEventService.triggerOrchestration).toHaveBeenCalledTimes(1);
    const callArg = orchestrationManagerEventService.triggerOrchestration.mock.calls[0][0];
    expect(callArg.triggerSource).toBe('granular_category_assessment');
    expect(callArg.transactions.length).toBe(result.totals.categoryCount * 5);
    expect(callArg.contextOverrides?.detailedCategoryComputation).toEqual(
      expect.objectContaining({
        includeHistorical: true,
        enableSyntheticBackfill: true,
        lookbackDays: 90
      })
    );
    expect(result.orchestration.orchestrationId).toBe('orch_granular_test_1');
    expect(result.orchestration.agentOutputs?.recommendations?.[0]?.title).toBe('Optimize grid load');
    expect(result.orchestration.plan).toEqual(expect.objectContaining({ stages: ['analyze'] }));
  });
});
