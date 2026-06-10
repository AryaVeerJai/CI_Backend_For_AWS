const {
  assessScope3Quality,
  assessCbamSubmissionReadiness,
  enrichCbamGoodsWithTiers,
  buildSebiBrsrExport,
  buildBrsrXbrlSkeleton,
  buildCbamRegistryCsv,
  validateCompliancePack,
  mapCbamDataQualityToTier,
  resolveCbamComplianceStatus
} = require('../services/reportStandardsExportService');

describe('reportStandardsExportService', () => {
  test('assessScope3Quality flags residual scope 3', () => {
    const result = assessScope3Quality({
      scopeTotals: {
        scope3: 100,
        residualScope3Used: true,
        scopesExplicitlyMeasured: { scope3: false }
      },
      assessment: { breakdown: { materials: { co2Emissions: 10 } } }
    });
    expect(result.residualScope3Used).toBe(true);
    expect(result.assuranceGradeReady).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('maps CBAM data quality to EU tiers', () => {
    expect(mapCbamDataQualityToTier('primary')).toBe('tier1');
    expect(mapCbamDataQualityToTier('estimated')).toBe('tier2');
  });

  test('blocks CBAM On Track when only tier 2/3 data present', () => {
    const goods = enrichCbamGoodsWithTiers([
      { id: 'steel', name: 'Steel', hsCode: '7208', dataQuality: 'estimated', exportVolumeTonnes: 10, embeddedEmissions: 5 }
    ]);
    const readiness = assessCbamSubmissionReadiness({
      goods,
      documentation: [{ status: 'complete' }, { status: 'complete' }],
      overview: { readinessScore: 90 }
    });
    expect(readiness.tierSummary.tier1Count).toBe(0);
    expect(readiness.filingReady).toBe(false);
    const status = resolveCbamComplianceStatus({
      isExporter: true,
      readinessScore: 90,
      submissionReadiness: readiness
    });
    expect(status).toMatch(/Tier 2\/3|At Risk/);
  });

  test('buildSebiBrsrExport includes principle 6 scope and validation', () => {
    const exportPayload = buildSebiBrsrExport({
      organization: { companyName: 'Test MSME', industry: 'Manufacturing', country: 'India' },
      reportingPeriod: { financialYear: 'FY 2025-26', startDate: '2025-04-01', endDate: '2026-03-31' },
      environmental: {
        greenhouseGasEmissions: { scope1: 100, scope2: 200, scope3: 300, total: 600, unit: 'kgCO2e' }
      },
      compliance: {
        mandatoryFields: {
          companyName: true,
          industry: true,
          registrationsDisclosed: true,
          reportingPeriod: true,
          organizationalBoundaryDocumented: true,
          operationalBoundaryDocumented: true,
          scope1Disclosed: true,
          scope2Disclosed: true,
          scope3Disclosed: true
        }
      },
      sectionC: { principleWisePerformance: [{ principle: 6, title: 'P6', status: 'reported' }] },
      reportScope: 'BRSR Principle 6 Environmental Pack (Section C partial)'
    });
    expect(exportPayload.exportFormat).toBe('SEBI_BRSR_CORE_JSON');
    expect(exportPayload.sectionC.principle6Environmental.ghgEmissions.totalKgCo2e).toBe(600);
    expect(exportPayload.sectionC.principlesOutOfScope).toEqual([1, 2, 3, 4, 5, 7, 8, 9]);
  });

  test('buildBrsrXbrlSkeleton returns XML with GHG elements', () => {
    const xbrl = buildBrsrXbrlSkeleton({
      organization: { companyName: 'Test MSME', industry: 'Manufacturing' },
      reportingPeriod: { financialYear: 'FY 2025-26', startDate: '2025-04-01', endDate: '2026-03-31' },
      environmental: { greenhouseGasEmissions: { scope1: 1, scope2: 2, scope3: 3, total: 6 } },
      compliance: { mandatoryFields: { scope1Disclosed: true, scope2Disclosed: true, scope3Disclosed: true } }
    });
    expect(xbrl.xml).toContain('<?xml');
    expect(xbrl.xml).toContain('brsr:TotalGHGEmissions');
  });

  test('buildCbamRegistryCsv produces registry rows', () => {
    const csv = buildCbamRegistryCsv({
      overview: { reportingQuarter: 'Q2 2026', methodology: 'test' },
      msmeProfile: { companyName: 'Exporter', gstNumber: 'GST123' },
      goods: [{
        name: 'Steel',
        hsCode: '7208',
        exportVolumeTonnes: 10,
        directEmbeddedEmissions: 3,
        indirectEmbeddedEmissions: 2,
        embeddedEmissions: 5,
        emissionIntensity: 0.5,
        dataQuality: 'primary',
        reportingStatus: 'in_progress'
      }]
    });
    expect(csv.csv).toContain('cn_code');
    expect(csv.rowCount).toBe(1);
  });

  test('validateCompliancePack flags EUDR pending geolocation', () => {
    const result = validateCompliancePack({
      framework: 'EU Deforestation Regulation (EUDR)',
      dueDiligenceStatement: { geolocationRequired: true, polygonVerification: 'pending' }
    }, 'eudr');
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
