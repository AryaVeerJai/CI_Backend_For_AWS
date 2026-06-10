const NodeCache = require('node-cache');
const logger = require('../utils/logger');
const { shouldRunAgentOptimizationBackgroundLoops } = require('../config/backgroundLoops');
const { setManagedInterval } = require('../utils/intervalRegistry');

class AgentOptimizationService {
  constructor() {
    this.cache = new NodeCache({ 
      stdTTL: 300, // 5 minutes default TTL
      checkperiod: 300, // Expired-key sweep every 5 minutes (lower idle wakeups)
      useClones: false
    });
    
    this.connectionPool = new Map();
    this.performanceMetrics = new Map();
    this.taskScheduler = new Map();
    this.agentCapabilities = new Map();
    this.workloadPredictor = new Map();
    
    // Performance optimization settings
    this.settings = {
      maxCacheSize: 1000,
      cacheHitThreshold: 0.8,
      loadBalanceThreshold: 0.7,
      performanceWindow: 300000, // 5 minutes
      predictionAccuracy: 0.85
    };
    
    this.initializeOptimization();
  }

  async initializeOptimization() {
    try {
      // Initialize performance tracking
      await this.initializePerformanceTracking();
      
      if (shouldRunAgentOptimizationBackgroundLoops()) {
        this.startPerformanceOptimization();
        this.startLoadBalancing();
        this.startPredictiveScaling();
      } else {
        logger.info('Agent optimization background loops disabled (set ENABLE_AGENT_OPTIMIZATION_LOOPS=true to enable in production)');
      }
      
      logger.info('Agent Optimization Service initialized');
    } catch (error) {
      logger.error('Failed to initialize optimization service:', error);
    }
  }

  // Advanced Caching System
  async getCachedResult(cacheKey, computeFunction, ttl = 300) {
    try {
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) {
        this.updateCacheMetrics(cacheKey, true);
        return { result: cached, cacheHit: true };
      }

      const result = await computeFunction();

      this.cache.set(cacheKey, result, ttl);
      this.updateCacheMetrics(cacheKey, false);

      return { result, cacheHit: false };
    } catch (error) {
      logger.error('Cache operation failed:', error);
      const result = await computeFunction();
      return { result, cacheHit: false };
    }
  }

  generateCacheKey(agentType, taskType, inputHash) {
    return `${agentType}_${taskType}_${inputHash}`;
  }

  updateCacheMetrics(cacheKey, hit) {
    const metrics = this.performanceMetrics.get('cache') || { hits: 0, misses: 0 };
    if (hit) {
      metrics.hits++;
    } else {
      metrics.misses++;
    }
    this.performanceMetrics.set('cache', metrics);
  }

  getCacheHitRate() {
    const metrics = this.performanceMetrics.get('cache') || { hits: 0, misses: 0 };
    const total = metrics.hits + metrics.misses;
    return total > 0 ? metrics.hits / total : 0;
  }

  // Connection Pool Management
  async getOptimizedConnection(agentId, connectionType = 'default') {
    const poolKey = `${agentId}_${connectionType}`;
    
    if (!this.connectionPool.has(poolKey)) {
      await this.initializeConnectionPool(agentId, connectionType);
    }
    
    const pool = this.connectionPool.get(poolKey);
    return this.selectOptimalConnection(pool);
  }

  async initializeConnectionPool(agentId, connectionType) {
    const pool = {
      connections: [],
      activeConnections: 0,
      maxConnections: this.getMaxConnections(agentId),
      lastUsed: Date.now(),
      performance: { avgResponseTime: 0, successRate: 1.0 }
    };
    
    // Pre-create connections
    for (let i = 0; i < Math.min(3, pool.maxConnections); i++) {
      pool.connections.push(await this.createConnection(agentId, connectionType));
    }
    
    this.connectionPool.set(`${agentId}_${connectionType}`, pool);
  }

  selectOptimalConnection(pool) {
    // Select connection with best performance
    const availableConnections = pool.connections.filter(conn => !conn.busy);
    
    if (availableConnections.length === 0) {
      // All connections busy, create new one if under limit
      if (pool.connections.length < pool.maxConnections) {
        return this.createConnection(pool.agentId, pool.connectionType);
      }
      // Return least recently used connection
      return pool.connections.sort((a, b) => a.lastUsed - b.lastUsed)[0];
    }
    
    // Return connection with best performance score
    return availableConnections.sort((a, b) => b.performanceScore - a.performanceScore)[0];
  }

  async createConnection(agentId, connectionType) {
    return {
      id: `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      agentId,
      connectionType,
      busy: false,
      lastUsed: Date.now(),
      performanceScore: 1.0,
      responseTime: 0,
      successCount: 0,
      errorCount: 0
    };
  }

  getMaxConnections(agentId) {
    // Dynamic connection limits based on agent type and performance
    const agentType = this.getAgentType(agentId);
    const baseLimits = {
      'carbon_analyzer': 5,
      'recommendation_engine': 3,
      'data_processor': 8,
      'anomaly_detector': 4,
      'trend_analyzer': 3,
      'compliance_monitor': 2,
      'optimization_advisor': 3,
      'report_generator': 2
    };
    
    return baseLimits[agentType] || 3;
  }

  // Intelligent Task Scheduling
  async scheduleTask(task, priority = 'medium') {
    const agentId = task.agentId;
    const agentCapabilities = await this.getAgentCapabilities(agentId);
    const workload = await this.getAgentWorkload(agentId);
    
    // Calculate optimal execution time
    const optimalTime = this.calculateOptimalExecutionTime(task, agentCapabilities, workload);
    
    // Schedule task
    const scheduledTask = {
      ...task,
      scheduledTime: optimalTime,
      priority: this.calculatePriority(task, priority),
      estimatedDuration: this.estimateTaskDuration(task, agentCapabilities),
      resourceRequirements: this.calculateResourceRequirements(task, agentCapabilities)
    };
    
    this.addToScheduler(scheduledTask);
    return scheduledTask;
  }

  calculateOptimalExecutionTime(task, capabilities, workload) {
    const now = Date.now();
    const baseDelay = 0;
    
    // Consider agent workload
    const workloadDelay = workload.currentTasks * 1000; // 1 second per current task
    
    // Consider agent performance
    const performanceDelay = capabilities.averageResponseTime * 0.5;
    
    // Consider task complexity
    const complexityDelay = this.getTaskComplexity(task) * 2000; // 2 seconds per complexity unit
    
    return now + baseDelay + workloadDelay + performanceDelay + complexityDelay;
  }

  calculatePriority(task, basePriority) {
    const priorityWeights = {
      'high': 10,
      'medium': 5,
      'low': 1
    };
    
    let priority = priorityWeights[basePriority] || 5;
    
    // Adjust based on task type
    const taskTypeWeights = {
      'carbon_analysis': 8,
      'recommendation_generation': 6,
      'data_processing': 4,
      'anomaly_detection': 9,
      'trend_analysis': 5,
      'compliance_check': 7,
      'optimization_advice': 6,
      'report_generation': 3
    };
    
    priority += taskTypeWeights[task.taskType] || 0;
    
    // Adjust based on input size
    const inputSize = JSON.stringify(task.input).length;
    priority += Math.min(inputSize / 10000, 5); // Max 5 points for large inputs
    
    return Math.min(priority, 20); // Cap at 20
  }

  estimateTaskDuration(task, capabilities) {
    const baseDuration = capabilities.averageResponseTime || 5000;
    const complexityMultiplier = this.getTaskComplexity(task);
    const inputSizeMultiplier = Math.max(1, JSON.stringify(task.input).length / 1000);
    
    return baseDuration * complexityMultiplier * inputSizeMultiplier;
  }

  calculateResourceRequirements(task, capabilities) {
    return {
      memory: this.estimateMemoryUsage(task),
      cpu: this.estimateCPUUsage(task),
      network: this.estimateNetworkUsage(task),
      storage: this.estimateStorageUsage(task)
    };
  }

  getTaskComplexity(task) {
    const complexityMap = {
      'carbon_analysis': 3,
      'recommendation_generation': 2,
      'data_processing': 1,
      'anomaly_detection': 4,
      'trend_analysis': 3,
      'compliance_check': 2,
      'optimization_advice': 3,
      'report_generation': 2
    };
    
    return complexityMap[task.taskType] || 1;
  }

  // Performance Tracking and Analytics
  async initializePerformanceTracking() {
    // Initialize performance metrics for all agents
    const agentTypes = [
      'carbon_analyzer', 'recommendation_engine', 'data_processor',
      'anomaly_detector', 'trend_analyzer', 'compliance_monitor',
      'optimization_advisor', 'report_generator'
    ];
    
    for (const agentType of agentTypes) {
      this.performanceMetrics.set(agentType, {
        responseTime: [],
        successRate: 1.0,
        throughput: 0,
        errorRate: 0,
        resourceUsage: { cpu: 0, memory: 0, network: 0 },
        lastUpdated: Date.now()
      });
    }
  }

  async updateAgentPerformance(agentId, task, result) {
    const agentType = this.getAgentType(agentId);
    const metrics = this.performanceMetrics.get(agentType) || {};
    
    // Update response time
    const responseTime = Date.now() - task.startedAt;
    metrics.responseTime = [...(metrics.responseTime || []).slice(-100), responseTime];
    
    // Update success rate
    const isSuccess = result && !result.error;
    const totalTasks = (metrics.successCount || 0) + (metrics.errorCount || 0) + 1;
    metrics.successCount = (metrics.successCount || 0) + (isSuccess ? 1 : 0);
    metrics.errorCount = (metrics.errorCount || 0) + (isSuccess ? 0 : 1);
    metrics.successRate = metrics.successCount / totalTasks;
    
    // Update throughput (tasks per minute)
    const now = Date.now();
    const windowStart = now - this.settings.performanceWindow;
    const recentTasks = (metrics.responseTime || []).filter(time => time > windowStart);
    metrics.throughput = recentTasks.length / (this.settings.performanceWindow / 60000);
    
    metrics.lastUpdated = now;
    this.performanceMetrics.set(agentType, metrics);
  }

  // Predictive Scaling and Load Balancing
  startPredictiveScaling() {
    setManagedInterval(async () => {
      try {
        await this.performPredictiveScaling();
      } catch (error) {
        logger.error('Predictive scaling error:', error);
      }
    }, 120000); // Every 2 minutes
  }

  async performPredictiveScaling() {
    for (const [agentType, metrics] of this.performanceMetrics) {
      const predictedLoad = await this.predictWorkload(agentType);
      const currentCapacity = this.getCurrentCapacity(agentType);
      
      if (predictedLoad > currentCapacity * 1.2) {
        await this.scaleUpAgent(agentType);
      } else if (predictedLoad < currentCapacity * 0.5) {
        await this.scaleDownAgent(agentType);
      }
    }
  }

  async predictWorkload(agentType) {
    const metrics = this.performanceMetrics.get(agentType);
    if (!metrics || !metrics.responseTime || metrics.responseTime.length < 5) {
      return 0;
    }
    
    // Simple linear regression for workload prediction
    const recentTimes = metrics.responseTime.slice(-10);
    const trend = this.calculateTrend(recentTimes);
    const currentLoad = metrics.throughput || 0;
    
    // Predict load for next 5 minutes
    return Math.max(0, currentLoad + (trend * 5));
  }

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
    return slope;
  }

  getCurrentCapacity(agentType) {
    // Get current agent capacity based on active connections and performance
    const activeConnections = Array.from(this.connectionPool.values())
      .filter(pool => pool.agentId === agentType)
      .reduce((sum, pool) => sum + pool.activeConnections, 0);
    
    return activeConnections;
  }

  async scaleUpAgent(agentType) {
    logger.info(`Scaling up ${agentType} agent`);
    // Implementation would create new agent instances
    // This is a placeholder for actual scaling logic
  }

  async scaleDownAgent(agentType) {
    logger.info(`Scaling down ${agentType} agent`);
    // Implementation would remove excess agent instances
    // This is a placeholder for actual scaling logic
  }

  // Advanced Load Balancing
  startLoadBalancing() {
    setManagedInterval(async () => {
      try {
        await this.performLoadBalancing();
      } catch (error) {
        logger.error('Load balancing error:', error);
      }
    }, 60000); // Every minute
  }

  async performLoadBalancing() {
    const agentLoads = await this.getAgentLoads();
    const overloadedAgents = agentLoads.filter(agent => agent.load > this.settings.loadBalanceThreshold);
    const underloadedAgents = agentLoads.filter(agent => agent.load < 0.3);
    
    if (overloadedAgents.length > 0 && underloadedAgents.length > 0) {
      await this.redistributeLoad(overloadedAgents, underloadedAgents);
    }
  }

  async getAgentLoads() {
    const loads = [];
    
    for (const [agentType, metrics] of this.performanceMetrics) {
      const currentTasks = this.getCurrentTaskCount(agentType);
      const maxCapacity = this.getMaxCapacity(agentType);
      const load = currentTasks / maxCapacity;
      
      loads.push({
        agentType,
        load,
        currentTasks,
        maxCapacity,
        performance: metrics
      });
    }
    
    return loads;
  }

  async redistributeLoad(overloadedAgents, underloadedAgents) {
    for (const overloaded of overloadedAgents) {
      let excessTasks = Math.floor((overloaded.load - 0.7) * overloaded.maxCapacity);
      
      for (const underloaded of underloadedAgents) {
        if (excessTasks <= 0) break;
        
        const tasksToMove = Math.min(excessTasks, Math.floor(underloaded.maxCapacity * 0.3));
        await this.moveTasks(overloaded.agentType, underloaded.agentType, tasksToMove);
        excessTasks -= tasksToMove;
      }
    }
  }

  async moveTasks(fromAgentType, toAgentType, taskCount) {
    logger.info(`Moving ${taskCount} tasks from ${fromAgentType} to ${toAgentType}`);
    // Implementation would move tasks between agents
    // This is a placeholder for actual task redistribution logic
  }

  // Agent Capabilities Management
  async getAgentCapabilities(agentId) {
    if (this.agentCapabilities.has(agentId)) {
      return this.agentCapabilities.get(agentId);
    }
    
    // Load capabilities from database or default
    const capabilities = {
      maxConcurrentTasks: 5,
      averageResponseTime: 5000,
      memoryLimit: 512, // MB
      cpuLimit: 1.0, // CPU cores
      supportedTaskTypes: ['carbon_analysis'],
      performanceScore: 1.0
    };
    
    this.agentCapabilities.set(agentId, capabilities);
    return capabilities;
  }

  async getAgentWorkload(agentId) {
    return {
      currentTasks: this.getCurrentTaskCount(agentId),
      queuedTasks: this.getQueuedTaskCount(agentId),
      averageResponseTime: this.getAverageResponseTime(agentId),
      lastActivity: this.getLastActivity(agentId)
    };
  }

  getCurrentTaskCount(agentId) {
    // Implementation would count current running tasks
    return 0;
  }

  getQueuedTaskCount(agentId) {
    // Implementation would count queued tasks
    return 0;
  }

  getAverageResponseTime(agentId) {
    const agentType = this.getAgentType(agentId);
    const metrics = this.performanceMetrics.get(agentType);
    return metrics?.responseTime ? 
      metrics.responseTime.reduce((a, b) => a + b, 0) / metrics.responseTime.length : 5000;
  }

  getLastActivity(agentId) {
    const agentType = this.getAgentType(agentId);
    const metrics = this.performanceMetrics.get(agentType);
    return metrics?.lastUpdated || 0;
  }

  getAgentType(agentId) {
    // Implementation would determine agent type from ID
    // This is a placeholder
    return 'carbon_analyzer';
  }

  getMaxCapacity(agentType) {
    const baseLimits = {
      'carbon_analyzer': 10,
      'recommendation_engine': 6,
      'data_processor': 15,
      'anomaly_detector': 8,
      'trend_analyzer': 6,
      'compliance_monitor': 4,
      'optimization_advisor': 6,
      'report_generator': 4
    };
    
    return baseLimits[agentType] || 5;
  }

  // Resource Estimation Helpers
  estimateMemoryUsage(task) {
    const baseMemory = 50; // MB
    const inputSize = JSON.stringify(task.input).length;
    return baseMemory + (inputSize / 1000); // 1KB = 1MB estimation
  }

  estimateCPUUsage(task) {
    const complexity = this.getTaskComplexity(task);
    return Math.min(complexity * 0.2, 1.0); // Max 1 CPU core
  }

  estimateNetworkUsage(task) {
    const inputSize = JSON.stringify(task.input).length;
    return inputSize / 1000; // KB
  }

  estimateStorageUsage(task) {
    const inputSize = JSON.stringify(task.input).length;
    return inputSize * 2; // 2x input size for output estimation
  }

  // Scheduler Management
  addToScheduler(task) {
    const scheduler = this.taskScheduler.get(task.agentId) || [];
    scheduler.push(task);
    scheduler.sort((a, b) => b.priority - a.priority);
    this.taskScheduler.set(task.agentId, scheduler);
  }

  getNextTask(agentId) {
    const scheduler = this.taskScheduler.get(agentId) || [];
    return scheduler.shift();
  }

  // Performance Optimization Loop
  startPerformanceOptimization() {
    setManagedInterval(async () => {
      try {
        await this.optimizePerformance();
      } catch (error) {
        logger.error('Performance optimization error:', error);
      }
    }, 180000); // Every 3 minutes
  }

  async optimizePerformance() {
    // Cache optimization
    if (this.getCacheHitRate() < this.settings.cacheHitThreshold) {
      await this.optimizeCache();
    }
    
    // Connection pool optimization
    await this.optimizeConnectionPools();
    
    // Task scheduling optimization
    await this.optimizeTaskScheduling();
  }

  async optimizeCache() {
    // Clear least used cache entries
    const keys = this.cache.keys();
    if (keys.length > this.settings.maxCacheSize) {
      const keysToRemove = keys.slice(0, keys.length - this.settings.maxCacheSize);
      keysToRemove.forEach(key => this.cache.del(key));
    }
  }

  async optimizeConnectionPools() {
    for (const [poolKey, pool] of this.connectionPool) {
      // Remove idle connections
      const idleConnections = pool.connections.filter(conn => 
        Date.now() - conn.lastUsed > 300000 // 5 minutes
      );
      
      idleConnections.forEach(conn => {
        pool.connections = pool.connections.filter(c => c.id !== conn.id);
      });
    }
  }

  async optimizeTaskScheduling() {
    // Re-prioritize tasks based on current system state
    for (const [agentId, tasks] of this.taskScheduler) {
      tasks.forEach(task => {
        task.priority = this.calculatePriority(task, task.priority);
      });
      tasks.sort((a, b) => b.priority - a.priority);
    }
  }

  // Public API Methods
  async optimizeTaskExecution(task) {
    return await this.scheduleTask(task);
  }

  getPerformanceMetrics() {
    return {
      cache: {
        hitRate: this.getCacheHitRate(),
        size: this.cache.keys().length
      },
      agents: Object.fromEntries(this.performanceMetrics),
      connections: Object.fromEntries(this.connectionPool)
    };
  }

  async cleanup() {
    // Cleanup resources
    this.cache.flushAll();
    this.connectionPool.clear();
    this.performanceMetrics.clear();
    this.taskScheduler.clear();
    this.agentCapabilities.clear();
    this.workloadPredictor.clear();
  }
}

module.exports = new AgentOptimizationService();