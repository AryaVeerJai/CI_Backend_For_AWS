const stateUtilityBoardBillAgent = require('../services/agents/stateUtilityBoardBillAgent');

describe('stateUtilityBoardBillAgent', () => {
  const baseCarbonElectricity = {
    extractedData: {
      carbonRelevant: true,
      energy: { electricity: { consumption: 1200 }, fuel: { consumption: 0 }, renewable: { percentage: 0 } },
      materials: { rawMaterials: { quantity: 0 }, packaging: { quantity: 0 } },
      transportation: { distance: 0, fuelConsumption: 0 },
      waste: { solid: { quantity: 0 }, hazardous: { quantity: 0 } },
      water: { consumption: 0 }
    }
  };

  test('consolidates Tamil Nadu Electricity Board style bills', () => {
    const r = stateUtilityBoardBillAgent.analyzeStateUtilityBoardBill({
      document: { documentType: 'bill' },
      extractedData: {
        vendor: { name: 'Tamil Nadu Electricity Board' },
        description: 'Monthly electricity',
        category: 'utilities',
        items: [{ name: 'Energy charges', total: 4000 }, { name: 'Fixed charges', total: 500 }]
      },
      carbonExtraction: baseCarbonElectricity
    });
    expect(r.consolidateAsSingleUtilityBill).toBe(true);
    expect(r.utilityType).toBe('electricity');
    expect(r.agents[0].name).toBe('state_utility_board_single_bill_agent');
  });

  test('consolidates water board vendor with corpus hints', () => {
    const r = stateUtilityBoardBillAgent.analyzeStateUtilityBoardBill({
      document: { documentType: 'receipt' },
      extractedData: {
        vendor: { name: 'Delhi Jal Board' },
        description: 'Water bill',
        category: 'utilities',
        rawText: 'Consumption 42 KL'
      },
      carbonExtraction: {
        extractedData: {
          carbonRelevant: true,
          energy: { electricity: { consumption: 0 }, fuel: { consumption: 0 }, renewable: { percentage: 0 } },
          materials: { rawMaterials: { quantity: 0 }, packaging: { quantity: 0 } },
          transportation: { distance: 0, fuelConsumption: 0 },
          waste: { solid: { quantity: 0 }, hazardous: { quantity: 0 } },
          water: { consumption: 42000 }
        }
      }
    });
    expect(r.consolidateAsSingleUtilityBill).toBe(true);
    expect(r.utilityType).toBe('water');
  });

  test('does not consolidate unrelated retail invoices', () => {
    const r = stateUtilityBoardBillAgent.analyzeStateUtilityBoardBill({
      document: { documentType: 'bill' },
      extractedData: {
        vendor: { name: 'Local Stationery Mart' },
        description: 'Office supplies',
        category: 'equipment',
        items: [{ name: 'Paper', total: 200 }]
      },
      carbonExtraction: null
    });
    expect(r.consolidateAsSingleUtilityBill).toBe(false);
  });

  test('ignores non-bill document types', () => {
    const r = stateUtilityBoardBillAgent.analyzeStateUtilityBoardBill({
      document: { documentType: 'other' },
      extractedData: {
        vendor: { name: 'Maharashtra State Electricity Distribution Co. Ltd' },
        description: 'Power'
      },
      carbonExtraction: baseCarbonElectricity
    });
    expect(r.consolidateAsSingleUtilityBill).toBe(false);
  });
});
