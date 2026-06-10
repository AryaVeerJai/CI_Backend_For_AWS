jest.mock('../services/fuelPriceService', () => ({
  getFuelPrices: jest.fn()
}));

const fuelPriceService = require('../services/fuelPriceService');
const CarbonCalculationService = require('../services/carbonCalculationService');

describe('Carbon Calculation Service', () => {
  let service;

  beforeEach(() => {
    service = CarbonCalculationService;
    fuelPriceService.getFuelPrices.mockReset();
  });

  describe('calculateTransactionCarbonFootprint', () => {
    test('should calculate energy emissions for grid electricity', () => {
      // Rs 8000 → 8000 / 8 = 1000 kWh × 0.8 = 800 kg CO2
      const transaction = {
        category: 'energy',
        amount: 8000, // Rs
        subcategory: 'grid',
        industry: 'manufacturing',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.co2Emissions).toBeCloseTo(885.6, 1); // (8000/8 * 0.82 CEA default) + 8% FERA
      expect(result.emissionFactor).toBeCloseTo(0.1107, 4);
      expect(result.feraSupplement).toEqual(expect.objectContaining({
        feraKg: 65.6,
        energyType: 'electricity'
      }));
      expect(result.calculationMethod).toBe('spend_proxy');
      expect(result.quantificationMethod).toBe('spend_proxy');
      expect(result.dataQualityTier).toBe('tier_2_spend_proxy');
    });

    test('should calculate energy emissions for renewable electricity', () => {
      // Rs 5000 → 5000 / 5 = 1000 kWh × 0.1 = 100 kg CO2
      const transaction = {
        category: 'energy',
        amount: 5000, // Rs
        subcategory: 'renewable',
        industry: 'manufacturing',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.co2Emissions).toBe(102); // (5000/5 * 0.1) + 2% renewable FERA
      expect(result.emissionFactor).toBeCloseTo(0.0204, 4);
    });

    test('should include transaction emission metrics in footprint output', () => {
      const transaction = {
        category: 'energy',
        amount: 1000,
        subcategory: 'grid',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.metrics).toBeDefined();
      expect(result.metrics.carbonIntensity).toBe(0.8);
      expect(result.metrics.emissionsPerThousandCurrency).toBeCloseTo(110.7, 1);
      expect(result.metrics.estimatedScope).toBe('scope2');
      expect(result.metrics.appliedFactors.location).toBe(1);
      expect(result.metrics.calculatedAt).toBeInstanceOf(Date);
    });

    test('should attach emissionBreakdown consistent with GHG scope classification', () => {
      const transaction = {
        category: 'energy',
        amount: 1000,
        subcategory: 'grid',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.emissionBreakdown).toBeDefined();
      expect(result.emissionBreakdown.scope1).toBe(0);
      expect(result.emissionBreakdown.scope3).toBeCloseTo(8.2, 2);
      expect(result.emissionBreakdown.scope2).toBeCloseTo(102.5, 2);
      expect(result.scope2Reporting).toBeDefined();
      expect(result.scope2Reporting.locationBasedKg).toBeCloseTo(102.5, 2);
      expect(result.factorLineage).toBeDefined();
      expect(result.factorLineage.source).toBeTruthy();
    });

    test('should use activity_based quantification when metered kWh is supplied', () => {
      const transaction = {
        category: 'energy',
        amount: 8000,
        subcategory: 'grid',
        quantity: 500,
        unit: 'kWh',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.quantificationMethod).toBe('activity_based');
      expect(result.dataQualityTier).toBe('tier_1_activity');
      expect(result.co2Emissions).toBeCloseTo(442.8, 1); // 500 kWh * 0.82 CEA default + 8% FERA
      expect(result.activityQuantity).toBe(500);
      expect(result.activityUnit).toBe('kwh');
    });

    test('should map scope 3 raw materials to GHG category cat1', () => {
      const transaction = {
        category: 'raw_materials',
        amount: 3000,
        subcategory: 'metals',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.emissionBreakdown.scope3).toBeGreaterThan(0);
      expect(result.ghgScope3Category).toBe('cat1_purchased_goods');
    });

    test('should apply utilities-specific spend factors for telecom subcategory', () => {
      const transaction = {
        category: 'utilities',
        amount: 10000,
        subcategory: 'telecom',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.emissionBreakdown.scope3).toBeGreaterThan(0);
      expect(result.co2Emissions).toBeCloseTo(4.86, 2);
    });

    test('should detect SMS-style recharge copy in generic spend path', () => {
      const transaction = {
        category: 'other',
        amount: 5000,
        subcategory: 'general',
        description: 'Rs.5000 debited via UPI for Jio prepaid recharge',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.co2Emissions).toBeCloseTo(2.1, 2);
    });

    test('should enrich pre-computed footprints with derived metrics', () => {
      const transaction = {
        category: 'other',
        subcategory: 'general',
        amount: 500,
        currency: 'INR',
        description: 'Service fee payment'
      };

      const result = service.ensureCarbonFootprintMetrics(transaction, {
        co2Emissions: 25,
        emissionFactor: 0.05,
        calculationMethod: 'document_itemized'
      });

      expect(result.co2Emissions).toBe(25);
      expect(result.emissionFactor).toBe(0.05);
      expect(result.metrics).toBeDefined();
      expect(result.metrics.emissionsPerThousandCurrency).toBe(50);
      expect(result.metrics.estimatedScope).toBe('scope3');
      expect(result.emissionBreakdown.scope3).toBe(25);
      expect(result.emissionBreakdown.scope1).toBe(0);
      expect(result.emissionBreakdown.scope2).toBe(0);
    });

    test('should calculate fuel emissions for diesel', () => {
      // Rs 2500 → 2500 / 90 = 27.778 liters × 2.68 = 74.44 kg CO2
      const transaction = {
        category: 'transportation',
        amount: 2500, // Rs
        subcategory: 'diesel',
        industry: 'manufacturing',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.co2Emissions).toBeCloseTo(74.44, 0); // ~74 kg for Rs 2500 diesel
      expect(result.emissionFactor).toBeCloseTo(0.0298, 3);
    });

    test('should calculate water emissions', () => {
      // Rs 500 → 500 / 0.5 = 1000 liters × 0.0004 = 0.4 kg CO2 (aligned with shared/carbonEmissionDefaults.json)
      const transaction = {
        category: 'water',
        amount: 500, // Rs
        industry: 'manufacturing',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.co2Emissions).toBe(0.4);
      expect(result.emissionFactor).toBe(0.0008);
    });

    test('should use metered kWh for electricity when quantity and unit are provided', () => {
      const transaction = {
        category: 'energy',
        amount: 8000,
        subcategory: 'grid',
        quantity: 400,
        unit: 'kWh',
        industry: 'manufacturing',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);
      expect(result.co2Emissions).toBeCloseTo(354.24, 2); // 400 kWh × 0.82 CEA default + 8% FERA
    });

    test('should exclude salary-like financial flows from emissions', () => {
      const transaction = {
        category: 'other',
        amount: 85000,
        description: 'Salary credited for March',
        industry: 'services',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);
      expect(result.co2Emissions).toBe(0);
      expect(result.calculationMethod).toBe('excluded_non_emitting_financial_flow');
    });

    test('should calculate waste emissions for solid waste', () => {
      // Rs 150 → 150 / 3 = 50 kg × 0.5 = 25 kg CO2
      const transaction = {
        category: 'waste_management',
        amount: 150, // Rs
        subcategory: 'solid',
        industry: 'manufacturing',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.co2Emissions).toBe(25); // 150/3 * 0.5
      expect(result.emissionFactor).toBeCloseTo(0.1667, 3);
    });

    test('should calculate waste emissions for hazardous waste', () => {
      // Rs 1250 → 1250 / 25 = 50 kg × 2.0 = 100 kg CO2
      const transaction = {
        category: 'waste_management',
        amount: 1250, // Rs
        description: 'hazardous waste disposal',
        industry: 'manufacturing',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.co2Emissions).toBe(100); // 1250/25 * 2.0
      expect(result.emissionFactor).toBe(0.08); // 100/1250
    });

    test('should calculate material emissions for steel', () => {
      // Rs 70000 → 70000 / 70 = 1000 kg × 1.85 = 1850 kg CO2
      const transaction = {
        category: 'raw_materials',
        amount: 70000, // Rs
        subcategory: 'steel',
        industry: 'manufacturing',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.co2Emissions).toBe(1850); // 70000/70 * 1.85
      expect(result.emissionFactor).toBeCloseTo(0.0264, 3);
    });

    test('should not apply sustainability composite adjustments in compliance mode', () => {
      const transaction = {
        category: 'energy',
        amount: 8000,
        subcategory: 'grid',
        industry: 'manufacturing',
        sustainability: { isGreen: true, greenScore: 80 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.co2Emissions).toBeCloseTo(885.6, 1);
      expect(result.reportingMode).toBe('compliance');
    });

    test('should not apply industry composite adjustments in compliance mode', () => {
      const transaction = {
        category: 'energy',
        amount: 8000,
        subcategory: 'grid',
        industry: 'chemicals',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.co2Emissions).toBeCloseTo(885.6, 1);
    });

    test('should not apply manufacturing profile composite adjustments in compliance mode', () => {
      const transaction = {
        category: 'energy',
        amount: 8000,
        subcategory: 'grid',
        industry: 'manufacturing',
        businessDomain: 'manufacturing',
        sustainability: { isGreen: false, greenScore: 0 },
        manufacturingProfile: {
          primaryEnergySource: 'Grid Electricity',
          backupEnergySource: 'Diesel Generator',
          mainFuelsUsed: ['Diesel', 'LPG'],
          operationalDaysPerYear: 300,
          esgMaturityLevel: 'Basic',
          digitalizationLevel: 'Moderate',
          carbonAccountingPractice: 'None',
          certifications: ['ISO 9001']
        }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.adjustmentCompositeCapped).toBe(1);
      expect(result.co2Emissions).toBeCloseTo(885.6, 1);
    });

    test('should not vary emissions by ZED certification in compliance mode', () => {
      const baseTransaction = {
        category: 'energy',
        amount: 8000,
        subcategory: 'grid',
        industry: 'manufacturing',
        businessDomain: 'manufacturing',
        sustainability: { isGreen: false, greenScore: 0 },
        manufacturingProfile: {
          primaryEnergySource: 'Grid Electricity',
          operationalDaysPerYear: 300,
          certifications: ['ISO 9001']
        }
      };

      const baseline = service.calculateTransactionCarbonFootprint(baseTransaction);
      const gold = service.calculateTransactionCarbonFootprint({
        ...baseTransaction,
        manufacturingProfile: {
          ...baseTransaction.manufacturingProfile,
          certifications: ['ZED Gold']
        }
      });

      expect(gold.co2Emissions).toBeCloseTo(baseline.co2Emissions, 1);
    });

    test('should exclude sales vouchers in compliance reporting mode', () => {
      const transaction = {
        category: 'other',
        amount: 500000,
        voucherType: 'Sales',
        description: 'Finished goods sales invoice',
        industry: 'manufacturing'
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.co2Emissions).toBe(0);
      expect(result.exclusionReason).toBe('revenue_or_sales_non_emitting');
    });

    test('should not apply composite multipliers in compliance reporting mode', () => {
      const transaction = {
        category: 'energy',
        amount: 8000,
        subcategory: 'grid',
        industry: 'chemicals',
        businessDomain: 'manufacturing',
        state: 'Karnataka',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.co2Emissions).toBeCloseTo(766.8, 1); // 710 direct + 8% FERA
      expect(result.adjustmentCompositeCapped).toBe(1);
      expect(result.reportingMode).toBe('compliance');
      expect(result.feraSupplement.feraKg).toBeCloseTo(56.8, 1);
    });

    test('should apply regional CEA grid factor in compliance mode when state is known', () => {
      const transaction = {
        category: 'energy',
        amount: 800,
        subcategory: 'grid',
        quantity: 100,
        unit: 'kWh',
        state: 'Karnataka',
        industry: 'manufacturing'
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.co2Emissions).toBeCloseTo(76.68, 2); // 71 direct + 8% FERA
      expect(result.reportingMode).toBe('compliance');
    });

    test('should strip GST for spend-proxy when net amount and GST are provided', () => {
      const transaction = {
        category: 'energy',
        amount: 1180,
        amountInr: 1000,
        gstAmount: 180,
        gstPercent: 18,
        netAmountInr: 1180,
        subcategory: 'grid',
        industry: 'manufacturing'
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.co2Emissions).toBeCloseTo(110.7, 1); // pre-tax 1000 → 125 kWh * 0.82 + 8% FERA
      expect(result.complianceFlags).toContain('gst_stripped_for_spend_proxy');
      expect(result.taxableAmountMeta.source).toBe('amountInr');
    });

    test('should model FERA as scope 3 cat3 for purchased electricity', () => {
      const transaction = {
        category: 'energy',
        amount: 800,
        subcategory: 'grid',
        quantity: 100,
        unit: 'kWh',
        state: 'Karnataka'
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.feraSupplement).toEqual(expect.objectContaining({
        ghgScope3Category: 'cat3_fuel_energy_related'
      }));
      expect(result.emissionBreakdown.scope2).toBeCloseTo(71, 2);
      expect(result.emissionBreakdown.scope3).toBeCloseTo(5.68, 2);
      expect(result.ghgScope3Category).toBe('cat3_fuel_energy_related');
    });

    test('should always model FERA in compliance inventory mode', () => {
      const transaction = {
        category: 'energy',
        amount: 8000,
        subcategory: 'grid',
        industry: 'manufacturing'
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.feraSupplement).not.toBeNull();
      expect(result.co2Emissions).toBeCloseTo(885.6, 1);
      expect(result.reportingMode).toBe('compliance');
    });

    test('should classify unowned transportation fuel as scope 3', () => {
      const transaction = {
        category: 'transportation',
        amount: 2500,
        subcategory: 'diesel',
        industry: 'manufacturing'
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.metrics.estimatedScope).toBe('scope3');
      expect(result.emissionBreakdown.scope3).toBeGreaterThan(0);
      expect(result.emissionBreakdown.scope1).toBe(0);
    });

    test('should calculate fuel combustion for energy diesel transactions', () => {
      const transaction = {
        category: 'energy',
        subcategory: 'diesel',
        quantity: 50,
        unit: 'liter',
        amount: 4500, // INR spend; the metered 50 L volume drives the combustion calc
        industry: 'manufacturing',
        sustainability: { isGreen: false, greenScore: 0 }
      };

      const result = service.calculateTransactionCarbonFootprint(transaction);

      expect(result.co2Emissions).toBeCloseTo(158.12, 2); // 50 L * 2.68 + 18% fuel FERA
      expect(result.metrics.fuelContext).toEqual(expect.objectContaining({
        fuelType: 'diesel',
        fuelEmissionFactor: 2.68
      }));
    });
  });

  describe('calculateTransactionCarbonFootprintForAgent', () => {
    test('should use live fuel price mapped from MSME state', async () => {
      fuelPriceService.getFuelPrices.mockResolvedValue({
        source: {
          authority: 'PPAC'
        },
        lastUpdated: '24-Feb-26',
        location: {
          name: 'Mumbai',
          petrol: 104,
          diesel: 95
        }
      });

      const transaction = {
        category: 'transportation',
        amount: 9500, // INR
        subcategory: 'diesel',
        currency: 'INR',
        description: 'Diesel fuel purchase'
      };

      const result = await service.calculateTransactionCarbonFootprintForAgent(transaction, {
        msmeData: {
          contact: {
            address: {
              state: 'Maharashtra'
            }
          }
        }
      });

      expect(fuelPriceService.getFuelPrices).toHaveBeenCalledWith({
        location: 'Mumbai',
        days: 2
      });
      expect(result.co2Emissions).toBeCloseTo((9500 / 95) * 2.68, 2);
      expect(result.metrics.fuelContext).toEqual(expect.objectContaining({
        source: 'ppac_live',
        location: 'Mumbai',
        fuelPricePerLiter: 95,
        fuelType: 'diesel'
      }));
    });

    test('should cache fuel price lookups inside shared runtime context', async () => {
      fuelPriceService.getFuelPrices.mockResolvedValue({
        source: {
          authority: 'PPAC'
        },
        lastUpdated: '24-Feb-26',
        location: {
          name: 'Delhi',
          petrol: 95,
          diesel: 88
        }
      });

      const runtimeContext = {
        msmeData: {
          contact: {
            address: {
              state: 'Delhi'
            }
          }
        }
      };

      const first = await service.calculateTransactionCarbonFootprintForAgent({
        category: 'transportation',
        amount: 8800,
        subcategory: 'diesel',
        currency: 'INR'
      }, runtimeContext);

      const second = await service.calculateTransactionCarbonFootprintForAgent({
        category: 'transportation',
        amount: 17600,
        subcategory: 'diesel',
        currency: 'INR'
      }, runtimeContext);

      expect(fuelPriceService.getFuelPrices).toHaveBeenCalledTimes(1);
      expect(first.co2Emissions).toBeCloseTo((8800 / 88) * 2.68, 2);
      expect(second.co2Emissions).toBeCloseTo((17600 / 88) * 2.68, 2);
    });

    test('should apply verified-source RAG emission factor for generic categories', async () => {
      const transaction = {
        category: 'other',
        amount: 1000,
        metadata: {
          ragClassification: {
            retrievalMethod: 'verified_registry_rag',
            emissionFactor: {
              value: 0.00268
            }
          }
        }
      };

      const result = await service.calculateTransactionCarbonFootprintForAgent(transaction, {});

      expect(result.co2Emissions).toBeCloseTo(2.68, 4);
      expect(result.metrics.appliedFactors.ragEmissionFactor).toBeCloseTo(0.00268, 6);
      expect(result.metrics.ragClassification).toBeTruthy();
    });
  });

  describe('calculateMSMECarbonFootprint', () => {
    test('should calculate complete MSME carbon footprint', () => {
      const msmeData = {
        companyType: 'micro',
        industry: 'manufacturing',
        environmentalCompliance: {
          hasEnvironmentalClearance: true,
          hasPollutionControlBoard: true,
          hasWasteManagement: true
        }
      };

      // Using Rs amounts that produce the same physical quantities as original test
      const transactions = [
        {
          // Rs 8000 → 8000/8 = 1000 kWh × 0.8 = 800 kg CO2
          category: 'energy',
          amount: 8000,
          subcategory: 'grid',
          industry: 'manufacturing',
          sustainability: { isGreen: false, greenScore: 0 }
        },
        {
          // Rs 250 → 250/0.5 = 500 liters × 0.0004 = 0.2 kg CO2
          category: 'water',
          amount: 250,
          industry: 'manufacturing',
          sustainability: { isGreen: false, greenScore: 0 }
        },
        {
          // Rs 300 → 300/3 = 100 kg × 0.5 = 50 kg CO2
          category: 'waste_management',
          amount: 300,
          subcategory: 'solid',
          industry: 'manufacturing',
          sustainability: { isGreen: false, greenScore: 0 }
        }
      ];

      const result = service.calculateMSMECarbonFootprint(msmeData, transactions);

      expect(result.totalCO2Emissions).toBeCloseTo(935.8, 1); // 885.6 energy (incl. FERA) + 0.2 + 50
      expect(result.breakdown.energy.total).toBeCloseTo(885.6, 1);
      expect(result.breakdown.water.co2Emissions).toBeCloseTo(0.2, 5);
      expect(result.breakdown.waste.total).toBe(50);
      expect(result.carbonScore).toBeGreaterThan(0);
      expect(result.recommendations).toBeDefined();
      expect(result.inventoryMetadata).toBeDefined();
      expect(result.inventoryMetadata.completenessScore).toBeGreaterThan(0);
      expect(result.inventoryMetadata.scopeTotals.scope2LocationBased).toBeGreaterThan(0);
    });

    test('should exclude transactions outside operational boundary configuration', () => {
      const msmeData = {
        companyType: 'micro',
        industry: 'manufacturing',
        operations: {
          ghgOperationalBoundary: {
            reportingPeriodType: 'financial_year',
            baseYear: 2024,
            scope1StationaryCombustion: false,
            scope1MobileCombustion: true,
            scope1ProcessEmissions: false,
            scope1FugitiveEmissions: true,
            scope2LocationBased: true,
            scope2MarketBased: false,
            scope3CategoriesIncluded: [1, 2, 3, 4, 5, 6, 7, 12, 13]
          }
        }
      };

      const transactions = [
        {
          category: 'energy',
          amount: 8000,
          subcategory: 'grid',
          industry: 'manufacturing'
        },
        {
          category: 'energy',
          amount: 5000,
          subcategory: 'diesel',
          description: 'On-site diesel generator fuel',
          industry: 'manufacturing'
        }
      ];

      const result = service.calculateMSMECarbonFootprint(msmeData, transactions);

      expect(result.boundaryGovernance.excludedTransactionCount).toBe(1);
      expect(result.boundaryGovernance.excludedSummary[0].reason).toBe('scope1_out_of_operational_boundary');
      expect(result.esgScopes.scope2.total).toBeCloseTo(820, 1);
      expect(result.esgScopes.scope1.total).toBe(0);
      expect(result.esgScopes.scope3.total).toBeCloseTo(65.6, 1);
      expect(result.totalCO2Emissions).toBeCloseTo(885.6, 1);
    });

    test('should calculate ESG scope breakdown', () => {
      const msmeData = {
        companyType: 'micro',
        industry: 'manufacturing',
        environmentalCompliance: {
          hasEnvironmentalClearance: false,
          hasPollutionControlBoard: false,
          hasWasteManagement: false
        }
      };

      const transactions = [
        {
          // Rs 8000 → 8000/8 = 1000 kWh × 0.8 = 800 kg CO2
          category: 'energy',
          amount: 8000,
          subcategory: 'grid',
          industry: 'manufacturing',
          sustainability: { isGreen: false, greenScore: 0 }
        },
        {
          // Rs 35000 → 35000/70 = 500 kg × 1.85 = 925 kg CO2
          category: 'raw_materials',
          amount: 35000,
          subcategory: 'steel',
          industry: 'manufacturing',
          sustainability: { isGreen: false, greenScore: 0 }
        }
      ];

      const result = service.calculateMSMECarbonFootprint(msmeData, transactions);

      expect(result.esgScopes.scope1.total).toBe(0); // No direct emissions
      expect(result.esgScopes.scope2.total).toBeCloseTo(820, 1); // Grid electricity direct
      expect(result.esgScopes.scope3.total).toBeCloseTo(990.6, 1); // 925 materials + 65.6 FERA
      expect(result.esgScopes.scope3.ghgCategories?.cat1_purchased_goods).toBe(925);
      expect(result.esgScopes.scope3.ghgCategories?.cat3_fuel_energy_related).toBeCloseTo(65.6, 1);
    });
  });

  describe('calculateCarbonSavings', () => {
    test('should calculate period savings', () => {
      const msmeData = {
        industry: 'manufacturing',
        companyType: 'micro'
      };

      const currentAssessment = {
        totalCO2Emissions: 1000,
        breakdown: {
          energy: { total: 500 },
          water: { total: 100 },
          waste: { total: 200 },
          transportation: { total: 100 },
          materials: { total: 50 },
          manufacturing: { total: 50 }
        },
        recommendations: [
          { isImplemented: true, potentialCO2Reduction: 100 },
          { isImplemented: false, potentialCO2Reduction: 200 }
        ]
      };

      const previousAssessment = {
        totalCO2Emissions: 1500,
        breakdown: {
          energy: { total: 800 },
          water: { total: 150 },
          waste: { total: 300 },
          transportation: { total: 150 },
          materials: { total: 50 },
          manufacturing: { total: 50 }
        }
      };

      const result = service.calculateCarbonSavings(msmeData, currentAssessment, previousAssessment);

      expect(result.periodSavings).toBe(500); // 1500 - 1000
      expect(result.savingsPercentage).toBeCloseTo(33.33, 2); // (500/1500) * 100
      expect(result.totalSavings).toBe(500);
      expect(result.implementedRecommendations).toBe(1);
      expect(result.potentialSavings).toBe(200);
    });

    test('should calculate category-wise savings', () => {
      const msmeData = {
        industry: 'manufacturing',
        companyType: 'micro'
      };

      const currentAssessment = {
        totalCO2Emissions: 1000,
        breakdown: {
          energy: { total: 500 },
          water: { total: 100 },
          waste: { total: 200 },
          transportation: { total: 100 },
          materials: { total: 50 },
          manufacturing: { total: 50 }
        },
        recommendations: []
      };

      const previousAssessment = {
        totalCO2Emissions: 1500,
        breakdown: {
          energy: { total: 800 },
          water: { total: 150 },
          waste: { total: 300 },
          transportation: { total: 150 },
          materials: { total: 50 },
          manufacturing: { total: 50 }
        }
      };

      const result = service.calculateCarbonSavings(msmeData, currentAssessment, previousAssessment);

      expect(result.categorySavings.energy).toBe(300); // 800 - 500
      expect(result.categorySavings.water).toBe(50); // 150 - 100
      expect(result.categorySavings.waste).toBe(100); // 300 - 200
    });
  });

  describe('generateRecommendations', () => {
    test('should generate energy recommendations for high energy usage', () => {
      const msmeData = {
        industry: 'manufacturing',
        companyType: 'micro'
      };

      const assessment = {
        totalCO2Emissions: 1000,
        breakdown: {
          energy: { total: 600 },
          water: { total: 100 },
          waste: { total: 100 },
          transportation: { total: 100 },
          materials: { total: 50 },
          manufacturing: { total: 50 }
        }
      };

      const recommendations = service.generateRecommendations(assessment, msmeData);

      const energyRecommendation = recommendations.find((entry) => entry.title === 'Switch to Renewable Energy');
      expect(energyRecommendation).toBeDefined();
      expect(energyRecommendation.category).toBe('energy');
      expect(energyRecommendation.priority).toBe('high');
    });

    test('should generate waste recommendations for high waste emissions', () => {
      const msmeData = {
        industry: 'manufacturing',
        companyType: 'micro'
      };

      const assessment = {
        totalCO2Emissions: 1000,
        breakdown: {
          energy: { total: 200 },
          water: { total: 100 },
          waste: { total: 150 },
          transportation: { total: 100 },
          materials: { total: 200 },
          manufacturing: { total: 250 }
        }
      };

      const recommendations = service.generateRecommendations(assessment, msmeData);

      const wasteRecommendation = recommendations.find((entry) => entry.title === 'Improve Waste Recycling');
      expect(wasteRecommendation).toBeDefined();
      expect(wasteRecommendation.category).toBe('waste');
    });
  });

  describe('getIndustryBenchmarks', () => {
    test('should return correct benchmarks for manufacturing micro enterprise', () => {
      const benchmarks = service.getIndustryBenchmarks('manufacturing', 'micro');

      expect(benchmarks.average).toBe(3.0); // 2.5 * 1.2
      expect(benchmarks.bestInClass).toBe(1.44); // 1.2 * 1.2
    });

    test('should return correct benchmarks for chemicals small enterprise', () => {
      const benchmarks = service.getIndustryBenchmarks('chemicals', 'small');

      expect(benchmarks.average).toBe(4.5); // 4.5 * 1.0
      expect(benchmarks.bestInClass).toBe(2.8); // 2.8 * 1.0
    });
  });

  describe('getManufacturingSectorComplianceProfile', () => {
    const sectorComplianceCases = [
      {
        sector: 'Steel & Metals',
        expected: {
          sectorKey: 'steel_and_metals',
          sector: 'Steel & Metals',
          complianceLevel: 'high',
          complianceLabel: '🔴 High',
          sustainowPriority: 5,
          sustainowPriorityLabel: '⭐⭐⭐⭐⭐'
        }
      },
      {
        sector: 'Cement & Materials',
        expected: {
          sectorKey: 'cement_and_materials',
          sector: 'Cement & Materials',
          complianceLevel: 'high',
          complianceLabel: '🔴 High',
          sustainowPriority: 5,
          sustainowPriorityLabel: '⭐⭐⭐⭐⭐'
        }
      },
      {
        sector: 'Chemicals',
        expected: {
          sectorKey: 'chemicals',
          sector: 'Chemicals',
          complianceLevel: 'high',
          complianceLabel: '🔴 High',
          sustainowPriority: 4,
          sustainowPriorityLabel: '⭐⭐⭐⭐'
        }
      },
      {
        sector: 'Textiles (wet)',
        expected: {
          sectorKey: 'textiles_wet',
          sector: 'Textiles (wet)',
          complianceLevel: 'high',
          complianceLabel: '🔴 High',
          sustainowPriority: 4,
          sustainowPriorityLabel: '⭐⭐⭐⭐'
        }
      },
      {
        sector: 'Engineering MSMEs',
        expected: {
          sectorKey: 'engineering_msmes',
          sector: 'Engineering MSMEs',
          complianceLevel: 'medium',
          complianceLabel: '🟠 Medium',
          sustainowPriority: 5,
          sustainowPriorityLabel: '⭐⭐⭐⭐⭐'
        }
      },
      {
        sector: 'Food processing',
        expected: {
          sectorKey: 'food_processing',
          sector: 'Food processing',
          complianceLevel: 'medium',
          complianceLabel: '🟠 Medium',
          sustainowPriority: 3,
          sustainowPriorityLabel: '⭐⭐⭐'
        }
      },
      {
        sector: 'Plastics',
        expected: {
          sectorKey: 'plastics',
          sector: 'Plastics',
          complianceLevel: 'medium',
          complianceLabel: '🟠 Medium',
          sustainowPriority: 3,
          sustainowPriorityLabel: '⭐⭐⭐'
        }
      },
      {
        sector: 'Electronics',
        expected: {
          sectorKey: 'electronics',
          sector: 'Electronics',
          complianceLevel: 'low',
          complianceLabel: '🟢 Low',
          sustainowPriority: 2,
          sustainowPriorityLabel: '⭐⭐'
        }
      }
    ];

    test.each(sectorComplianceCases)(
      'should return compliance profile for $sector',
      ({ sector, expected }) => {
        const profile = service.getManufacturingSectorComplianceProfile(sector, 'manufacturing');

        expect(profile).toEqual(expected);
      }
    );

    test('should return null for unsupported sector', () => {
      const profile = service.getManufacturingSectorComplianceProfile('Pharmaceuticals', 'manufacturing');
      expect(profile).toBeNull();
    });

    test('should return null outside manufacturing domain', () => {
      const profile = service.getManufacturingSectorComplianceProfile('Steel & Metals', 'services');
      expect(profile).toBeNull();
    });
  });

  describe('calculatePerformanceLevel', () => {
    test('should return excellent for low emissions', () => {
      const performance = service.calculatePerformanceLevel(100, { average: 200, bestInClass: 100 });
      expect(performance).toBe('excellent');
    });

    test('should return good for below average emissions', () => {
      const performance = service.calculatePerformanceLevel(150, { average: 200, bestInClass: 100 });
      expect(performance).toBe('good');
    });

    test('should return average for average emissions', () => {
      const performance = service.calculatePerformanceLevel(200, { average: 200, bestInClass: 100 });
      expect(performance).toBe('average');
    });

    test('should return poor for high emissions', () => {
      const performance = service.calculatePerformanceLevel(300, { average: 200, bestInClass: 100 });
      expect(performance).toBe('poor');
    });
  });

  describe('generateAchievements', () => {
    test('should generate carbon reduction achievements', () => {
      const msmeData = {
        industry: 'manufacturing',
        companyType: 'micro'
      };

      const savings = {
        savingsPercentage: 25,
        periodSavings: 500,
        implementedRecommendations: 3
      };

      const assessment = {
        carbonScore: 85
      };

      const achievements = service.generateAchievements(savings, assessment, msmeData);

      expect(achievements).toHaveLength(3);
      expect(achievements[0].type).toBe('carbon_reduction');
      expect(achievements[0].title).toBe('Carbon Reduction Champion');
      expect(achievements[0].level).toBe('gold');
    });
  });

  describe('generateNextMilestones', () => {
    test('should generate appropriate milestones', () => {
      const msmeData = {
        industry: 'manufacturing',
        companyType: 'micro'
      };

      const savings = {
        savingsPercentage: 15,
        implementedRecommendations: 2
      };

      const assessment = {
        carbonScore: 75
      };

      const milestones = service.generateNextMilestones(savings, assessment, msmeData);

      expect(milestones).toHaveLength(3);
      expect(milestones[0].type).toBe('carbon_reduction');
      expect(milestones[0].targetValue).toBe(20);
      expect(milestones[1].type).toBe('recommendations');
      expect(milestones[1].targetValue).toBe(4);
      expect(milestones[2].type).toBe('score');
      expect(milestones[2].targetValue).toBe(85);
    });
  });

  describe('resolveCurrentCarbonScore', () => {
    test('derives score from live transactions when assessment score is zero', () => {
      const msmeData = { annualTurnover: 5000000 };
      const periodTransactions = [
        { amount: 10000, carbonFootprint: { co2Emissions: 250 } },
        { amount: 5000, carbonFootprint: { co2Emissions: 120 } }
      ];

      const score = service.resolveCurrentCarbonScore({
        enrichedLatestAssessment: null,
        latestAssessment: null,
        msmeData,
        totalCO2Emissions: 370,
        periodTransactions
      });

      expect(score).toBeGreaterThan(0);
    });

    test('recalculates stored zero score from enriched assessment', () => {
      const msmeData = { annualTurnover: 2000000 };
      const enrichedLatestAssessment = {
        carbonScore: 0,
        totalCO2Emissions: 500,
        totalAmount: 20000,
        totalSpend: 20000,
        breakdown: {}
      };

      const score = service.resolveCurrentCarbonScore({
        enrichedLatestAssessment,
        latestAssessment: enrichedLatestAssessment,
        msmeData,
        totalCO2Emissions: 500,
        periodTransactions: []
      });

      expect(score).toBeGreaterThan(0);
    });
  });
});
