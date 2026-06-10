const EventEmitter = require('events');
const logger = require('../utils/logger');
const { shouldRunSimulatedMonitoringTimers } = require('../config/backgroundLoops');
const { setManagedInterval } = require('../utils/intervalRegistry');

class DataFlowOptimizationService extends EventEmitter {
  constructor() {
    super();
    this.dataStreams = new Map();
    this.cacheLayers = new Map();
    this.compressionEngines = new Map();
    this.serializationFormats = new Map();
    this.routingStrategies = new Map();
    this.performanceMetrics = new Map();
    
    this.initializeDataFlowComponents();
    if (shouldRunSimulatedMonitoringTimers()) {
      this.startOptimizationProcesses();
    } else {
      logger.info('Data flow optimization background timers disabled (same flag as simulated monitoring)');
    }
  }

  initializeDataFlowComponents() {
    // Initialize cache layers
    this.cacheLayers.set('l1', {
      name: 'L1 Cache (Memory)',
      type: 'memory',
      maxSize: 1000,
      ttl: 300000, // 5 minutes
      compression: true,
      hitRate: 0,
      missRate: 0
    });

    this.cacheLayers.set('l2', {
      name: 'L2 Cache (Redis)',
      type: 'redis',
      maxSize: 10000,
      ttl: 3600000, // 1 hour
      compression: true,
      hitRate: 0,
      missRate: 0
    });

    this.cacheLayers.set('l3', {
      name: 'L3 Cache (Database)',
      type: 'database',
      maxSize: 100000,
      ttl: 86400000, // 24 hours
      compression: false,
      hitRate: 0,
      missRate: 0
    });

    // Initialize compression engines
    this.compressionEngines.set('gzip', {
      name: 'GZIP',
      compressionRatio: 0.3,
      speed: 'fast',
      cpuUsage: 'low'
    });

    this.compressionEngines.set('brotli', {
      name: 'Brotli',
      compressionRatio: 0.2,
      speed: 'medium',
      cpuUsage: 'medium'
    });

    this.compressionEngines.set('lz4', {
      name: 'LZ4',
      compressionRatio: 0.4,
      speed: 'very_fast',
      cpuUsage: 'very_low'
    });

    // Initialize serialization formats
    this.serializationFormats.set('json', {
      name: 'JSON',
      size: 1.0,
      speed: 'fast',
      compatibility: 'high'
    });

    this.serializationFormats.set('msgpack', {
      name: 'MessagePack',
      size: 0.7,
      speed: 'very_fast',
      compatibility: 'medium'
    });

    this.serializationFormats.set('protobuf', {
      name: 'Protocol Buffers',
      size: 0.5,
      speed: 'fast',
      compatibility: 'high'
    });

    // Initialize routing strategies
    this.routingStrategies.set('round_robin', {
      name: 'Round Robin',
      description: 'Distribute data evenly across channels',
      loadBalancing: 'equal'
    });

    this.routingStrategies.set('least_loaded', {
      name: 'Least Loaded',
      description: 'Route to channel with least load',
      loadBalancing: 'intelligent'
    });

    this.routingStrategies.set('priority_based', {
      name: 'Priority Based',
      description: 'Route based on data priority',
      loadBalancing: 'priority'
    });

    this.routingStrategies.set('latency_optimized', {
      name: 'Latency Optimized',
      description: 'Route to minimize latency',
      loadBalancing: 'latency'
    });
  }

  startOptimizationProcesses() {
    // Start cache optimization
    setManagedInterval(() => {
      this.optimizeCaches();
    }, 60000); // Every minute

    // Start compression optimization
    setManagedInterval(() => {
      this.optimizeCompression();
    }, 300000); // Every 5 minutes

    // Start routing optimization
    setManagedInterval(() => {
      this.optimizeRouting();
    }, 120000); // Every 2 minutes

    // Start performance monitoring
    setManagedInterval(() => {
      this.monitorPerformance();
    }, 30000); // Every 30 seconds
  }

  // Data Streaming Optimization
  async createOptimizedDataStream(streamId, config) {
    try {
      const stream = {
        id: streamId,
        config: {
          ...config,
          compression: config.compression || 'auto',
          serialization: config.serialization || 'auto',
          routing: config.routing || 'least_loaded',
          caching: config.caching || true
        },
        metrics: {
          throughput: 0,
          latency: 0,
          errorRate: 0,
          compressionRatio: 0,
          cacheHitRate: 0
        },
        channels: [],
        createdAt: new Date()
      };

      // Optimize stream configuration
      await this.optimizeStreamConfiguration(stream);
      
      // Create optimized channels
      await this.createOptimizedChannels(stream);
      
      this.dataStreams.set(streamId, stream);
      
      logger.info(`Created optimized data stream: ${streamId}`);
      return stream;
    } catch (error) {
      logger.error('Failed to create optimized data stream:', error);
      throw error;
    }
  }

  async optimizeStreamConfiguration(stream) {
    const { dataType, volume, frequency, priority } = stream.config;
    
    // Select optimal compression
    if (stream.config.compression === 'auto') {
      stream.config.compression = this.selectOptimalCompression(dataType, volume, frequency);
    }
    
    // Select optimal serialization
    if (stream.config.serialization === 'auto') {
      stream.config.serialization = this.selectOptimalSerialization(dataType, priority);
    }
    
    // Select optimal routing
    if (stream.config.routing === 'auto') {
      stream.config.routing = this.selectOptimalRouting(volume, frequency, priority);
    }
    
    // Configure caching strategy
    if (stream.config.caching) {
      stream.config.cacheStrategy = this.selectOptimalCacheStrategy(dataType, frequency);
    }
  }

  selectOptimalCompression(dataType, volume, frequency) {
    if (frequency > 1000) { // High frequency
      return 'lz4'; // Fast compression
    } else if (volume > 1000000) { // Large volume
      return 'brotli'; // High compression ratio
    } else {
      return 'gzip'; // Balanced
    }
  }

  selectOptimalSerialization(dataType, priority) {
    if (priority === 'high') {
      return 'msgpack'; // Fast serialization
    } else if (dataType === 'structured') {
      return 'protobuf'; // Efficient for structured data
    } else {
      return 'json'; // Universal compatibility
    }
  }

  selectOptimalRouting(volume, frequency, priority) {
    if (priority === 'high') {
      return 'latency_optimized';
    } else if (volume > 1000000) {
      return 'least_loaded';
    } else {
      return 'round_robin';
    }
  }

  selectOptimalCacheStrategy(dataType, frequency) {
    if (frequency > 100) {
      return 'l1'; // High frequency -> L1 cache
    } else if (frequency > 10) {
      return 'l2'; // Medium frequency -> L2 cache
    } else {
      return 'l3'; // Low frequency -> L3 cache
    }
  }

  async createOptimizedChannels(stream) {
    const channelCount = this.calculateOptimalChannelCount(stream);
    
    for (let i = 0; i < channelCount; i++) {
      const channel = await this.createOptimizedChannel(stream, i);
      stream.channels.push(channel);
    }
  }

  calculateOptimalChannelCount(stream) {
    const { volume, frequency } = stream.config;
    const baseChannels = 1;
    const volumeChannels = Math.ceil(volume / 1000000); // 1 channel per 1M records
    const frequencyChannels = Math.ceil(frequency / 1000); // 1 channel per 1K req/sec
    
    return Math.min(baseChannels + volumeChannels + frequencyChannels, 10);
  }

  async createOptimizedChannel(stream, channelId) {
    return {
      id: `${stream.id}_channel_${channelId}`,
      streamId: stream.id,
      compression: stream.config.compression,
      serialization: stream.config.serialization,
      routing: stream.config.routing,
      cacheStrategy: stream.config.cacheStrategy,
      metrics: {
        throughput: 0,
        latency: 0,
        errorRate: 0,
        queueLength: 0
      },
      buffer: [],
      isActive: true,
      createdAt: new Date()
    };
  }

  // Data Processing Pipeline
  async processData(data, streamId, options = {}) {
    try {
      const stream = this.dataStreams.get(streamId);
      if (!stream) {
        throw new Error(`Stream not found: ${streamId}`);
      }

      const startTime = Date.now();
      
      // Select optimal channel
      const channel = this.selectOptimalChannel(stream, data, options);
      
      // Apply compression
      const compressedData = await this.applyCompression(data, stream.config.compression);
      
      // Apply serialization
      const serializedData = await this.applySerialization(compressedData, stream.config.serialization);
      
      // Apply caching
      const cacheKey = this.generateCacheKey(streamId, data);
      const cachedData = await this.getFromCache(cacheKey, stream.config.cacheStrategy);
      
      if (cachedData) {
        this.updateCacheMetrics(stream.config.cacheStrategy, true);
        return cachedData;
      }
      
      // Process data through channel
      const processedData = await this.processThroughChannel(serializedData, channel);
      
      // Store in cache
      await this.storeInCache(cacheKey, processedData, stream.config.cacheStrategy);
      this.updateCacheMetrics(stream.config.cacheStrategy, false);
      
      // Update metrics
      const processingTime = Date.now() - startTime;
      this.updateStreamMetrics(stream, processingTime, true);
      
      return processedData;
    } catch (error) {
      logger.error('Data processing failed:', error);
      this.updateStreamMetrics(this.dataStreams.get(streamId), 0, false);
      throw error;
    }
  }

  selectOptimalChannel(stream, data, options) {
    const strategy = this.routingStrategies.get(stream.config.routing);
    
    switch (strategy.name) {
      case 'Round Robin':
        return stream.channels[Math.floor(Math.random() * stream.channels.length)];
      
      case 'Least Loaded':
        return stream.channels.reduce((least, current) => 
          current.metrics.queueLength < least.metrics.queueLength ? current : least
        );
      
      case 'Priority Based':
        return stream.channels.find(channel => 
          channel.priority === options.priority
        ) || stream.channels[0];
      
      case 'Latency Optimized':
        return stream.channels.reduce((fastest, current) => 
          current.metrics.latency < fastest.metrics.latency ? current : fastest
        );
      
      default:
        return stream.channels[0];
    }
  }

  async applyCompression(data, compressionType) {
    const engine = this.compressionEngines.get(compressionType);
    if (!engine) {
      return data;
    }

    // Simulate compression (in production, use actual compression libraries)
    const compressionRatio = engine.compressionRatio;
    const compressedSize = Math.ceil(JSON.stringify(data).length * compressionRatio);
    
    return {
      ...data,
      _compressed: true,
      _compressionType: compressionType,
      _originalSize: JSON.stringify(data).length,
      _compressedSize: compressedSize,
      _compressionRatio: compressionRatio
    };
  }

  async applySerialization(data, serializationType) {
    const format = this.serializationFormats.get(serializationType);
    if (!format) {
      return data;
    }

    // Simulate serialization (in production, use actual serialization libraries)
    const serializedSize = Math.ceil(JSON.stringify(data).length * format.size);
    
    return {
      ...data,
      _serialized: true,
      _serializationType: serializationType,
      _serializedSize: serializedSize,
      _serializationRatio: format.size
    };
  }

  async getFromCache(cacheKey, cacheStrategy) {
    const cache = this.cacheLayers.get(cacheStrategy);
    if (!cache) {
      return null;
    }

    // Simulate cache lookup (in production, use actual cache implementation)
    const cached = this.cacheLayers.get(cacheStrategy).data?.[cacheKey];
    if (cached && Date.now() - cached.timestamp < cache.ttl) {
      return cached.data;
    }
    
    return null;
  }

  async storeInCache(cacheKey, data, cacheStrategy) {
    const cache = this.cacheLayers.get(cacheStrategy);
    if (!cache) {
      return;
    }

    // Simulate cache storage (in production, use actual cache implementation)
    if (!cache.data) {
      cache.data = {};
    }
    
    cache.data[cacheKey] = {
      data,
      timestamp: Date.now()
    };
  }

  generateCacheKey(streamId, data) {
    const crypto = require('crypto');
    const dataHash = crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
    return `${streamId}_${dataHash}`;
  }

  updateCacheMetrics(cacheStrategy, hit) {
    const cache = this.cacheLayers.get(cacheStrategy);
    if (cache) {
      if (hit) {
        cache.hitRate = (cache.hitRate * 0.9) + 0.1;
        cache.missRate = (cache.missRate * 0.9);
      } else {
        cache.hitRate = (cache.hitRate * 0.9);
        cache.missRate = (cache.missRate * 0.9) + 0.1;
      }
    }
  }

  updateStreamMetrics(stream, processingTime, success) {
    if (!stream) return;
    
    const metrics = stream.metrics;
    
    // Update throughput (requests per second)
    metrics.throughput = (metrics.throughput * 0.9) + (1000 / processingTime * 0.1);
    
    // Update latency (average processing time)
    metrics.latency = (metrics.latency * 0.9) + (processingTime * 0.1);
    
    // Update error rate
    if (success) {
      metrics.errorRate = (metrics.errorRate * 0.9);
    } else {
      metrics.errorRate = (metrics.errorRate * 0.9) + 0.1;
    }
  }

  // Inter-Agent Communication Optimization
  async optimizeInterAgentCommunication(agentId, targetAgentId, message, options = {}) {
    try {
      const communicationConfig = {
        compression: options.compression || 'auto',
        serialization: options.serialization || 'auto',
        routing: options.routing || 'latency_optimized',
        priority: options.priority || 'medium',
        reliability: options.reliability || 'high'
      };

      // Optimize message based on size and priority
      const optimizedMessage = await this.optimizeMessage(message, communicationConfig);
      
      // Select optimal communication channel
      const channel = await this.selectCommunicationChannel(agentId, targetAgentId, communicationConfig);
      
      // Send message through optimized channel
      const result = await this.sendThroughChannel(optimizedMessage, channel);
      
      // Update communication metrics
      this.updateCommunicationMetrics(agentId, targetAgentId, result);
      
      return result;
    } catch (error) {
      logger.error('Inter-agent communication failed:', error);
      throw error;
    }
  }

  async optimizeMessage(message, config) {
    let optimizedMessage = { ...message };
    
    // Apply compression if beneficial
    if (config.compression !== 'none') {
      const messageSize = JSON.stringify(message).length;
      if (messageSize > 1024) { // Only compress if > 1KB
        optimizedMessage = await this.applyCompression(message, config.compression);
      }
    }
    
    // Apply serialization
    if (config.serialization !== 'none') {
      optimizedMessage = await this.applySerialization(optimizedMessage, config.serialization);
    }
    
    // Add metadata
    optimizedMessage._metadata = {
      timestamp: Date.now(),
      agentId: message.agentId,
      targetAgentId: message.targetAgentId,
      priority: config.priority,
      reliability: config.reliability
    };
    
    return optimizedMessage;
  }

  async selectCommunicationChannel(agentId, targetAgentId, config) {
    // Select channel based on priority and reliability requirements
    if (config.priority === 'high' && config.reliability === 'high') {
      return 'direct_secure';
    } else if (config.priority === 'high') {
      return 'direct_fast';
    } else if (config.reliability === 'high') {
      return 'queued_reliable';
    } else {
      return 'queued_standard';
    }
  }

  async sendThroughChannel(message, channel) {
    // Simulate message sending through different channels
    const channelDelays = {
      'direct_secure': 50,
      'direct_fast': 20,
      'queued_reliable': 100,
      'queued_standard': 30
    };
    
    const delay = channelDelays[channel] || 50;
    await new Promise(resolve => setTimeout(resolve, delay));
    
    return {
      success: true,
      channel,
      latency: delay,
      timestamp: Date.now()
    };
  }

  updateCommunicationMetrics(agentId, targetAgentId, result) {
    const key = `${agentId}_${targetAgentId}`;
    const metrics = this.performanceMetrics.get(key) || {
      totalMessages: 0,
      successfulMessages: 0,
      averageLatency: 0,
      errorRate: 0
    };
    
    metrics.totalMessages++;
    if (result.success) {
      metrics.successfulMessages++;
    }
    
    metrics.averageLatency = (metrics.averageLatency * 0.9) + (result.latency * 0.1);
    metrics.errorRate = 1 - (metrics.successfulMessages / metrics.totalMessages);
    
    this.performanceMetrics.set(key, metrics);
  }

  // Optimization Processes
  async optimizeCaches() {
    for (const [cacheId, cache] of this.cacheLayers) {
      // Clean expired entries
      if (cache.data) {
        const now = Date.now();
        Object.keys(cache.data).forEach(key => {
          if (now - cache.data[key].timestamp > cache.ttl) {
            delete cache.data[key];
          }
        });
      }
      
      // Optimize cache size
      if (cache.data && Object.keys(cache.data).length > cache.maxSize) {
        const entries = Object.entries(cache.data);
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        
        // Remove oldest entries
        const toRemove = entries.slice(0, entries.length - cache.maxSize);
        toRemove.forEach(([key]) => delete cache.data[key]);
      }
    }
  }

  async optimizeCompression() {
    // Analyze compression performance and adjust strategies
    for (const [engineId, engine] of this.compressionEngines) {
      // Update compression ratios based on performance
      const performance = this.calculateCompressionPerformance(engineId);
      engine.performance = performance;
    }
  }

  async optimizeRouting() {
    // Analyze routing performance and adjust strategies
    for (const [strategyId, strategy] of this.routingStrategies) {
      const performance = this.calculateRoutingPerformance(strategyId);
      strategy.performance = performance;
    }
  }

  async monitorPerformance() {
    // Monitor overall data flow performance
    const metrics = {
      totalStreams: this.dataStreams.size,
      activeChannels: 0,
      averageThroughput: 0,
      averageLatency: 0,
      cacheHitRates: {},
      compressionRatios: {},
      errorRates: {}
    };
    
    // Calculate metrics
    for (const stream of this.dataStreams.values()) {
      metrics.activeChannels += stream.channels.length;
      metrics.averageThroughput += stream.metrics.throughput;
      metrics.averageLatency += stream.metrics.latency;
    }
    
    if (this.dataStreams.size > 0) {
      metrics.averageThroughput /= this.dataStreams.size;
      metrics.averageLatency /= this.dataStreams.size;
    }
    
    // Cache hit rates
    for (const [cacheId, cache] of this.cacheLayers) {
      metrics.cacheHitRates[cacheId] = cache.hitRate;
    }
    
    // Compression ratios
    for (const [engineId, engine] of this.compressionEngines) {
      metrics.compressionRatios[engineId] = engine.compressionRatio;
    }
    
    // Error rates
    for (const [key, metrics] of this.performanceMetrics) {
      metrics.errorRates[key] = metrics.errorRate;
    }
    
    this.emit('performanceUpdate', metrics);
  }

  calculateCompressionPerformance(engineId) {
    // Calculate compression performance based on usage
    const engine = this.compressionEngines.get(engineId);
    return {
      efficiency: engine.compressionRatio,
      speed: engine.speed,
      cpuUsage: engine.cpuUsage
    };
  }

  calculateRoutingPerformance(strategyId) {
    // Calculate routing performance based on metrics
    return {
      loadBalancing: 'good',
      latency: 'low',
      reliability: 'high'
    };
  }

  // Public API
  async createDataStream(streamId, config) {
    return await this.createOptimizedDataStream(streamId, config);
  }

  async processDataThroughStream(data, streamId, options) {
    return await this.processData(data, streamId, options);
  }

  async sendAgentMessage(agentId, targetAgentId, message, options) {
    return await this.optimizeInterAgentCommunication(agentId, targetAgentId, message, options);
  }

  getPerformanceMetrics() {
    const metrics = {};
    
    // Stream metrics
    for (const [streamId, stream] of this.dataStreams) {
      metrics[streamId] = stream.metrics;
    }
    
    // Cache metrics
    for (const [cacheId, cache] of this.cacheLayers) {
      metrics[`cache_${cacheId}`] = {
        hitRate: cache.hitRate,
        missRate: cache.missRate,
        size: cache.data ? Object.keys(cache.data).length : 0
      };
    }
    
    // Communication metrics
    for (const [key, commMetrics] of this.performanceMetrics) {
      metrics[`communication_${key}`] = commMetrics;
    }
    
    return metrics;
  }

  getStreamStatus(streamId) {
    const stream = this.dataStreams.get(streamId);
    if (!stream) {
      return null;
    }
    
    return {
      id: stream.id,
      config: stream.config,
      metrics: stream.metrics,
      channels: stream.channels.length,
      status: 'active',
      uptime: Date.now() - stream.createdAt.getTime()
    };
  }

  async destroyStream(streamId) {
    const stream = this.dataStreams.get(streamId);
    if (stream) {
      // Clean up channels
      stream.channels.forEach(channel => {
        channel.isActive = false;
      });
      
      // Remove from data streams
      this.dataStreams.delete(streamId);
      
      logger.info(`Destroyed data stream: ${streamId}`);
    }
  }
}

module.exports = new DataFlowOptimizationService();