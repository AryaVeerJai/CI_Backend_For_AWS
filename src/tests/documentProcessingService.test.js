jest.mock('../services/carbonCalculationService', () => ({
  calculateTransactionCarbonFootprint: jest.fn((transaction) => ({
    co2Emissions: Number(transaction.amount || 0) * 0.1,
    emissionFactor: 0.1,
    calculationMethod: 'mock'
  })),
  calculateTransactionCarbonFootprintForAgent: jest.fn(async (transaction) => ({
    co2Emissions: Number(transaction.amount || 0) * 0.1,
    emissionFactor: 0.1,
    calculationMethod: 'mock'
  })),
  ensureCarbonFootprintMetrics: jest.fn((transaction, footprint = {}) => ({
    co2Emissions: Number(footprint.co2Emissions ?? 0),
    emissionFactor: Number(footprint.emissionFactor ?? 0),
    calculationMethod: footprint.calculationMethod || 'mock',
    emissionBreakdown: footprint.emissionBreakdown || { scope1: 0, scope2: 0, scope3: 0 },
    metrics: footprint.metrics || {
      category: transaction?.category || 'other',
      subcategory: transaction?.subcategory || 'general',
      appliedFactors: {}
    }
  })),
  estimateTransactionScope: jest.fn((transaction = {}) => {
    const category = String(transaction.category || '').toLowerCase();
    if (category === 'energy') return 'scope2';
    if (category === 'equipment' || category === 'maintenance') return 'scope1';
    return 'scope3';
  }),
  calculateMSMECarbonFootprint: jest.fn((msmeData, transactions) => ({
    totalCO2Emissions: transactions.reduce((sum, txn) => sum + (Number(txn.amount) || 0) * 0.1, 0),
    breakdown: {
      energy: { electricity: 0, fuel: 0, total: 0 },
      water: { consumption: 0, co2Emissions: 0 },
      waste: { solid: 0, hazardous: 0, total: 0 },
      transportation: { distance: 0, co2Emissions: 0, vehicleCount: 0, fuelEfficiency: 0 },
      materials: { consumption: 0, co2Emissions: 0, type: 'mixed', supplierDistance: 0 },
      manufacturing: { productionVolume: 0, co2Emissions: 0, efficiency: 0, equipmentAge: 0 }
    },
    esgScopes: {
      scope1: { total: 10 },
      scope2: { total: 0 },
      scope3: { total: 0 },
      scope4: { total: 0 }
    },
    carbonScore: 88,
    recommendations: [{ category: 'energy', title: 'Mock Recommendation' }]
  })),
  calculateMSMECarbonFootprintAsync: jest.fn(async (msmeData, transactions) => ({
    totalCO2Emissions: transactions.reduce((sum, txn) => sum + (Number(txn.amount) || 0) * 0.1, 0),
    breakdown: {
      energy: { electricity: 0, fuel: 0, total: 0 },
      water: { consumption: 0, co2Emissions: 0 },
      waste: { solid: 0, hazardous: 0, total: 0 },
      transportation: { distance: 0, co2Emissions: 0, vehicleCount: 0, fuelEfficiency: 0 },
      materials: { consumption: 0, co2Emissions: 0, type: 'mixed', supplierDistance: 0 },
      manufacturing: { productionVolume: 0, co2Emissions: 0, efficiency: 0, equipmentAge: 0 }
    },
    esgScopes: {
      scope1: { total: 10 },
      scope2: { total: 0 },
      scope3: { total: 0 },
      scope4: { total: 0 }
    },
    carbonScore: 88,
    recommendations: [{ category: 'energy', title: 'Mock Recommendation' }]
  })),
  resolveRegion: jest.fn(() => 'north-india'),
  calculateDocumentCarbonFootprint: jest.fn()
}));

const documentProcessingService = require('../services/documentProcessingService');
const dataProcessorAgent = require('../services/agents/dataProcessorAgent');
const processMachineryProfilerAgent = require('../services/agents/processMachineryProfilerAgent');

describe('Document Processing Service - Itemized Carbon', () => {
  test('should compute item-level carbon and aggregate totals', async () => {
    const extractedData = {
      description: 'Monthly utilities',
      category: 'energy',
      items: [
        { name: 'Electricity charge', quantity: 1, price: 1000, total: 1000 },
        { name: 'Diesel fuel', quantity: 2, price: 500 }
      ]
    };

    const itemFootprints = documentProcessingService.calculateItemCarbonFootprints(extractedData);

    expect(itemFootprints).toHaveLength(2);
    expect(itemFootprints[0].carbonFootprint.co2Emissions).toBeCloseTo(100);
    expect(itemFootprints[1].total).toBe(1000);

    const carbonFootprint = await documentProcessingService.calculateCarbonFootprint({
      ...extractedData,
      items: itemFootprints
    });

    expect(carbonFootprint.co2Emissions).toBeCloseTo(200);
    expect(carbonFootprint.emissionFactor).toBeCloseTo(0.1);
    expect(carbonFootprint.calculationMethod).toBe('document_itemized');
  });

  test('should build document carbon analysis with category breakdown', async () => {
    const document = {
      msmeId: 'msme123',
      documentType: 'bill',
      _id: 'doc123',
      fileName: 'doc.pdf',
      originalName: 'doc.pdf'
    };
    const extractedData = {
      description: 'Utility charges',
      currency: 'INR',
      date: new Date(),
      vendor: { name: 'Utility Provider' }
    };
    const itemFootprints = [
      {
        name: 'Electricity charge',
        total: 1000,
        category: 'energy',
        subcategory: 'grid',
        carbonFootprint: { co2Emissions: 100 }
      },
      {
        name: 'Water charge',
        total: 500,
        category: 'water',
        subcategory: 'general',
        carbonFootprint: { co2Emissions: 50 }
      }
    ];
    const msmeProfile = {
      industry: 'services',
      businessDomain: 'services',
      contact: { address: { state: 'Delhi', country: 'India' } }
    };

    const analysis = await documentProcessingService.calculateDocumentCarbonAnalysis(
      document,
      extractedData,
      itemFootprints,
      msmeProfile
    );

    expect(analysis).toBeTruthy();
    expect(analysis.totalAmount).toBe(1500);
    expect(analysis.transactionCount).toBe(2);
    expect(analysis.categoryBreakdown.energy.count).toBe(1);
    expect(analysis.categoryBreakdown.energy.emissions).toBeCloseTo(100);
    expect(analysis.carbonScore).toBe(88);
    expect(Array.isArray(analysis.lineItemBreakup)).toBe(true);
    expect(analysis.lineItemBreakup.length).toBe(2);
    expect(analysis.ghgProtocol).toBeDefined();
    expect(analysis.ghgProtocol.standard).toBe('GHG Protocol Corporate Standard');
    expect(analysis.ghgProtocol.scopes.scope2).toBeGreaterThan(0);
  });

  test('should apply multi-parameter mapping before document carbon analysis', async () => {
    const document = {
      msmeId: 'msme-multi-1',
      documentType: 'invoice',
      _id: 'doc-multi-1',
      fileName: 'fuel-invoice.pdf',
      originalName: 'fuel-invoice.pdf'
    };
    const extractedData = {
      description: 'Diesel purchase for transport fleet operations',
      rawText: 'Diesel purchase for transport fleet operations',
      currency: 'INR',
      date: new Date(),
      vendor: { name: 'Fleet Fuels Pvt Ltd' }
    };
    const itemFootprints = [
      {
        name: 'Fleet fuel refill',
        total: 2000,
        category: 'other',
        subcategory: 'general',
        carbonFootprint: { co2Emissions: 200 }
      }
    ];
    const msmeProfile = {
      industry: 'manufacturing',
      businessDomain: 'manufacturing',
      contact: { address: { state: 'Delhi', country: 'India' } }
    };

    const profileSpy = jest.spyOn(processMachineryProfilerAgent, 'analyzeProfile')
      .mockResolvedValue({
        sector: 'manufacturing',
        processes: ['material_preparation'],
        machinery: ['transport_fleet'],
        productSignals: ['steel'],
        activitySignals: { transportation: 0.5 }
      });
    const classifySpy = jest.spyOn(dataProcessorAgent, 'classifyTransaction')
      .mockResolvedValue({
        category: 'other',
        subcategory: 'general',
        confidence: 0.62,
        processingMetadata: { needsReview: true }
      });

    try {
      const analysis = await documentProcessingService.calculateDocumentCarbonAnalysis(
        document,
        extractedData,
        itemFootprints,
        msmeProfile
      );

      expect(profileSpy).toHaveBeenCalled();
      expect(classifySpy).toHaveBeenCalled();
      expect(analysis).toBeTruthy();
      expect(analysis.categoryBreakdown.energy).toBeDefined();
      expect(analysis.categoryBreakdown.energy.count).toBe(1);
    } finally {
      profileSpy.mockRestore();
      classifySpy.mockRestore();
    }
  });

  test('should calculate bill/receipt carbon analysis from pdf extraction', async () => {
    const carbonCalculationService = require('../services/carbonCalculationService');
    carbonCalculationService.calculateDocumentCarbonFootprint.mockResolvedValue({
        totalCO2Emissions: 800,
        breakdown: {
          energy: { co2: 800, percentage: 100 }
        },
        scopeBreakdown: {
          scope1: { co2: 200, percentage: 25 },
          scope2: { co2: 600, percentage: 75 },
          scope3: { co2: 0, percentage: 0 }
        },
        carbonScore: 72,
        recommendations: [{ category: 'energy', title: 'Test Recommendation' }]
    });

    try {
      const document = {
        msmeId: 'msme123',
        documentType: 'bill'
      };
      const extractedData = { amount: 5000, currency: 'INR' };
      const carbonExtraction = {
        extractedData: {
          carbonRelevant: true,
          energy: { electricity: { consumption: 1000 }, fuel: { consumption: 0 }, renewable: { percentage: 0 } },
          materials: { rawMaterials: { quantity: 0 }, packaging: { quantity: 0 } },
          transportation: { distance: 0, fuelConsumption: 0 },
          waste: { solid: { quantity: 0 }, hazardous: { quantity: 0 } },
          water: { consumption: 0 }
        }
      };
      const msmeProfile = { industry: 'services', businessDomain: 'services' };

      const analysis = await documentProcessingService.calculateBillReceiptCarbonAnalysis(
        document,
        extractedData,
        carbonExtraction,
        msmeProfile
      );

      expect(analysis).toBeTruthy();
      expect(analysis.totalCO2Emissions).toBe(800);
      expect(analysis.totalAmount).toBe(5000);
      expect(analysis.categoryBreakdown.energy.emissions).toBe(800);
      expect(analysis.carbonScore).toBe(72);
      expect(carbonCalculationService.calculateDocumentCarbonFootprint).toHaveBeenCalled();
    } finally {
      carbonCalculationService.calculateDocumentCarbonFootprint.mockReset();
    }
  });

  test('should extract structured data from plain text documents', async () => {
    const textBuffer = Buffer.from(
      [
        'Vendor: Green Utility Pvt Ltd',
        'Invoice Date: 12/02/2026',
        'Invoice No: INV-2026-77',
        'Total Amount: INR 2500',
        'Description: Monthly electricity usage'
      ].join('\n'),
      'utf8'
    );

    const result = await documentProcessingService.extractDataFromDocument(textBuffer, {
      mimeType: 'text/plain',
      documentType: 'invoice',
      originalName: 'utility-invoice.txt'
    });

    expect(result.data.amount).toBe(2500);
    expect(result.data.currency).toBe('INR');
    expect(result.data.vendor.name).toContain('Green Utility');
    expect(typeof result.data.referenceNumber).toBe('string');
    expect(result.data.referenceNumber.length).toBeGreaterThan(0);
    expect(Array.isArray(result.extractionWarnings)).toBe(true);
    expect(result.extractionWarnings.join(' ')).not.toContain('using fallback');
  });

  test('should extract line items from tabular invoice-style OCR text', async () => {
    const textBuffer = Buffer.from(
      [
        'TAX INVOICE',
        'NO PRODUCT / SERVICE NAME HSN/SAC PREPARATION UNIT PRICE IGST CESS AMOUNT',
        '1 solvent white cleaner industrial substance ISD 00456 345 23.00 200.00 524.40 218.50 4,894.40',
        '2 detergent only carpets 100% KER23 1296 3.00 2,000.00 1,080.00 0.00 7,080.00',
        'TOTAL AMOUNT: INR 27,425'
      ].join('\n'),
      'utf8'
    );

    const result = await documentProcessingService.extractDataFromDocument(textBuffer, {
      mimeType: 'text/plain',
      documentType: 'invoice',
      originalName: 'tabular-invoice.txt'
    });

    expect(Array.isArray(result.data.items)).toBe(true);
    expect(result.data.items.length).toBeGreaterThanOrEqual(2);
    expect(result.data.items[0]).toEqual(expect.objectContaining({
      name: expect.any(String),
      quantity: expect.any(Number),
      price: expect.any(Number),
      total: expect.any(Number)
    }));
    expect(result.data.items[0].name.toLowerCase()).toContain('solvent');
    expect(result.data.items[0].total).toBeCloseTo(4894.40, 2);
  });

  test('should merge continuation lines into previous invoice item name', async () => {
    const rawText = [
      'Sr. Name of Product / Service HSN / SAC Qty Rate Taxable Value IGST Amount Total',
      '1 Stanley Hammer 82052000 3.00 PCS 499.00 1497.00 18.00 269.46 1,766.46',
      'Claw Hammer Steel Shaft (Black and Chrome)',
      '2 Automatic Saw 60 mm 8202 1.00 PCS 1,883.00 1883.00 18.00 338.94 2,221.94',
      'Total Amount After Tax 3,988.40'
    ].join('\n');

    const extraction = await documentProcessingService.buildExtractionResultFromText(
      rawText,
      { documentType: 'invoice', originalName: 'proforma.txt' },
      [],
      'text'
    );

    expect(Array.isArray(extraction.data.items)).toBe(true);
    expect(extraction.data.items.length).toBeGreaterThanOrEqual(2);
    expect(extraction.data.items[0].name.toLowerCase()).toContain('claw hammer steel shaft');
    expect(extraction.data.items[0].quantity).toBeCloseTo(3, 1);
    expect(extraction.data.items[0].total).toBeCloseTo(1766.46, 2);
  });

  test('should use OCR extraction path for image documents', async () => {
    const ocrSpy = jest.spyOn(documentProcessingService, 'extractTextWithOCR')
      .mockResolvedValue([
        'Receipt',
        'Vendor: Eco Supplies',
        'Date: 10-02-2026',
        'Total Amount: INR 1500'
      ].join('\n'));

    try {
      const result = await documentProcessingService.extractDataFromDocument(Buffer.from('fake-image-bytes'), {
        mimeType: 'image/png',
        documentType: 'receipt',
        originalName: 'receipt.png'
      });

      expect(ocrSpy).toHaveBeenCalled();
      expect(result.data.amount).toBe(1500);
      expect(result.data.vendor.name).toContain('Eco Supplies');
    } finally {
      ocrSpy.mockRestore();
    }
  });

  test('should fallback for unsupported MIME types', async () => {
    const result = await documentProcessingService.extractDataFromDocument(Buffer.from('binary'), {
      mimeType: 'application/zip',
      documentType: 'other',
      originalName: 'archive.zip'
    });

    expect(result.data.description).toBe('archive.zip');
    expect(result.extractionWarnings[0]).toContain('Unsupported document MIME type');
  });

  test('should reconcile conflicting AI and OCR extraction values using OCR trust', () => {
    const reconciliation = documentProcessingService.reconcileExtractionForAccuracy({
      aiExtraction: {
        data: {
          amount: 12500,
          date: new Date('2026-02-10'),
          vendor: { name: 'Atlas Logistics Pvt Ltd' },
          description: 'AI parsed utility invoice',
          category: 'energy',
          subcategory: 'grid',
          currency: 'INR'
        },
        rawText: 'AI OCR text'
      },
      ocrExtraction: {
        independentOcr: true,
        data: {
          amount: 11000,
          date: new Date('2026-02-10'),
          vendor: { name: 'North Utilities Cooperative' },
          description: 'OCR parsed utility invoice',
          category: 'energy',
          subcategory: 'grid',
          currency: 'INR'
        },
        rawText: 'OCR text'
      },
      ocrAccuracy: {
        overall: 0.92,
        engines: [
          { engine: 'pdf_native_text', agreement: 0.91 },
          { engine: 'pdf_ocr_tesseract', agreement: 0.93 }
        ]
      }
    });

    expect(reconciliation.extractedData.amount).toBe(11000);
    expect(reconciliation.extractedData.vendor.name).toBe('North Utilities Cooperative');
    expect(reconciliation.accuracyReport.overall).toBeGreaterThan(0.7);
    expect(reconciliation.warnings.join(' ')).toContain('Field mismatch detected for amount');
  });

  test('should use AI-only passthrough when backend OCR is not independent', () => {
    const reconciliation = documentProcessingService.reconcileExtractionForAccuracy({
      aiExtraction: {
        data: {
          amount: 12500,
          vendor: { name: 'Atlas Logistics Pvt Ltd' },
          referenceNumber: 'AI-INV-1'
        }
      },
      ocrExtraction: {
        independentOcr: false,
        data: {
          amount: 11000,
          vendor: { name: 'North Utilities Cooperative' },
          referenceNumber: 'OCR-INV-1'
        }
      },
      ocrAccuracy: { overall: 0.92, engines: [] }
    });

    expect(reconciliation.extractedData.amount).toBe(12500);
    expect(reconciliation.extractedData.referenceNumber).toBe('AI-INV-1');
    expect(reconciliation.extractedData.fieldProvenance.fields.amount.winner.stage).toBe('ai_only');
  });

  test('applyPostMergeRecovery fills referenceNumber from raw text', () => {
    const previousAccuracyFlag = process.env.ACCURACY_RECOVERY_ENABLED;
    process.env.ACCURACY_RECOVERY_ENABLED = '1';

    const extractedData = { amount: 1500 };
    const warnings = [];
    const rawText = 'Invoice No: INV-2026-001\nTotal Amount: INR 1500';

    documentProcessingService.applyPostMergeRecovery(extractedData, {
      document: { createdAt: new Date('2026-06-01'), metadata: {} },
      rawText,
      extractionWarnings: warnings
    });

    expect(extractedData.referenceNumber).toBe('INV-2026-001');
    expect(extractedData.fieldProvenance.fields.referenceNumber.winner.stage).toBe('recovery');

    if (previousAccuracyFlag === undefined) {
      delete process.env.ACCURACY_RECOVERY_ENABLED;
    } else {
      process.env.ACCURACY_RECOVERY_ENABLED = previousAccuracyFlag;
    }
  });

  test('applyPostMergeRecovery fills gstin from OCR hints before text recovery', () => {
    const extractedData = { amount: 1500 };
    const ocrFieldHints = {
      version: '1.0',
      gstin_candidates: ['27AABCU9603R1ZP'],
      invoice_number_candidates: [],
      date_candidates: [],
      total_candidates: []
    };

    documentProcessingService.applyPostMergeRecovery(extractedData, {
      document: { createdAt: new Date('2026-06-01'), metadata: {} },
      rawText: null,
      extractionWarnings: [],
      ocrFieldHints
    });

    expect(extractedData.gstin).toBe('27AABCU9603R1ZP');
    expect(extractedData.fieldProvenance.fields.gstin.winner).toEqual({
      source: 'ocr_hint',
      stage: 'recovery'
    });
  });

  test('applyPostMergeRecovery prefers OCR hints over raw text for referenceNumber', () => {
    const extractedData = { amount: 1500 };
    const ocrFieldHints = {
      version: '1.0',
      gstin_candidates: [],
      invoice_number_candidates: ['HINT-INV-99'],
      date_candidates: [],
      total_candidates: []
    };

    documentProcessingService.applyPostMergeRecovery(extractedData, {
      document: { createdAt: new Date('2026-06-01'), metadata: {} },
      rawText: 'Invoice No: TEXT-INV-001\nTotal Amount: INR 1500',
      extractionWarnings: [],
      ocrFieldHints
    });

    expect(extractedData.referenceNumber).toBe('HINT-INV-99');
    expect(extractedData.fieldProvenance.fields.referenceNumber.winner.source).toBe('ocr_hint');
  });

  test('applyPostMergeRecovery does not overwrite populated gstin from hints', () => {
    const existingGstin = '29AAACI1195H1ZK';
    const extractedData = { amount: 1500, gstin: existingGstin, seller_gstin: existingGstin };
    const ocrFieldHints = {
      version: '1.0',
      gstin_candidates: ['27AABCU9603R1ZP'],
      invoice_number_candidates: [],
      date_candidates: [],
      total_candidates: []
    };

    documentProcessingService.applyPostMergeRecovery(extractedData, {
      document: { createdAt: new Date('2026-06-01'), metadata: {} },
      rawText: null,
      extractionWarnings: [],
      ocrFieldHints
    });

    expect(extractedData.gstin).toBe(existingGstin);
    expect(extractedData.fieldProvenance?.fields?.gstin).toBeUndefined();
  });

  test('applyPostMergeRecovery strips ocr_field_hints from persisted extractedData', () => {
    const extractedData = {
      amount: 0,
      ocr_field_hints: {
        version: '1.0',
        total_candidates: [4200]
      }
    };

    documentProcessingService.applyPostMergeRecovery(extractedData, {
      document: { createdAt: new Date('2026-06-01'), metadata: {} },
      rawText: null,
      extractionWarnings: []
    });

    expect(extractedData.amount).toBe(4200);
    expect(extractedData.ocr_field_hints).toBeUndefined();
  });

  describe('RC-5C multi-OCR recovery', () => {
    const previousFlag = process.env.MULTI_OCR_RECOVERY_ENABLED;
    const previousAccuracyFlag = process.env.ACCURACY_RECOVERY_ENABLED;

    beforeEach(() => {
      process.env.MULTI_OCR_RECOVERY_ENABLED = '1';
      process.env.ACCURACY_RECOVERY_ENABLED = '1';
    });

    afterEach(() => {
      if (previousFlag === undefined) {
        delete process.env.MULTI_OCR_RECOVERY_ENABLED;
      } else {
        process.env.MULTI_OCR_RECOVERY_ENABLED = previousFlag;
      }
      if (previousAccuracyFlag === undefined) {
        delete process.env.ACCURACY_RECOVERY_ENABLED;
      } else {
        process.env.ACCURACY_RECOVERY_ENABLED = previousAccuracyFlag;
      }
    });

    test('applyMultiOcrRecoveryFill records multi_ocr provenance for agreed gstin', () => {
      const gstin = '27AABCU9603R1ZP';
      const extractedData = { amount: 1000 };

      documentProcessingService.applyMultiOcrRecoveryFill(extractedData, [
        { engine: 'pdf_native_text', text: `Seller GSTIN: ${gstin}\nTotal Amount: INR 1000` },
        { engine: 'pdf_ocr_tesseract', text: `GSTIN ${gstin}\nGrand Total INR 1000` }
      ]);

      expect(extractedData.gstin).toBe(gstin);
      expect(extractedData.fieldProvenance.fields.gstin.winner).toEqual({
        source: 'multi_ocr',
        stage: 'recovery'
      });
    });

    test('applyMultiOcrRecoveryFill does not overwrite populated gstin', () => {
      const existingGstin = '29AAACI1195H1ZK';
      const extractedData = {
        amount: 1000,
        gstin: existingGstin,
        seller_gstin: existingGstin
      };

      documentProcessingService.applyMultiOcrRecoveryFill(extractedData, [
        { engine: 'pdf_native_text', text: 'GSTIN 27AABCU9603R1ZP' },
        { engine: 'pdf_ocr_tesseract', text: 'GSTIN 27AABCU9603R1ZP' }
      ]);

      expect(extractedData.gstin).toBe(existingGstin);
      expect(extractedData.fieldProvenance).toBeUndefined();
    });

    test('applyPostMergeRecovery uses hint before multi_ocr before ocr_text', () => {
      const hintGstin = '27AABCU9603R1ZP';
      const multiGstin = '29AAACI1195H1ZK';
      const textGstin = '36AABFI9912C1Z4';
      const extractedData = { amount: 1500 };

      documentProcessingService.applyPostMergeRecovery(extractedData, {
        document: { createdAt: new Date('2026-06-01'), metadata: {} },
        rawText: `GSTIN ${textGstin}\nInvoice No: TEXT-INV-001\nTotal Amount: INR 1500`,
        extractionWarnings: [],
        ocrFieldHints: {
          version: '1.0',
          gstin_candidates: [hintGstin],
          invoice_number_candidates: [],
          date_candidates: [],
          total_candidates: []
        },
        multiOcrEngineTexts: [
          { engine: 'pdf_native_text', text: `GSTIN ${multiGstin}` },
          { engine: 'pdf_ocr_tesseract', text: `GSTIN ${multiGstin}` }
        ]
      });

      expect(extractedData.gstin).toBe(hintGstin);
      expect(extractedData.fieldProvenance.fields.gstin.winner.source).toBe('ocr_hint');
      expect(extractedData.referenceNumber).toBe('TEXT-INV-001');
      expect(extractedData.fieldProvenance.fields.referenceNumber.winner.source).toBe('reference_recovery');
    });

    test('applyMultiOcrRecoveryFill is disabled when feature flag is off', () => {
      process.env.MULTI_OCR_RECOVERY_ENABLED = '0';
      const extractedData = { amount: 1000 };

      documentProcessingService.applyMultiOcrRecoveryFill(extractedData, [
        { engine: 'pdf_native_text', text: 'GSTIN 27AABCU9603R1ZP' },
        { engine: 'pdf_ocr_tesseract', text: 'GSTIN 27AABCU9603R1ZP' }
      ]);

      expect(extractedData.gstin).toBeUndefined();
    });

    test('performMultiOCRAccuracyCheck returns engineTexts', async () => {
      const accuracy = await documentProcessingService.performMultiOCRAccuracyCheck(
        Buffer.from('sample'),
        { mimeType: 'application/zip' },
        'This is only ai engine text for similarity checks with enough length here',
        null
      );

      expect(accuracy.engineTexts).toHaveLength(1);
      expect(accuracy.engineTexts[0].engine).toBe('ai_model_multi_ocr');
    });
  });

  describe('RC-5D item recovery', () => {
    const previousFlag = process.env.ITEM_RECOVERY_ENABLED;

    beforeEach(() => {
      process.env.ITEM_RECOVERY_ENABLED = '1';
    });

    afterEach(() => {
      if (previousFlag === undefined) {
        delete process.env.ITEM_RECOVERY_ENABLED;
      } else {
        process.env.ITEM_RECOVERY_ENABLED = previousFlag;
      }
    });

    test('applyItemRecoveryFill executes when flag enabled', () => {
      const extractedData = { amount: 500 };

      documentProcessingService.applyItemRecoveryFill(extractedData, {
        ocrItems: [{ name: 'Office Chair', quantity: 2, price: 150, total: 300 }]
      });

      expect(extractedData.items).toHaveLength(1);
      expect(extractedData.items[0].total).toBe(300);
      expect(extractedData.items[0].item_provenance.source).toBe('ocr_text_item');
    });

    test('applyItemRecoveryFill is no-op when flag disabled', () => {
      process.env.ITEM_RECOVERY_ENABLED = '0';
      const extractedData = { amount: 500 };

      documentProcessingService.applyItemRecoveryFill(extractedData, {
        ocrItems: [{ name: 'Office Chair', quantity: 2, price: 150, total: 300 }]
      });

      expect(extractedData.items).toBeUndefined();
    });

    test('applyItemRecoveryFill does not overwrite existing values', () => {
      const extractedData = {
        amount: 1000,
        items: [{ name: 'Widget', quantity: 1, price: 500, total: 500 }]
      };

      documentProcessingService.applyItemRecoveryFill(extractedData, {
        ocrItems: [{ name: 'Widget', quantity: 9, price: 600, total: 600 }]
      });

      expect(extractedData.items[0].total).toBe(500);
      expect(extractedData.items[0].quantity).toBe(1);
      expect(extractedData.items[0].price).toBe(500);
    });

    test('applyItemRecoveryFill recovers missing quantity', () => {
      const extractedData = {
        amount: 150,
        items: [{ name: 'Steel Bracket', price: 50, total: 150 }]
      };

      documentProcessingService.applyItemRecoveryFill(extractedData, {
        ocrItems: [{ name: 'Steel Bracket', quantity: 3, price: 50, total: 150 }]
      });

      expect(extractedData.items[0].quantity).toBe(3);
    });

    test('applyItemRecoveryFill recovers missing price', () => {
      const extractedData = {
        amount: 200,
        items: [{ name: 'Cable', quantity: 4, total: 200 }]
      };

      documentProcessingService.applyItemRecoveryFill(extractedData, {
        ocrItems: [{ name: 'Cable', quantity: 4, price: 50, total: 200 }]
      });

      expect(extractedData.items[0].price).toBe(50);
    });

    test('applyItemRecoveryFill recovers missing total via math_derived', () => {
      const extractedData = {
        amount: 150,
        items: [{ name: 'Bolt Kit', quantity: 2, price: 75 }]
      };

      documentProcessingService.applyItemRecoveryFill(extractedData, {
        ocrItems: [{ name: 'Bolt Kit', quantity: 2, price: 75 }]
      });

      expect(extractedData.items[0].total).toBe(150);
      expect(extractedData.items[0].item_provenance.source).toBe('math_derived');
    });

    test('applyPostMergeRecovery runs item recovery before sanitize', () => {
      const extractedData = {
        amount: 300,
        items: [{ name: 'Office Chair', quantity: 2, price: 150 }]
      };
      const fillSpy = jest.spyOn(documentProcessingService, 'applyItemRecoveryFill');
      const sanitizeSpy = jest.spyOn(documentProcessingService, 'sanitizeExtractedItems')
        .mockImplementation((items) => items);

      documentProcessingService.applyPostMergeRecovery(extractedData, {
        document: { metadata: {} },
        rawText: null,
        extractionWarnings: [],
        ocrItems: [{ name: 'Office Chair', quantity: 2, price: 150, total: 300 }]
      });

      expect(fillSpy).toHaveBeenCalled();
      expect(sanitizeSpy).toHaveBeenCalled();
      expect(fillSpy.mock.invocationCallOrder[0]).toBeLessThan(sanitizeSpy.mock.invocationCallOrder[0]);
      expect(extractedData.items[0].total).toBe(300);

      fillSpy.mockRestore();
      sanitizeSpy.mockRestore();
    });
  });

  test('should incorporate OCR agreement in confidence score', () => {
    const extractedData = {
      amount: 1000,
      date: new Date(),
      vendor: { name: 'Test Vendor' },
      description: 'Office supplies',
      category: 'other'
    };

    const highConfidence = documentProcessingService.calculateConfidence(extractedData, { overall: 0.95 });
    const lowConfidence = documentProcessingService.calculateConfidence(extractedData, { overall: 0.25 });

    expect(highConfidence).toBeGreaterThan(lowConfidence);
    expect(lowConfidence).toBeGreaterThan(0);
  });

  test('should extract GST data and preserve in OCR extraction result', async () => {
    const textBuffer = Buffer.from(
      [
        'Vendor: Green Utility Pvt Ltd',
        'Invoice Date: 12/02/2026',
        'Invoice No: INV-2026-77',
        'GSTIN: 27AABCU9603R1ZP',
        'Bill To GSTIN: 29AAACI1195H1ZK',
        'Total Amount: INR 2500'
      ].join('\n'),
      'utf8'
    );

    const result = await documentProcessingService.extractDataFromDocument(textBuffer, {
      mimeType: 'text/plain',
      documentType: 'invoice',
      originalName: 'utility-invoice.txt'
    });

    expect(result.data.gstin).toBe('27AABCU9603R1ZP');
    expect(result.data.seller_gstin).toBe('27AABCU9603R1ZP');
    expect(result.data.buyer_gstin).toBe('29AAACI1195H1ZK');
    expect(result.data.gst.seller_gstin).toBe('27AABCU9603R1ZP');
  });

  test('should extract invoice reference after "Invoice No:" label', () => {
    const reference = documentProcessingService.extractReferenceNumberFromText(
      'Invoice No: INV-2026-001\nTotal Amount: INR 1500'
    );

    expect(reference).toBe('INV-2026-001');
  });

  test('should not capture placeholder tokens as invoice reference', () => {
    const reference = documentProcessingService.extractReferenceNumberFromText(
      'No reference here\nTotal amount INR 1000'
    );

    expect(reference).toBeNull();
  });

  test('should parse lakh notation amounts correctly', () => {
    const amountData = documentProcessingService.extractAmountFromText(
      'Total Amount: Rs 2.5 Lakhs'
    );

    expect(amountData.amount).toBe(250000);
    expect(amountData.currency).toBe('INR');
  });

  test('should persist RAG metadata at transaction metadata root', async () => {
    const savedPayloads = [];
    const originalGetTransactionModel = documentProcessingService.getTransactionModel;
    documentProcessingService.getTransactionModel = jest.fn(() => (
      function MockTransaction(data) {
        this.data = data;
        this.save = jest.fn().mockImplementation(async () => {
          savedPayloads.push(this.data);
          return this;
        });
      }
    ));
    const duplicateDetectionService = require('../services/duplicateDetectionService');
    const duplicateSpy = jest.spyOn(duplicateDetectionService, 'detectDuplicate')
      .mockResolvedValue({ isDuplicate: false });

    try {
      const document = {
        _id: { toString: () => 'doc-rag-1' },
        msmeId: '507f1f77bcf86cd799439012',
        documentType: 'invoice',
        originalName: 'invoice.pdf',
        extractedData: {
          amount: 1000,
          currency: 'INR',
          category: 'other',
          subcategory: 'general',
          ragClassification: {
            retrievalMethod: 'verified_registry_rag',
            emissionFactor: { value: 0.0012, unit: 'kg_co2_per_inr' }
          }
        },
        carbonFootprint: { co2Emissions: 1.2, emissionFactor: 0.0012 },
        processingResults: { confidence: 0.9 },
        metadata: { sourceWorkflow: 'document_upload' }
      };

      const result = await documentProcessingService.createTransactionsFromDocument(document, []);
      expect(result.createdTransactions).toHaveLength(1);
      expect(savedPayloads).toHaveLength(1);
      expect(savedPayloads[0].metadata.ragClassification).toEqual(
        expect.objectContaining({
          retrievalMethod: 'verified_registry_rag'
        })
      );
    } finally {
      duplicateSpy.mockRestore();
      documentProcessingService.getTransactionModel = originalGetTransactionModel;
    }
  });

  test('should store multi-parameter mapping metadata in created transactions', async () => {
    const savedPayloads = [];
    const originalGetTransactionModel = documentProcessingService.getTransactionModel;
    documentProcessingService.getTransactionModel = jest.fn(() => (
      function MockTransaction(data) {
        this.data = data;
        this.save = jest.fn().mockImplementation(async () => {
          savedPayloads.push(this.data);
          return this;
        });
      }
    ));
    const duplicateDetectionService = require('../services/duplicateDetectionService');
    const duplicateSpy = jest.spyOn(duplicateDetectionService, 'detectDuplicate')
      .mockResolvedValue({ isDuplicate: false });
    const profileSpy = jest.spyOn(processMachineryProfilerAgent, 'analyzeProfile')
      .mockResolvedValue({
        sector: 'manufacturing',
        processes: ['welding'],
        machinery: ['transport_fleet'],
        productSignals: ['steel'],
        activitySignals: { transportation: 0.4 }
      });
    const classifySpy = jest.spyOn(dataProcessorAgent, 'classifyTransaction')
      .mockResolvedValue({
        category: 'transportation',
        subcategory: 'diesel',
        confidence: 0.84,
        processingMetadata: { needsReview: false }
      });

    try {
      const document = {
        _id: { toString: () => 'doc-map-1' },
        msmeId: '507f1f77bcf86cd799439012',
        documentType: 'invoice',
        originalName: 'diesel-invoice.pdf',
        extractedData: {
          amount: 1500,
          currency: 'INR',
          category: 'other',
          subcategory: 'general',
          description: 'Diesel purchase for fleet movement'
        },
        carbonFootprint: { co2Emissions: 150, emissionFactor: 0.1 },
        processingResults: { confidence: 0.88 },
        metadata: { sourceWorkflow: 'document_upload', transactionMapping: 'company' }
      };

      const result = await documentProcessingService.createTransactionsFromDocument(document, []);
      expect(result.createdTransactions).toHaveLength(1);
      expect(savedPayloads).toHaveLength(1);
      expect(savedPayloads[0].category).toBe('transportation');
      expect(savedPayloads[0].subcategory).toBe('diesel');
      expect(savedPayloads[0].metadata.mappingParameters).toEqual(
        expect.objectContaining({
          profileSector: 'manufacturing',
          productSignals: expect.any(Array),
          classifierConfidence: expect.any(Number)
        })
      );
    } finally {
      classifySpy.mockRestore();
      profileSpy.mockRestore();
      duplicateSpy.mockRestore();
      documentProcessingService.getTransactionModel = originalGetTransactionModel;
    }
  });

  test('should cap single engine OCR accuracy to conservative score', async () => {
    const accuracy = await documentProcessingService.performMultiOCRAccuracyCheck(
      Buffer.from('sample'),
      { mimeType: 'application/zip' },
      'This is only ai engine text for similarity checks',
      null
    );

    expect(accuracy.available).toBe(true);
    expect(accuracy.overall).toBe(0.5);
    expect(accuracy.engines).toHaveLength(1);
    expect(accuracy.engines[0].agreement).toBe(0.5);
  });

  test('should keep ambiguous slash dates unresolved for safety', () => {
    const parsed = documentProcessingService.parseDocumentDate('05/06/2026');
    expect(parsed).toBeNull();
  });

  test('should parse Tesseract OEM and PSM from CLI-style tesseractConfig', () => {
    const { OEM } = require('tesseract.js');
    expect(documentProcessingService.parseTesseractOemPsmFromCli('--oem 1 --psm 11')).toEqual({
      oem: 1,
      psm: '11'
    });
    expect(documentProcessingService.parseTesseractOemPsmFromCli('')).toEqual({
      oem: OEM.LSTM_ONLY,
      psm: null
    });
    expect(documentProcessingService.parseTesseractOemPsmFromCli('--oem 9 --psm 99')).toEqual({
      oem: OEM.LSTM_ONLY,
      psm: null
    });
  });

  test('should detect OCR quality rejection messages from AI analyze errors', () => {
    expect(
      documentProcessingService.isOcrQualityRejectionMessage(
        'This image looks blurry, so we cannot read the characters reliably.'
      )
    ).toBe(true);
    expect(
      documentProcessingService.isOcrQualityRejectionMessage(
        'We could not read the text clearly — characters may be too blurry or faint.'
      )
    ).toBe(true);
    expect(documentProcessingService.isOcrQualityRejectionMessage('Invalid request body')).toBe(false);
  });

  test('should extract analyze error detail from axios-style errors', () => {
    const detail = documentProcessingService.extractAIAnalyzeErrorDetail({
      response: {
        data: {
          detail: 'Image is blurry. Please upload a clearer document.'
        }
      }
    });
    expect(detail).toContain('blurry');
  });

  test('should build OCR validation payload for rejected documents', () => {
    const blurValidation = documentProcessingService.buildOcrQualityRejectionValidation(
      'This image looks blurry, so we cannot read the characters reliably.'
    );
    expect(blurValidation.unreadable).toBe(true);
    expect(blurValidation.blur_detected).toBe(true);
    expect(blurValidation.gate_rejection_reason).toBe('blur_pre_check');
    expect(blurValidation.user_action.message).toContain('blurry');

    const lowConfValidation = documentProcessingService.buildOcrQualityRejectionValidation(
      'We could not read the text clearly — characters may be too blurry or faint. Please upload a sharper, well-lit image.'
    );
    expect(lowConfValidation.blur_detected).toBe(false);
    expect(lowConfValidation.gate_rejection_reason).toBe('low_ocr_confidence');
    expect(lowConfValidation.user_action.problematic_sections).toContain('low_ocr_confidence');
  });

  test('should apply tesseractConfig OEM and PSM when running OCR', async () => {
    const tesseract = require('tesseract.js');
    const mockWorker = {
      setParameters: jest.fn().mockResolvedValue(undefined),
      recognize: jest.fn().mockResolvedValue({ data: { text: 'line items' } }),
      terminate: jest.fn().mockResolvedValue(undefined)
    };
    const spy = jest.spyOn(tesseract, 'createWorker').mockResolvedValue(mockWorker);
    try {
      const text = await documentProcessingService.extractTextWithOCR(Buffer.from('fake-png'), {
        tesseractConfig: '--oem 1 --psm 11',
        source: 'test_image'
      });
      expect(text).toBe('line items');
      expect(spy).toHaveBeenCalledWith(
        'eng',
        1,
        expect.objectContaining({ logger: expect.any(Function) })
      );
      expect(mockWorker.setParameters).toHaveBeenCalledWith({ tessedit_pageseg_mode: '11' });
      expect(mockWorker.terminate).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
