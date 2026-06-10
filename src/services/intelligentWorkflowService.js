const os = require('os');
const logger = require('../utils/logger');

const getAiAgentService = () => require('./aiAgentService');
const getAIAgentModel = () => require('../models/AIAgent');

const STEP_TYPE_TO_AGENT = {
  data_processing: 'data_processor',
  carbon_analysis: 'carbon_analyzer',
  anomaly_detection: 'anomaly_detector',
  trend_analysis: 'trend_analyzer',
  recommendation_generation: 'recommendation_engine',
  compliance_monitoring: 'compliance_monitor',
  optimization: 'optimization_advisor',
  report_generation: 'report_generator'
};

class IntelligentWorkflowService {
  constructor() {
    this.workflowTemplates = new Map();
    this.optimizationRules = new Map();
    this.performanceHistory = new Map();
    this.workflowPredictor = new Map();
    this.agentSelector = new Map();
    
    this.initializeWorkflowTemplates();
    this.initializeOptimizationRules();
    this.initializeIntelligentFeatures();
  }

  initializeWorkflowTemplates() {
    // Carbon Analysis Workflow Template
    this.workflowTemplates.set('carbon_analysis_workflow', {
      name: 'Intelligent Carbon Analysis Workflow',
      description: 'AI-optimized carbon footprint analysis with dynamic agent selection',
      category: 'carbon_analysis',
      complexity: 'high',
      estimatedDuration: 300000, // 5 minutes
      steps: [
        {
          stepId: 'data_preprocessing',
          name: 'Data Preprocessing',
          type: 'data_processing',
          dependencies: [],
          optimization: {
            parallelizable: true,
            cacheable: true,
            resourceIntensive: false
          }
        },
        {
          stepId: 'carbon_calculation',
          name: 'Carbon Footprint Calculation',
          type: 'carbon_analysis',
          dependencies: ['data_preprocessing'],
          optimization: {
            parallelizable: false,
            cacheable: true,
            resourceIntensive: true
          }
        },
        {
          stepId: 'anomaly_detection',
          name: 'Anomaly Detection',
          type: 'anomaly_detection',
          dependencies: ['carbon_calculation'],
          optimization: {
            parallelizable: true,
            cacheable: false,
            resourceIntensive: true
          }
        },
        {
          stepId: 'trend_analysis',
          name: 'Trend Analysis',
          type: 'trend_analysis',
          dependencies: ['carbon_calculation'],
          optimization: {
            parallelizable: true,
            cacheable: true,
            resourceIntensive: false
          }
        },
        {
          stepId: 'recommendation_generation',
          name: 'Recommendation Generation',
          type: 'recommendation_generation',
          dependencies: ['anomaly_detection', 'trend_analysis'],
          optimization: {
            parallelizable: false,
            cacheable: true,
            resourceIntensive: false
          }
        },
        {
          stepId: 'report_generation',
          name: 'Report Generation',
          type: 'report_generation',
          dependencies: ['recommendation_generation'],
          optimization: {
            parallelizable: false,
            cacheable: true,
            resourceIntensive: false
          }
        }
      ],
      coordination: {
        strategy: 'adaptive',
        loadBalancing: 'predictive',
        consensus: 'ensemble',
        optimization: {
          autoScale: true,
          dynamicRouting: true,
          performanceMonitoring: true
        }
      }
    });

    // Sustainability Assessment Workflow Template
    this.workflowTemplates.set('sustainability_assessment_workflow', {
      name: 'Comprehensive Sustainability Assessment',
      description: 'End-to-end sustainability evaluation with intelligent optimization',
      category: 'sustainability',
      complexity: 'very_high',
      estimatedDuration: 600000, // 10 minutes
      steps: [
        {
          stepId: 'data_collection',
          name: 'Multi-source Data Collection',
          type: 'data_processing',
          dependencies: [],
          optimization: {
            parallelizable: true,
            cacheable: true,
            resourceIntensive: false
          }
        },
        {
          stepId: 'carbon_analysis',
          name: 'Carbon Footprint Analysis',
          type: 'carbon_analysis',
          dependencies: ['data_collection'],
          optimization: {
            parallelizable: false,
            cacheable: true,
            resourceIntensive: true
          }
        },
        {
          stepId: 'compliance_check',
          name: 'Regulatory Compliance Check',
          type: 'compliance_check',
          dependencies: ['data_collection'],
          optimization: {
            parallelizable: true,
            cacheable: true,
            resourceIntensive: false
          }
        },
        {
          stepId: 'efficiency_analysis',
          name: 'Resource Efficiency Analysis',
          type: 'trend_analysis',
          dependencies: ['carbon_analysis'],
          optimization: {
            parallelizable: true,
            cacheable: true,
            resourceIntensive: true
          }
        },
        {
          stepId: 'risk_assessment',
          name: 'Environmental Risk Assessment',
          type: 'anomaly_detection',
          dependencies: ['carbon_analysis', 'compliance_check'],
          optimization: {
            parallelizable: true,
            cacheable: false,
            resourceIntensive: true
          }
        },
        {
          stepId: 'optimization_advice',
          name: 'Optimization Recommendations',
          type: 'optimization_advice',
          dependencies: ['efficiency_analysis', 'risk_assessment'],
          optimization: {
            parallelizable: false,
            cacheable: true,
            resourceIntensive: false
          }
        },
        {
          stepId: 'sustainability_score',
          name: 'Sustainability Score Calculation',
          type: 'carbon_analysis',
          dependencies: ['optimization_advice'],
          optimization: {
            parallelizable: false,
            cacheable: true,
            resourceIntensive: false
          }
        },
        {
          stepId: 'comprehensive_report',
          name: 'Comprehensive Report Generation',
          type: 'report_generation',
          dependencies: ['sustainability_score'],
          optimization: {
            parallelizable: false,
            cacheable: true,
            resourceIntensive: false
          }
        }
      ],
      coordination: {
        strategy: 'hybrid',
        loadBalancing: 'performance_based',
        consensus: 'ml_consensus',
        optimization: {
          autoScale: true,
          dynamicRouting: true,
          performanceMonitoring: true,
          predictiveScaling: true
        }
      }
    });

    // Real-time Monitoring Workflow Template
    this.workflowTemplates.set('realtime_monitoring_workflow', {
      name: 'Real-time Environmental Monitoring',
      description: 'Continuous monitoring with instant alerts and optimization',
      category: 'monitoring',
      complexity: 'medium',
      estimatedDuration: 60000, // 1 minute
      steps: [
        {
          stepId: 'data_stream_processing',
          name: 'Real-time Data Stream Processing',
          type: 'data_processing',
          dependencies: [],
          optimization: {
            parallelizable: true,
            cacheable: false,
            resourceIntensive: false,
            realTime: true
          }
        },
        {
          stepId: 'anomaly_detection',
          name: 'Real-time Anomaly Detection',
          type: 'anomaly_detection',
          dependencies: ['data_stream_processing'],
          optimization: {
            parallelizable: true,
            cacheable: false,
            resourceIntensive: true,
            realTime: true
          }
        },
        {
          stepId: 'alert_generation',
          name: 'Alert Generation',
          type: 'recommendation_generation',
          dependencies: ['anomaly_detection'],
          optimization: {
            parallelizable: false,
            cacheable: false,
            resourceIntensive: false,
            realTime: true
          }
        }
      ],
      coordination: {
        strategy: 'parallel',
        loadBalancing: 'least_connections',
        consensus: 'weighted_voting',
        optimization: {
          autoScale: true,
          dynamicRouting: true,
          performanceMonitoring: true,
          realTimeOptimization: true
        }
      }
    });
  }

  initializeOptimizationRules() {
    // Performance-based optimization rules
    this.optimizationRules.set('performance_optimization', {
      name: 'Performance Optimization Rules',
      rules: [
        {
          condition: 'responseTime > 10000', // 10 seconds
          action: 'scale_up_agents',
          parameters: { factor: 1.5 }
        },
        {
          condition: 'successRate < 0.8',
          action: 'switch_agent_type',
          parameters: { fallbackType: 'backup_agent' }
        },
        {
          condition: 'queueLength > 20',
          action: 'enable_parallel_processing',
          parameters: { maxConcurrency: 5 }
        },
        {
          condition: 'cacheHitRate < 0.6',
          action: 'optimize_cache_strategy',
          parameters: { ttl: 600, maxSize: 1000 }
        }
      ]
    });

    // Resource optimization rules
    this.optimizationRules.set('resource_optimization', {
      name: 'Resource Optimization Rules',
      rules: [
        {
          condition: 'memoryUsage > 0.8',
          action: 'reduce_batch_size',
          parameters: { factor: 0.5 }
        },
        {
          condition: 'cpuUsage > 0.9',
          action: 'throttle_processing',
          parameters: { delay: 1000 }
        },
        {
          condition: 'networkLatency > 200',
          action: 'enable_local_caching',
          parameters: { ttl: 300 }
        }
      ]
    });

    // Quality optimization rules
    this.optimizationRules.set('quality_optimization', {
      name: 'Quality Optimization Rules',
      rules: [
        {
          condition: 'confidence < 0.7',
          action: 'enable_consensus_mode',
          parameters: { algorithm: 'ensemble' }
        },
        {
          condition: 'errorRate > 0.1',
          action: 'enable_retry_mechanism',
          parameters: { maxRetries: 3, backoff: 'exponential' }
        },
        {
          condition: 'dataQuality < 0.8',
          action: 'enable_data_validation',
          parameters: { strict: true }
        }
      ]
    });
  }

  initializeIntelligentFeatures() {
    // Initialize ML-based features
    this.workflowPredictor = new Map();
    this.agentSelector = new Map();
    
    // Initialize performance tracking
    this.performanceHistory = new Map();
  }

  // Intelligent Workflow Creation
  async createIntelligentWorkflow(workflowType, customizations = {}) {
    try {
      const template = this.workflowTemplates.get(workflowType);
      if (!template) {
        throw new Error(`Unknown workflow type: ${workflowType}`);
      }

      // Apply intelligent customizations
      const intelligentWorkflow = await this.applyIntelligentCustomizations(template, customizations);
      
      // Optimize workflow based on current system state
      const optimizedWorkflow = await this.optimizeWorkflow(intelligentWorkflow);
      
      // Generate workflow ID and metadata
      const workflowId = this.generateWorkflowId();
      const workflow = {
        ...optimizedWorkflow,
        id: workflowId,
        createdAt: new Date(),
        version: '1.0.0',
        intelligence: {
          autoOptimization: true,
          adaptiveScaling: true,
          performanceMonitoring: true,
          predictiveRouting: true
        }
      };

      logger.info(`Created intelligent workflow: ${workflow.name}`, {
        workflowId,
        type: workflowType,
        steps: workflow.steps.length,
        complexity: workflow.complexity
      });

      return workflow;
    } catch (error) {
      logger.error('Failed to create intelligent workflow:', error);
      throw error;
    }
  }

  async applyIntelligentCustomizations(template, customizations) {
    const workflow = { ...template };
    
    // Apply step customizations
    if (customizations.steps) {
      workflow.steps = await this.customizeSteps(workflow.steps, customizations.steps);
    }
    
    // Apply coordination customizations
    if (customizations.coordination) {
      workflow.coordination = {
        ...workflow.coordination,
        ...customizations.coordination
      };
    }
    
    // Apply optimization customizations
    if (customizations.optimization) {
      workflow.coordination.optimization = {
        ...workflow.coordination.optimization,
        ...customizations.optimization
      };
    }
    
    // Apply intelligent agent selection
    workflow.steps = await this.selectOptimalAgents(workflow.steps);
    
    return workflow;
  }

  async customizeSteps(steps, customizations) {
    return steps.map(step => {
      const customization = customizations[step.stepId];
      if (customization) {
        return {
          ...step,
          ...customization,
          optimization: {
            ...step.optimization,
            ...customization.optimization
          }
        };
      }
      return step;
    });
  }

  async selectOptimalAgents(steps) {
    const systemState = await this.analyzeSystemState();
    const availableAgents = await this.getAvailableAgents();
    
    return steps.map(step => {
      const optimalAgent = this.selectAgentForStep(step, availableAgents, systemState);
      return {
        ...step,
        agentId: optimalAgent.id,
        agentType: optimalAgent.type,
        selectionReason: optimalAgent.reason
      };
    });
  }

  selectAgentForStep(step, availableAgents, systemState) {
    // Intelligent agent selection based on multiple factors
    const candidates = availableAgents.filter(agent => 
      agent.capabilities.includes(step.type) && 
      agent.status === 'active'
    );
    
    if (candidates.length === 0) {
      throw new Error(`No available agents for step type: ${step.type}`);
    }
    
    // Score each candidate
    const scoredCandidates = candidates.map(agent => {
      let score = 0;
      
      // Performance score (40%)
      score += (agent.performanceScore || 0.5) * 0.4;
      
      // Resource availability (20%)
      score += this.calculateResourceScore(agent, systemState) * 0.2;
      
      // Workload score (20%)
      score += this.calculateWorkloadScore(agent) * 0.2;
      
      // Specialization score (20%)
      score += this.calculateSpecializationScore(agent, step) * 0.2;
      
      return {
        ...agent,
        score,
        reason: this.generateSelectionReason(agent, step)
      };
    });
    
    // Select highest scoring agent
    const selected = scoredCandidates.reduce((best, current) => 
      current.score > best.score ? current : best
    );
    
    return selected;
  }

  calculateResourceScore(agent, systemState) {
    const memoryScore = 1 - (agent.memoryUsage || 0);
    const cpuScore = 1 - (agent.cpuUsage || 0);
    return (memoryScore + cpuScore) / 2;
  }

  calculateWorkloadScore(agent) {
    const currentTasks = agent.currentTasks || 0;
    const maxTasks = agent.maxConcurrentTasks || 5;
    return 1 - (currentTasks / maxTasks);
  }

  calculateSpecializationScore(agent, step) {
    // Check if agent is specialized for this step type
    const specializationMap = {
      'carbon_analysis': ['carbon_analyzer'],
      'data_processing': ['data_processor'],
      'anomaly_detection': ['anomaly_detector'],
      'trend_analysis': ['trend_analyzer'],
      'compliance_check': ['compliance_monitor'],
      'optimization_advice': ['optimization_advisor'],
      'report_generation': ['report_generator'],
      'recommendation_generation': ['recommendation_engine']
    };
    
    const specializedTypes = specializationMap[step.type] || [];
    return specializedTypes.includes(agent.type) ? 1.0 : 0.5;
  }

  generateSelectionReason(agent, step) {
    return `Selected ${agent.name} for ${step.name} based on performance score: ${agent.score.toFixed(2)}`;
  }

  // Workflow Optimization
  async optimizeWorkflow(workflow) {
    try {
      // Analyze workflow complexity
      const complexity = this.analyzeWorkflowComplexity(workflow);
      
      // Optimize step dependencies
      const optimizedSteps = await this.optimizeStepDependencies(workflow.steps);
      
      // Optimize coordination strategy
      const optimizedCoordination = await this.optimizeCoordinationStrategy(workflow.coordination, workflow.steps);
      
      // Apply performance optimizations
      const performanceOptimizations = await this.applyPerformanceOptimizations(workflow);
      
      return {
        ...workflow,
        steps: optimizedSteps,
        coordination: optimizedCoordination,
        optimizations: performanceOptimizations,
        complexity
      };
    } catch (error) {
      logger.error('Workflow optimization failed:', error);
      return workflow; // Return original workflow if optimization fails
    }
  }

  analyzeWorkflowComplexity(workflow) {
    const stepCount = workflow.steps.length;
    const dependencyCount = workflow.steps.reduce((count, step) => 
      count + (step.dependencies?.length || 0), 0
    );
    const resourceIntensiveSteps = workflow.steps.filter(step => 
      step.optimization?.resourceIntensive
    ).length;
    
    const complexityScore = (stepCount * 0.3) + (dependencyCount * 0.4) + (resourceIntensiveSteps * 0.3);
    
    if (complexityScore < 3) return 'low';
    if (complexityScore < 6) return 'medium';
    if (complexityScore < 9) return 'high';
    return 'very_high';
  }

  async optimizeStepDependencies(steps) {
    // Identify parallel execution opportunities
    const parallelGroups = this.identifyParallelGroups(steps);
    
    // Optimize step order
    const optimizedSteps = this.optimizeStepOrder(steps, parallelGroups);
    
    return optimizedSteps;
  }

  identifyParallelGroups(steps) {
    const groups = [];
    const processed = new Set();
    
    for (const step of steps) {
      if (processed.has(step.stepId)) continue;
      
      const group = [step.stepId];
      processed.add(step.stepId);
      
      // Find steps that can run in parallel
      for (const otherStep of steps) {
        if (processed.has(otherStep.stepId)) continue;
        
        if (this.canRunInParallel(step, otherStep, steps)) {
          group.push(otherStep.stepId);
          processed.add(otherStep.stepId);
        }
      }
      
      groups.push(group);
    }
    
    return groups;
  }

  canRunInParallel(step1, step2, allSteps) {
    // Check if step1 depends on step2 or vice versa
    const step1Deps = step1.dependencies || [];
    const step2Deps = step2.dependencies || [];
    
    return !step1Deps.includes(step2.stepId) && !step2Deps.includes(step1.stepId);
  }

  optimizeStepOrder(steps, parallelGroups) {
    // Create optimized step order based on dependencies and parallel groups
    const optimizedSteps = [];
    const processed = new Set();
    
    for (const group of parallelGroups) {
      const groupSteps = group.map(stepId => 
        steps.find(s => s.stepId === stepId)
      ).filter(Boolean);
      
      // Sort group steps by priority
      groupSteps.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      
      optimizedSteps.push(...groupSteps);
      group.forEach(stepId => processed.add(stepId));
    }
    
    return optimizedSteps;
  }

  async optimizeCoordinationStrategy(coordination, steps) {
    const stepCount = steps.length;
    const parallelizableSteps = steps.filter(step => 
      step.optimization?.parallelizable
    ).length;
    
    let strategy = coordination.strategy;
    
    // Optimize strategy based on workflow characteristics
    if (parallelizableSteps / stepCount > 0.7) {
      strategy = 'parallel';
    } else if (stepCount > 8) {
      strategy = 'hybrid';
    } else if (parallelizableSteps / stepCount < 0.3) {
      strategy = 'sequential';
    }
    
    return {
      ...coordination,
      strategy,
      optimization: {
        ...coordination.optimization,
        strategyReason: `Selected ${strategy} strategy based on ${parallelizableSteps}/${stepCount} parallelizable steps`
      }
    };
  }

  async applyPerformanceOptimizations(workflow) {
    const optimizations = [];
    
    // Caching optimization
    const cacheableSteps = workflow.steps.filter(step => 
      step.optimization?.cacheable
    );
    if (cacheableSteps.length > 0) {
      optimizations.push({
        type: 'caching',
        description: `Enable caching for ${cacheableSteps.length} steps`,
        impact: 'high',
        steps: cacheableSteps.map(s => s.stepId)
      });
    }
    
    // Parallel processing optimization
    const parallelizableSteps = workflow.steps.filter(step => 
      step.optimization?.parallelizable
    );
    if (parallelizableSteps.length > 1) {
      optimizations.push({
        type: 'parallel_processing',
        description: `Enable parallel processing for ${parallelizableSteps.length} steps`,
        impact: 'high',
        steps: parallelizableSteps.map(s => s.stepId)
      });
    }
    
    // Resource optimization
    const resourceIntensiveSteps = workflow.steps.filter(step => 
      step.optimization?.resourceIntensive
    );
    if (resourceIntensiveSteps.length > 0) {
      optimizations.push({
        type: 'resource_optimization',
        description: `Optimize resource usage for ${resourceIntensiveSteps.length} steps`,
        impact: 'medium',
        steps: resourceIntensiveSteps.map(s => s.stepId)
      });
    }
    
    return optimizations;
  }

  // Workflow Execution Intelligence
  async executeIntelligentWorkflow(workflow, input, options = {}) {
    try {
      const executionId = this.generateExecutionId();
      const startTime = Date.now();
      
      logger.info(`Starting intelligent workflow execution: ${workflow.name}`, {
        executionId,
        workflowId: workflow.id,
        steps: workflow.steps.length
      });
      
      // Initialize execution context
      const executionContext = {
        executionId,
        workflow,
        input,
        options,
        startTime,
        steps: workflow.steps.map(step => ({
          ...step,
          status: 'pending',
          startTime: null,
          endTime: null,
          result: null,
          error: null
        })),
        metrics: {
          totalSteps: workflow.steps.length,
          completedSteps: 0,
          failedSteps: 0,
          totalDuration: 0,
          averageStepDuration: 0
        }
      };
      
      // Execute workflow with intelligence
      const result = await this.executeWorkflowWithIntelligence(executionContext);
      
      // Calculate final metrics
      const endTime = Date.now();
      result.metrics.totalDuration = endTime - startTime;
      result.metrics.averageStepDuration = result.metrics.totalDuration / result.metrics.completedSteps;
      
      logger.info(`Intelligent workflow execution completed: ${workflow.name}`, {
        executionId,
        duration: result.metrics.totalDuration,
        success: result.metrics.failedSteps === 0
      });
      
      return result;
    } catch (error) {
      logger.error('Intelligent workflow execution failed:', error);
      throw error;
    }
  }

  async executeWorkflowWithIntelligence(executionContext) {
    const { workflow, steps } = executionContext;
    
    // Execute steps based on coordination strategy
    switch (workflow.coordination.strategy) {
      case 'parallel':
        return await this.executeParallelSteps(executionContext);
      case 'sequential':
        return await this.executeSequentialSteps(executionContext);
      case 'hybrid':
        return await this.executeHybridSteps(executionContext);
      case 'adaptive':
        return await this.executeAdaptiveSteps(executionContext);
      default:
        return await this.executeSequentialSteps(executionContext);
    }
  }

  async executeParallelSteps(executionContext) {
    const { steps } = executionContext;
    
    // Execute all steps in parallel
    const promises = steps.map(step => this.executeStep(executionContext, step));
    const results = await Promise.allSettled(promises);
    
    // Process results
    results.forEach((result, index) => {
      const step = steps[index];
      if (result.status === 'fulfilled') {
        step.status = 'completed';
        step.result = result.value;
        executionContext.metrics.completedSteps++;
      } else {
        step.status = 'failed';
        step.error = result.reason.message;
        executionContext.metrics.failedSteps++;
      }
      step.endTime = Date.now();
    });
    
    return executionContext;
  }

  async executeSequentialSteps(executionContext) {
    const { steps } = executionContext;
    let currentInput = executionContext.input;
    
    for (const step of steps) {
      try {
        step.startTime = Date.now();
        step.status = 'running';
        
        const result = await this.executeStep(executionContext, step, currentInput);
        
        step.status = 'completed';
        step.result = result;
        step.endTime = Date.now();
        executionContext.metrics.completedSteps++;
        
        // Pass result to next step
        currentInput = this.mergeStepResults(currentInput, result);
      } catch (error) {
        step.status = 'failed';
        step.error = error.message;
        step.endTime = Date.now();
        executionContext.metrics.failedSteps++;
        
        // Decide whether to continue
        if (executionContext.options.continueOnError !== true) {
          break;
        }
      }
    }
    
    return executionContext;
  }

  async executeHybridSteps(executionContext) {
    // Implement hybrid execution (combination of parallel and sequential)
    const { workflow } = executionContext;
    const parallelGroups = this.identifyParallelGroups(workflow.steps);
    
    for (const group of parallelGroups) {
      const groupSteps = group.map(stepId => 
        executionContext.steps.find(s => s.stepId === stepId)
      ).filter(Boolean);
      
      // Execute group in parallel
      const promises = groupSteps.map(step => this.executeStep(executionContext, step));
      const results = await Promise.allSettled(promises);
      
      // Process results
      results.forEach((result, index) => {
        const step = groupSteps[index];
        if (result.status === 'fulfilled') {
          step.status = 'completed';
          step.result = result.value;
          executionContext.metrics.completedSteps++;
        } else {
          step.status = 'failed';
          step.error = result.reason.message;
          executionContext.metrics.failedSteps++;
        }
        step.endTime = Date.now();
      });
    }
    
    return executionContext;
  }

  async executeAdaptiveSteps(executionContext) {
    // Implement adaptive execution based on real-time conditions
    const { steps } = executionContext;
    
    for (const step of steps) {
      // Analyze current system state
      const systemState = await this.analyzeSystemState();
      
      // Adapt execution strategy based on conditions
      if (systemState.cpuUsage > 0.8) {
        // High CPU usage - execute sequentially
        await this.executeStepSequentially(executionContext, step);
      } else {
        // Normal conditions - execute with optimization
        await this.executeStepWithOptimization(executionContext, step);
      }
    }
    
    return executionContext;
  }

  resolveAgentTypeForStep(step = {}) {
    if (step.agentType) {
      return step.agentType;
    }
    if (step.type && STEP_TYPE_TO_AGENT[step.type]) {
      return STEP_TYPE_TO_AGENT[step.type];
    }
    return null;
  }

  async executeStep(executionContext, step, input = null) {
    const stepInput = input || executionContext.input;
    const startTime = Date.now();
    const agentType = this.resolveAgentTypeForStep(step);

    if (agentType) {
      const aiAgentService = getAiAgentService();
      const agent = {
        id: step.agentId || `workflow_${step.stepId}`,
        type: agentType
      };
      const task = {
        input: stepInput,
        workflowContext: {
          executionId: executionContext.executionId,
          stepId: step.stepId,
          stepName: step.name
        }
      };

      const result = await aiAgentService.routeToAgent(agent, task);
      return {
        stepId: step.stepId,
        agentId: agent.id,
        agentType,
        result,
        confidence: Number(result?.confidence ?? result?.optimization?.confidence ?? 0.85),
        duration: Date.now() - startTime
      };
    }

    return {
      stepId: step.stepId,
      agentId: step.agentId || null,
      result: {
        status: 'skipped',
        message: `No agent mapping configured for step type: ${step.type || 'unknown'}`
      },
      confidence: 0,
      duration: Date.now() - startTime
    };
  }

  async executeStepSequentially(executionContext, step) {
    // Execute step with sequential optimization
    return await this.executeStep(executionContext, step);
  }

  async executeStepWithOptimization(executionContext, step) {
    // Execute step with full optimization
    return await this.executeStep(executionContext, step);
  }

  mergeStepResults(currentInput, stepResult) {
    return {
      ...currentInput,
      previousResults: [...(currentInput.previousResults || []), stepResult]
    };
  }

  // Helper Methods
  generateWorkflowId() {
    return `wf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateExecutionId() {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async analyzeSystemState() {
    const cpuCount = Math.max(os.cpus().length, 1);
    const loadAverage = os.loadavg()[0] || 0;
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const memoryUsage = totalMemory > 0 ? 1 - (freeMemory / totalMemory) : 0;

    return {
      cpuUsage: Math.min(loadAverage / cpuCount, 1),
      memoryUsage: Math.min(memoryUsage, 1),
      networkLatency: 0,
      activeTasks: this.performanceHistory.size,
      queuedTasks: 0,
      sampledAt: new Date().toISOString()
    };
  }

  async getAvailableAgents() {
    try {
      const AIAgent = getAIAgentModel();
      const agents = await AIAgent.find({ status: 'active' }).lean();
      if (agents.length > 0) {
        return agents.map((agent) => ({
          id: String(agent._id),
          name: agent.name,
          type: agent.type,
          capabilities: agent.capabilities || [],
          status: agent.status,
          performanceScore: Number(agent.performanceScore ?? 0.8),
          memoryUsage: Number(agent.memoryUsage ?? 0),
          cpuUsage: Number(agent.cpuUsage ?? 0),
          currentTasks: Number(agent.currentTasks ?? 0),
          maxConcurrentTasks: Number(agent.maxConcurrentTasks ?? 5)
        }));
      }
    } catch (error) {
      logger.warn('Unable to load active AI agents for workflow orchestration', {
        error: error.message
      });
    }

    return [
      {
        id: 'agent1',
        name: 'Carbon Analyzer Agent',
        type: 'carbon_analyzer',
        capabilities: ['carbon_analysis'],
        status: 'active',
        performanceScore: 0.9,
        memoryUsage: 0.3,
        cpuUsage: 0.4,
        currentTasks: 2,
        maxConcurrentTasks: 5
      },
      {
        id: 'agent2',
        name: 'Data Processor Agent',
        type: 'data_processor',
        capabilities: ['data_processing'],
        status: 'active',
        performanceScore: 0.8,
        memoryUsage: 0.5,
        cpuUsage: 0.6,
        currentTasks: 1,
        maxConcurrentTasks: 8
      }
    ];
  }

  // Public API
  async createWorkflow(workflowType, customizations = {}) {
    return await this.createIntelligentWorkflow(workflowType, customizations);
  }

  async executeWorkflow(workflow, input, options = {}) {
    return await this.executeIntelligentWorkflow(workflow, input, options);
  }

  getWorkflowTemplates() {
    return Array.from(this.workflowTemplates.values());
  }

  getOptimizationRules() {
    return Array.from(this.optimizationRules.values());
  }
}

module.exports = new IntelligentWorkflowService();