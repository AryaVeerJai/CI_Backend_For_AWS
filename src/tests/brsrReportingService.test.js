const { buildBRSRReport, normalizeScopeTotals } = require('../services/brsrReportingService');

describe('BRSR Reporting Service', () => {
  test('should build BRSR report with scope 1, 2 and 3 metrics', () => {
    const msme = {
      companyName: 'Green Metals MSME',
      companyType: 'small',
      industry: 'manufacturing',
      businessDomain: 'manufacturing',
      establishmentYear: 2016,
      udyamRegistrationNumber: 'UDYAM-GJ-01-1234567',
      gstNumber: '24ABCDE1234F1Z5',
      panNumber: 'ABCDE1234F',
      business: {
        annualTurnover: 50000000,
        numberOfEmployees: 120,
        manufacturingUnits: 2,
        primaryProducts: 'Steel components',
        solarPower: {
          installedCapacityKw: 120,
          annualGenerationKwh: 10000,
          annualUsageKwh: 7000
        }
      },
      contact: {
        address: {
          state: 'Gujarat',
          city: 'Ahmedabad',
          pincode: '380001',
          country: 'India'
        }
      },
      manufacturingProfile: {
        industrySector: 'basic_metal_industries',
        nicCode: '2410',
        operationalDaysPerYear: 300,
        plantAreaSqft: 22000,
        primaryEnergySource: 'grid_solar_hybrid',
        certifications: ['ISO 14001'],
        regulatoryExposure: ['CPCB', 'State PCB']
      },
      environmentalCompliance: {
        hasEnvironmentalClearance: true,
        hasPollutionControlBoard: true,
        hasWasteManagement: true
      }
    };

    const assessment = {
      period: {
        startDate: new Date('2025-04-01T00:00:00Z'),
        endDate: new Date('2026-03-31T23:59:59Z')
      },
      totalCO2Emissions: 1500,
      carbonScore: 78,
      esgScopes: {
        scope1: {
          total: 400,
          breakdown: {
            directFuel: 300,
            directTransport: 70,
            directManufacturing: 30
          }
        },
        scope2: {
          total: 500,
          breakdown: {
            electricity: 500
          }
        },
        scope3: {
          total: 600,
          breakdown: {
            purchasedGoods: 350,
            transportation: 170,
            wasteDisposal: 60,
            other: 20
          }
        }
      },
      breakdown: {
        energy: { electricity: 500, fuel: 400, total: 900 },
        water: { consumption: 12000, co2Emissions: 6 },
        waste: { solid: 50, hazardous: 20, total: 70 },
        transportation: { co2Emissions: 170 },
        materials: { co2Emissions: 350 }
      },
      recommendations: [{
        title: 'Switch to renewable energy',
        potentialCO2Reduction: 120,
        actualCO2Saved: 80,
        isImplemented: true,
        status: 'completed'
      }]
    };

    const transactions = [
      {
        category: 'energy',
        subcategory: 'renewable',
        transactionType: 'utility',
        amount: 25000,
        vendor: { name: 'Green Power Co' }
      },
      {
        category: 'raw_materials',
        subcategory: 'steel',
        transactionType: 'purchase',
        amount: 90000,
        vendor: { name: 'Steel Supplier Ltd' }
      },
      {
        category: 'transportation',
        subcategory: 'diesel',
        transactionType: 'transport',
        amount: 30000,
        vendor: { name: 'Fast Logistics' }
      }
    ];

    const report = buildBRSRReport({
      msme,
      assessment,
      assessmentHistory: [
        { totalCO2Emissions: 1700, period: { endDate: new Date('2025-12-31T23:59:59Z') } },
        { totalCO2Emissions: 1650, period: { endDate: new Date('2025-09-30T23:59:59Z') } }
      ],
      transactions,
      billAnnexure: [
        {
          _id: '6611b3f92a5f1b0123aa1101',
          originalName: 'Electricity_Bill_April_2025.pdf',
          documentType: 'bill',
          status: 'processed',
          createdAt: new Date('2025-04-05T09:30:00Z'),
          extractedData: { amount: 12500.55 }
        },
        {
          _id: '6611b3f92a5f1b0123aa1102',
          fileName: 'water_bill_may.pdf',
          documentType: 'bill',
          status: 'uploaded',
          createdAt: new Date('2025-05-06T10:45:00Z'),
          extractedData: { amount: 4300 }
        }
      ],
      carbonCreditsSummary: {
        earnedCredits: 120,
        availableCredits: 95,
        usedCredits: 15,
        retiredCredits: 10,
        transferredInCredits: 5,
        transferredOutCredits: 3
      },
      requestedPeriod: 'annual'
    });

    expect(report.reportType).toBe('BRSR');
    expect(report.framework).toBe('SEBI_BRSR');
    expect(report.environmental.greenhouseGasEmissions.scope1).toBe(400);
    expect(report.environmental.greenhouseGasEmissions.scope2).toBe(500);
    expect(report.environmental.greenhouseGasEmissions.scope3).toBe(600);
    expect(report.environmental.greenhouseGasEmissions.total).toBe(1500);
    expect(report.ghgInventoryBoundaries).toBeDefined();
    expect(report.ghgInventoryBoundaries.operationalBoundary.scope1SourcesIncluded).toEqual([]);
    expect(report.methodologyAndAssumptions.ghgInventoryBoundaries).toBeDefined();
    expect(report.valueChain).toBeDefined();
    expect(report.valueChain.summary.totalTransactions).toBe(3);
    expect(report.valueChain.summary.companyName).toBe('Green Metals MSME');
    expect(report.valueChain.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'upstream' }),
        expect.objectContaining({ stage: 'operations' }),
        expect.objectContaining({ stage: 'downstream' })
      ])
    );
    expect(report.compliance.disclosurePrepReady).toBe(true);
    expect(report.compliance.isBRSRCompliant).toBe(true);
    expect(report.templateMetadata.templateVariant).toContain('Principle 6');
    expect(report.msmeProfileDetailed.legalIdentity.udyamRegistrationNumber).toBe('UDYAM-GJ-01-1234567');
    expect(report.msmeProfileDetailed.businessProfile.employeeCount).toBe(120);
    expect(report.environmental.carbonSavings.netSavingsKgCO2e).toBeGreaterThan(0);
    expect(report.environmental.carbonCredits.availableCredits).toBe(95);
    expect(report.assuranceAndCompliance.overallStatus).toBe('aligned');
    expect(report.sectionC.environmentalPerformanceKpis.carbonCreditsAvailable).toBe(95);

    const principle6 = report.sectionC.principleWisePerformance.find(
      entry => entry.principle === 6
    );
    expect(principle6).toBeDefined();
    expect(principle6.indicators.scopeEmissions.scope1).toBe(400);
    expect(principle6.indicators.scopeEmissions.scope2).toBe(500);
    expect(principle6.indicators.scopeEmissions.scope3).toBe(600);
    expect(report.summary).toMatch(/BRSR Principle 6 prep ready/);
    expect(report.reportScope).toContain('Principle 6');
    expect(report.scope3Quality).toBeDefined();
    expect(report.reportReadiness?.reportReadinessLevel).toBeDefined();
    expect(report.brsrComplianceSummary.overallStatus).toBe('aligned');
    expect(report.brsrComplianceSummary.readinessScore).toBe(report.brsrComplianceSummary.disclosureReadinessPercent);
    const principle1 = report.sectionC.principleWisePerformance.find((entry) => entry.principle === 1);
    expect(principle1?.status).toBe('out_of_pack_scope');
    expect(report.compliance.templateAlignment.sectionB.status).toBe('complete');
    expect(report.environmental.solarPowerGenerationAndUsage.generationKwh).toBe(10000);
    expect(report.environmental.solarPowerGenerationAndUsage.usageKwh).toBe(7000);
    expect(report.environmental.solarPowerGenerationAndUsage.emissionReductionPotential.totalKgCO2e).toBe(7300);
    expect(report.environmental.solarPowerGenerationAndUsage.carbonCreditBenefits.eligibleForCarbonCreditBenefits).toBe(true);
    expect(report.environmental.solarPowerGenerationAndUsage.carbonCreditBenefits.estimatedCarbonCredits).toBe(730);
    expect(principle6.indicators.solarPowerGenerationAndUsage.eligibleForCarbonCreditBenefits).toBe(true);
    expect(principle6.indicators.solarPowerGenerationAndUsage.estimatedCarbonCredits).toBe(730);
    expect(report.environmental.hotspotMitigationPlan).toBeDefined();
    expect(Array.isArray(report.environmental.hotspotMitigationPlan.hotspots)).toBe(true);
    expect(report.environmental.hotspotMitigationPlan.hotspots.length).toBeGreaterThan(0);
    expect(report.environmental.hotspotMitigationPlan.prioritizedMitigations.length).toBeGreaterThan(0);
    expect(report.sectionC.environmentalPerformanceKpis.hotspotCount).toBeGreaterThan(0);
    expect(report.annexure).toBeDefined();
    expect(report.annexure.billsAttachedForReference.totalBillsAttached).toBe(2);
    expect(report.annexure.billsAttachedForReference.totalBillAmountINR).toBe(16800.55);
    expect(report.annexure.billsAttachedForReference.bills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serialNumber: 1,
          documentId: '6611b3f92a5f1b0123aa1101',
          fileName: 'Electricity_Bill_April_2025.pdf',
          documentType: 'bill',
          status: 'processed',
          amountINR: 12500.55
        }),
        expect.objectContaining({
          serialNumber: 2,
          documentId: '6611b3f92a5f1b0123aa1102',
          fileName: 'water_bill_may.pdf',
          documentType: 'bill',
          status: 'uploaded',
          amountINR: 4300
        })
      ])
    );
  });

  test('should not use residual scope3 without explicit esg scopes or allowResidual flag', () => {
    const scopeTotals = normalizeScopeTotals({
      totalCO2Emissions: 120,
      breakdown: {
        energy: {
          fuel: 30,
          electricity: 40
        }
      }
    });

    expect(scopeTotals.scope1).toBe(30);
    expect(scopeTotals.scope2).toBe(40);
    expect(scopeTotals.scope3).toBe(0);
    expect(scopeTotals.methodologicalWarning).toBeTruthy();
  });

  test('should allow residual scope3 only when explicitly opted in', () => {
    const scopeTotals = normalizeScopeTotals(
      {
        totalCO2Emissions: 120,
        breakdown: {
          energy: {
            fuel: 30,
            electricity: 40
          }
        }
      },
      { allowResidualScope3: true }
    );

    expect(scopeTotals.scope3).toBe(50);
    expect(scopeTotals.residualScope3Used).toBe(true);
  });

  test('should expose boundary completeness in compliance checklist when boundaries are configured', () => {
    const report = buildBRSRReport({
      msme: {
        companyName: 'Boundary Ready MSME',
        industry: 'manufacturing',
        businessDomain: 'manufacturing',
        gstNumber: '24ABCDE1234F1Z5',
        business: { annualTurnover: 1000000, numberOfEmployees: 10 },
        manufacturingProfile: {
          ghgOrganizationalBoundary: {
            consolidationApproach: 'operational_control',
            reportingEntityDescription: 'Single MSME legal entity with one manufacturing site in Pune.'
          }
        },
        operations: {
          ghgOperationalBoundary: {
            reportingPeriodType: 'financial_year',
            baseYear: 2024,
            scope1StationaryCombustion: true,
            scope2LocationBased: true,
            scope3CategoriesIncluded: [1, 2, 3, 4]
          }
        }
      },
      assessment: {
        period: {
          startDate: new Date('2025-04-01T00:00:00Z'),
          endDate: new Date('2026-03-31T23:59:59Z')
        },
        totalCO2Emissions: 100,
        esgScopes: {
          scope1: { total: 30 },
          scope2: { total: 40 },
          scope3: { total: 30 }
        },
        breakdown: {}
      },
      transactions: [],
      requestedPeriod: 'annual'
    });

    expect(report.compliance.mandatoryFields.organizationalBoundaryDocumented).toBe(true);
    expect(report.compliance.mandatoryFields.operationalBoundaryDocumented).toBe(true);
    expect(report.ghgInventoryBoundaries.completeness.boundariesReadyForBrsrPrinciple6).toBe(true);
  });

  test('should mark section B partial when governance signals are missing', () => {
    const report = buildBRSRReport({
      msme: {
        companyName: 'Partial Governance MSME',
        industry: 'manufacturing',
        businessDomain: 'manufacturing'
      },
      assessment: {
        totalCO2Emissions: 100,
        carbonScore: 0,
        breakdown: { energy: { total: 100 } }
      },
      transactions: [],
      requestedPeriod: 'annual'
    });

    expect(report.compliance.templateAlignment.sectionB.status).toBe('partial');
  });

  test('should mark BRSR compliance as incomplete when mandatory metadata is missing', () => {
    const report = buildBRSRReport({
      msme: {},
      assessment: {
        totalCO2Emissions: 0,
        breakdown: {}
      },
      transactions: [],
      requestedPeriod: 'annual'
    });

    expect(report.compliance.disclosurePrepReady).toBe(false);
    expect(report.compliance.isBRSRCompliant).toBe(false);
    expect(report.compliance.completenessScore).toBeLessThan(80);
    expect(report.valueChain.summary.totalTransactions).toBe(0);
    expect(report.valueChain.insights[0]).toMatch(/No transactions were available/i);
    expect(report.assuranceAndCompliance.overallStatus).toBe('needs_improvement');
  });

  describe('sector-specific annual reporting lifecycle (bills, emissions, hotspots, benefits)', () => {
    const baseAssessment = {
      period: {
        startDate: new Date('2025-04-01T00:00:00Z'),
        endDate: new Date('2026-03-31T23:59:59Z')
      },
      totalCO2Emissions: 900,
      carbonScore: 72,
      status: 'final',
      esgScopes: {
        scope1: { total: 200, breakdown: { directFuel: 200 } },
        scope2: { total: 400, breakdown: { electricity: 400 } },
        scope3: { total: 300, breakdown: { purchasedGoods: 200, transportation: 100 } }
      },
      breakdown: {
        energy: { electricity: 400, fuel: 200, total: 600 },
        water: { consumption: 5000, co2Emissions: 2 },
        waste: { solid: 20, hazardous: 5, total: 25 },
        transportation: { co2Emissions: 100 },
        materials: { co2Emissions: 173 }
      },
      recommendations: [
        {
          title: 'Shift peak load to off-grid solar',
          potentialCO2Reduction: 80,
          actualCO2Saved: 40,
          isImplemented: true,
          status: 'completed'
        }
      ]
    };

    const baseTransactions = [
      { category: 'energy', subcategory: 'grid', amount: 12000, description: 'Annual electricity' },
      { category: 'raw_materials', subcategory: 'general', amount: 45000, description: 'Purchased inputs' },
      { category: 'transportation', subcategory: 'diesel', amount: 8000, description: 'Logistics' }
    ];

    const baseBills = [
      {
        _id: '6611b3f92a5f1b0123aa3301',
        originalName: 'FY26_consolidated_utility_bills.pdf',
        documentType: 'bill',
        status: 'processed',
        createdAt: new Date('2026-03-28T12:00:00Z'),
        extractedData: { amount: 12000 }
      }
    ];

    const sectorCases = [
      {
        id: 'manufacturing_basic_metal',
        expectedPersona: 'manufacturing',
        msme: {
          companyName: 'Peenya Metal Fab MSME',
          companyType: 'small',
          industry: 'Manufacturing',
          businessDomain: 'manufacturing',
          establishmentYear: 2012,
          udyamRegistrationNumber: 'UDYAM-KA-03-7654321',
          gstNumber: '29ABCDE1234F1Z5',
          panNumber: 'ABCDE1234F',
          business: {
            annualTurnover: 45000000,
            numberOfEmployees: 95,
            manufacturingUnits: 1,
            primaryProducts: 'Fabricated metal structures',
            solarPower: {
              installedCapacityKw: 40,
              annualGenerationKwh: 5000,
              annualUsageKwh: 4000
            }
          },
          contact: {
            address: { state: 'Karnataka', city: 'Bengaluru', pincode: '560058', country: 'India' }
          },
          manufacturingProfile: {
            industrySector: 'basic_metal_industries',
            nicCode: '2511',
            operationalDaysPerYear: 300,
            esgMaturityLevel: 'Basic',
            carbonAccountingPractice: 'Developing'
          },
          environmentalCompliance: {
            hasEnvironmentalClearance: true,
            hasPollutionControlBoard: true,
            hasWasteManagement: true
          }
        }
      },
      {
        id: 'services_it_startup',
        expectedPersona: 'services_commerce',
        msme: {
          companyName: 'SaaS Startup Pvt Ltd',
          companyType: 'micro',
          industry: 'IT services startup',
          businessDomain: 'consulting',
          establishmentYear: 2023,
          udyamRegistrationNumber: 'UDYAM-DL-07-1234567',
          gstNumber: '07ABCDE1234F1Z5',
          panNumber: 'ABCDE1234F',
          business: {
            annualTurnover: 8000000,
            numberOfEmployees: 18,
            manufacturingUnits: 0,
            primaryProducts: 'B2B software subscriptions'
          },
          contact: {
            address: { state: 'Delhi', city: 'New Delhi', pincode: '110001', country: 'India' }
          },
          manufacturingProfile: {
            industrySector: 'it_services',
            nicCode: '62011',
            digitalizationLevel: 'Advanced',
            carbonAccountingPractice: 'None'
          },
          environmentalCompliance: {
            hasEnvironmentalClearance: false,
            hasPollutionControlBoard: false,
            hasWasteManagement: true
          }
        }
      },
      {
        id: 'food_processing_agrifood',
        expectedPersona: 'agrifood',
        msme: {
          companyName: 'Coastal Food Processing Udyog',
          companyType: 'small',
          industry: 'Food processing',
          businessDomain: 'food_processing',
          establishmentYear: 2018,
          udyamRegistrationNumber: 'UDYAM-TN-09-9876543',
          gstNumber: '33ABCDE1234F1Z5',
          panNumber: 'ABCDE1234F',
          business: {
            annualTurnover: 28000000,
            numberOfEmployees: 62,
            manufacturingUnits: 1,
            primaryProducts: 'Frozen marine products'
          },
          contact: {
            address: { state: 'Tamil Nadu', city: 'Tuticorin', pincode: '628001', country: 'India' }
          },
          manufacturingProfile: {
            industrySector: 'food_products_industry',
            nicCode: '1020',
            waterSource: 'Municipal + RO',
            wasteManagementPractice: 'Authorized cold-chain disposal'
          },
          environmentalCompliance: {
            hasEnvironmentalClearance: true,
            hasPollutionControlBoard: true,
            hasWasteManagement: true
          }
        }
      }
    ];

    test.each(sectorCases)(
      'BRSR pack for $id covers bills annexure, hotspots, recommendations, credits, and sector analytics',
      ({ msme, expectedPersona }) => {
        const report = buildBRSRReport({
          msme,
          assessment: baseAssessment,
          assessmentHistory: [{ totalCO2Emissions: 950, period: { endDate: new Date('2025-12-31T23:59:59Z') } }],
          transactions: baseTransactions,
          billAnnexure: baseBills,
          carbonCreditsSummary: {
            earnedCredits: 40,
            availableCredits: 30,
            usedCredits: 5,
            retiredCredits: 3,
            transferredInCredits: 2,
            transferredOutCredits: 1
          },
          requestedPeriod: 'annual'
        });

        expect(report.sectorCarbonAnalytics.sectorId).toBe(expectedPersona);
        expect(report.sectorCarbonAnalytics.industryContext.industrySector).toBe(
          msme.manufacturingProfile.industrySector
        );
        expect(report.annexure.billsAttachedForReference.totalBillsAttached).toBe(1);
        expect(report.annexure.billsAttachedForReference.totalBillAmountINR).toBe(12000);
        expect(report.environmental.greenhouseGasEmissions.total).toBe(900);
        expect(report.environmental.hotspotMitigationPlan.hotspots.length).toBeGreaterThan(0);
        expect(report.environmental.hotspotMitigationPlan.prioritizedMitigations[0]).toEqual(
          expect.objectContaining({
            priority: 1,
            mitigation: expect.any(String)
          })
        );
        expect(report.environmental.carbonSavings.recommendations.realizedSavingsKgCO2e).toBe(40);
        expect(report.environmental.carbonSavings.recommendations.potentialSavingsKgCO2e).toBe(80);
        expect(report.environmental.carbonCredits.estimatedMonetaryValueINR).toBe(1500);
        expect(report.sectionB.managementAndProcessDisclosures.governance.recommendationsCount).toBe(1);
        expect(report.sectionC.environmentalPerformanceKpis.hotspotCount).toBeGreaterThan(0);
        expect(report.valueChain.summary.totalTransactions).toBe(baseTransactions.length);
        expect(report.methodologyAndAssumptions).toEqual(
          expect.objectContaining({
            scopeAllocationSource: expect.any(String),
            gwpBasis: expect.stringContaining('AR5')
          })
        );
        expect(report.environmental.greenhouseGasEmissions.scopesExplicitlyMeasured).toBe(true);
      }
    );

    test('bill annexure includes OCR quality metadata', () => {
      const report = buildBRSRReport({
        msme: sectorCases[0].msme,
        assessment: baseAssessment,
        transactions: baseTransactions,
        billAnnexure: [{
          originalName: 'bill-scan.pdf',
          status: 'processed',
          extractedData: { amount: 5000 },
          processingResults: { confidence: 0.42, warnings: ['low quality'], errors: [] }
        }],
        requestedPeriod: 'annual'
      });

      const bill = report.annexure.billsAttachedForReference.bills[0];
      expect(bill.ocrConfidencePercent).toBe(42);
      expect(bill.dataQualityFlag).toBe('low');
      expect(bill.processingWarningCount).toBe(1);
    });

    test('normalizeScopeTotals blocks residual scope3 when scopes are not explicit', () => {
      const totals = normalizeScopeTotals({
        totalCO2Emissions: 1000,
        breakdown: {
          energy: {
            fuel: { co2Emissions: 300 },
            electricity: { co2Emissions: 400 }
          }
        }
      });
      expect(totals.scopesExplicitlyMeasured).toBe(false);
      expect(totals.scopeAllocationSource).toBe('incomplete_requires_explicit_scopes');
      expect(totals.scope3).toBe(0);
      expect(totals.methodologicalWarning).toBeTruthy();
    });
  });
});
