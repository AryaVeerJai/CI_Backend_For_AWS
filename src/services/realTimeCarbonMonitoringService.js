const EventEmitter = require('events');
const logger = require('../utils/logger');
const { MSMENotificationService } = require('./msmeNotificationService');
const { shouldRunMaintenanceTimers } = require('../config/backgroundLoops');
const { setManagedInterval } = require('../utils/intervalRegistry');

const msmeNotificationService = new MSMENotificationService();

class RealTimeCarbonMonitoringService extends EventEmitter {
  constructor() {
    super();
    
    // Monitoring configuration
    this.config = {
      monitoringInterval: 60000, // 1 minute
      alertThresholds: {
        carbonFootprint: {
          warning: 1000, // kg CO2
          critical: 5000 // kg CO2
        },
        energyConsumption: {
          warning: 500, // kWh
          critical: 2000 // kWh
        },
        wasteGeneration: {
          warning: 100, // kg
          critical: 500 // kg
        },
        waterConsumption: {
          warning: 1000, // liters
          critical: 5000 // liters
        }
      },
      trendAnalysis: {
        windowSize: 24, // hours
        sensitivity: 0.2 // 20% change threshold
      }
    };

    // Active monitoring sessions
    this.activeSessions = new Map();
    
    // Alert history
    this.alertHistory = [];
    
    // Data buffers for trend analysis
    this.dataBuffers = new Map();
    
    // Initialize monitoring
    this.initializeMonitoring();
  }

  initializeMonitoring() {
    // Start the main monitoring loop
    if (shouldRunMaintenanceTimers()) {
      setManagedInterval(() => {
        this.performMonitoringCycle();
      }, this.config.monitoringInterval);
    }

    logger.info('Real-time carbon monitoring service initialized');
  }

  async startMonitoring(msmeId, options = {}) {
    try {
      const sessionId = `monitor_${msmeId}_${Date.now()}`;
      
      const session = {
        id: sessionId,
        msmeId,
        startTime: new Date(),
        options: {
          alertThresholds: { ...this.config.alertThresholds, ...options.alertThresholds },
          monitoringInterval: options.monitoringInterval || this.config.monitoringInterval,
          enableTrendAnalysis: options.enableTrendAnalysis !== false,
          enablePredictiveAlerts: options.enablePredictiveAlerts !== false
        },
        status: 'active',
        lastData: null,
        alertCount: 0
      };

      this.activeSessions.set(sessionId, session);
      
      // Initialize data buffer for trend analysis
      this.dataBuffers.set(msmeId, []);

      logger.info(`Started monitoring for MSME ${msmeId} with session ${sessionId}`);
      
      this.emit('monitoringStarted', { sessionId, msmeId });
      
      return sessionId;

    } catch (error) {
      logger.error('Error starting monitoring:', error);
      throw error;
    }
  }

  async stopMonitoring(sessionId) {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error('Monitoring session not found');
      }

      session.status = 'stopped';
      session.endTime = new Date();
      
      this.activeSessions.delete(sessionId);
      
      logger.info(`Stopped monitoring session ${sessionId}`);
      
      this.emit('monitoringStopped', { sessionId, msmeId: session.msmeId });
      
      return true;

    } catch (error) {
      logger.error('Error stopping monitoring:', error);
      throw error;
    }
  }

  async updateCarbonData(msmeId, carbonData) {
    try {
      // Find active monitoring sessions for this MSME
      const sessions = Array.from(this.activeSessions.values())
        .filter(session => session.msmeId === msmeId && session.status === 'active');

      if (sessions.length === 0) {
        logger.warn(`No active monitoring sessions found for MSME ${msmeId}`);
        return;
      }

      // Update data buffer for trend analysis
      this.updateDataBuffer(msmeId, carbonData);

      // Process each active session
      for (const session of sessions) {
        await this.processCarbonData(session, carbonData);
      }

      logger.debug(`Updated carbon data for MSME ${msmeId}`);

    } catch (error) {
      logger.error('Error updating carbon data:', error);
      throw error;
    }
  }

  updateDataBuffer(msmeId, carbonData) {
    const buffer = this.dataBuffers.get(msmeId) || [];
    
    // Add new data point
    buffer.push({
      timestamp: new Date(),
      data: carbonData
    });

    // Keep only recent data (last 24 hours)
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const filteredBuffer = buffer.filter(entry => entry.timestamp > cutoffTime);
    
    this.dataBuffers.set(msmeId, filteredBuffer);
  }

  async processCarbonData(session, carbonData) {
    try {
      // Update session data
      session.lastData = carbonData;
      session.lastUpdate = new Date();

      // Check for immediate alerts
      const immediateAlerts = await this.checkImmediateAlerts(session, carbonData);
      
      // Check for trend-based alerts
      const trendAlerts = await this.checkTrendAlerts(session, carbonData);
      
      // Check for predictive alerts
      const predictiveAlerts = await this.checkPredictiveAlerts(session, carbonData);

      // Process all alerts
      const allAlerts = [...immediateAlerts, ...trendAlerts, ...predictiveAlerts];
      
      for (const alert of allAlerts) {
        await this.processAlert(session, alert);
      }

      // Emit data update event
      this.emit('dataUpdated', {
        sessionId: session.id,
        msmeId: session.msmeId,
        carbonData,
        alerts: allAlerts
      });

    } catch (error) {
      logger.error('Error processing carbon data:', error);
      throw error;
    }
  }

  async checkImmediateAlerts(session, carbonData) {
    const alerts = [];
    const thresholds = session.options.alertThresholds;

    // Check carbon footprint threshold
    if (carbonData.totalCO2Emissions >= thresholds.carbonFootprint.critical) {
      alerts.push({
        type: 'carbon_footprint_critical',
        severity: 'critical',
        message: `Critical carbon footprint: ${carbonData.totalCO2Emissions} kg CO2`,
        value: carbonData.totalCO2Emissions,
        threshold: thresholds.carbonFootprint.critical,
        timestamp: new Date()
      });
    } else if (carbonData.totalCO2Emissions >= thresholds.carbonFootprint.warning) {
      alerts.push({
        type: 'carbon_footprint_warning',
        severity: 'warning',
        message: `High carbon footprint: ${carbonData.totalCO2Emissions} kg CO2`,
        value: carbonData.totalCO2Emissions,
        threshold: thresholds.carbonFootprint.warning,
        timestamp: new Date()
      });
    }

    // Check energy consumption
    const energyConsumption = carbonData.breakdown?.energy?.electricity?.consumption || 0;
    if (energyConsumption >= thresholds.energyConsumption.critical) {
      alerts.push({
        type: 'energy_consumption_critical',
        severity: 'critical',
        message: `Critical energy consumption: ${energyConsumption} kWh`,
        value: energyConsumption,
        threshold: thresholds.energyConsumption.critical,
        timestamp: new Date()
      });
    } else if (energyConsumption >= thresholds.energyConsumption.warning) {
      alerts.push({
        type: 'energy_consumption_warning',
        severity: 'warning',
        message: `High energy consumption: ${energyConsumption} kWh`,
        value: energyConsumption,
        threshold: thresholds.energyConsumption.warning,
        timestamp: new Date()
      });
    }

    // Check waste generation
    const wasteGeneration = (carbonData.breakdown?.waste?.solid?.quantity || 0) + 
                          (carbonData.breakdown?.waste?.hazardous?.quantity || 0);
    if (wasteGeneration >= thresholds.wasteGeneration.critical) {
      alerts.push({
        type: 'waste_generation_critical',
        severity: 'critical',
        message: `Critical waste generation: ${wasteGeneration} kg`,
        value: wasteGeneration,
        threshold: thresholds.wasteGeneration.critical,
        timestamp: new Date()
      });
    } else if (wasteGeneration >= thresholds.wasteGeneration.warning) {
      alerts.push({
        type: 'waste_generation_warning',
        severity: 'warning',
        message: `High waste generation: ${wasteGeneration} kg`,
        value: wasteGeneration,
        threshold: thresholds.wasteGeneration.warning,
        timestamp: new Date()
      });
    }

    // Check water consumption
    const waterConsumption = carbonData.breakdown?.water?.consumption || 0;
    if (waterConsumption >= thresholds.waterConsumption.critical) {
      alerts.push({
        type: 'water_consumption_critical',
        severity: 'critical',
        message: `Critical water consumption: ${waterConsumption} liters`,
        value: waterConsumption,
        threshold: thresholds.waterConsumption.critical,
        timestamp: new Date()
      });
    } else if (waterConsumption >= thresholds.waterConsumption.warning) {
      alerts.push({
        type: 'water_consumption_warning',
        severity: 'warning',
        message: `High water consumption: ${waterConsumption} liters`,
        value: waterConsumption,
        threshold: thresholds.waterConsumption.warning,
        timestamp: new Date()
      });
    }

    return alerts;
  }

  async checkTrendAlerts(session, carbonData) {
    const alerts = [];
    
    if (!session.options.enableTrendAnalysis) {
      return alerts;
    }

    const buffer = this.dataBuffers.get(session.msmeId) || [];
    if (buffer.length < 2) {
      return alerts; // Need at least 2 data points for trend analysis
    }

    // Analyze trends for different metrics
    const trends = this.analyzeTrends(buffer);
    
    // Check for significant upward trends
    if (trends.carbonFootprint.trend === 'increasing' && trends.carbonFootprint.change > this.config.trendAnalysis.sensitivity) {
      alerts.push({
        type: 'carbon_footprint_trend_warning',
        severity: 'warning',
        message: `Increasing carbon footprint trend: +${(trends.carbonFootprint.change * 100).toFixed(1)}%`,
        value: trends.carbonFootprint.change,
        threshold: this.config.trendAnalysis.sensitivity,
        timestamp: new Date()
      });
    }

    if (trends.energyConsumption.trend === 'increasing' && trends.energyConsumption.change > this.config.trendAnalysis.sensitivity) {
      alerts.push({
        type: 'energy_consumption_trend_warning',
        severity: 'warning',
        message: `Increasing energy consumption trend: +${(trends.energyConsumption.change * 100).toFixed(1)}%`,
        value: trends.energyConsumption.change,
        threshold: this.config.trendAnalysis.sensitivity,
        timestamp: new Date()
      });
    }

    return alerts;
  }

  async checkPredictiveAlerts(session, carbonData) {
    const alerts = [];
    
    if (!session.options.enablePredictiveAlerts) {
      return alerts;
    }

    const buffer = this.dataBuffers.get(session.msmeId) || [];
    if (buffer.length < 5) {
      return alerts; // Need at least 5 data points for prediction
    }

    // Generate predictions
    const predictions = this.generatePredictions(buffer);
    
    // Check if predicted values exceed thresholds
    const thresholds = session.options.alertThresholds;
    
    if (predictions.carbonFootprint > thresholds.carbonFootprint.critical) {
      alerts.push({
        type: 'carbon_footprint_predictive_critical',
        severity: 'critical',
        message: `Predicted critical carbon footprint: ${predictions.carbonFootprint.toFixed(2)} kg CO2`,
        value: predictions.carbonFootprint,
        threshold: thresholds.carbonFootprint.critical,
        timestamp: new Date()
      });
    }

    if (predictions.energyConsumption > thresholds.energyConsumption.critical) {
      alerts.push({
        type: 'energy_consumption_predictive_critical',
        severity: 'critical',
        message: `Predicted critical energy consumption: ${predictions.energyConsumption.toFixed(2)} kWh`,
        value: predictions.energyConsumption,
        threshold: thresholds.energyConsumption.critical,
        timestamp: new Date()
      });
    }

    return alerts;
  }

  analyzeTrends(buffer) {
    const trends = {
      carbonFootprint: { trend: 'stable', change: 0 },
      energyConsumption: { trend: 'stable', change: 0 },
      wasteGeneration: { trend: 'stable', change: 0 },
      waterConsumption: { trend: 'stable', change: 0 }
    };

    if (buffer.length < 2) return trends;

    // Calculate trends for each metric
    const metrics = ['carbonFootprint', 'energyConsumption', 'wasteGeneration', 'waterConsumption'];
    
    metrics.forEach(metric => {
      const values = buffer.map(entry => this.extractMetricValue(entry.data, metric));
      const trend = this.calculateTrend(values);
      trends[metric] = trend;
    });

    return trends;
  }

  extractMetricValue(carbonData, metric) {
    switch (metric) {
      case 'carbonFootprint':
        return carbonData.totalCO2Emissions || 0;
      case 'energyConsumption':
        return carbonData.breakdown?.energy?.electricity?.consumption || 0;
      case 'wasteGeneration':
        return (carbonData.breakdown?.waste?.solid?.quantity || 0) + 
               (carbonData.breakdown?.waste?.hazardous?.quantity || 0);
      case 'waterConsumption':
        return carbonData.breakdown?.water?.consumption || 0;
      default:
        return 0;
    }
  }

  calculateTrend(values) {
    if (values.length < 2) return { trend: 'stable', change: 0 };

    // Simple linear regression
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = values;

    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const avgValue = sumY / n;
    const change = avgValue > 0 ? slope / avgValue : 0;

    let trend = 'stable';
    if (change > this.config.trendAnalysis.sensitivity) trend = 'increasing';
    else if (change < -this.config.trendAnalysis.sensitivity) trend = 'decreasing';

    return { trend, change: Math.abs(change) };
  }

  generatePredictions(buffer) {
    const predictions = {
      carbonFootprint: 0,
      energyConsumption: 0,
      wasteGeneration: 0,
      waterConsumption: 0
    };

    if (buffer.length < 5) return predictions;

    // Simple linear extrapolation for next hour
    const metrics = ['carbonFootprint', 'energyConsumption', 'wasteGeneration', 'waterConsumption'];
    
    metrics.forEach(metric => {
      const values = buffer.map(entry => this.extractMetricValue(entry.data, metric));
      const trend = this.calculateTrend(values);
      
      // Extrapolate based on trend
      const lastValue = values[values.length - 1];
      const predictedChange = trend.change * lastValue;
      predictions[metric] = Math.max(0, lastValue + predictedChange);
    });

    return predictions;
  }

  async processAlert(session, alert) {
    try {
      // Add alert to history
      this.alertHistory.push({
        sessionId: session.id,
        msmeId: session.msmeId,
        alert,
        timestamp: new Date()
      });

      // Update session alert count
      session.alertCount++;

      // Emit alert event
      this.emit('alert', {
        sessionId: session.id,
        msmeId: session.msmeId,
        alert
      });

      // Log alert
      logger.warn(`Alert for MSME ${session.msmeId}: ${alert.message}`);

      // Send notifications if configured
      if (session.options.enableNotifications !== false) {
        await this.sendAlertNotification(session, alert);
      }

    } catch (error) {
      logger.error('Error processing alert:', error);
    }
  }

  async sendAlertNotification(session, alert) {
    logger.info(`Sending alert notification for MSME ${session.msmeId}: ${alert.message}`);

    try {
      await msmeNotificationService.sendCarbonAlert(session.msmeId, {
        metric: alert.metric || alert.type || 'Carbon metric',
        value: alert.value ?? alert.currentValue,
        threshold: alert.threshold ?? alert.limit,
        severity: alert.severity || alert.level || 'medium',
        action: alert.recommendation || alert.action || alert.nextStep
      });
    } catch (error) {
      logger.error('Failed to dispatch SMS alert notification', {
        msmeId: session.msmeId,
        error: error.message
      });
    }
  }

  async performMonitoringCycle() {
    try {
      const activeSessions = Array.from(this.activeSessions.values())
        .filter(session => session.status === 'active');

      for (const session of activeSessions) {
        // Check for stale data
        if (session.lastUpdate) {
          const timeSinceUpdate = Date.now() - session.lastUpdate.getTime();
          if (timeSinceUpdate > session.options.monitoringInterval * 2) {
            // Data is stale, emit warning
            this.emit('dataStale', {
              sessionId: session.id,
              msmeId: session.msmeId,
              timeSinceUpdate
            });
          }
        }
      }

      // Clean up old alert history (keep last 1000 alerts)
      if (this.alertHistory.length > 1000) {
        this.alertHistory = this.alertHistory.slice(-1000);
      }

    } catch (error) {
      logger.error('Error in monitoring cycle:', error);
    }
  }

  getMonitoringStatus(msmeId) {
    const sessions = Array.from(this.activeSessions.values())
      .filter(session => session.msmeId === msmeId);

    return {
      msmeId,
      activeSessions: sessions.length,
      sessions: sessions.map(session => ({
        id: session.id,
        startTime: session.startTime,
        status: session.status,
        alertCount: session.alertCount,
        lastUpdate: session.lastUpdate
      }))
    };
  }

  getAlertHistory(msmeId, limit = 50) {
    const alerts = this.alertHistory
      .filter(alert => alert.msmeId === msmeId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);

    return alerts;
  }

  getTrendAnalysis(msmeId) {
    const buffer = this.dataBuffers.get(msmeId) || [];
    return this.analyzeTrends(buffer);
  }

  getPredictions(msmeId) {
    const buffer = this.dataBuffers.get(msmeId) || [];
    return this.generatePredictions(buffer);
  }

  updateAlertThresholds(sessionId, newThresholds) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error('Monitoring session not found');
    }

    session.options.alertThresholds = {
      ...session.options.alertThresholds,
      ...newThresholds
    };

    logger.info(`Updated alert thresholds for session ${sessionId}`);
  }

  getSystemStatus() {
    return {
      activeSessions: this.activeSessions.size,
      totalAlerts: this.alertHistory.length,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      config: this.config
    };
  }
}

module.exports = RealTimeCarbonMonitoringService;
