const EventEmitter = require('events');
const logger = require('../utils/logger');
const { shouldRunSimulatedMonitoringTimers } = require('../config/backgroundLoops');
const { setManagedInterval } = require('../utils/intervalRegistry');

class EnhancedMonitoringService extends EventEmitter {
  constructor() {
    super();
    this.metrics = new Map();
    this.alerts = new Map();
    this.analytics = new Map();
    this.predictions = new Map();
    this.recommendations = new Map();
    this.dashboards = new Map();
    
    this.initializeMonitoringComponents();
    if (shouldRunSimulatedMonitoringTimers()) {
      this.startMonitoringProcesses();
    } else {
      logger.info('Simulated monitoring timers disabled (set ENABLE_SIMULATED_MONITORING_TIMERS=true to enable in production)');
    }
  }

  initializeMonitoringComponents() {
    // Initialize metrics collectors
    this.metrics.set('system', {
      cpu: [],
      memory: [],
      disk: [],
      network: [],
      timestamp: []
    });

    this.metrics.set('agents', {
      performance: new Map(),
      utilization: new Map(),
      errors: new Map(),
      throughput: new Map()
    });

    this.metrics.set('workflows', {
      executionTime: new Map(),
      successRate: new Map(),
      resourceUsage: new Map(),
      errorRate: new Map()
    });

    this.metrics.set('optimization', {
      cacheHitRate: [],
      compressionRatio: [],
      loadBalancing: [],
      predictionAccuracy: []
    });

    // Initialize alert rules
    this.alerts.set('performance', {
      rules: [
        {
          name: 'High CPU Usage',
          condition: 'cpu > 80',
          severity: 'warning',
          action: 'scale_up'
        },
        {
          name: 'High Memory Usage',
          condition: 'memory > 85',
          severity: 'critical',
          action: 'scale_up'
        },
        {
          name: 'Low Cache Hit Rate',
          condition: 'cacheHitRate < 60',
          severity: 'warning',
          action: 'optimize_cache'
        },
        {
          name: 'High Error Rate',
          condition: 'errorRate > 10',
          severity: 'critical',
          action: 'investigate_errors'
        }
      ],
      active: true
    });

    this.alerts.set('agents', {
      rules: [
        {
          name: 'Agent Unresponsive',
          condition: 'lastActivity > 300000',
          severity: 'critical',
          action: 'restart_agent'
        },
        {
          name: 'Low Agent Performance',
          condition: 'performanceScore < 0.5',
          severity: 'warning',
          action: 'optimize_agent'
        },
        {
          name: 'High Agent Load',
          condition: 'load > 0.9',
          severity: 'warning',
          action: 'balance_load'
        }
      ],
      active: true
    });

    // Initialize analytics engines
    this.analytics.set('trend', {
      name: 'Trend Analysis',
      enabled: true,
      window: 3600000, // 1 hour
      algorithms: ['linear_regression', 'exponential_smoothing']
    });

    this.analytics.set('anomaly', {
      name: 'Anomaly Detection',
      enabled: true,
      sensitivity: 0.8,
      algorithms: ['statistical', 'ml_based']
    });

    this.analytics.set('forecasting', {
      name: 'Performance Forecasting',
      enabled: true,
      horizon: 1800000, // 30 minutes
      algorithms: ['arima', 'lstm']
    });

    // Initialize prediction models
    this.predictions.set('workload', {
      model: null,
      accuracy: 0,
      lastUpdated: null,
      predictions: []
    });

    this.predictions.set('performance', {
      model: null,
      accuracy: 0,
      lastUpdated: null,
      predictions: []
    });

    this.predictions.set('scaling', {
      model: null,
      accuracy: 0,
      lastUpdated: null,
      predictions: []
    });
  }

  startMonitoringProcesses() {
    // System metrics collection
    setManagedInterval(() => {
      this.collectSystemMetrics();
    }, 5000); // Every 5 seconds

    // Agent metrics collection
    setManagedInterval(() => {
      this.collectAgentMetrics();
    }, 10000); // Every 10 seconds

    // Workflow metrics collection
    setManagedInterval(() => {
      this.collectWorkflowMetrics();
    }, 15000); // Every 15 seconds

    // Alert processing
    setManagedInterval(() => {
      this.processAlerts();
    }, 30000); // Every 30 seconds

    // Analytics processing
    setManagedInterval(() => {
      this.processAnalytics();
    }, 60000); // Every minute

    // Prediction updates
    setManagedInterval(() => {
      this.updatePredictions();
    }, 300000); // Every 5 minutes

    // Recommendation generation
    setManagedInterval(() => {
      this.generateRecommendations();
    }, 600000); // Every 10 minutes
  }

  // System Metrics Collection
  async collectSystemMetrics() {
    try {
      const systemMetrics = await this.getSystemMetrics();
      
      // Store metrics
      this.metrics.get('system').cpu.push(systemMetrics.cpu);
      this.metrics.get('system').memory.push(systemMetrics.memory);
      this.metrics.get('system').disk.push(systemMetrics.disk);
      this.metrics.get('system').network.push(systemMetrics.network);
      this.metrics.get('system').timestamp.push(Date.now());
      
      // Keep only last 1000 data points
      this.trimMetrics('system', 1000);
      
      // Emit metrics update
      this.emit('systemMetrics', systemMetrics);
    } catch (error) {
      logger.error('Failed to collect system metrics:', error);
    }
  }

  async getSystemMetrics() {
    // Simulate system metrics collection (in production, use actual system monitoring)
    return {
      cpu: Math.random() * 100,
      memory: Math.random() * 100,
      disk: Math.random() * 100,
      network: {
        inbound: Math.random() * 1000,
        outbound: Math.random() * 1000,
        latency: Math.random() * 100
      },
      timestamp: Date.now()
    };
  }

  // Agent Metrics Collection
  async collectAgentMetrics() {
    try {
      const agentMetrics = await this.getAgentMetrics();
      
      for (const [agentId, metrics] of Object.entries(agentMetrics)) {
        const agentData = this.metrics.get('agents');
        
        if (!agentData.performance.has(agentId)) {
          agentData.performance.set(agentId, []);
          agentData.utilization.set(agentId, []);
          agentData.errors.set(agentId, []);
          agentData.throughput.set(agentId, []);
        }
        
        agentData.performance.get(agentId).push(metrics.performance);
        agentData.utilization.get(agentId).push(metrics.utilization);
        agentData.errors.get(agentId).push(metrics.errors);
        agentData.throughput.get(agentId).push(metrics.throughput);
        
        // Trim metrics
        this.trimAgentMetrics(agentId, 1000);
      }
      
      this.emit('agentMetrics', agentMetrics);
    } catch (error) {
      logger.error('Failed to collect agent metrics:', error);
    }
  }

  async getAgentMetrics() {
    // Simulate agent metrics collection
    const agents = ['agent1', 'agent2', 'agent3', 'agent4'];
    const metrics = {};
    
    for (const agentId of agents) {
      metrics[agentId] = {
        performance: Math.random() * 100,
        utilization: Math.random() * 100,
        errors: Math.random() * 10,
        throughput: Math.random() * 1000,
        lastActivity: Date.now() - Math.random() * 300000,
        status: Math.random() > 0.1 ? 'active' : 'inactive'
      };
    }
    
    return metrics;
  }

  // Workflow Metrics Collection
  async collectWorkflowMetrics() {
    try {
      const workflowMetrics = await this.getWorkflowMetrics();
      
      for (const [workflowId, metrics] of Object.entries(workflowMetrics)) {
        const workflowData = this.metrics.get('workflows');
        
        if (!workflowData.executionTime.has(workflowId)) {
          workflowData.executionTime.set(workflowId, []);
          workflowData.successRate.set(workflowId, []);
          workflowData.resourceUsage.set(workflowId, []);
          workflowData.errorRate.set(workflowId, []);
        }
        
        workflowData.executionTime.get(workflowId).push(metrics.executionTime);
        workflowData.successRate.get(workflowId).push(metrics.successRate);
        workflowData.resourceUsage.get(workflowId).push(metrics.resourceUsage);
        workflowData.errorRate.get(workflowId).push(metrics.errorRate);
        
        // Trim metrics
        this.trimWorkflowMetrics(workflowId, 1000);
      }
      
      this.emit('workflowMetrics', workflowMetrics);
    } catch (error) {
      logger.error('Failed to collect workflow metrics:', error);
    }
  }

  async getWorkflowMetrics() {
    // Simulate workflow metrics collection
    const workflows = ['workflow1', 'workflow2', 'workflow3'];
    const metrics = {};
    
    for (const workflowId of workflows) {
      metrics[workflowId] = {
        executionTime: Math.random() * 10000,
        successRate: Math.random() * 100,
        resourceUsage: {
          cpu: Math.random() * 100,
          memory: Math.random() * 100
        },
        errorRate: Math.random() * 10
      };
    }
    
    return metrics;
  }

  // Alert Processing
  async processAlerts() {
    try {
      const systemMetrics = this.getLatestSystemMetrics();
      const agentMetrics = this.getLatestAgentMetrics();
      
      // Process system alerts
      await this.processSystemAlerts(systemMetrics);
      
      // Process agent alerts
      await this.processAgentAlerts(agentMetrics);
      
    } catch (error) {
      logger.error('Failed to process alerts:', error);
    }
  }

  async processSystemAlerts(metrics) {
    const rules = this.alerts.get('performance').rules;
    
    for (const rule of rules) {
      const condition = this.evaluateCondition(rule.condition, metrics);
      
      if (condition) {
        await this.triggerAlert(rule, metrics);
      }
    }
  }

  async processAgentAlerts(metrics) {
    const rules = this.alerts.get('agents').rules;
    
    for (const [agentId, agentMetrics] of Object.entries(metrics)) {
      for (const rule of rules) {
        const condition = this.evaluateCondition(rule.condition, agentMetrics);
        
        if (condition) {
          await this.triggerAlert(rule, { ...agentMetrics, agentId });
        }
      }
    }
  }

  evaluateCondition(condition, metrics) {
    // Simple condition evaluation (in production, use a proper expression evaluator)
    const parts = condition.split(' ');
    const metric = parts[0];
    const operator = parts[1];
    const value = parseFloat(parts[2]);
    
    const metricValue = this.getMetricValue(metric, metrics);
    
    switch (operator) {
      case '>':
        return metricValue > value;
      case '<':
        return metricValue < value;
      case '>=':
        return metricValue >= value;
      case '<=':
        return metricValue <= value;
      case '==':
        return metricValue === value;
      default:
        return false;
    }
  }

  getMetricValue(metric, metrics) {
    // Extract metric value from metrics object
    const parts = metric.split('.');
    let value = metrics;
    
    for (const part of parts) {
      value = value[part];
      if (value === undefined) return 0;
    }
    
    return value;
  }

  async triggerAlert(rule, metrics) {
    const alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      rule: rule.name,
      severity: rule.severity,
      action: rule.action,
      metrics,
      timestamp: new Date(),
      status: 'active'
    };
    
    // Store alert
    this.alerts.set(alert.id, alert);
    
    // Emit alert
    this.emit('alert', alert);
    
    // Execute action
    await this.executeAlertAction(rule.action, metrics);
    
    logger.warn(`Alert triggered: ${rule.name}`, alert);
  }

  async executeAlertAction(action, metrics) {
    switch (action) {
      case 'scale_up':
        await this.scaleUp(metrics);
        break;
      case 'scale_down':
        await this.scaleDown(metrics);
        break;
      case 'optimize_cache':
        await this.optimizeCache(metrics);
        break;
      case 'balance_load':
        await this.balanceLoad(metrics);
        break;
      case 'restart_agent':
        await this.restartAgent(metrics);
        break;
      case 'investigate_errors':
        await this.investigateErrors(metrics);
        break;
      default:
        logger.warn(`Unknown alert action: ${action}`);
    }
  }

  // Analytics Processing
  async processAnalytics() {
    try {
      // Trend analysis
      await this.performTrendAnalysis();
      
      // Anomaly detection
      await this.performAnomalyDetection();
      
      // Performance forecasting
      await this.performPerformanceForecasting();
      
    } catch (error) {
      logger.error('Failed to process analytics:', error);
    }
  }

  async performTrendAnalysis() {
    const systemMetrics = this.metrics.get('system');
    const trends = {};
    
    // Analyze CPU trend
    trends.cpu = this.calculateTrend(systemMetrics.cpu);
    
    // Analyze memory trend
    trends.memory = this.calculateTrend(systemMetrics.memory);
    
    // Analyze network trend
    trends.network = this.calculateTrend(systemMetrics.network);
    
    this.analytics.set('trend_analysis', {
      trends,
      timestamp: Date.now()
    });
    
    this.emit('trendAnalysis', trends);
  }

  calculateTrend(values) {
    if (values.length < 2) return { direction: 'stable', slope: 0 };
    
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = values;
    
    // Calculate linear regression slope
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    
    return {
      direction: slope > 0.1 ? 'increasing' : slope < -0.1 ? 'decreasing' : 'stable',
      slope,
      confidence: Math.min(1, Math.abs(slope) * 10)
    };
  }

  async performAnomalyDetection() {
    const systemMetrics = this.metrics.get('system');
    const anomalies = [];
    
    // Detect CPU anomalies
    const cpuAnomalies = this.detectAnomalies(systemMetrics.cpu, 'cpu');
    anomalies.push(...cpuAnomalies);
    
    // Detect memory anomalies
    const memoryAnomalies = this.detectAnomalies(systemMetrics.memory, 'memory');
    anomalies.push(...memoryAnomalies);
    
    this.analytics.set('anomaly_detection', {
      anomalies,
      timestamp: Date.now()
    });
    
    if (anomalies.length > 0) {
      this.emit('anomalies', anomalies);
    }
  }

  detectAnomalies(values, metric) {
    if (values.length < 10) return [];
    
    const anomalies = [];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const threshold = 2 * stdDev; // 2 standard deviations
    
    for (let i = 0; i < values.length; i++) {
      if (Math.abs(values[i] - mean) > threshold) {
        anomalies.push({
          metric,
          value: values[i],
          index: i,
          severity: Math.abs(values[i] - mean) / stdDev,
          timestamp: this.metrics.get('system').timestamp[i]
        });
      }
    }
    
    return anomalies;
  }

  async performPerformanceForecasting() {
    const systemMetrics = this.metrics.get('system');
    const forecasts = {};
    
    // Forecast CPU usage
    forecasts.cpu = this.forecastValues(systemMetrics.cpu, 12); // Next 12 data points
    
    // Forecast memory usage
    forecasts.memory = this.forecastValues(systemMetrics.memory, 12);
    
    this.analytics.set('performance_forecasting', {
      forecasts,
      timestamp: Date.now()
    });
    
    this.emit('performanceForecast', forecasts);
  }

  forecastValues(values, steps) {
    if (values.length < 10) return [];
    
    // Simple linear forecasting
    const trend = this.calculateTrend(values);
    const lastValue = values[values.length - 1];
    const forecasts = [];
    
    for (let i = 1; i <= steps; i++) {
      const forecast = lastValue + (trend.slope * i);
      forecasts.push(Math.max(0, Math.min(100, forecast))); // Clamp between 0 and 100
    }
    
    return forecasts;
  }

  // Prediction Updates
  async updatePredictions() {
    try {
      // Update workload predictions
      await this.updateWorkloadPredictions();
      
      // Update performance predictions
      await this.updatePerformancePredictions();
      
      // Update scaling predictions
      await this.updateScalingPredictions();
      
    } catch (error) {
      logger.error('Failed to update predictions:', error);
    }
  }

  async updateWorkloadPredictions() {
    const systemMetrics = this.metrics.get('system');
    const predictions = this.predictions.get('workload');
    
    // Simple workload prediction based on CPU and memory trends
    const cpuTrend = this.calculateTrend(systemMetrics.cpu);
    const memoryTrend = this.calculateTrend(systemMetrics.memory);
    
    const workloadPrediction = {
      timestamp: Date.now(),
      predictedLoad: (cpuTrend.slope + memoryTrend.slope) / 2,
      confidence: (cpuTrend.confidence + memoryTrend.confidence) / 2,
      factors: {
        cpuTrend: cpuTrend.slope,
        memoryTrend: memoryTrend.slope
      }
    };
    
    predictions.predictions.push(workloadPrediction);
    
    // Keep only last 100 predictions
    if (predictions.predictions.length > 100) {
      predictions.predictions = predictions.predictions.slice(-100);
    }
    
    this.emit('workloadPrediction', workloadPrediction);
  }

  async updatePerformancePredictions() {
    const agentMetrics = this.metrics.get('agents');
    const predictions = this.predictions.get('performance');
    
    // Predict performance for each agent
    const performancePredictions = {};
    
    for (const [agentId, performanceValues] of agentMetrics.performance) {
      if (performanceValues.length > 5) {
        const trend = this.calculateTrend(performanceValues);
        performancePredictions[agentId] = {
          predictedPerformance: performanceValues[performanceValues.length - 1] + trend.slope,
          confidence: trend.confidence,
          trend: trend.direction
        };
      }
    }
    
    predictions.predictions.push({
      timestamp: Date.now(),
      predictions: performancePredictions
    });
    
    // Keep only last 100 predictions
    if (predictions.predictions.length > 100) {
      predictions.predictions = predictions.predictions.slice(-100);
    }
    
    this.emit('performancePrediction', performancePredictions);
  }

  async updateScalingPredictions() {
    const systemMetrics = this.metrics.get('system');
    const predictions = this.predictions.get('scaling');
    
    // Predict scaling needs based on system metrics
    const cpuTrend = this.calculateTrend(systemMetrics.cpu);
    const memoryTrend = this.calculateTrend(systemMetrics.memory);
    
    const scalingPrediction = {
      timestamp: Date.now(),
      recommendedAction: this.getScalingRecommendation(cpuTrend, memoryTrend),
      confidence: (cpuTrend.confidence + memoryTrend.confidence) / 2,
      factors: {
        cpuTrend: cpuTrend.slope,
        memoryTrend: memoryTrend.slope,
        currentCpu: systemMetrics.cpu[systemMetrics.cpu.length - 1],
        currentMemory: systemMetrics.memory[systemMetrics.memory.length - 1]
      }
    };
    
    predictions.predictions.push(scalingPrediction);
    
    // Keep only last 100 predictions
    if (predictions.predictions.length > 100) {
      predictions.predictions = predictions.predictions.slice(-100);
    }
    
    this.emit('scalingPrediction', scalingPrediction);
  }

  getScalingRecommendation(cpuTrend, memoryTrend) {
    const avgSlope = (cpuTrend.slope + memoryTrend.slope) / 2;
    
    if (avgSlope > 0.5) {
      return 'scale_up';
    } else if (avgSlope < -0.5) {
      return 'scale_down';
    } else {
      return 'maintain';
    }
  }

  // Recommendation Generation
  async generateRecommendations() {
    try {
      const recommendations = [];
      
      // System recommendations
      const systemRecs = await this.generateSystemRecommendations();
      recommendations.push(...systemRecs);
      
      // Agent recommendations
      const agentRecs = await this.generateAgentRecommendations();
      recommendations.push(...agentRecs);
      
      // Workflow recommendations
      const workflowRecs = await this.generateWorkflowRecommendations();
      recommendations.push(...workflowRecs);
      
      // Store recommendations
      this.recommendations.set('latest', {
        recommendations,
        timestamp: Date.now()
      });
      
      this.emit('recommendations', recommendations);
      
    } catch (error) {
      logger.error('Failed to generate recommendations:', error);
    }
  }

  async generateSystemRecommendations() {
    const recommendations = [];
    const systemMetrics = this.metrics.get('system');
    
    // CPU recommendations
    const avgCpu = systemMetrics.cpu.reduce((a, b) => a + b, 0) / systemMetrics.cpu.length;
    if (avgCpu > 80) {
      recommendations.push({
        type: 'system',
        category: 'cpu',
        priority: 'high',
        title: 'High CPU Usage Detected',
        description: `Average CPU usage is ${avgCpu.toFixed(1)}%. Consider scaling up or optimizing workloads.`,
        action: 'scale_up_cpu',
        impact: 'high'
      });
    }
    
    // Memory recommendations
    const avgMemory = systemMetrics.memory.reduce((a, b) => a + b, 0) / systemMetrics.memory.length;
    if (avgMemory > 85) {
      recommendations.push({
        type: 'system',
        category: 'memory',
        priority: 'critical',
        title: 'High Memory Usage Detected',
        description: `Average memory usage is ${avgMemory.toFixed(1)}%. Consider scaling up or optimizing memory usage.`,
        action: 'scale_up_memory',
        impact: 'critical'
      });
    }
    
    return recommendations;
  }

  async generateAgentRecommendations() {
    const recommendations = [];
    const agentMetrics = this.metrics.get('agents');
    
    for (const [agentId, performanceValues] of agentMetrics.performance) {
      if (performanceValues.length > 10) {
        const avgPerformance = performanceValues.reduce((a, b) => a + b, 0) / performanceValues.length;
        
        if (avgPerformance < 50) {
          recommendations.push({
            type: 'agent',
            category: 'performance',
            priority: 'medium',
            title: `Low Performance for Agent ${agentId}`,
            description: `Agent ${agentId} has average performance of ${avgPerformance.toFixed(1)}%. Consider optimization.`,
            action: 'optimize_agent',
            agentId,
            impact: 'medium'
          });
        }
      }
    }
    
    return recommendations;
  }

  async generateWorkflowRecommendations() {
    const recommendations = [];
    const workflowMetrics = this.metrics.get('workflows');
    
    for (const [workflowId, executionTimes] of workflowMetrics.executionTime) {
      if (executionTimes.length > 5) {
        const avgExecutionTime = executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length;
        
        if (avgExecutionTime > 30000) { // 30 seconds
          recommendations.push({
            type: 'workflow',
            category: 'performance',
            priority: 'medium',
            title: `Slow Workflow Execution: ${workflowId}`,
            description: `Workflow ${workflowId} has average execution time of ${(avgExecutionTime / 1000).toFixed(1)}s. Consider optimization.`,
            action: 'optimize_workflow',
            workflowId,
            impact: 'medium'
          });
        }
      }
    }
    
    return recommendations;
  }

  // Helper Methods
  trimMetrics(metricType, maxSize) {
    const metrics = this.metrics.get(metricType);
    if (metrics.cpu) {
      metrics.cpu = metrics.cpu.slice(-maxSize);
      metrics.memory = metrics.memory.slice(-maxSize);
      metrics.disk = metrics.disk.slice(-maxSize);
      metrics.network = metrics.network.slice(-maxSize);
      metrics.timestamp = metrics.timestamp.slice(-maxSize);
    }
  }

  trimAgentMetrics(agentId, maxSize) {
    const agentData = this.metrics.get('agents');
    const trim = (arr) => {
      if (!Array.isArray(arr) || arr.length <= maxSize) return;
      arr.splice(0, arr.length - maxSize);
    };
    trim(agentData.performance.get(agentId));
    trim(agentData.utilization.get(agentId));
    trim(agentData.errors.get(agentId));
    trim(agentData.throughput.get(agentId));
  }

  trimWorkflowMetrics(workflowId, maxSize) {
    const workflowData = this.metrics.get('workflows');
    const trim = (arr) => {
      if (!Array.isArray(arr) || arr.length <= maxSize) return;
      arr.splice(0, arr.length - maxSize);
    };
    trim(workflowData.executionTime.get(workflowId));
    trim(workflowData.successRate.get(workflowId));
    trim(workflowData.resourceUsage.get(workflowId));
    trim(workflowData.errorRate.get(workflowId));
  }

  getLatestSystemMetrics() {
    const systemMetrics = this.metrics.get('system');
    return {
      cpu: systemMetrics.cpu[systemMetrics.cpu.length - 1] || 0,
      memory: systemMetrics.memory[systemMetrics.memory.length - 1] || 0,
      disk: systemMetrics.disk[systemMetrics.disk.length - 1] || 0,
      network: systemMetrics.network[systemMetrics.network.length - 1] || 0
    };
  }

  getLatestAgentMetrics() {
    const agentMetrics = this.metrics.get('agents');
    const latest = {};
    
    for (const [agentId, performanceValues] of agentMetrics.performance) {
      latest[agentId] = {
        performance: performanceValues[performanceValues.length - 1] || 0,
        utilization: agentMetrics.utilization.get(agentId)[agentMetrics.utilization.get(agentId).length - 1] || 0,
        errors: agentMetrics.errors.get(agentId)[agentMetrics.errors.get(agentId).length - 1] || 0,
        throughput: agentMetrics.throughput.get(agentId)[agentMetrics.throughput.get(agentId).length - 1] || 0
      };
    }
    
    return latest;
  }

  // Alert Action Implementations
  async scaleUp(metrics) {
    logger.info('Scaling up system resources', metrics);
    // Implementation would scale up resources
  }

  async scaleDown(metrics) {
    logger.info('Scaling down system resources', metrics);
    // Implementation would scale down resources
  }

  async optimizeCache(metrics) {
    logger.info('Optimizing cache configuration', metrics);
    // Implementation would optimize cache
  }

  async balanceLoad(metrics) {
    logger.info('Balancing load across agents', metrics);
    // Implementation would balance load
  }

  async restartAgent(metrics) {
    logger.info('Restarting agent', metrics);
    // Implementation would restart agent
  }

  async investigateErrors(metrics) {
    logger.info('Investigating errors', metrics);
    // Implementation would investigate errors
  }

  // Public API
  getMetrics() {
    return {
      system: this.metrics.get('system'),
      agents: Object.fromEntries(this.metrics.get('agents').performance),
      workflows: Object.fromEntries(this.metrics.get('workflows').executionTime),
      optimization: this.metrics.get('optimization')
    };
  }

  getAlerts() {
    return Array.from(this.alerts.values());
  }

  getAnalytics() {
    return {
      trend: this.analytics.get('trend_analysis'),
      anomaly: this.analytics.get('anomaly_detection'),
      forecasting: this.analytics.get('performance_forecasting')
    };
  }

  getPredictions() {
    return {
      workload: this.predictions.get('workload').predictions,
      performance: this.predictions.get('performance').predictions,
      scaling: this.predictions.get('scaling').predictions
    };
  }

  getRecommendations() {
    return this.recommendations.get('latest') || { recommendations: [], timestamp: Date.now() };
  }

  getDashboardData() {
    return {
      metrics: this.getMetrics(),
      alerts: this.getAlerts(),
      analytics: this.getAnalytics(),
      predictions: this.getPredictions(),
      recommendations: this.getRecommendations()
    };
  }
}

module.exports = new EnhancedMonitoringService();