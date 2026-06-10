const { assignProductsToTransaction, buildProductCatalog, inferManufacturedProductsFromAgentContext } = require('../utils/productAttribution');
const {
  aggregateTransactionEmissionsByProduct,
  applyReportingConfigurationToBreakdown
} = require('../utils/reportingProductAggregation');

describe('product attribution and reporting aggregation', () => {
  const msmeProfile = {
    business: {
      primaryProducts: 'Eco Panel, Carbon Filter',
      manufacturingWorkflow: {
        units: [
          {
            unitId: 'unit-1',
            products: ['Eco Panel']
          },
          {
            unitId: 'unit-2',
            products: ['Carbon Filter']
          }
        ]
      }
    },
    manufacturingProfile: {
      keyProducts: ['Eco Panel']
    }
  };

  test('buildProductCatalog merges profile and workflow products', () => {
    const catalog = buildProductCatalog(msmeProfile);
    expect(catalog).toHaveLength(2);
    expect(catalog.map(item => item.productName)).toEqual(
      expect.arrayContaining(['Eco Panel', 'Carbon Filter'])
    );
  });

  test('assignProductsToTransaction respects explicit products', () => {
    const transaction = {
      description: 'Sold Eco Panel batch',
      productNames: ['Eco Panel'],
      metadata: {
        extractedData: {}
      }
    };

    const attributed = assignProductsToTransaction(transaction, msmeProfile, {
      assignmentSource: 'unit_test'
    });

    expect(attributed.productAttribution).toBeDefined();
    expect(attributed.productAttribution.assignmentMethod).toBe('explicit_input');
    expect(attributed.productAttribution.assignedProducts).toHaveLength(1);
    expect(attributed.productAttribution.assignedProducts[0].productName).toBe('Eco Panel');
    expect(attributed.productAttribution.assignedProducts[0].allocationPercent).toBe(100);
  });

  test('inferManufacturedProductsFromAgentContext merges document text and profiler signals', () => {
    const transaction = {
      description: 'Raw materials for Eco Panel finishing line',
      metadata: { extractedData: {} }
    };
    const agentContext = { productSignals: ['eco panel'] };
    const inferred = inferManufacturedProductsFromAgentContext(transaction, msmeProfile, agentContext);
    expect(inferred).toEqual(expect.arrayContaining(['Eco Panel']));
  });

  test('aggregateTransactionEmissionsByProduct allocates emissions by percentage', () => {
    const transactions = [
      {
        amount: 1000,
        carbonFootprint: {
          co2Emissions: 120,
          emissionBreakdown: { scope1: 30, scope2: 40, scope3: 50 }
        },
        productAttribution: {
          assignedProducts: [
            { productId: 'eco_panel', productName: 'Eco Panel', allocationPercent: 60 },
            { productId: 'carbon_filter', productName: 'Carbon Filter', allocationPercent: 40 }
          ]
        }
      }
    ];

    const breakdown = aggregateTransactionEmissionsByProduct({ transactions, msme: msmeProfile });
    const ecoPanel = breakdown.products.find(item => item.productId === 'eco_panel');
    const carbonFilter = breakdown.products.find(item => item.productId === 'carbon_filter');

    expect(breakdown.organization.totalEmissions).toBe(120);
    expect(ecoPanel.totalEmissions).toBe(72);
    expect(carbonFilter.totalEmissions).toBe(48);
  });

  test('applyReportingConfigurationToBreakdown can hide product scope details', () => {
    const breakdown = {
      organization: {
        totalEmissions: 120
      },
      products: [
        {
          productId: 'eco_panel',
          productName: 'Eco Panel',
          totalEmissions: 72,
          totalAmount: 600,
          transactionCount: 0.6,
          scopes: { scope1: 18, scope2: 24, scope3: 30 }
        }
      ],
      attributionStats: {
        assignedTransactions: 1,
        unassignedTransactions: 0,
        assignedTransactionRatio: 1
      }
    };

    const reportView = applyReportingConfigurationToBreakdown({
      breakdown,
      config: {
        includeProductScopeBreakdown: 'false',
        includeAttributionStats: 'false'
      }
    });

    expect(reportView.organizationSummary.totalEmissions).toBe(120);
    expect(reportView.productBreakdown).toHaveLength(1);
    expect(reportView.productBreakdown[0].scopes).toBeUndefined();
    expect(reportView.attributionStats).toBeUndefined();
  });
});
