const {
  buildEmissionsAchievements,
  buildFinanceOverview,
  GREEN_LOAN_MIN_CARBON_SAVINGS_PERCENT
} = require('../services/financeEligibilityService');

jest.mock('../models/CarbonAssessment', () => ({
  find: jest.fn()
}));

jest.mock('../models/Recommendation', () => ({
  countDocuments: jest.fn()
}));

jest.mock('../models/GIFTScheme', () => ({
  find: jest.fn()
}));

jest.mock('../models/Bank', () => ({
  find: jest.fn()
}));

jest.mock('../models/UserIncentiveProfile', () => ({
  findOne: jest.fn()
}));

jest.mock('../services/adeetieEligibilityService', () => ({
  evaluateEligibility: jest.fn(),
  computeReadinessScore: jest.fn()
}));

const CarbonAssessment = require('../models/CarbonAssessment');
const Recommendation = require('../models/Recommendation');
const GIFTScheme = require('../models/GIFTScheme');
const Bank = require('../models/Bank');
const UserIncentiveProfile = require('../models/UserIncentiveProfile');
const adeetieService = require('../services/adeetieEligibilityService');

const msme = {
  _id: 'msme-1',
  companyName: 'Demo Fabrics',
  companyType: 'small',
  carbonScore: 72,
  isVerified: true,
  business: {
    annualTurnover: 50000000,
    numberOfEmployees: 45
  },
  environmentalCompliance: {
    iso14001: true,
    energyAudit: true
  },
  sustainabilitySettings: {
    reductionTargetPct: 15
  },
  manufacturingProfile: {
    beeSector: 'textiles',
    adeetieClusterId: 'textiles-tiruppur-tn'
  },
  udyamRegistrationNumber: 'UDYAM-TN-02-1234567',
  gstNumber: '33AABCU9603R1ZM'
};

describe('financeEligibilityService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    CarbonAssessment.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              totalCO2Emissions: 8000,
              carbonScore: 72,
              carbonSavings: { totalSavings: 1200, savingsPercentage: 12 }
            },
            {
              totalCO2Emissions: 9200,
              carbonScore: 65,
              carbonSavings: { totalSavings: 400, savingsPercentage: 4 }
            }
          ])
        })
      })
    });

    Recommendation.countDocuments
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2);

    GIFTScheme.find.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            eligibilityCriteria: {
              minCarbonScore: 60,
              minAnnualTurnover: 1000000,
              maxAnnualTurnover: 100000000,
              companyTypes: ['small', 'medium'],
              minEmployees: 10,
              maxEmployees: 200
            }
          }
        ])
      })
    });

    Bank.find.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { bankName: 'Green Bank', greenLoanPolicy: { minCarbonScore: 60 } }
        ])
      })
    });

    UserIncentiveProfile.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        totalPoints: 450,
        level: 2,
        rewards: [{ cost: 200, available: true }]
      })
    });

    adeetieService.evaluateEligibility.mockReturnValue({
      isEligible: true,
      subventionRatePercent: 5,
      criteria: [{ id: 'udyam', label: 'Udyam', passed: true, hint: null }]
    });

    adeetieService.computeReadinessScore.mockResolvedValue({
      readinessScore: 78,
      estimatedEnergySavingsPercent: 12,
      minRequiredSavingsPercent: 10
    });
  });

  test('buildEmissionsAchievements derives reduction metrics from assessment history', async () => {
    const achievements = await buildEmissionsAchievements(msme);

    expect(achievements.assessmentCount).toBe(2);
    expect(achievements.implementedRecommendations).toBe(4);
    expect(achievements.reductionPercent).toBeGreaterThan(0);
    expect(achievements.hasReductionHistory).toBe(true);
    expect(achievements.savingsPercent).toBe(12);
  });

  test('buildFinanceOverview returns structured options with eligibility', async () => {
    const overview = await buildFinanceOverview('user-1', msme);

    expect(overview.companyName).toBe('Demo Fabrics');
    expect(overview.options).toHaveLength(5);
    expect(overview.options.find((option) => option.id === 'green_loans')?.isEligible).toBe(true);
    expect(overview.options.find((option) => option.id === 'adeetie')?.isEligible).toBe(true);
    expect(overview.summary.eligibleCount).toBeGreaterThan(0);
    expect(overview.nextSteps.length).toBeGreaterThan(0);
  });

  test('exports green loan savings threshold constant', () => {
    expect(GREEN_LOAN_MIN_CARBON_SAVINGS_PERCENT).toBe(10);
  });
});
