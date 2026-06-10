class CarbonForecastingService {
  constructor() {
    this.forecastingModels = {
      // Linear regression for trend analysis
      linear: this.linearRegression,
      // Exponential smoothing for seasonal patterns
      exponential: this.exponentialSmoothing,
      // Moving average for smoothing
      movingAverage: this.movingAverage,
      // ARIMA-like model for complex patterns
      arima: this.arimaModel
    };
  }

  /**
   * Generate carbon footprint forecast for MSME
   * @param {Object} msmeData - MSME profile data
   * @param {Array} historicalAssessments - Array of past carbon assessments
   * @param {Object} options - Forecasting options
   * @returns {Object} Forecast data with past, current, and future projections
   */
  async generateCarbonFootprintForecast(msmeData, historicalAssessments, options = {}) {
    const {
      forecastPeriods = 12, // months
      confidenceLevel = 0.95,
      includeSeasonality = true,
      includeTrend = true,
      modelType = 'auto' // auto, linear, exponential, movingAverage, arima
    } = options;

    try {
      // Prepare historical data
      const historicalData = this.prepareHistoricalData(historicalAssessments);
      if (historicalData.length < 3) {
        return {
          success: false,
          error: 'Forecasting requires minimum 3 completed assessments',
          message: 'Forecasting requires minimum 3 completed assessments',
          errorCode: 'insufficient_data',
          code: 'insufficient_data'
        };
      }
      
      // Select best model if auto
      const selectedModel = modelType === 'auto' 
        ? this.selectBestModel(historicalData)
        : this.forecastingModels[modelType];

      // Generate forecast
      const forecast = await this.generateForecast(
        historicalData,
        selectedModel,
        forecastPeriods,
        confidenceLevel,
        includeSeasonality,
        includeTrend
      );

      // Calculate forecast accuracy metrics
      const accuracyMetrics = this.calculateAccuracyMetrics(historicalData, forecast);

      // Generate insights and recommendations
      const insights = this.generateForecastInsights(forecast, msmeData, historicalData);

      return {
        success: true,
        data: {
          historical: historicalData,
          current: this.getCurrentYearData(historicalData),
          forecast: forecast,
          accuracy: accuracyMetrics,
          insights: insights,
          model: {
            type: selectedModel.name,
            parameters: forecast.parameters
          }
        }
      };

    } catch (error) {
      console.error('Carbon forecasting error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Prepare historical data for forecasting
   */
  prepareHistoricalData(assessments) {
    if (!assessments || assessments.length === 0) {
      return [];
    }

    return assessments
      .sort((a, b) => new Date(a.period.startDate) - new Date(b.period.startDate))
      .map((assessment, index) => ({
        period: index + 1,
        date: new Date(assessment.period.startDate),
        year: new Date(assessment.period.startDate).getFullYear(),
        month: new Date(assessment.period.startDate).getMonth() + 1,
        totalCO2: assessment.totalCO2Emissions,
        breakdown: assessment.breakdown,
        carbonScore: assessment.carbonScore,
        esgScopes: assessment.esgScopes
      }));
  }

  /**
   * Generate fallback breakdown data when historical details are unavailable.
   */
  generateFallbackBreakdown(totalCO2) {
    const energy = totalCO2 * 0.4;
    const water = totalCO2 * 0.1;
    const waste = totalCO2 * 0.15;
    const transportation = totalCO2 * 0.2;
    const materials = totalCO2 * 0.1;
    const manufacturing = totalCO2 * 0.05;

    return {
      energy: { total: energy, electricity: energy * 0.7, fuel: energy * 0.3 },
      water: { consumption: water * 1000, co2Emissions: water },
      waste: { total: waste, solid: waste * 0.8, hazardous: waste * 0.2 },
      transportation: { co2Emissions: transportation, vehicleCount: 3, fuelEfficiency: 12 },
      materials: { co2Emissions: materials, consumption: materials * 10, type: 'steel' },
      manufacturing: { co2Emissions: manufacturing, productionVolume: 1000, efficiency: 75 }
    };
  }

  /**
   * Generate fallback ESG scopes when historical details are unavailable.
   */
  generateFallbackESGScopes(totalCO2) {
    return {
      scope1: { total: totalCO2 * 0.3, breakdown: { directFuel: totalCO2 * 0.2, directTransport: totalCO2 * 0.1 } },
      scope2: { total: totalCO2 * 0.4, breakdown: { electricity: totalCO2 * 0.4 } },
      scope3: { total: totalCO2 * 0.3, breakdown: { purchasedGoods: totalCO2 * 0.2, transportation: totalCO2 * 0.1 } }
    };
  }

  /**
   * Select best forecasting model based on data characteristics
   */
  selectBestModel(historicalData) {
    if (historicalData.length < 6) {
      return this.forecastingModels.linear;
    }

    // Calculate data characteristics
    const values = historicalData.map(d => d.totalCO2);
    const trend = this.calculateTrend(values);
    const seasonality = this.calculateSeasonality(values);
    const volatility = this.calculateVolatility(values);

    // Select model based on characteristics
    if (seasonality > 0.3) {
      return this.forecastingModels.exponential;
    } else if (volatility > 0.2) {
      return this.forecastingModels.movingAverage;
    } else if (Math.abs(trend) > 0.1) {
      return this.forecastingModels.linear;
    } else {
      return this.forecastingModels.arima;
    }
  }

  /**
   * Calculate trend in data
   */
  calculateTrend(values) {
    if (values.length < 2) return 0;
    
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = values;
    
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return slope / (sumY / n); // Normalized trend
  }

  /**
   * Calculate seasonality in data
   */
  calculateSeasonality(values) {
    if (values.length < 12) return 0;
    
    // Calculate monthly averages
    const monthlyAverages = Array.from({ length: 12 }, () => []);
    values.forEach((value, index) => {
      monthlyAverages[index % 12].push(value);
    });
    
    const avgValues = monthlyAverages.map(month => 
      month.reduce((a, b) => a + b, 0) / month.length
    );
    
    const overallAverage = avgValues.reduce((a, b) => a + b, 0) / 12;
    
    // Calculate coefficient of variation
    const variance = avgValues.reduce((sum, val) => sum + Math.pow(val - overallAverage, 2), 0) / 12;
    return Math.sqrt(variance) / overallAverage;
  }

  /**
   * Calculate volatility in data
   */
  calculateVolatility(values) {
    if (values.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < values.length; i++) {
      returns.push((values[i] - values[i-1]) / values[i-1]);
    }
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  /**
   * Generate forecast using selected model
   */
  async generateForecast(historicalData, model, periods, confidenceLevel, includeSeasonality, includeTrend) {
    if (!Array.isArray(historicalData) || historicalData.length < 3) {
      throw new Error('At least 3 historical assessments are required for forecasting');
    }

    const values = historicalData.map(d => d.totalCO2);
    const forecast = await model(values, periods, { includeSeasonality, includeTrend });
    
    // Generate confidence intervals
    const confidenceIntervals = this.calculateConfidenceIntervals(
      values, 
      forecast, 
      confidenceLevel
    );

    // Format forecast data
    const forecastData = [];
    const lastDate = historicalData[historicalData.length - 1].date;
    
    for (let i = 0; i < periods; i++) {
      const forecastDate = new Date(lastDate.getFullYear(), lastDate.getMonth() + i + 1, 1);
      const value = forecast[i];
      const lowerBound = confidenceIntervals.lower[i];
      const upperBound = confidenceIntervals.upper[i];
      
      forecastData.push({
        period: historicalData.length + i + 1,
        date: forecastDate,
        year: forecastDate.getFullYear(),
        month: forecastDate.getMonth() + 1,
        totalCO2: Math.round(value),
        confidenceInterval: {
          lower: Math.round(lowerBound),
          upper: Math.round(upperBound)
        },
        breakdown: this.generateFallbackBreakdown(value),
        carbonScore: this.forecastCarbonScore(value, historicalData),
        esgScopes: this.generateFallbackESGScopes(value)
      });
    }

    return {
      data: forecastData,
      parameters: forecast.parameters || {},
      model: model.name
    };
  }

  /**
   * Linear regression forecasting
   */
  linearRegression(values, periods, options = {}) {
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = values;
    
    // Calculate regression coefficients
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // Generate forecast
    const forecast = [];
    for (let i = 0; i < periods; i++) {
      forecast.push(intercept + slope * (n + i));
    }
    
    return {
      data: forecast,
      parameters: { slope, intercept },
      name: 'linear'
    };
  }

  /**
   * Exponential smoothing forecasting
   */
  exponentialSmoothing(values, periods, options = {}) {
    const alpha = 0.3; // Smoothing parameter
    const forecast = [];
    
    // Calculate initial smoothed value
    let smoothed = values[0];
    
    // Apply exponential smoothing
    for (let i = 1; i < values.length; i++) {
      smoothed = alpha * values[i] + (1 - alpha) * smoothed;
    }
    
    // Generate forecast
    for (let i = 0; i < periods; i++) {
      forecast.push(smoothed);
    }
    
    return {
      data: forecast,
      parameters: { alpha },
      name: 'exponential'
    };
  }

  /**
   * Moving average forecasting
   */
  movingAverage(values, periods, options = {}) {
    const window = Math.min(3, Math.floor(values.length / 2));
    const forecast = [];
    
    // Calculate moving average
    const recentValues = values.slice(-window);
    const average = recentValues.reduce((a, b) => a + b, 0) / window;
    
    // Generate forecast
    for (let i = 0; i < periods; i++) {
      forecast.push(average);
    }
    
    return {
      data: forecast,
      parameters: { window },
      name: 'movingAverage'
    };
  }

  /**
   * ARIMA-like model forecasting
   */
  arimaModel(values, periods, options = {}) {
    // Simplified ARIMA implementation
    const forecast = [];
    const recentValues = values.slice(-6); // Use last 6 values
    
    // Calculate trend locally
    const calculateTrend = (vals) => {
      if (vals.length < 2) return 0;
      const n = vals.length;
      const x = Array.from({ length: n }, (_, i) => i);
      const y = vals;
      const sumX = x.reduce((a, b) => a + b, 0);
      const sumY = y.reduce((a, b) => a + b, 0);
      const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
      const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
      const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
      return slope / (sumY / n);
    };
    
    const trend = calculateTrend(recentValues);
    const lastValue = values[values.length - 1];
    
    // Generate forecast with trend
    for (let i = 0; i < periods; i++) {
      forecast.push(lastValue + trend * (i + 1));
    }
    
    return {
      data: forecast,
      parameters: { trend },
      name: 'arima'
    };
  }

  /**
   * Calculate trend in data
   */

  /**
   * Calculate confidence intervals
   */
  calculateConfidenceIntervals(historicalValues, forecast, confidenceLevel) {
    const residuals = this.calculateResiduals(historicalValues, forecast);
    const standardError = this.calculateStandardError(residuals);
    const zScore = this.getZScore(confidenceLevel);
    
    const lower = forecast.data.map(value => value - zScore * standardError);
    const upper = forecast.data.map(value => value + zScore * standardError);
    
    return { lower, upper };
  }

  /**
   * Calculate residuals for confidence interval calculation
   */
  calculateResiduals(historicalValues, forecast) {
    // For simplicity, use historical variance
    const mean = historicalValues.reduce((a, b) => a + b, 0) / historicalValues.length;
    const variance = historicalValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / historicalValues.length;
    return Math.sqrt(variance);
  }

  /**
   * Calculate standard error
   */
  calculateStandardError(residuals) {
    return residuals;
  }

  /**
   * Get Z-score for confidence level
   */
  getZScore(confidenceLevel) {
    const zScores = {
      0.90: 1.645,
      0.95: 1.96,
      0.99: 2.576
    };
    return zScores[confidenceLevel] || 1.96;
  }

  /**
   * Calculate forecast accuracy metrics
   */
  calculateAccuracyMetrics(historicalData, forecast) {
    if (historicalData.length < 2) {
      return { mape: 0, rmse: 0, mae: 0 };
    }

    // Use last few points for validation
    const validationPoints = Math.min(3, Math.floor(historicalData.length / 2));
    const actual = historicalData.slice(-validationPoints).map(d => d.totalCO2);
    const predicted = forecast.data.slice(0, validationPoints);

    const mape = this.calculateMAPE(actual, predicted);
    const rmse = this.calculateRMSE(actual, predicted);
    const mae = this.calculateMAE(actual, predicted);

    return { mape, rmse, mae };
  }

  /**
   * Calculate Mean Absolute Percentage Error
   */
  calculateMAPE(actual, predicted) {
    const errors = actual.map((a, i) => Math.abs((a - predicted[i]) / a));
    return errors.reduce((a, b) => a + b, 0) / errors.length * 100;
  }

  /**
   * Calculate Root Mean Square Error
   */
  calculateRMSE(actual, predicted) {
    const errors = actual.map((a, i) => Math.pow(a - predicted[i], 2));
    return Math.sqrt(errors.reduce((a, b) => a + b, 0) / errors.length);
  }

  /**
   * Calculate Mean Absolute Error
   */
  calculateMAE(actual, predicted) {
    const errors = actual.map((a, i) => Math.abs(a - predicted[i]));
    return errors.reduce((a, b) => a + b, 0) / errors.length;
  }

  /**
   * Get current year data
   */
  getCurrentYearData(historicalData) {
    const currentYear = new Date().getFullYear();
    return historicalData.filter(d => d.year === currentYear);
  }

  /**
   * Forecast carbon score based on CO2 emissions
   */
  forecastCarbonScore(co2Emissions, historicalData) {
    // Simple scoring based on emissions level
    const avgScore = historicalData.reduce((sum, d) => sum + d.carbonScore, 0) / historicalData.length;
    const avgCO2 = historicalData.reduce((sum, d) => sum + d.totalCO2, 0) / historicalData.length;
    
    const scoreAdjustment = (avgCO2 - co2Emissions) / avgCO2 * 10;
    return Math.max(0, Math.min(100, Math.round(avgScore + scoreAdjustment)));
  }

  /**
   * Generate forecast insights
   */
  generateForecastInsights(forecast, msmeData, historicalData) {
    const insights = [];
    
    // Calculate trend
    const currentYear = historicalData.filter(d => d.year === new Date().getFullYear());
    const lastYear = historicalData.filter(d => d.year === new Date().getFullYear() - 1);
    
    if (currentYear.length > 0 && lastYear.length > 0) {
      const currentAvg = currentYear.reduce((sum, d) => sum + d.totalCO2, 0) / currentYear.length;
      const lastYearAvg = lastYear.reduce((sum, d) => sum + d.totalCO2, 0) / lastYear.length;
      const trend = ((currentAvg - lastYearAvg) / lastYearAvg) * 100;
      
      if (Math.abs(trend) > 5) {
        insights.push({
          type: 'trend',
          title: trend > 0 ? 'Increasing Emissions Trend' : 'Decreasing Emissions Trend',
          description: `Your carbon emissions have ${trend > 0 ? 'increased' : 'decreased'} by ${Math.abs(trend).toFixed(1)}% compared to last year.`,
          priority: trend > 0 ? 'high' : 'low',
          impact: Math.abs(trend)
        });
      }
    }
    
    // Forecast insights
    const forecastValues = forecast.data.map(d => d.totalCO2);
    const currentAvg = historicalData.slice(-6).reduce((sum, d) => sum + d.totalCO2, 0) / 6;
    const forecastAvg = forecastValues.reduce((sum, val) => sum + val, 0) / forecastValues.length;
    const projectedChange = ((forecastAvg - currentAvg) / currentAvg) * 100;
    
    if (Math.abs(projectedChange) > 10) {
      insights.push({
        type: 'forecast',
        title: 'Significant Projected Change',
        description: `Based on current trends, your carbon emissions are projected to ${projectedChange > 0 ? 'increase' : 'decrease'} by ${Math.abs(projectedChange).toFixed(1)}% next year.`,
        priority: 'medium',
        impact: Math.abs(projectedChange)
      });
    }
    
    // Recommendations based on forecast
    if (forecastAvg > currentAvg * 1.1) {
      insights.push({
        type: 'recommendation',
        title: 'Action Required',
        description: 'Your carbon emissions are projected to increase. Consider implementing energy efficiency measures.',
        priority: 'high',
        impact: 15
      });
    }
    
    return insights;
  }
}

module.exports = new CarbonForecastingService();