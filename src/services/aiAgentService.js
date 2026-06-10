const AIAgent = require('../models/AIAgent');
const AITask = require('../models/AITask');
const AIWorkflow = require('../models/AIWorkflow');
const AIExecution = require('../models/AIExecution');
const agentOptimizationService = require('./agentOptimizationService');
const agentGraphOrchestratorService = require('./agentGraphOrchestratorService');
const agentOrchestrationCuratorService = require('./agentOrchestrationCuratorService');
const agentRegistry = require('./agents/registry');
const aiAgentRuntimeState = require('./aiAgentRuntimeState');
const logger = require('../utils/logger');

class AIAgentService {
  constructor() {
    this.agents = new Map();
    this.taskQueue = [];
    this.isProcessing = false;
    this.maxConcurrentTasks = 5;
    this.currentTasks = 0;
    this.multiAgentWorkflows = new Map();
    this.agentCoordination = new Map();
    this.parallelExecutionQueue = [];
    this.agentCommunication = new Map();
    this._taskProcessorScheduled = false;
    this.taskProcessorTimer = null;
  }

  async initialize() {
    try {
      // Load all active agents
      const activeAgents = await AIAgent.find({ isActive: true, status: 'active' });
      
      for (const agent of activeAgents) {
        await this.registerAgent(agent);
      }

      logger.info(`AI Agent Service initialized with ${activeAgents.length} agents`);
      aiAgentRuntimeState.setReady(this.agents.size);

      // Start task processing
      this.startTaskProcessor();
      
    } catch (error) {
      aiAgentRuntimeState.setDegraded(error);
      logger.error('Failed to initialize AI Agent Service:', error);
      throw error;
    }
  }

  async registerAgent(agentData) {
    try {
      const agent = {
        id: agentData._id,
        name: agentData.name,
        type: agentData.type,
        capabilities: agentData.capabilities,
        configuration: agentData.configuration,
        status: agentData.status,
        performance: agentData.performance
      };

      this.agents.set(agent.id.toString(), agent);
      
      logger.info(`Registered AI Agent: ${agent.name} (${agent.type})`);
      
      return agent;
    } catch (error) {
      logger.error(`Failed to register agent ${agentData.name}:`, error);
      throw error;
    }
  }

  async createTask(taskData) {
    try {
      const task = new AITask({
        taskId: this.generateTaskId(),
        ...taskData,
        status: 'pending'
      });

      await task.save();
      
      // Add to processing queue
      this.taskQueue.push(task);
      
      logger.info(`Created AI task: ${task.taskId} for agent: ${task.agentId}`);
      
      return task;
    } catch (error) {
      logger.error('Failed to create AI task:', error);
      throw error;
    }
  }

  async executeWorkflow(workflowId, msmeId, triggerData = {}) {
    try {
      const workflow = await AIWorkflow.findById(workflowId);
      if (!workflow) {
        throw new Error('Workflow not found');
      }

      const executionId = this.generateExecutionId();
      const execution = new AIExecution({
        executionId,
        workflowId,
        msmeId,
        trigger: {
          type: workflow.trigger.type,
          source: 'api',
          data: triggerData
        },
        steps: workflow.steps.map(step => ({
          stepId: step.stepId,
          agentId: step.agentId,
          status: 'pending'
        }))
      });

      await execution.save();

      // Execute workflow steps
      await this.executeWorkflowSteps(execution);

      return execution;
    } catch (error) {
      logger.error('Failed to execute workflow:', error);
      throw error;
    }
  }

  // Multi-Agent Orchestration Methods
  async executeMultiAgentWorkflow(workflowId, msmeId, triggerData = {}) {
    try {
      const workflow = await AIWorkflow.findById(workflowId);
      if (!workflow) {
        throw new Error('Workflow not found');
      }

      const compiledGraph = this.buildMultiAgentWorkflowGraph(workflow);
      const executionId = this.generateExecutionId();
      const execution = new AIExecution({
        executionId,
        workflowId,
        msmeId,
        trigger: {
          type: workflow.trigger.type,
          source: 'multi_agent',
          data: triggerData
        },
        steps: workflow.steps.map(step => ({
          stepId: step.stepId,
          agentId: step.agentId,
          status: 'pending',
          executionMode: step.executionMode || 'graph'
        })),
        coordination: {
          mode: 'graph',
          parallelGroups: compiledGraph.parallelGroups,
          dependencies: compiledGraph.dependenciesIndex,
          graph: {
            entryNodes: compiledGraph.entryNodes,
            terminalNodes: compiledGraph.terminalNodes,
            edges: compiledGraph.edges
          },
          graphResult: null
        }
      });

      await execution.save();

      // Execute multi-agent workflow
      await this.executeMultiAgentWorkflowSteps(execution, workflow, compiledGraph);

      return execution;
    } catch (error) {
      logger.error('Failed to execute multi-agent workflow:', error);
      throw error;
    }
  }

  async executeMultiAgentWorkflowSteps(execution, workflow = null, compiledGraph = null) {
    try {
      const workflowDefinition = workflow || await AIWorkflow.findById(execution.workflowId);
      if (!workflowDefinition) {
        throw new Error('Workflow not found for multi-agent execution');
      }

      const graph = compiledGraph || this.buildMultiAgentWorkflowGraph(workflowDefinition);
      const graphConfig = workflowDefinition.coordination?.graph || {};

      const graphExecutionResult = await agentGraphOrchestratorService.executeGraph({
        graph,
        initialState: {
          executionId: execution.executionId,
          workflowId: execution.workflowId?.toString?.() || execution.workflowId,
          triggerData: execution.trigger?.data || {},
          nodeOutputs: {}
        },
        runNode: async ({ nodeId, state, attempt }) => {
          const workflowStep = workflowDefinition.steps.find(step => step.stepId === nodeId);
          if (!workflowStep) {
            throw new Error(`Missing workflow step for graph node: ${nodeId}`);
          }

          return this.executeMultiAgentGraphStep({
            execution,
            workflowStep,
            state,
            attempt
          });
        },
        options: {
          continueOnNodeError: workflowDefinition.coordination?.continueOnError === true,
          maxConcurrency: Number.isFinite(graphConfig.maxConcurrency)
            ? Math.max(1, Math.floor(graphConfig.maxConcurrency))
            : 1,
          defaultNodeTimeoutMs: Number.isFinite(graphConfig.defaultNodeTimeoutMs)
            ? graphConfig.defaultNodeTimeoutMs
            : null
        }
      });

      execution.coordination = execution.coordination || {};
      execution.coordination.graphResult = {
        status: graphExecutionResult.status,
        metrics: graphExecutionResult.metrics,
        trace: graphExecutionResult.trace,
        nodeStatuses: graphExecutionResult.nodeStatuses
      };
      execution.coordination.results = graphExecutionResult.finalState?.nodeOutputs || {};
      execution.graphState = graphExecutionResult.finalState;

      execution.results = execution.results || {};
      execution.results.overall = {
        graphStatus: graphExecutionResult.status,
        finalState: graphExecutionResult.finalState
      };
      execution.results.stepResults = Object.entries(graphExecutionResult.nodeResults)
        .map(([stepId, result]) => ({
          stepId,
          result: {
            status: result.status,
            output: result.output,
            error: result.error
          }
        }));
      execution.results.metrics = {
        ...(execution.results.metrics || {}),
        totalDuration: graphExecutionResult.metrics.durationMs,
        successRate: graphExecutionResult.metrics.totalNodes > 0
          ? (graphExecutionResult.metrics.completedNodes / graphExecutionResult.metrics.totalNodes) * 100
          : 0,
        errorCount: graphExecutionResult.metrics.failedNodes
      };

      const hasFailures = Object.values(graphExecutionResult.nodeStatuses)
        .some(status => status === 'failed');
      if (hasFailures && workflowDefinition.coordination?.continueOnError !== true) {
        execution.status = 'failed';
        execution.error = {
          message: 'Graph execution failed on one or more nodes',
          code: 'MULTI_AGENT_GRAPH_EXECUTION_ERROR',
          timestamp: new Date()
        };
      } else {
        execution.status = 'completed';
      }

      execution.completedAt = new Date();
      execution.duration = execution.completedAt - execution.startedAt;
      await execution.save();

      logger.info(`Multi-agent graph workflow execution completed: ${execution.executionId}`, {
        status: execution.status,
        completedNodes: graphExecutionResult.metrics.completedNodes,
        failedNodes: graphExecutionResult.metrics.failedNodes,
        skippedNodes: graphExecutionResult.metrics.skippedNodes
      });
    } catch (error) {
      execution.status = 'failed';
      execution.error = {
        message: error.message,
        code: 'MULTI_AGENT_EXECUTION_ERROR',
        timestamp: new Date()
      };
      await execution.save();
      
      logger.error('Multi-agent workflow execution failed:', error);
      throw error;
    }
  }

  buildMultiAgentWorkflowGraph(workflow) {
    return agentGraphOrchestratorService.compileWorkflowGraph(
      workflow.steps || [],
      workflow.coordination?.graph || {}
    );
  }

  async executeMultiAgentGraphStep({ execution, workflowStep, state, attempt = 1 }) {
    const executionStep = execution.steps.find(step => step.stepId === workflowStep.stepId);
    if (!executionStep) {
      throw new Error(`Execution step not found for ${workflowStep.stepId}`);
    }

    const attemptStartedAt = new Date();

    try {
      executionStep.status = 'running';
      executionStep.startedAt = executionStep.startedAt || attemptStartedAt;
      executionStep.error = undefined;
      await execution.save();

      const task = await this.createTask({
        agentId: executionStep.agentId,
        msmeId: execution.msmeId,
        taskType: workflowStep.taskType,
        input: {
          ...(execution.trigger?.data || {}),
          graphState: state,
          nodeOutputs: state?.nodeOutputs || {},
          previousResults: state?.nodeOutputs || {}
        },
        parameters: workflowStep.parameters,
        metadata: {
          executionId: execution.executionId,
          stepId: executionStep.stepId,
          attempt,
          coordinationMode: 'graph'
        }
      });

      executionStep.taskId = task._id;
      await execution.save();

      const result = await this.executeTaskWithCoordination(task, execution);

      executionStep.status = 'completed';
      executionStep.completedAt = new Date();
      executionStep.duration = executionStep.completedAt - executionStep.startedAt;
      executionStep.output = result;
      await execution.save();

      logger.info(`Multi-agent graph step completed: ${executionStep.stepId}`, {
        executionId: execution.executionId,
        duration: executionStep.duration,
        attempt
      });

      return {
        output: result,
        statePatch: {
          lastCompletedStep: executionStep.stepId,
          nodeOutputs: {
            [executionStep.stepId]: result
          }
        },
        metadata: {
          durationMs: executionStep.duration,
          attempt
        }
      };
    } catch (error) {
      executionStep.status = 'failed';
      executionStep.error = {
        message: error.message,
        code: 'MULTI_AGENT_GRAPH_STEP_ERROR'
      };
      executionStep.completedAt = new Date();
      executionStep.duration = executionStep.completedAt - attemptStartedAt;
      await execution.save();

      logger.error(`Multi-agent graph step failed: ${executionStep.stepId}`, {
        executionId: execution.executionId,
        attempt,
        error: error.message
      });

      throw error;
    }
  }

  getCuratedOrchestrationCatalog() {
    return {
      catalog: agentOrchestrationCuratorService.getAgentCatalog(),
      pipelines: agentOrchestrationCuratorService.getPipelineTemplates()
    };
  }

  buildCuratedOrchestrationPlan({ pipelineId, context = {}, orchestrationOptions = {} }) {
    return agentOrchestrationCuratorService.buildCuratedPlan({
      pipelineId,
      context,
      orchestrationOptions
    });
  }

  async executeMultiAgentStep(execution, stepId, dependencies) {
    try {
      const step = execution.steps.find(s => s.stepId === stepId);
      if (!step || step.status !== 'pending') {
        return;
      }

      // Check if dependencies are satisfied
      if (!this.areDependenciesSatisfied(stepId, dependencies, execution)) {
        return;
      }

      step.status = 'running';
      step.startedAt = new Date();
      await execution.save();

      const workflow = await AIWorkflow.findById(execution.workflowId);
      const workflowStep = workflow.steps.find(s => s.stepId === stepId);

      // Create task for the step
      const task = await this.createTask({
        agentId: step.agentId,
        msmeId: execution.msmeId,
        taskType: workflowStep.taskType,
        input: execution.trigger.data,
        parameters: workflowStep.parameters,
        metadata: {
          executionId: execution.executionId,
          stepId: step.stepId,
          coordinationMode: 'multi_agent'
        }
      });

      step.taskId = task._id;
      await execution.save();

      // Execute the task with multi-agent coordination
      const result = await this.executeTaskWithCoordination(task, execution);

      step.status = 'completed';
      step.completedAt = new Date();
      step.duration = step.completedAt - step.startedAt;
      step.output = result;
      await execution.save();

      // Notify dependent steps
      await this.notifyDependentSteps(stepId, dependencies, execution);

      logger.info(`Multi-agent step completed: ${stepId} in ${step.duration}ms`);
    } catch (error) {
      const step = execution.steps.find(s => s.stepId === stepId);
      if (step) {
        step.status = 'failed';
        step.error = {
          message: error.message,
          code: 'MULTI_AGENT_STEP_ERROR'
        };
        await execution.save();
      }
      
      logger.error(`Multi-agent step failed: ${stepId}`, error);
      throw error;
    }
  }

  async executeTaskWithCoordination(task, execution) {
    try {
      const agent = this.agents.get(task.agentId.toString());
      if (!agent) {
        throw new Error(`Agent not found: ${task.agentId}`);
      }

      task.status = 'in_progress';
      task.startedAt = new Date();
      await task.save();

      // Check for inter-agent communication requirements
      const coordinationData = await this.gatherCoordinationData(task, execution);
      
      // Route to appropriate agent handler with coordination data
      const result = await this.routeToAgentWithCoordination(agent, task, coordinationData);

      task.status = 'completed';
      task.completedAt = new Date();
      task.output = result;
      task.metadata.actualDuration = task.completedAt - task.startedAt;
      await task.save();

      // Update agent performance
      await this.updateAgentPerformance(agent.id, task);

      // Store results for other agents
      await this.storeCoordinationResults(task, result, execution);

      return result;
    } catch (error) {
      task.status = 'failed';
      task.error = {
        message: error.message,
        code: 'COORDINATED_TASK_ERROR',
        stack: error.stack,
        timestamp: new Date()
      };
      await task.save();

      logger.error(`Coordinated task failed: ${task.taskId}`, error);
      throw error;
    }
  }

  async routeToAgentWithCoordination(agent, task, coordinationData) {
    const startTime = Date.now();

    try {
      // Merge coordination data with task input
      const enhancedInput = {
        ...task.input,
        coordinationData,
        multiAgentContext: {
          executionId: task.metadata.executionId,
          stepId: task.metadata.stepId,
          coordinationMode: task.metadata.coordinationMode
        }
      };

      const enhancedTask = { ...task, input: enhancedInput };

      const handler = agentRegistry.getHandler(agent.type);
      if (!handler) {
        throw new Error(`Unknown agent type: ${agent.type}`);
      }

      return await handler(enhancedTask);
    } finally {
      const duration = Date.now() - startTime;
      task.results = {
        ...task.results,
        processingTime: duration,
        coordinationTime: duration - (task.results?.processingTime || 0)
      };
    }
  }

  async executeWorkflowSteps(execution) {
    try {
      const workflow = await AIWorkflow.findById(execution.workflowId);
      const stepOrder = this.calculateStepOrder(workflow.steps);

      for (const stepId of stepOrder) {
        const step = workflow.steps.find(s => s.stepId === stepId);
        const executionStep = execution.steps.find(s => s.stepId === stepId);

        if (this.canExecuteStep(execution, stepId)) {
          await this.executeStep(execution, step, executionStep);
        }
      }

      // Mark execution as completed
      execution.status = 'completed';
      execution.completedAt = new Date();
      execution.duration = execution.completedAt - execution.startedAt;
      await execution.save();

      logger.info(`Workflow execution completed: ${execution.executionId}`);
    } catch (error) {
      execution.status = 'failed';
      execution.error = {
        message: error.message,
        code: 'EXECUTION_ERROR',
        timestamp: new Date()
      };
      await execution.save();
      
      logger.error('Workflow execution failed:', error);
      throw error;
    }
  }

  async executeStep(execution, step, executionStep) {
    try {
      executionStep.status = 'running';
      executionStep.startedAt = new Date();
      await execution.save();

      // Create task for the step
      const task = await this.createTask({
        agentId: step.agentId,
        msmeId: execution.msmeId,
        taskType: step.taskType,
        input: execution.trigger.data,
        parameters: step.parameters,
        metadata: {
          executionId: execution.executionId,
          stepId: step.stepId
        }
      });

      executionStep.taskId = task._id;
      await execution.save();

      // Execute the task
      const result = await this.executeTask(task);

      executionStep.status = 'completed';
      executionStep.completedAt = new Date();
      executionStep.duration = executionStep.completedAt - executionStep.startedAt;
      executionStep.output = result;
      await execution.save();

      logger.info(`Step completed: ${step.stepId} in ${executionStep.duration}ms`);
    } catch (error) {
      executionStep.status = 'failed';
      executionStep.error = {
        message: error.message,
        code: 'STEP_ERROR'
      };
      await execution.save();
      
      logger.error(`Step failed: ${step.stepId}`, error);
      throw error;
    }
  }

  async executeTask(task) {
    try {
      const agent = this.agents.get(task.agentId.toString());
      if (!agent) {
        throw new Error(`Agent not found: ${task.agentId}`);
      }

      // Optimize task execution
      const optimizedTask = await agentOptimizationService.optimizeTaskExecution(task);
      
      task.status = 'in_progress';
      task.startedAt = new Date();
      await task.save();

      // Get optimized connection
      const connection = await agentOptimizationService.getOptimizedConnection(
        task.agentId, 
        'default'
      );

      // Check for cached result
      const cacheKey = agentOptimizationService.generateCacheKey(
        agent.type, 
        task.taskType, 
        this.hashInput(task.input)
      );

      const { result, cacheHit } = await agentOptimizationService.getCachedResult(
        cacheKey,
        () => this.routeToAgent(agent, task),
        this.getCacheTTL(task.taskType)
      );

      task.status = 'completed';
      task.completedAt = new Date();
      task.output = result;
      task.metadata.actualDuration = task.completedAt - task.startedAt;
      task.metadata.optimization = {
        cached: cacheHit,
        connectionId: connection.id,
        scheduledTime: optimizedTask.scheduledTime
      };
      await task.save();

      // Update agent performance with optimization service
      await agentOptimizationService.updateAgentPerformance(agent.id, task, result);
      await this.updateAgentPerformance(agent.id, task);

      return result;
    } catch (error) {
      task.status = 'failed';
      task.error = {
        message: error.message,
        code: 'TASK_ERROR',
        stack: error.stack,
        timestamp: new Date()
      };
      await task.save();

      logger.error(`Task failed: ${task.taskId}`, error);
      throw error;
    }
  }

  async routeToAgent(agent, task) {
    const startTime = Date.now();

    try {
      // Enhanced routing with optimization context
      const optimizedTask = {
        ...task,
        optimizationContext: {
          agentCapabilities: await agentOptimizationService.getAgentCapabilities(agent.id),
          workload: await agentOptimizationService.getAgentWorkload(agent.id),
          performanceMetrics: agentOptimizationService.performanceMetrics.get(agent.type)
        }
      };

      const handler = agentRegistry.getHandler(agent.type);
      if (!handler) {
        throw new Error(`Unknown agent type: ${agent.type}`);
      }

      const result = await handler(optimizedTask);

      // Add optimization metadata to result
      result.optimization = {
        processingTime: Date.now() - startTime,
        agentType: agent.type,
        optimizationApplied: true,
        cacheHit: false // Will be set by optimization service
      };

      return result;
    } finally {
      const duration = Date.now() - startTime;
      task.results = {
        ...task.results,
        processingTime: duration,
        optimizationTime: duration - (task.results?.processingTime || 0)
      };
    }
  }

  // Agent implementations
  async carbonAnalyzerAgent(task) {
    const handler = agentRegistry.getHandler('carbon_analyzer');
    return handler ? handler(task) : { error: 'Carbon analyzer handler not available' };
  }

  async esgAnalyzerAgent(task) {
    const handler = agentRegistry.getHandler('esg_analyzer');
    return handler ? handler(task) : { error: 'ESG analyzer handler not available' };
  }

  async sectorProfilerAgent(task) {
    const handler = agentRegistry.getHandler('sector_profiler');
    return handler ? handler(task) : { error: 'Sector profiler handler not available' };
  }

  async processMachineryProfilerAgent(task) {
    const handler = agentRegistry.getHandler('process_machinery_profiler');
    return handler ? handler(task) : { error: 'Process/machinery profiler handler not available' };
  }

  async verifiedSourceRagAgent(task) {
    const handler = agentRegistry.getHandler('verified_source_rag');
    return handler ? handler(task) : { error: 'Verified-source RAG handler not available' };
  }

  async recommendationEngineAgent(task) {
    const handler = agentRegistry.getHandler('recommendation_engine');
    return handler ? handler(task) : { error: 'Recommendation handler not available' };
  }

  async dataProcessorAgent(task) {
    const handler = agentRegistry.getHandler('data_processor');
    return handler ? handler(task) : { error: 'Data processor handler not available' };
  }

  async dataPrivacyAgent(task) {
    const handler = agentRegistry.getHandler('data_privacy');
    return handler ? handler(task) : { error: 'Data privacy handler not available' };
  }

  async documentAnalyzerAgent(task) {
    const handler = agentRegistry.getHandler('document_analyzer');
    return handler ? handler(task) : { error: 'Document analyzer handler not available' };
  }

  async anomalyDetectorAgent(task) {
    const handler = agentRegistry.getHandler('anomaly_detector');
    return handler ? handler(task) : { error: 'Anomaly detector handler not available' };
  }

  async trendAnalyzerAgent(task) {
    const handler = agentRegistry.getHandler('trend_analyzer');
    return handler ? handler(task) : { error: 'Trend analyzer handler not available' };
  }

  async complianceMonitorAgent(task) {
    const handler = agentRegistry.getHandler('compliance_monitor');
    return handler ? handler(task) : { error: 'Compliance monitor handler not available' };
  }

  async isoEvidenceCollectorAgent(task) {
    const handler = agentRegistry.getHandler('iso_evidence_collector');
    return handler ? handler(task) : { error: 'ISO evidence collector handler not available' };
  }

  async isoGapClosurePlannerAgent(task) {
    const handler = agentRegistry.getHandler('iso_gap_closure_planner');
    return handler ? handler(task) : { error: 'ISO gap-closure planner handler not available' };
  }

  async isoAuditPackagerAgent(task) {
    const handler = agentRegistry.getHandler('iso_audit_packager');
    return handler ? handler(task) : { error: 'ISO audit packager handler not available' };
  }

  async optimizationAdvisorAgent(task) {
    const handler = agentRegistry.getHandler('optimization_advisor');
    return handler ? handler(task) : { error: 'Optimization advisor handler not available' };
  }

  async reportGeneratorAgent(task) {
    const handler = agentRegistry.getHandler('report_generator');
    return handler ? handler(task) : { error: 'Report generator handler not available' };
  }

  async orchestrationAgent(task) {
    const handler = agentRegistry.getHandler('orchestration_agent');
    return handler ? handler(task) : { error: 'Orchestration handler not available' };
  }

  async inventoryQualityAdvisorAgent(task) {
    const handler = agentRegistry.getHandler('inventory_quality_advisor');
    return handler ? handler(task) : { error: 'Inventory quality advisor not available' };
  }

  async buyerRequestAdvisorAgent(task) {
    const handler = agentRegistry.getHandler('buyer_request_advisor');
    return handler ? handler(task) : { error: 'Buyer request advisor not available' };
  }

  async msmeGoalAdvisorAgent(task) {
    const handler = agentRegistry.getHandler('msme_goal_advisor');
    return handler ? handler(task) : { error: 'MSME goal advisor not available' };
  }

  async dpdpPrivacyAdvisorAgent(task) {
    const handler = agentRegistry.getHandler('dpdp_privacy_advisor');
    return handler ? handler(task) : { error: 'DPDP privacy advisor not available' };
  }

  async environmentalKpiAdvisorAgent(task) {
    const handler = agentRegistry.getHandler('environmental_kpi_advisor');
    return handler ? handler(task) : { error: 'Environmental KPI advisor not available' };
  }

  async runMsmeAdvisoryOrchestration(input) {
    const msmeAdvisoryOrchestrationService = require('./msmeAdvisoryOrchestrationService');
    return msmeAdvisoryOrchestrationService.runAdvisory(input);
  }

  // Helper methods
  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateExecutionId() {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  calculateStepOrder(steps) {
    // Simple topological sort for step dependencies
    const visited = new Set();
    const visiting = new Set();
    const order = [];

    const visit = (stepId) => {
      if (visiting.has(stepId)) {
        throw new Error('Circular dependency detected');
      }
      if (visited.has(stepId)) {
        return;
      }

      visiting.add(stepId);
      const step = steps.find(s => s.stepId === stepId);
      
      if (step && step.dependencies) {
        for (const dep of step.dependencies) {
          visit(dep);
        }
      }

      visiting.delete(stepId);
      visited.add(stepId);
      order.push(stepId);
    };

    for (const step of steps) {
      if (!visited.has(step.stepId)) {
        visit(step.stepId);
      }
    }

    return order;
  }

  canExecuteStep(execution, stepId) {
    const step = execution.steps.find(s => s.stepId === stepId);
    if (!step || step.status !== 'pending') {
      return false;
    }

    // Check dependencies
    const workflow = execution.workflowId; // This should be populated
    // Implementation would check if all dependencies are completed
    
    return true;
  }

  async updateAgentPerformance(agentId, task) {
    try {
      const agent = await AIAgent.findById(agentId);
      if (!agent) return;

      agent.performance.tasksCompleted += 1;
      agent.performance.lastActivity = new Date();
      
      if (task.status === 'completed') {
        const successRate = agent.performance.tasksCompleted > 0 
          ? (agent.performance.tasksCompleted - agent.performance.errorCount) / agent.performance.tasksCompleted * 100
          : 100;
        agent.performance.successRate = successRate;
      } else if (task.status === 'failed') {
        agent.performance.errorCount += 1;
      }

      if (task.metadata.actualDuration) {
        const avgTime = agent.performance.averageResponseTime;
        const newTime = task.metadata.actualDuration;
        agent.performance.averageResponseTime = avgTime 
          ? (avgTime + newTime) / 2 
          : newTime;
      }

      await agent.save();
    } catch (error) {
      logger.error('Failed to update agent performance:', error);
    }
  }

  startTaskProcessor() {
    if (this._taskProcessorScheduled) {
      return;
    }
    this._taskProcessorScheduled = true;

    const idlePollMs = Number(process.env.AI_TASK_QUEUE_IDLE_POLL_MS || 5000);
    const activePollMs = Number(process.env.AI_TASK_QUEUE_ACTIVE_POLL_MS || 400);

    const tick = async () => {
      if (!this.isProcessing && this.currentTasks < this.maxConcurrentTasks) {
        const task = this.taskQueue.shift();
        if (task) {
          this.isProcessing = true;
          this.currentTasks += 1;
          try {
            await this.executeTask(task);
          } catch (error) {
            logger.error('Task processing error:', error);
          } finally {
            this.isProcessing = false;
            this.currentTasks -= 1;
          }
        }
      }

      const busy = this.isProcessing || this.currentTasks >= this.maxConcurrentTasks;
      const delay = busy || this.taskQueue.length > 0 ? activePollMs : idlePollMs;
      this.taskProcessorTimer = setTimeout(tick, delay);
    };

    this.taskProcessorTimer = setTimeout(tick, activePollMs);
  }

  // Placeholder methods for agent-specific logic
  generateCarbonInsights(analysis) {
    return [
      {
        type: 'emission_peak',
        message: 'Highest emissions detected in energy category',
        value: Math.max(...Object.values(analysis.categoryBreakdown))
      }
    ];
  }

  generateCarbonRecommendations(analysis) {
    return [
      {
        category: 'energy',
        title: 'Switch to renewable energy',
        priority: 'high',
        potentialReduction: analysis.totalEmissions * 0.3
      }
    ];
  }

  generateSustainabilityRecommendations(carbonData) {
    return [];
  }

  generateTransactionRecommendations(transactions) {
    return [];
  }

  cleanTransactionData(transaction) {
    return transaction;
  }

  classifyTransaction(transaction) {
    return transaction;
  }

  enrichTransactionData(transaction) {
    return transaction;
  }

  validateForCarbonCalculation(transaction) {
    return transaction;
  }

  analyzeTransactionPatterns(transactions) {
    return {};
  }

  detectEmissionAnomalies(patterns) {
    return [];
  }

  detectSpendingAnomalies(patterns) {
    return [];
  }

  detectFrequencyAnomalies(patterns) {
    return [];
  }

  calculateAnomalySeverity(anomalies) {
    return 'low';
  }

  analyzeEmissionTrends(data) {
    return {};
  }

  analyzeSpendingTrends(data) {
    return {};
  }

  analyzeEfficiencyTrends(data) {
    return {};
  }

  analyzeSustainabilityTrends(data) {
    return {};
  }

  generateTrendPredictions(trends) {
    return {};
  }

  generateTrendInsights(trends) {
    return [];
  }

  checkEnvironmentalCompliance(carbonData) {
    return { issues: [], recommendations: [] };
  }

  checkRegulatoryCompliance(regulations, data) {
    return { issues: [], recommendations: [] };
  }

  suggestEnergyOptimizations(carbonData) {
    return [];
  }

  suggestWasteOptimizations(carbonData) {
    return [];
  }

  suggestTransportOptimizations(carbonData) {
    return [];
  }

  suggestProcessOptimizations(processes) {
    return [];
  }

  calculatePotentialSavings(optimizations) {
    return 0;
  }

  prioritizeOptimizations(optimizations) {
    return optimizations;
  }

  generateReportSummary(input) {
    return {};
  }

  generateCarbonSection(carbonData) {
    return {};
  }

  generateCarbonCharts(carbonData) {
    return [];
  }

  generateTrendsSection(trends) {
    return {};
  }

  generateTrendCharts(trends) {
    return [];
  }

  generateRecommendationsSection(recommendations) {
    return {};
  }

  // Multi-Agent Coordination Helper Methods
  identifyParallelGroups(steps) {
    const groups = [];
    const processed = new Set();
    
    for (const step of steps) {
      if (processed.has(step.stepId)) continue;
      
      const group = [step.stepId];
      processed.add(step.stepId);
      
      // Find steps that can run in parallel (no dependencies between them)
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

  buildDependencyGraph(steps) {
    const graph = new Map();
    
    for (const step of steps) {
      graph.set(step.stepId, {
        dependencies: step.dependencies || [],
        dependents: []
      });
    }
    
    // Build reverse dependencies
    for (const step of steps) {
      const deps = step.dependencies || [];
      for (const dep of deps) {
        if (graph.has(dep)) {
          graph.get(dep).dependents.push(step.stepId);
        }
      }
    }
    
    return graph;
  }

  resolveDependencyMeta(dependencies, stepId) {
    if (!dependencies) {
      return { dependencies: [], dependents: [] };
    }

    if (typeof dependencies.get === 'function') {
      return dependencies.get(stepId) || { dependencies: [], dependents: [] };
    }

    return dependencies[stepId] || { dependencies: [], dependents: [] };
  }

  areDependenciesSatisfied(stepId, dependencies, execution) {
    const stepDeps = this.resolveDependencyMeta(dependencies, stepId).dependencies || [];
    
    for (const dep of stepDeps) {
      const depStep = execution.steps.find(s => s.stepId === dep);
      if (!depStep || depStep.status !== 'completed') {
        return false;
      }
    }
    
    return true;
  }

  async notifyDependentSteps(completedStepId, dependencies, execution) {
    const dependents = this.resolveDependencyMeta(dependencies, completedStepId).dependents || [];
    
    for (const dependentId of dependents) {
      const dependentStep = execution.steps.find(s => s.stepId === dependentId);
      if (dependentStep && dependentStep.status === 'pending') {
        // Check if all dependencies are now satisfied
        if (this.areDependenciesSatisfied(dependentId, dependencies, execution)) {
          // Trigger execution of dependent step
          await this.executeMultiAgentStep(execution, dependentId, dependencies);
        }
      }
    }
  }

  async gatherCoordinationData(task, execution) {
    const coordinationData = {
      previousResults: {},
      sharedContext: {},
      agentStates: {}
    };

    // Gather results from previously completed steps
    const completedSteps = execution.steps.filter(s => s.status === 'completed');
    for (const step of completedSteps) {
      if (step.output) {
        coordinationData.previousResults[step.stepId] = step.output;
      }
    }

    // Gather shared context from all agents
    for (const [agentId, agent] of this.agents) {
      if (this.agentCommunication.has(agentId)) {
        coordinationData.agentStates[agentId] = this.agentCommunication.get(agentId);
      }
    }

    return coordinationData;
  }

  async storeCoordinationResults(task, result, execution) {
    const agentId = task.agentId.toString();
    const stepId = task.metadata.stepId;
    
    // Store results for inter-agent communication
    if (!this.agentCommunication.has(agentId)) {
      this.agentCommunication.set(agentId, {});
    }
    
    const agentComm = this.agentCommunication.get(agentId);
    agentComm[stepId] = {
      result,
      timestamp: new Date(),
      executionId: execution.executionId
    };

    // Store in execution context for dependent steps
    execution.coordination = execution.coordination || {};
    execution.coordination.results = execution.coordination.results || {};
    execution.coordination.results[stepId] = result;
    
    await execution.save();
  }

  // Multi-Agent Status and Monitoring
  async getMultiAgentStatus() {
    const status = {
      totalAgents: this.agents.size,
      activeAgents: 0,
      processingTasks: this.currentTasks,
      queuedTasks: this.taskQueue.length,
      parallelExecutions: this.parallelExecutionQueue.length,
      agentStates: {},
      coordinationStatus: {}
    };

    for (const [agentId, agent] of this.agents) {
      if (agent.status === 'active') {
        status.activeAgents++;
      }
      
      status.agentStates[agentId] = {
        name: agent.name,
        type: agent.type,
        status: agent.status,
        performance: agent.performance,
        lastActivity: agent.performance?.lastActivity
      };
    }

    // Coordination status
    for (const [agentId, commData] of this.agentCommunication) {
      status.coordinationStatus[agentId] = {
        lastCommunication: Math.max(...Object.values(commData).map(d => d.timestamp.getTime())),
        activeChannels: Object.keys(commData).length
      };
    }

    return status;
  }

  // Agent Load Balancing
  async balanceAgentLoad() {
    const agentLoads = new Map();
    
    // Calculate current load for each agent
    for (const [agentId, agent] of this.agents) {
      const activeTasks = this.taskQueue.filter(t => t.agentId.toString() === agentId).length;
      const processingTasks = this.currentTasks;
      
      agentLoads.set(agentId, {
        queued: activeTasks,
        processing: processingTasks,
        total: activeTasks + processingTasks,
        capacity: agent.performance?.maxConcurrentTasks || 5
      });
    }

    // Redistribute tasks if needed
    const overloadedAgents = Array.from(agentLoads.entries())
      .filter(([_, load]) => load.total > load.capacity);
    
    const underloadedAgents = Array.from(agentLoads.entries())
      .filter(([_, load]) => load.total < load.capacity * 0.5);

    if (overloadedAgents.length > 0 && underloadedAgents.length > 0) {
      await this.redistributeTasks(overloadedAgents, underloadedAgents);
    }
  }

  async redistributeTasks(overloadedAgents, underloadedAgents) {
    // Simple round-robin redistribution
    for (const [overloadedId, overloadedLoad] of overloadedAgents) {
      const excessTasks = overloadedLoad.total - overloadedLoad.capacity;
      const tasksToMove = this.taskQueue
        .filter(t => t.agentId.toString() === overloadedId)
        .slice(0, excessTasks);

      for (let i = 0; i < tasksToMove.length && i < underloadedAgents.length; i++) {
        const [underloadedId] = underloadedAgents[i];
        const task = tasksToMove[i];
        
        // Reassign task to underloaded agent
        task.agentId = underloadedId;
        task.metadata.reassigned = true;
        task.metadata.originalAgent = overloadedId;
        
        logger.info(`Redistributed task ${task.taskId} from agent ${overloadedId} to ${underloadedId}`);
      }
    }
  }

  // Agent Coordination Methods
  async executeParallelCoordination(tasks) {
    try {
      logger.info(`Starting parallel coordination for ${tasks.length} tasks`);
      
      const promises = tasks.map(task => this.executeTask(task));
      const results = await Promise.allSettled(promises);
      
      const coordinationResults = {
        mode: 'parallel',
        totalTasks: tasks.length,
        successful: results.filter(r => r.status === 'fulfilled').length,
        failed: results.filter(r => r.status === 'rejected').length,
        results: results.map((result, index) => ({
          taskId: tasks[index].taskId,
          agentId: tasks[index].agentId,
          status: result.status,
          output: result.status === 'fulfilled' ? result.value : null,
          error: result.status === 'rejected' ? result.reason.message : null
        }))
      };

      logger.info(`Parallel coordination completed: ${coordinationResults.successful}/${coordinationResults.totalTasks} successful`);
      return coordinationResults;
    } catch (error) {
      logger.error('Parallel coordination failed:', error);
      throw error;
    }
  }

  async executeSequentialCoordination(tasks) {
    try {
      logger.info(`Starting sequential coordination for ${tasks.length} tasks`);
      
      const results = [];
      let previousOutput = null;
      
      for (const task of tasks) {
        // Pass previous output as context
        if (previousOutput) {
          task.input = {
            ...task.input,
            previousResults: previousOutput
          };
        }
        
        const result = await this.executeTask(task);
        results.push({
          taskId: task.taskId,
          agentId: task.agentId,
          status: 'completed',
          output: result
        });
        
        previousOutput = result;
      }
      
      const coordinationResults = {
        mode: 'sequential',
        totalTasks: tasks.length,
        successful: results.length,
        failed: 0,
        results
      };

      logger.info(`Sequential coordination completed: ${coordinationResults.successful}/${coordinationResults.totalTasks} successful`);
      return coordinationResults;
    } catch (error) {
      logger.error('Sequential coordination failed:', error);
      throw error;
    }
  }

  async executeConsensusCoordination(tasks) {
    try {
      logger.info(`Starting consensus coordination for ${tasks.length} tasks`);
      
      // Execute all tasks in parallel first
      const promises = tasks.map(task => this.executeTask(task));
      const results = await Promise.allSettled(promises);
      
      const successfulResults = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);
      
      if (successfulResults.length === 0) {
        throw new Error('All tasks failed in consensus coordination');
      }
      
      // Build consensus from successful results
      const consensus = this.buildConsensus(successfulResults);
      
      const coordinationResults = {
        mode: 'consensus',
        totalTasks: tasks.length,
        successful: successfulResults.length,
        failed: results.length - successfulResults.length,
        consensus,
        individualResults: results.map((result, index) => ({
          taskId: tasks[index].taskId,
          agentId: tasks[index].agentId,
          status: result.status,
          output: result.status === 'fulfilled' ? result.value : null,
          error: result.status === 'rejected' ? result.reason.message : null
        }))
      };

      logger.info(`Consensus coordination completed: ${coordinationResults.successful}/${coordinationResults.totalTasks} successful`);
      return coordinationResults;
    } catch (error) {
      logger.error('Consensus coordination failed:', error);
      throw error;
    }
  }

  buildConsensus(results) {
    // Simple consensus building - can be enhanced based on specific use cases
    const consensus = {
      confidence: 0,
      recommendations: [],
      insights: [],
      metrics: {}
    };

    if (results.length === 0) {
      return consensus;
    }

    // Calculate confidence based on agreement
    consensus.confidence = Math.min(1.0, results.length / 3); // Simple confidence metric

    // Aggregate recommendations
    const allRecommendations = results.flatMap(r => r.recommendations || []);
    consensus.recommendations = this.aggregateRecommendations(allRecommendations);

    // Aggregate insights
    const allInsights = results.flatMap(r => r.insights || []);
    consensus.insights = this.aggregateInsights(allInsights);

    // Aggregate metrics
    consensus.metrics = this.aggregateMetrics(results);

    return consensus;
  }

  aggregateRecommendations(recommendations) {
    // Group by category and priority
    const grouped = recommendations.reduce((acc, rec) => {
      const key = `${rec.category}_${rec.priority}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(rec);
      return acc;
    }, {});

    // Select top recommendations from each group
    const aggregated = [];
    for (const group of Object.values(grouped)) {
      // Sort by potential impact and select top ones
      const sorted = group.sort((a, b) => (b.potentialReduction || 0) - (a.potentialReduction || 0));
      aggregated.push(...sorted.slice(0, 2)); // Top 2 from each group
    }

    return aggregated;
  }

  aggregateInsights(insights) {
    // Remove duplicates and combine similar insights
    const unique = insights.filter((insight, index, self) => 
      index === self.findIndex(i => i.type === insight.type && i.message === insight.message)
    );

    return unique;
  }

  aggregateMetrics(results) {
    const metrics = {};
    
    // Aggregate numerical metrics
    const numericFields = ['totalEmissions', 'averageResponseTime', 'successRate'];
    for (const field of numericFields) {
      const values = results.map(r => r[field]).filter(v => typeof v === 'number');
      if (values.length > 0) {
        metrics[field] = {
          average: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          count: values.length
        };
      }
    }

    return metrics;
  }

  // Optimization helper methods
  hashInput(input) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(JSON.stringify(input)).digest('hex');
  }

  getCacheTTL(taskType) {
    const ttlMap = {
      'carbon_analysis': 600, // 10 minutes
      'recommendation_generation': 300, // 5 minutes
      'data_processing': 180, // 3 minutes
      'anomaly_detection': 120, // 2 minutes
      'trend_analysis': 300, // 5 minutes
      'compliance_check': 600, // 10 minutes
      'optimization_advice': 300, // 5 minutes
      'report_generation': 1800 // 30 minutes
    };
    
    return ttlMap[taskType] || 300;
  }

  // Enhanced multi-agent coordination with optimization
  async executeOptimizedMultiAgentWorkflow(workflowId, msmeId, triggerData = {}) {
    try {
      const workflow = await AIWorkflow.findById(workflowId);
      if (!workflow) {
        throw new Error('Workflow not found');
      }

      const executionId = this.generateExecutionId();
      const execution = new AIExecution({
        executionId,
        workflowId,
        msmeId,
        trigger: {
          type: workflow.trigger.type,
          source: 'optimized_multi_agent',
          data: triggerData
        },
        steps: workflow.steps.map(step => ({
          stepId: step.stepId,
          agentId: step.agentId,
          status: 'pending',
          executionMode: step.executionMode || 'optimized_parallel',
          optimization: {
            priority: this.calculateStepPriority(step),
            resourceRequirements: this.estimateStepResources(step),
            dependencies: step.dependencies || []
          }
        })),
        coordination: {
          mode: 'optimized_multi_agent',
          parallelGroups: this.identifyOptimizedParallelGroups(workflow.steps),
          dependencies: this.buildDependencyGraph(workflow.steps),
          optimization: {
            loadBalancing: true,
            caching: true,
            predictiveScaling: true
          }
        }
      });

      await execution.save();

      // Execute optimized multi-agent workflow
      await this.executeOptimizedMultiAgentWorkflowSteps(execution);

      return execution;
    } catch (error) {
      logger.error('Failed to execute optimized multi-agent workflow:', error);
      throw error;
    }
  }

  async executeOptimizedMultiAgentWorkflowSteps(execution) {
    try {
      const workflow = await AIWorkflow.findById(execution.workflowId);
      const { parallelGroups, dependencies } = execution.coordination;

      // Execute with optimization
      for (const group of parallelGroups) {
        const groupPromises = group.map(stepId => 
          this.executeOptimizedMultiAgentStep(execution, stepId, dependencies)
        );
        
        await Promise.allSettled(groupPromises);
      }

      // Mark execution as completed
      execution.status = 'completed';
      execution.completedAt = new Date();
      execution.duration = execution.completedAt - execution.startedAt;
      await execution.save();

      logger.info(`Optimized multi-agent workflow execution completed: ${execution.executionId}`);
    } catch (error) {
      execution.status = 'failed';
      execution.error = {
        message: error.message,
        code: 'OPTIMIZED_MULTI_AGENT_EXECUTION_ERROR',
        timestamp: new Date()
      };
      await execution.save();
      
      logger.error('Optimized multi-agent workflow execution failed:', error);
      throw error;
    }
  }

  async executeOptimizedMultiAgentStep(execution, stepId, dependencies) {
    try {
      const step = execution.steps.find(s => s.stepId === stepId);
      if (!step || step.status !== 'pending') {
        return;
      }

      // Check if dependencies are satisfied
      if (!this.areDependenciesSatisfied(stepId, dependencies, execution)) {
        return;
      }

      step.status = 'running';
      step.startedAt = new Date();
      await execution.save();

      const workflow = await AIWorkflow.findById(execution.workflowId);
      const workflowStep = workflow.steps.find(s => s.stepId === stepId);

      // Create optimized task
      const task = await this.createOptimizedTask({
        agentId: step.agentId,
        msmeId: execution.msmeId,
        taskType: workflowStep.taskType,
        input: execution.trigger.data,
        parameters: workflowStep.parameters,
        metadata: {
          executionId: execution.executionId,
          stepId: step.stepId,
          coordinationMode: 'optimized_multi_agent',
          optimization: step.optimization
        }
      });

      step.taskId = task._id;
      await execution.save();

      // Execute the task with optimization
      const result = await this.executeTaskWithOptimization(task, execution);

      step.status = 'completed';
      step.completedAt = new Date();
      step.duration = step.completedAt - step.startedAt;
      step.output = result;
      await execution.save();

      // Notify dependent steps
      await this.notifyDependentSteps(stepId, dependencies, execution);

      logger.info(`Optimized multi-agent step completed: ${stepId} in ${step.duration}ms`);
    } catch (error) {
      const step = execution.steps.find(s => s.stepId === stepId);
      if (step) {
        step.status = 'failed';
        step.error = {
          message: error.message,
          code: 'OPTIMIZED_MULTI_AGENT_STEP_ERROR'
        };
        await execution.save();
      }
      
      logger.error(`Optimized multi-agent step failed: ${stepId}`, error);
      throw error;
    }
  }

  async createOptimizedTask(taskData) {
    try {
      const task = new AITask({
        taskId: this.generateTaskId(),
        ...taskData,
        status: 'pending',
        optimization: {
          scheduled: true,
          priority: taskData.metadata?.optimization?.priority || 5,
          resourceRequirements: taskData.metadata?.optimization?.resourceRequirements || {}
        }
      });

      await task.save();
      
      // Add to optimization scheduler
      await agentOptimizationService.scheduleTask(task, 'medium');
      
      logger.info(`Created optimized AI task: ${task.taskId} for agent: ${task.agentId}`);
      
      return task;
    } catch (error) {
      logger.error('Failed to create optimized AI task:', error);
      throw error;
    }
  }

  async executeTaskWithOptimization(task, execution) {
    try {
      const agent = this.agents.get(task.agentId.toString());
      if (!agent) {
        throw new Error(`Agent not found: ${task.agentId}`);
      }

      task.status = 'in_progress';
      task.startedAt = new Date();
      await task.save();

      // Get coordination data with optimization
      const coordinationData = await this.gatherOptimizedCoordinationData(task, execution);
      
      // Route to appropriate agent handler with optimization
      const result = await this.routeToAgentWithOptimization(agent, task, coordinationData);

      task.status = 'completed';
      task.completedAt = new Date();
      task.output = result;
      task.metadata.actualDuration = task.completedAt - task.startedAt;
      await task.save();

      // Update agent performance with optimization
      await agentOptimizationService.updateAgentPerformance(agent.id, task, result);
      await this.updateAgentPerformance(agent.id, task);

      // Store results for other agents with optimization
      await this.storeOptimizedCoordinationResults(task, result, execution);

      return result;
    } catch (error) {
      task.status = 'failed';
      task.error = {
        message: error.message,
        code: 'OPTIMIZED_TASK_ERROR',
        stack: error.stack,
        timestamp: new Date()
      };
      await task.save();

      logger.error(`Optimized task failed: ${task.taskId}`, error);
      throw error;
    }
  }

  async routeToAgentWithOptimization(agent, task, coordinationData) {
    const startTime = Date.now();

    try {
      // Enhanced input with optimization context
      const optimizedInput = {
        ...task.input,
        coordinationData,
        multiAgentContext: {
          executionId: task.metadata.executionId,
          stepId: task.metadata.stepId,
          coordinationMode: task.metadata.coordinationMode,
          optimization: task.metadata.optimization
        },
        optimizationContext: {
          agentCapabilities: await agentOptimizationService.getAgentCapabilities(agent.id),
          workload: await agentOptimizationService.getAgentWorkload(agent.id),
          performanceMetrics: agentOptimizationService.performanceMetrics.get(agent.type)
        }
      };

      const enhancedTask = { ...task, input: optimizedInput };

      const handler = agentRegistry.getHandler(agent.type);
      if (!handler) {
        throw new Error(`Unknown agent type: ${agent.type}`);
      }

      const result = await handler(enhancedTask);

      // Add optimization metadata
      result.optimization = {
        processingTime: Date.now() - startTime,
        agentType: agent.type,
        optimizationApplied: true,
        coordinationOptimized: true
      };

      return result;
    } finally {
      const duration = Date.now() - startTime;
      task.results = {
        ...task.results,
        processingTime: duration,
        optimizationTime: duration - (task.results?.processingTime || 0)
      };
    }
  }

  calculateStepPriority(step) {
    const basePriority = 5;
    const taskTypePriority = {
      'carbon_analysis': 8,
      'recommendation_generation': 6,
      'data_processing': 4,
      'anomaly_detection': 9,
      'trend_analysis': 5,
      'compliance_check': 7,
      'optimization_advice': 6,
      'report_generation': 3
    };
    
    return basePriority + (taskTypePriority[step.taskType] || 0);
  }

  estimateStepResources(step) {
    return {
      memory: this.estimateMemoryUsage(step),
      cpu: this.estimateCPUUsage(step),
      network: this.estimateNetworkUsage(step),
      storage: this.estimateStorageUsage(step)
    };
  }

  identifyOptimizedParallelGroups(steps) {
    // Enhanced parallel group identification with optimization
    const groups = [];
    const processed = new Set();
    const resourceConstraints = new Map();
    
    for (const step of steps) {
      if (processed.has(step.stepId)) continue;
      
      const group = [step.stepId];
      processed.add(step.stepId);
      
      // Find steps that can run in parallel with resource optimization
      for (const otherStep of steps) {
        if (processed.has(otherStep.stepId)) continue;
        
        if (this.canRunInParallelOptimized(step, otherStep, steps, resourceConstraints)) {
          group.push(otherStep.stepId);
          processed.add(otherStep.stepId);
          
          // Update resource constraints
          this.updateResourceConstraints(resourceConstraints, otherStep);
        }
      }
      
      groups.push(group);
    }
    
    return groups;
  }

  canRunInParallelOptimized(step1, step2, allSteps, resourceConstraints) {
    // Check dependencies
    const step1Deps = step1.dependencies || [];
    const step2Deps = step2.dependencies || [];
    
    if (step1Deps.includes(step2.stepId) || step2Deps.includes(step1.stepId)) {
      return false;
    }
    
    // Check resource constraints
    const step1Resources = this.estimateStepResources(step1);
    const step2Resources = this.estimateStepResources(step2);
    
    const totalMemory = (resourceConstraints.get('memory') || 0) + step1Resources.memory + step2Resources.memory;
    const totalCPU = (resourceConstraints.get('cpu') || 0) + step1Resources.cpu + step2Resources.cpu;
    
    // Resource limits (adjust based on system capacity)
    return totalMemory < 2048 && totalCPU < 4.0; // 2GB memory, 4 CPU cores
  }

  updateResourceConstraints(resourceConstraints, step) {
    const resources = this.estimateStepResources(step);
    resourceConstraints.set('memory', (resourceConstraints.get('memory') || 0) + resources.memory);
    resourceConstraints.set('cpu', (resourceConstraints.get('cpu') || 0) + resources.cpu);
  }

  async gatherOptimizedCoordinationData(task, execution) {
    const coordinationData = {
      previousResults: {},
      sharedContext: {},
      agentStates: {},
      optimization: {
        cacheHits: 0,
        performanceMetrics: {},
        resourceUsage: {}
      }
    };

    // Gather results from previously completed steps with optimization
    const completedSteps = execution.steps.filter(s => s.status === 'completed');
    for (const step of completedSteps) {
      if (step.output) {
        coordinationData.previousResults[step.stepId] = step.output;
      }
    }

    // Gather shared context from all agents with optimization
    for (const [agentId, agent] of this.agents) {
      if (this.agentCommunication.has(agentId)) {
        coordinationData.agentStates[agentId] = this.agentCommunication.get(agentId);
      }
      
      // Add optimization metrics
      const metrics = agentOptimizationService.performanceMetrics.get(agent.type);
      if (metrics) {
        coordinationData.optimization.performanceMetrics[agentId] = metrics;
      }
    }

    return coordinationData;
  }

  async storeOptimizedCoordinationResults(task, result, execution) {
    const agentId = task.agentId.toString();
    const stepId = task.metadata.stepId;
    
    // Store results for inter-agent communication with optimization
    if (!this.agentCommunication.has(agentId)) {
      this.agentCommunication.set(agentId, {});
    }
    
    const agentComm = this.agentCommunication.get(agentId);
    agentComm[stepId] = {
      result,
      timestamp: new Date(),
      executionId: execution.executionId,
      optimization: {
        processingTime: task.metadata.actualDuration,
        resourceUsage: task.metadata.optimization?.resourceRequirements || {},
        cacheHit: task.metadata.optimization?.cached || false
      }
    };

    // Store in execution context for dependent steps with optimization
    execution.coordination = execution.coordination || {};
    execution.coordination.results = execution.coordination.results || {};
    execution.coordination.results[stepId] = {
      ...result,
      optimization: {
        processingTime: task.metadata.actualDuration,
        resourceUsage: task.metadata.optimization?.resourceRequirements || {},
        cacheHit: task.metadata.optimization?.cached || false
      }
    };
    
    await execution.save();
  }

  // Get optimization metrics
  async getOptimizationMetrics() {
    return agentOptimizationService.getPerformanceMetrics();
  }

  /** Advanced multi-agent coordination (formerly advancedCoordinationService). */
  _coordinationCore() {
    if (!this.__coordinationCore) {
      this.__coordinationCore = require('./advancedCoordinationCore');
    }
    return this.__coordinationCore;
  }

  get coordinationStrategies() {
    return this._coordinationCore().coordinationStrategies;
  }

  get consensusAlgorithms() {
    return this._coordinationCore().consensusAlgorithms;
  }

  get loadBalancingStrategies() {
    return this._coordinationCore().loadBalancingStrategies;
  }

  executeAdvancedCoordination(agentIds, taskType, input, strategy = 'adaptive') {
    return this._coordinationCore().executeAdvancedCoordination(agentIds, taskType, input, strategy);
  }

  buildConsensusFromResults(results, algorithm = 'ensemble', parameters = {}) {
    const consensusAlgorithm = this.consensusAlgorithms.get(algorithm);
    if (!consensusAlgorithm) {
      throw new Error(`Unknown consensus algorithm: ${algorithm}`);
    }
    return consensusAlgorithm.buildConsensus(results, {
      ...consensusAlgorithm.parameters,
      ...parameters
    });
  }
}

module.exports = new AIAgentService();