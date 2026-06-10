const mongoose = require('mongoose');
const carbonCreditsService = require('../services/carbonCreditsService');
const { CarbonCredits, MSMECarbonCredits, CarbonCreditTransaction } = require('../models/CarbonCredits');
const CarbonAssessment = require('../models/CarbonAssessment');
const MSME = require('../models/MSME');
const User = require('../models/User');

// Mock data
const mockUser = {
  _id: new mongoose.Types.ObjectId(),
  name: 'Test User',
  email: 'test@example.com',
  password: 'hashedpassword'
};

const mockMSME = {
  _id: new mongoose.Types.ObjectId(),
  userId: mockUser._id,
  companyName: 'Test MSME',
  companyType: 'small',
  industry: 'Manufacturing',
  businessDomain: 'manufacturing',
  establishmentYear: 2010,
  udyamRegistrationNumber: 'UDYAM-KR-03-0593459',
  gstNumber: '12ABCDE1234F1Z5',
  panNumber: 'ABCDE1234F',
  contact: {
    email: 'test@msme.com',
    phone: '9876543210',
    address: {
      street: 'Test Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001'
    }
  },
  business: {
    annualTurnover: 1000000,
    numberOfEmployees: 50,
    manufacturingUnits: 1,
    primaryProducts: 'Test Products'
  }
};

const mockAssessment = {
  _id: new mongoose.Types.ObjectId(),
  msmeId: mockMSME._id,
  assessmentType: 'automatic',
  period: {
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-01-31')
  },
  totalCO2Emissions: 1000, // kg
  carbonScore: 75,
  status: 'completed'
};

describe('Carbon Credits Service', () => {
  beforeAll(async () => {
    // Connect to test database
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/carbon_intelligence_test';
    await mongoose.connect(mongoUri);
  }, 30000);

  afterAll(async () => {
    // Clean up test data
    await CarbonCredits.deleteMany({});
    await MSMECarbonCredits.deleteMany({});
    await CarbonCreditTransaction.deleteMany({});
    await CarbonAssessment.deleteMany({});
    await MSME.deleteMany({});
    await User.deleteMany({});
  }, 30000);

  beforeEach(async () => {
    // Clean up before each test
    await CarbonCredits.deleteMany({});
    await MSMECarbonCredits.deleteMany({});
    await CarbonCreditTransaction.deleteMany({});
    await CarbonAssessment.deleteMany({});
    await MSME.deleteMany({});
    await User.deleteMany({});
  });

  describe('Pool Initialization', () => {
    test('should initialize carbon credits pool', async () => {
      const pool = await carbonCreditsService.initializePool();
      
      expect(pool).toBeDefined();
      expect(pool.poolId).toBe('indian_carbon_market_pool');
      expect(pool.totalCreditsAvailable).toBe(0);
      expect(pool.verificationStatus).toBe('pending');
    });
  });

  describe('MSME Credits Management', () => {
    beforeEach(async () => {
      // Create test data
      await new User(mockUser).save();
      await new MSME(mockMSME).save();
      await new CarbonAssessment(mockAssessment).save();
    });

    test('should get MSME credits (create if not exists)', async () => {
      const msmeCredits = await carbonCreditsService.getMSMECredits(mockMSME._id);
      
      expect(msmeCredits).toBeDefined();
      expect(msmeCredits.msmeId.toString()).toBe(mockMSME._id.toString());
      expect(msmeCredits.allocatedCredits).toBe(0);
      expect(msmeCredits.availableCredits).toBe(0);
    });

    test('should allocate credits to MSME', async () => {
      const creditsAmount = 50;
      const co2Reduced = 500;
      
      const result = await carbonCreditsService.allocateCreditsToMSME(
        mockMSME._id,
        creditsAmount,
        co2Reduced,
        'proportional',
        mockAssessment._id
      );
      
      expect(result.allocatedCredits).toBe(creditsAmount);
      expect(result.availableCredits).toBe(creditsAmount);
      expect(result.totalCO2Reduced).toBe(co2Reduced);
      expect(result.allocationHistory).toHaveLength(1);
    });

    test('should use credits', async () => {
      // First allocate credits
      await carbonCreditsService.allocateCreditsToMSME(
        mockMSME._id,
        100,
        1000,
        'proportional',
        mockAssessment._id
      );
      
      // Then use credits
      const result = await carbonCreditsService.useCredits(
        mockMSME._id,
        30,
        'Test usage',
        'TEST_REF_001'
      );
      
      expect(result.availableCredits).toBe(70);
      expect(result.usedCredits).toBe(30);
    });

    test('should retire credits', async () => {
      // First allocate credits
      await carbonCreditsService.allocateCreditsToMSME(
        mockMSME._id,
        100,
        1000,
        'proportional',
        mockAssessment._id
      );
      
      // Then retire credits
      const result = await carbonCreditsService.retireCredits(
        mockMSME._id,
        20,
        'Test retirement'
      );
      
      expect(result.availableCredits).toBe(80);
      expect(result.retiredCredits).toBe(20);
    });

    test('should throw error when using insufficient credits', async () => {
      await expect(
        carbonCreditsService.useCredits(mockMSME._id, 100, 'Test usage')
      ).rejects.toThrow('Insufficient credits available');
    });
  });

  describe('Aggregation and Allocation', () => {
    beforeEach(async () => {
      await new User(mockUser).save();
      await new MSME(mockMSME).save();

      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endDate = new Date(now.getFullYear(), now.getMonth(), 0);

      await new CarbonAssessment({
        ...mockAssessment,
        period: { startDate, endDate },
        totalCO2Emissions: 1000,
        source: 'backend',
      }).save();

      await carbonCreditsService.setICMWorkflowBaseline(mockMSME._id, {
        baselineCO2Emissions: 2000,
      });
    });

    test('should aggregate and allocate credits', async () => {
      const result = await carbonCreditsService.aggregateAndAllocateCredits('monthly');
      
      expect(result.success).toBe(true);
      expect(result.data.totalCO2Reduced).toBeGreaterThan(0);
      expect(result.data.totalCreditsAllocated).toBeGreaterThan(0);
      expect(result.data.msmeCount).toBe(1);
    });

    test('should handle no assessments gracefully', async () => {
      // Remove assessment
      await CarbonAssessment.deleteMany({});
      
      const result = await carbonCreditsService.aggregateAndAllocateCredits('monthly');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('No assessments found');
    });
  });

  describe('Market Data', () => {
    test('should get market data', async () => {
      // Initialize pool
      await carbonCreditsService.initializePool();
      
      const marketData = await carbonCreditsService.getMarketData();
      
      expect(marketData).toBeDefined();
      expect(marketData.pool).toBeDefined();
      expect(marketData.msmeStats).toBeDefined();
      expect(marketData.marketMetrics).toBeDefined();
    });
  });

  describe('Leaderboard', () => {
    beforeEach(async () => {
      // Create test data
      await new User(mockUser).save();
      await new MSME(mockMSME).save();
      await new CarbonAssessment(mockAssessment).save();
      
      // Allocate some credits
      await carbonCreditsService.allocateCreditsToMSME(
        mockMSME._id,
        100,
        1000,
        'proportional',
        mockAssessment._id
      );
    });

    test('should get MSME leaderboard', async () => {
      const leaderboard = await carbonCreditsService.getMSMELeaderboard(10, 'all');
      
      expect(leaderboard).toBeDefined();
      expect(Array.isArray(leaderboard)).toBe(true);
      if (leaderboard.length > 0) {
        expect(leaderboard[0]).toHaveProperty('companyName');
        expect(leaderboard[0]).toHaveProperty('allocatedCredits');
        expect(leaderboard[0]).toHaveProperty('performanceMetrics');
      }
    });
  });

  describe('Transaction Management', () => {
    test('should create carbon credit transaction', async () => {
      const transactionData = {
        fromMSME: mockMSME._id,
        toMSME: new mongoose.Types.ObjectId(),
        type: 'transfer',
        creditsAmount: 50,
        pricePerCredit: 50,
        totalValue: 2500,
        marketType: 'bilateral',
        description: 'Test transfer'
      };
      
      const transaction = await carbonCreditsService.createTransaction(transactionData);
      
      expect(transaction).toBeDefined();
      expect(transaction.transactionId).toBeDefined();
      expect(transaction.type).toBe('transfer');
      expect(transaction.creditsAmount).toBe(50);
    });
  });

  describe('Pool Verification', () => {
    test('should verify carbon credits pool', async () => {
      await carbonCreditsService.initializePool();
      
      const pool = await carbonCreditsService.verifyPool(
        mockUser._id,
        'Test verification'
      );
      
      expect(pool.verificationStatus).toBe('verified');
      expect(pool.verifiedBy.toString()).toBe(mockUser._id.toString());
      expect(pool.indianCarbonMarketCompliance.isCompliant).toBe(true);
    });
  });
});

describe('Carbon Credits Models', () => {
  beforeEach(async () => {
    await MSMECarbonCredits.deleteMany({ msmeId: mockMSME._id });
  });

  test('should create MSME carbon credits with allocation', async () => {
    const msmeCredits = new MSMECarbonCredits({
      msmeId: mockMSME._id,
      poolId: 'indian_carbon_market_pool'
    });
    
    await msmeCredits.allocateCredits(100, 1000, 'proportional', mockAssessment._id);
    
    expect(msmeCredits.allocatedCredits).toBe(100);
    expect(msmeCredits.availableCredits).toBe(100);
    expect(msmeCredits.totalCO2Reduced).toBe(1000);
    expect(msmeCredits.allocationHistory).toHaveLength(1);
  });

  test('should update performance metrics', async () => {
    const msmeCredits = new MSMECarbonCredits({
      msmeId: mockMSME._id,
      poolId: 'indian_carbon_market_pool',
      allocatedCredits: 100,
      totalCO2Reduced: 1000
    });
    
    await msmeCredits.updatePerformanceMetrics();
    
    expect(msmeCredits.performanceMetrics.carbonEfficiency).toBe(0.1); // 100/1000
    expect(msmeCredits.performanceMetrics.participationScore).toBeGreaterThan(0);
  });
});