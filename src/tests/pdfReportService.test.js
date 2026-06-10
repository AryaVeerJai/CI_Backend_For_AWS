const pdfParse = require('pdf-parse');
const {
  generateBRSRReportPdf,
  generateCbamReportPdf,
  generateGenericReportPdf
} = require('../services/pdfReportService');
const { buildBRSRReport } = require('../services/brsrReportingService');

const FOOTER_STRIP_RE = /Page \d+ of \d+/g;
const SYSTEM_FOOTER_RE = /This report is system-generated[\s\S]*/i;

const extractPdfPageBodies = async (buffer) => {
  const pages = [];
  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent();
      const raw = textContent.items.map((item) => item.str).join(' ');
      const body = raw.replace(FOOTER_STRIP_RE, '').replace(SYSTEM_FOOTER_RE, '').replace(/\s+/g, ' ').trim();
      pages.push(body);
      return body;
    }
  });
  return pages;
};

const assertNoTrailingBlankPages = (pages) => {
  expect(pages.length).toBeGreaterThan(0);
  if (pages.length === 1) {
    return;
  }
  const lastBody = pages[pages.length - 1];
  expect(lastBody.length).toBeGreaterThan(80);
};

const minimalMsme = {
  companyName: 'Test MSME Pvt Ltd',
  companyType: 'small',
  industry: 'manufacturing',
  businessDomain: 'manufacturing',
  gstNumber: '24ABCDE1234F1Z5',
  business: {
    annualTurnover: 10000000,
    numberOfEmployees: 25,
    manufacturingUnits: 1,
    primaryProducts: 'Components'
  },
  contact: {
    address: { city: 'Mumbai', state: 'Maharashtra', country: 'India' }
  },
  manufacturingProfile: {
    industrySector: 'general',
    primaryEnergySource: 'grid',
    wasteManagementPractice: 'recycling'
  }
};

const minimalAssessment = {
  period: {
    startDate: new Date('2025-04-01T00:00:00Z'),
    endDate: new Date('2026-03-31T23:59:59Z')
  },
  totalCO2Emissions: 500,
  esgScopes: {
    scope1: { total: 100 },
    scope2: { total: 200 },
    scope3: { total: 200 }
  },
  breakdown: {
    energy: { electricity: { co2Emissions: 200 }, fuel: { co2Emissions: 100 } },
    materials: { co2Emissions: 120 },
    waste: { total: 30 }
  }
};

describe('PDF Report Service', () => {
  test('generateBRSRReportPdf returns a valid PDF buffer', async () => {
    const report = buildBRSRReport({
      msme: minimalMsme,
      assessment: minimalAssessment,
      assessmentHistory: [{ totalCO2Emissions: 450, period: { endDate: new Date('2025-12-31T23:59:59Z') } }],
      transactions: [
        { category: 'energy', amount: 5000, transactionType: 'expense', date: new Date('2025-06-01') },
        { category: 'raw_materials', amount: 3000, transactionType: 'purchase', vendor: { name: 'Supplier A' } }
      ],
      billAnnexure: [{
        originalName: 'electricity.pdf',
        status: 'processed',
        amount: 5000,
        processingResults: { confidence: 0.82, warnings: [], errors: [] }
      }],
      requestedPeriod: 'annual'
    });

    expect(report.methodologyAndAssumptions).toEqual(
      expect.objectContaining({
        gwpBasis: expect.stringContaining('AR5'),
        scopesExplicitlyMeasured: true
      })
    );

    const buffer = await generateBRSRReportPdf(report, { reportId: 'BRSR-TEST-001' });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(2000);
    expect(buffer.slice(0, 5).toString()).toBe('%PDF-');
    const pdfText = buffer.toString('latin1');
    expect(pdfText).not.toMatch(/AI Agents Used for Report Generation/i);
    expect(pdfText).not.toMatch(/agent-derived/i);

    const parsed = await pdfParse(buffer);
    expect(parsed.numpages).toBe(5);

    const pageBodies = await extractPdfPageBodies(buffer);
    assertNoTrailingBlankPages(pageBodies);
    expect(pageBodies[0]).toMatch(/BRSR Carbon Emissions Report/);
  });

  test('generateGenericReportPdf has left-aligned body and no trailing blank pages', async () => {
    const buffer = await generateGenericReportPdf({
      title: 'ISO 14064 Report',
      companyProfile: {
        companyName: 'Test Co',
        industry: 'manufacturing',
        businessDomain: 'manufacturing',
        companyType: 'small',
        location: { city: 'Mumbai', state: 'MH', country: 'India' }
      },
      operationsProfile: {
        annualTurnoverINR: 1000000,
        employeeCount: 10,
        manufacturingUnits: 1,
        primaryProducts: 'Parts',
        primaryEnergySource: 'grid',
        wasteManagementPractice: 'recycling'
      },
      summary: { readinessScore: '80%' },
      emissionsAndCompliance: { scope1: 10, scope2: 20, scope3: 5 },
      sections: ['Organizational Boundary'],
      carbonVisualization: {
        scopeContribution: [
          { scope: 'Scope 1', emissions: 10 },
          { scope: 'Scope 2', emissions: 20 }
        ],
        emissionsTrend: [
          { period: 'Q1', total: 30, scope1: 10, scope2: 10, scope3: 10 },
          { period: 'Q2', total: 35, scope1: 11, scope2: 12, scope3: 12 }
        ]
      },
      carbonVisualizationKind: 'iso14064'
    });

    const pageBodies = await extractPdfPageBodies(buffer);
    assertNoTrailingBlankPages(pageBodies);
    expect(pageBodies[0]).toMatch(/ISO 14064 Report/);
  });

  test('generateBRSRReportPdf with large annexure has no trailing blank pages', async () => {
    const report = buildBRSRReport({
      msme: minimalMsme,
      assessment: minimalAssessment,
      billAnnexure: Array.from({ length: 45 }, (_, i) => ({
        originalName: `utility-bill-${i}.pdf`,
        status: 'processed',
        amount: 1000 + i,
        processingResults: { confidence: 0.9, warnings: [], errors: [] }
      })),
      requestedPeriod: 'annual'
    });
    report.compliance = report.compliance || {};
    report.compliance.mandatoryFields = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`mandatory_field_${i}`, i % 2 === 0])
    );

    const buffer = await generateBRSRReportPdf(report, { reportId: 'BRSR-LARGE-001' });
    const parsed = await pdfParse(buffer);
    expect(parsed.numpages).toBeGreaterThanOrEqual(4);

    const pageBodies = await extractPdfPageBodies(buffer);
    assertNoTrailingBlankPages(pageBodies);
    expect(pageBodies[pageBodies.length - 1]).toMatch(/bill|Annexure|field_/i);
  });

  test('generateCbamReportPdf returns valid PDF for minimal report', async () => {
    const report = {
      generatedAt: '2025-01-15T10:00:00.000Z',
      overview: {
        reportingQuarter: 'Q1 2025',
        reportingFrequency: 'Quarterly',
        complianceStatus: 'On Track',
        readinessScore: 80,
        totalEmbeddedEmissions: 12.5
      },
      goods: [],
      emissionsTrend: [],
      documentation: [],
      recommendations: [],
      msmeProfile: { companyName: 'Exporter Co' }
    };

    const buffer = await generateCbamReportPdf(report, { reportId: 'CBAM-TEST-001' });
    expect(buffer.slice(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1500);
    const pdfText = buffer.toString('latin1');
    expect(pdfText).not.toMatch(/AI Agents Used for Report Generation/i);

    const parsed = await pdfParse(buffer);
    expect(parsed.numpages).toBe(2);

    const pageBodies = await extractPdfPageBodies(buffer);
    assertNoTrailingBlankPages(pageBodies);
  });
});
