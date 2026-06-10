const carbonForecastingService = require('../services/carbonForecastingService');

describe('Carbon Forecasting Service', () => {
  let mockMsmeData;
  let mockHistoricalAssessments;

  beforeEach(() => {
    mockMsmeData = {
      _id: '507f1f77bcf86cd799439011',
      companyName: 'Test MSME',
      companyType: 'small',
      industry: 'manufacturing',
      business: {
        annualTurnover: 1000000,
        numberOfEmployees: 50,
        manufacturingUnits: 2
      }
    };

    mockHistoricalAssessments = [
      {
        _id: '507f1f77bcf86cd799439012',
        msmeId: '507f1f77bcf86cd799439011',
        period: {
          startDate: new Date('2023-01-01'),
          endDate: new Date('2023-01-31')
        },
        totalCO2Emissions: 800,
        carbonScore: 75,
        breakdown: {
          energy: { total: 320 },
          water: { co2Emissions: 80 },
          waste: { total: 120 },
          transportation: { co2Emissions: 160 },
          materials: { co2Emissions: 80 },
          manufacturing: { co2Emissions: 40 }
        }
      },
      {
        _id: '507f1f77bcf86cd799439013',
        msmeId: '507f1f77bcf86cd799439011',
        period: {
          startDate: new Date('2023-02-01'),
          endDate: new Date('2023-02-28')
        },
        totalCO2Emissions: 750,
        carbonScore: 78,
        breakdown: {
          energy: { total: 300 },
          water: { co2Emissions: 75 },
          waste: { total: 110 },
          transportation: { co2Emissions: 150 },
          materials: { co2Emissions: 75 },
          manufacturing: { co2Emissions: 40 }
        }
      },
      {
        _id: '507f1f77bcf86cd799439014',
        msmeId: '507f1f77bcf86cd799439011',
        period: {
          startDate: new Date('2023-03-01'),
          endDate: new Date('2023-03-31')
        },
        totalCO2Emissions: 720,
        carbonScore: 80,
        breakdown: {
          energy: { total: 288 },
          water: { co2Emissions: 72 },
          waste: { total: 108 },
          transportation: { co2Emissions: 144 },
          materials: { co2Emissions: 72 },
          manufacturing: { co2Emissions: 36 }
        }
      }
    ];
  });

  describe('generateCarbonFootprintForecast', () => {
    it('should generate forecast successfully with valid data', async () => {
      const result = await carbonForecastingService.generateCarbonFootprintForecast(
        mockMsmeData,
        mockHistoricalAssessments,
        { forecastPeriods: 6, modelType: 'linear' }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.historical).toBeDefined();
      expect(result.data.forecast).toBeDefined();
      expect(result.data.forecast.data).toHaveLength(6);
      expect(result.data.accuracy).toBeDefined();
      expect(result.data.insights).toBeDefined();
    });

    it('should reject forecast when historical data is missing', async () => {
      const result = await carbonForecastingService.generateCarbonFootprintForecast(
        mockMsmeData,
        [],
        { forecastPeriods: 12, modelType: 'auto' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/minimum 3 completed assessments/i);
    });

    it('should handle different model types', async () => {
      const models = [
        { input: 'linear', expected: 'linearRegression' },
        { input: 'exponential', expected: 'exponentialSmoothing' },
        { input: 'movingAverage', expected: 'movingAverage' },
        { input: 'arima', expected: 'arimaModel' }
      ];
      
      for (const model of models) {
        const result = await carbonForecastingService.generateCarbonFootprintForecast(
          mockMsmeData,
          mockHistoricalAssessments,
          { forecastPeriods: 6, modelType: model.input }
        );

        expect(result.success).toBe(true);
        expect(result.data.model.type).toBe(model.expected);
      }
    });

    it('should generate insights based on forecast data', async () => {
      const result = await carbonForecastingService.generateCarbonFootprintForecast(
        mockMsmeData,
        mockHistoricalAssessments,
        { forecastPeriods: 12, modelType: 'linear' }
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data.insights)).toBe(true);
    });
  });

  describe('prepareHistoricalData', () => {
    it('should format historical data correctly', () => {
      const result = carbonForecastingService.prepareHistoricalData(mockHistoricalAssessments);
      
      expect(result).toHaveLength(3);
      expect(result[0]).toHaveProperty('period');
      expect(result[0]).toHaveProperty('date');
      expect(result[0]).toHaveProperty('totalCO2');
      expect(result[0]).toHaveProperty('carbonScore');
    });

    it('should sort data by date', () => {
      const unsortedAssessments = [...mockHistoricalAssessments].reverse();
      const result = carbonForecastingService.prepareHistoricalData(unsortedAssessments);
      
      expect(result[0].period).toBeLessThan(result[1].period);
    });
  });

  describe('selectBestModel', () => {
    it('should select linear model for short data', () => {
      const shortData = mockHistoricalAssessments.slice(0, 1);
      const result = carbonForecastingService.selectBestModel(shortData);
      
      expect(result.name).toBe('linearRegression');
    });

    it('should select appropriate model based on data characteristics', () => {
      const mockData = Array.from({ length: 12 }, (_, i) => ({
        totalCO2: 800 + Math.sin(i / 12 * 2 * Math.PI) * 100 // Seasonal data
      }));
      
      const result = carbonForecastingService.selectBestModel(mockData);
      expect(result).toBeDefined();
      expect(result.name).toBeDefined();
    });
  });

  describe('calculateTrend', () => {
    it('should calculate positive trend correctly', () => {
      const values = [100, 110, 120, 130, 140];
      const trend = carbonForecastingService.calculateTrend(values);
      
      expect(trend).toBeGreaterThan(0);
    });

    it('should calculate negative trend correctly', () => {
      const values = [140, 130, 120, 110, 100];
      const trend = carbonForecastingService.calculateTrend(values);
      
      expect(trend).toBeLessThan(0);
    });

    it('should handle empty array', () => {
      const trend = carbonForecastingService.calculateTrend([]);
      expect(trend).toBe(0);
    });
  });

  describe('calculateSeasonality', () => {
    it('should detect seasonal patterns', () => {
      const values = [100, 120, 100, 120, 100, 120, 100, 120, 100, 120, 100, 120];
      const seasonality = carbonForecastingService.calculateSeasonality(values);
      
      expect(seasonality).toBeGreaterThan(0);
    });

    it('should return 0 for non-seasonal data', () => {
      const values = [100, 100, 100, 100, 100, 100];
      const seasonality = carbonForecastingService.calculateSeasonality(values);
      
      expect(seasonality).toBe(0);
    });
  });

  describe('calculateVolatility', () => {
    it('should calculate volatility correctly', () => {
      const values = [100, 120, 80, 140, 60];
      const volatility = carbonForecastingService.calculateVolatility(values);
      
      expect(volatility).toBeGreaterThan(0);
    });

    it('should return 0 for constant values', () => {
      const values = [100, 100, 100, 100];
      const volatility = carbonForecastingService.calculateVolatility(values);
      
      expect(volatility).toBe(0);
    });
  });
});