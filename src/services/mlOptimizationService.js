const logger = require('../utils/logger');

class MLOptimizationService {
  constructor() {
    this.mlModels = new Map();
    this.trainingData = new Map();
    this.predictionCache = new Map();
    this.featureExtractors = new Map();
    this.modelPerformance = new Map();
    
    this.initializeMLModels();
    this.initializeFeatureExtractors();
    this.startModelTraining();
  }

  initializeMLModels() {
    // Agent Selection Model
    this.mlModels.set('agent_selection', {
      name: 'Agent Selection Model',
      type: 'classification',
      features: ['task_type', 'agent_performance', 'workload', 'resource_availability'],
      model: null,
      accuracy: 0,
      lastTrained: null,
      trainingData: []
    });

    // Workflow Optimization Model
    this.mlModels.set('workflow_optimization', {
      name: 'Workflow Optimization Model',
      type: 'regression',
      features: ['workflow_complexity', 'system_load', 'agent_capabilities', 'historical_performance'],
      model: null,
      accuracy: 0,
      lastTrained: null,
      trainingData: []
    });

    // Performance Prediction Model
    this.mlModels.set('performance_prediction', {
      name: 'Performance Prediction Model',
      type: 'regression',
      features: ['task_complexity', 'agent_performance', 'system_resources', 'queue_length'],
      model: null,
      accuracy: 0,
      lastTrained: null,
      trainingData: []
    });

    // Load Balancing Model
    this.mlModels.set('load_balancing', {
      name: 'Load Balancing Model',
      type: 'classification',
      features: ['agent_load', 'task_priority', 'agent_capabilities', 'system_state'],
      model: null,
      accuracy: 0,
      lastTrained: null,
      trainingData: []
    });

    // Consensus Building Model
    this.mlModels.set('consensus_building', {
      name: 'Consensus Building Model',
      type: 'regression',
      features: ['result_confidence', 'agent_performance', 'result_diversity', 'historical_consensus'],
      model: null,
      accuracy: 0,
      lastTrained: null,
      trainingData: []
    });
  }

  initializeFeatureExtractors() {
    // Agent Selection Features
    this.featureExtractors.set('agent_selection', (task, agents, systemState) => {
      return {
        task_type: this.encodeTaskType(task.taskType),
        agent_performance: agents.map(agent => agent.performanceScore || 0.5),
        workload: agents.map(agent => (agent.currentTasks || 0) / (agent.maxConcurrentTasks || 5)),
        resource_availability: agents.map(agent => 1 - (agent.memoryUsage || 0.5)),
        system_load: systemState.cpuUsage || 0.5,
        queue_length: systemState.queuedTasks || 0
      };
    });

    // Workflow Optimization Features
    this.featureExtractors.set('workflow_optimization', (workflow, systemState, historicalData) => {
      return {
        workflow_complexity: this.calculateWorkflowComplexity(workflow),
        system_load: systemState.cpuUsage || 0.5,
        agent_capabilities: this.calculateAgentCapabilities(workflow.steps),
        historical_performance: historicalData.averagePerformance || 0.5,
        step_count: workflow.steps.length,
        parallelizable_steps: workflow.steps.filter(s => s.optimization?.parallelizable).length
      };
    });

    // Performance Prediction Features
    this.featureExtractors.set('performance_prediction', (task, agent, systemState) => {
      return {
        task_complexity: this.calculateTaskComplexity(task),
        agent_performance: agent.performanceScore || 0.5,
        system_resources: {
          cpu: systemState.cpuUsage || 0.5,
          memory: systemState.memoryUsage || 0.5,
          network: systemState.networkLatency || 50
        },
        queue_length: systemState.queuedTasks || 0,
        agent_load: (agent.currentTasks || 0) / (agent.maxConcurrentTasks || 5),
        task_priority: task.priority || 5
      };
    });

    // Load Balancing Features
    this.featureExtractors.set('load_balancing', (agents, tasks, systemState) => {
      return {
        agent_load: agents.map(agent => (agent.currentTasks || 0) / (agent.maxConcurrentTasks || 5)),
        task_priority: tasks.map(task => task.priority || 5),
        agent_capabilities: agents.map(agent => agent.performanceScore || 0.5),
        system_state: {
          cpu: systemState.cpuUsage || 0.5,
          memory: systemState.memoryUsage || 0.5,
          active_tasks: systemState.activeTasks || 0
        }
      };
    });

    // Consensus Building Features
    this.featureExtractors.set('consensus_building', (results, agents, context) => {
      return {
        result_confidence: results.map(r => r.confidence || 0.5),
        agent_performance: agents.map(agent => agent.performanceScore || 0.5),
        result_diversity: this.calculateResultDiversity(results),
        historical_consensus: context.historicalConsensus || 0.5,
        result_count: results.length,
        agreement_level: this.calculateAgreementLevel(results)
      };
    });
  }

  // ML Model Training
  async startModelTraining() {
    const { shouldRunAgentOptimizationBackgroundLoops } = require('../config/backgroundLoops');
    const { setManagedInterval } = require('../utils/intervalRegistry');
    if (!shouldRunAgentOptimizationBackgroundLoops()) {
      await this.trainAllModels();
      return;
    }
    // Train models periodically
    setManagedInterval(async () => {
      try {
        await this.trainAllModels();
      } catch (error) {
        logger.error('Model training error:', error);
      }
    }, 300000); // Train every 5 minutes

    // Initial training
    await this.trainAllModels();
  }

  async trainAllModels() {
    for (const [modelId, model] of this.mlModels) {
      if (model.trainingData.length > 10) { // Minimum training data
        await this.trainModel(modelId, model);
      }
    }
  }

  async trainModel(modelId, model) {
    try {
      logger.info(`Training ML model: ${model.name}`);

      // Prepare training data
      const features = model.trainingData.map(data => data.features);
      const labels = model.trainingData.map(data => data.label);

      // Simple linear regression/classification (in production, use proper ML library)
      const trainedModel = this.trainSimpleModel(features, labels, model.type);
      
      model.model = trainedModel;
      model.accuracy = this.calculateModelAccuracy(trainedModel, features, labels);
      model.lastTrained = new Date();

      logger.info(`Model ${model.name} trained with accuracy: ${model.accuracy.toFixed(3)}`);
    } catch (error) {
      logger.error(`Failed to train model ${model.name}:`, error);
    }
  }

  trainSimpleModel(features, labels, type) {
    // Simplified model training (in production, use TensorFlow.js, scikit-learn, etc.)
    if (type === 'regression') {
      return this.trainLinearRegression(features, labels);
    } else if (type === 'classification') {
      return this.trainLogisticRegression(features, labels);
    }
    return null;
  }

  trainLinearRegression(features, labels) {
    // Simple linear regression implementation
    const n = features.length;
    if (n === 0) return null;

    const featureCount = features[0].length;
    const weights = new Array(featureCount).fill(0);
    let bias = 0;
    const learningRate = 0.01;
    const epochs = 100;

    for (let epoch = 0; epoch < epochs; epoch++) {
      for (let i = 0; i < n; i++) {
        const prediction = this.predictLinear(features[i], weights, bias);
        const error = labels[i] - prediction;

        // Update weights
        for (let j = 0; j < featureCount; j++) {
          weights[j] += learningRate * error * features[i][j];
        }
        bias += learningRate * error;
      }
    }

    return { weights, bias, type: 'linear_regression' };
  }

  trainLogisticRegression(features, labels) {
    // Simple logistic regression implementation
    const n = features.length;
    if (n === 0) return null;

    const featureCount = features[0].length;
    const weights = new Array(featureCount).fill(0);
    let bias = 0;
    const learningRate = 0.01;
    const epochs = 100;

    for (let epoch = 0; epoch < epochs; epoch++) {
      for (let i = 0; i < n; i++) {
        const prediction = this.sigmoid(this.predictLinear(features[i], weights, bias));
        const error = labels[i] - prediction;

        // Update weights
        for (let j = 0; j < featureCount; j++) {
          weights[j] += learningRate * error * features[i][j];
        }
        bias += learningRate * error;
      }
    }

    return { weights, bias, type: 'logistic_regression' };
  }

  predictLinear(features, weights, bias) {
    let prediction = bias;
    for (let i = 0; i < features.length; i++) {
      prediction += weights[i] * features[i];
    }
    return prediction;
  }

  sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
  }

  calculateModelAccuracy(model, features, labels) {
    if (!model) return 0;

    let correct = 0;
    for (let i = 0; i < features.length; i++) {
      const prediction = this.makePrediction(model, features[i]);
      const actual = labels[i];
      
      if (model.type === 'classification') {
        if (Math.round(prediction) === actual) correct++;
      } else {
        // For regression, consider correct if within 10% of actual value
        if (Math.abs(prediction - actual) / actual < 0.1) correct++;
      }
    }

    return correct / features.length;
  }

  makePrediction(model, features) {
    if (model.type === 'linear_regression') {
      return this.predictLinear(features, model.weights, model.bias);
    } else if (model.type === 'logistic_regression') {
      return this.sigmoid(this.predictLinear(features, model.weights, model.bias));
    }
    return 0;
  }

  // ML-Powered Agent Selection
  async selectOptimalAgent(task, availableAgents, systemState) {
    const model = this.mlModels.get('agent_selection');
    if (!model.model) {
      return this.selectAgentFallback(task, availableAgents);
    }

    try {
      // Extract features
      const features = this.featureExtractors.get('agent_selection')(task, availableAgents, systemState);
      
      // Make prediction
      const scores = availableAgents.map((agent, index) => {
        const agentFeatures = [
          features.task_type,
          features.agent_performance[index],
          features.workload[index],
          features.resource_availability[index],
          features.system_load,
          features.queue_length
        ];
        
        const score = this.makePrediction(model.model, agentFeatures);
        return { agent, score };
      });

      // Select agent with highest score
      const selected = scores.reduce((best, current) => 
        current.score > best.score ? current : best
      );

      // Store training data
      this.addTrainingData('agent_selection', {
        features: features,
        label: availableAgents.indexOf(selected.agent),
        timestamp: new Date()
      });

      return selected.agent;
    } catch (error) {
      logger.error('ML agent selection failed:', error);
      return this.selectAgentFallback(task, availableAgents);
    }
  }

  // ML-Powered Workflow Optimization
  async optimizeWorkflow(workflow, systemState, historicalData) {
    const model = this.mlModels.get('workflow_optimization');
    if (!model.model) {
      return this.optimizeWorkflowFallback(workflow);
    }

    try {
      // Extract features
      const features = this.featureExtractors.get('workflow_optimization')(workflow, systemState, historicalData);
      
      // Make prediction
      const optimizationScore = this.makePrediction(model.model, Object.values(features));
      
      // Apply optimizations based on prediction
      const optimizations = this.generateWorkflowOptimizations(optimizationScore, workflow);
      
      // Store training data
      this.addTrainingData('workflow_optimization', {
        features: features,
        label: optimizationScore,
        timestamp: new Date()
      });

      return optimizations;
    } catch (error) {
      logger.error('ML workflow optimization failed:', error);
      return this.optimizeWorkflowFallback(workflow);
    }
  }

  // ML-Powered Performance Prediction
  async predictPerformance(task, agent, systemState) {
    const model = this.mlModels.get('performance_prediction');
    if (!model.model) {
      return this.predictPerformanceFallback(task, agent);
    }

    try {
      // Extract features
      const features = this.featureExtractors.get('performance_prediction')(task, agent, systemState);
      
      // Make prediction
      const predictedPerformance = this.makePrediction(model.model, Object.values(features));
      
      // Store training data
      this.addTrainingData('performance_prediction', {
        features: features,
        label: predictedPerformance,
        timestamp: new Date()
      });

      return {
        predictedTime: predictedPerformance * 1000, // Convert to milliseconds
        confidence: this.calculatePredictionConfidence(model, features),
        factors: this.analyzePerformanceFactors(features)
      };
    } catch (error) {
      logger.error('ML performance prediction failed:', error);
      return this.predictPerformanceFallback(task, agent);
    }
  }

  // ML-Powered Load Balancing
  async balanceLoad(agents, tasks, systemState) {
    const model = this.mlModels.get('load_balancing');
    if (!model.model) {
      return this.balanceLoadFallback(agents, tasks);
    }

    try {
      // Extract features
      const features = this.featureExtractors.get('load_balancing')(agents, tasks, systemState);
      
      // Make predictions for each task-agent combination
      const assignments = tasks.map(task => {
        const taskScores = agents.map((agent, index) => {
          const agentFeatures = [
            features.agent_load[index],
            task.priority || 5,
            features.agent_capabilities[index],
            features.system_state.cpu,
            features.system_state.memory,
            features.system_state.active_tasks
          ];
          
          const score = this.makePrediction(model.model, agentFeatures);
          return { agent, score };
        });

        const bestAgent = taskScores.reduce((best, current) => 
          current.score > best.score ? current : best
        );

        return { task, agent: bestAgent.agent };
      });

      // Store training data
      this.addTrainingData('load_balancing', {
        features: features,
        label: assignments.length,
        timestamp: new Date()
      });

      return assignments;
    } catch (error) {
      logger.error('ML load balancing failed:', error);
      return this.balanceLoadFallback(agents, tasks);
    }
  }

  // ML-Powered Consensus Building
  async buildConsensus(results, agents, context) {
    const model = this.mlModels.get('consensus_building');
    if (!model.model) {
      return this.buildConsensusFallback(results);
    }

    try {
      // Extract features
      const features = this.featureExtractors.get('consensus_building')(results, agents, context);
      
      // Make prediction
      const consensusScore = this.makePrediction(model.model, Object.values(features));
      
      // Build consensus based on prediction
      const consensus = this.generateConsensusFromScore(consensusScore, results);
      
      // Store training data
      this.addTrainingData('consensus_building', {
        features: features,
        label: consensusScore,
        timestamp: new Date()
      });

      return consensus;
    } catch (error) {
      logger.error('ML consensus building failed:', error);
      return this.buildConsensusFallback(results);
    }
  }

  // Helper Methods
  addTrainingData(modelId, data) {
    const model = this.mlModels.get(modelId);
    if (model) {
      model.trainingData.push(data);
      
      // Keep only recent training data (last 1000 entries)
      if (model.trainingData.length > 1000) {
        model.trainingData = model.trainingData.slice(-1000);
      }
    }
  }

  encodeTaskType(taskType) {
    const encoding = {
      'carbon_analysis': 1,
      'recommendation_generation': 2,
      'data_processing': 3,
      'anomaly_detection': 4,
      'trend_analysis': 5,
      'compliance_check': 6,
      'optimization_advice': 7,
      'report_generation': 8
    };
    return encoding[taskType] || 0;
  }

  calculateWorkflowComplexity(workflow) {
    const stepCount = workflow.steps.length;
    const dependencyCount = workflow.steps.reduce((count, step) => 
      count + (step.dependencies?.length || 0), 0
    );
    const resourceIntensiveSteps = workflow.steps.filter(step => 
      step.optimization?.resourceIntensive
    ).length;
    
    return (stepCount * 0.3) + (dependencyCount * 0.4) + (resourceIntensiveSteps * 0.3);
  }

  calculateAgentCapabilities(steps) {
    const capabilities = steps.map(step => {
      const capabilityMap = {
        'carbon_analysis': 0.9,
        'data_processing': 0.8,
        'anomaly_detection': 0.7,
        'trend_analysis': 0.6,
        'compliance_check': 0.5,
        'optimization_advice': 0.4,
        'report_generation': 0.3,
        'recommendation_generation': 0.2
      };
      return capabilityMap[step.type] || 0.1;
    });
    
    return capabilities.reduce((sum, cap) => sum + cap, 0) / capabilities.length;
  }

  calculateTaskComplexity(task) {
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
    
    const baseComplexity = complexityMap[task.taskType] || 1;
    const inputComplexity = Math.log(JSON.stringify(task.input).length) / Math.log(10);
    
    return Math.min(baseComplexity + inputComplexity, 10);
  }

  calculateResultDiversity(results) {
    if (results.length <= 1) return 0;
    
    // Calculate variance in confidence scores
    const confidences = results.map(r => r.confidence || 0.5);
    const mean = confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
    const variance = confidences.reduce((sum, conf) => sum + Math.pow(conf - mean, 2), 0) / confidences.length;
    
    return Math.sqrt(variance);
  }

  calculateAgreementLevel(results) {
    if (results.length <= 1) return 1;
    
    // Simple agreement calculation based on confidence scores
    const confidences = results.map(r => r.confidence || 0.5);
    const mean = confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
    const agreement = 1 - (confidences.reduce((sum, conf) => sum + Math.abs(conf - mean), 0) / confidences.length);
    
    return Math.max(0, agreement);
  }

  calculatePredictionConfidence(model, features) {
    // Simple confidence calculation based on model accuracy and feature quality
    const baseConfidence = model.accuracy || 0.5;
    const featureQuality = this.calculateFeatureQuality(features);
    
    return Math.min(1, baseConfidence * featureQuality);
  }

  calculateFeatureQuality(features) {
    // Calculate quality based on feature completeness and range
    const values = Object.values(features).flat();
    const nonZeroValues = values.filter(v => v !== 0 && v !== null && v !== undefined);
    
    return nonZeroValues.length / values.length;
  }

  analyzePerformanceFactors(features) {
    return {
      taskComplexity: features.task_complexity,
      agentPerformance: features.agent_performance,
      systemLoad: features.system_resources.cpu,
      queueLength: features.queue_length,
      agentLoad: features.agent_load
    };
  }

  generateWorkflowOptimizations(score, workflow) {
    const optimizations = [];
    
    if (score > 0.8) {
      optimizations.push({
        type: 'parallel_processing',
        description: 'Enable aggressive parallel processing',
        impact: 'high'
      });
    }
    
    if (score > 0.6) {
      optimizations.push({
        type: 'caching',
        description: 'Enable comprehensive caching',
        impact: 'medium'
      });
    }
    
    if (score < 0.4) {
      optimizations.push({
        type: 'sequential_processing',
        description: 'Use sequential processing for stability',
        impact: 'medium'
      });
    }
    
    return optimizations;
  }

  generateConsensusFromScore(score, results) {
    return {
      confidence: score,
      agreement: score,
      recommendations: results.flatMap(r => r.recommendations || []),
      insights: results.flatMap(r => r.insights || []),
      quality: score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low'
    };
  }

  // Fallback Methods
  selectAgentFallback(task, availableAgents) {
    return availableAgents.reduce((best, current) => 
      (current.performanceScore || 0.5) > (best.performanceScore || 0.5) ? current : best
    );
  }

  optimizeWorkflowFallback(workflow) {
    return [{
      type: 'basic_optimization',
      description: 'Apply basic workflow optimizations',
      impact: 'low'
    }];
  }

  predictPerformanceFallback(task, agent) {
    return {
      predictedTime: 5000, // 5 seconds default
      confidence: 0.5,
      factors: {
        taskComplexity: 1,
        agentPerformance: 0.5,
        systemLoad: 0.5,
        queueLength: 0,
        agentLoad: 0.5
      }
    };
  }

  balanceLoadFallback(agents, tasks) {
    return tasks.map((task, index) => ({
      task,
      agent: agents[index % agents.length]
    }));
  }

  buildConsensusFallback(results) {
    return {
      confidence: 0.5,
      agreement: 0.5,
      recommendations: results.flatMap(r => r.recommendations || []),
      insights: results.flatMap(r => r.insights || []),
      quality: 'medium'
    };
  }

  // Public API
  async getModelStatus() {
    const status = {};
    for (const [modelId, model] of this.mlModels) {
      status[modelId] = {
        name: model.name,
        type: model.type,
        accuracy: model.accuracy,
        lastTrained: model.lastTrained,
        trainingDataSize: model.trainingData.length,
        isTrained: model.model !== null
      };
    }
    return status;
  }

  async retrainModel(modelId) {
    const model = this.mlModels.get(modelId);
    if (model) {
      await this.trainModel(modelId, model);
    }
  }

  async clearTrainingData(modelId) {
    const model = this.mlModels.get(modelId);
    if (model) {
      model.trainingData = [];
      model.model = null;
      model.accuracy = 0;
    }
  }
}

module.exports = new MLOptimizationService();