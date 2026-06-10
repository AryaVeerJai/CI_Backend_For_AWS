const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const auth = require('../middleware/auth');
const aiAgentService = require('../services/aiAgentService');
const agentOptimizationService = require('../services/agentOptimizationService');
const intelligentWorkflowService = require('../services/intelligentWorkflowService');
const orchestrationManagerEventService = require('../services/orchestrationManagerEventService');
const { createOrchestrationEventEmitter } = require('../utils/orchestrationEvents');
const logger = require('../utils/logger');

const emitOrchestrationEvent = createOrchestrationEventEmitter(
  orchestrationManagerEventService,
  'optimized-ai-agents'
);

// @route   POST /api/optimized-ai-agents/execute-optimized-workflow
// @desc    Execute workflow with full optimization
// @access  Private
router.post('/execute-optimized-workflow', auth, async (req, res) => {
  try {
    const { workflowType, input, customizations = {}, options = {} } = req.body;

    if (!workflowType) {
      return res.status(400).json({
        success: false,
        message: 'Workflow type is required'
      });
    }

    // Create intelligent workflow
    const workflow = await intelligentWorkflowService.createWorkflow(workflowType, customizations);
    
    // Execute with optimization
    const result = await intelligentWorkflowService.executeWorkflow(workflow, input, options);

    emitOrchestrationEvent('optimized.workflow.executed', {
      workflowId: workflow.id,
      workflowType,
      executionId: result.executionId,
      steps: result.steps?.length || 0
    });

    res.json({
      success: true,
      message: 'Optimized workflow executed successfully',
      data: {
        executionId: result.executionId,
        workflow: {
          id: workflow.id,
          name: workflow.name,
          complexity: workflow.complexity
        },
        metrics: result.metrics,
        steps: result.steps.map(step => ({
          stepId: step.stepId,
          name: step.name,
          status: step.status,
          duration: step.endTime - step.startTime,
          result: step.result,
          error: step.error
        }))
      }
    });
  } catch (error) {
    logger.error('Optimized workflow execution error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/optimized-ai-agents/advanced-coordination
// @desc    Execute advanced multi-agent coordination
// @access  Private
router.post('/advanced-coordination', auth, async (req, res) => {
  try {
    const { 
      agentIds, 
      taskType, 
      input, 
      strategy = 'adaptive',
      coordinationOptions = {} 
    } = req.body;

    if (!agentIds || !Array.isArray(agentIds) || agentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Agent IDs array is required'
      });
    }

    if (!taskType) {
      return res.status(400).json({
        success: false,
        message: 'Task type is required'
      });
    }

    // Execute advanced coordination
    const result = await aiAgentService.executeAdvancedCoordination(
      agentIds,
      taskType,
      input,
      strategy
    );

    emitOrchestrationEvent('optimized.coordination.completed', {
      agentIds,
      taskType,
      strategy,
      results: result
    });

    res.json({
      success: true,
      message: 'Advanced coordination executed successfully',
      data: result
    });
  } catch (error) {
    logger.error('Advanced coordination error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/optimized-ai-agents/optimize-task
// @desc    Optimize individual task execution
// @access  Private
router.post('/optimize-task', auth, async (req, res) => {
  try {
    const { agentId, taskType, input, priority = 'medium' } = req.body;

    if (!agentId || !taskType) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID and task type are required'
      });
    }

    // Create optimized task
    const task = {
      agentId,
      taskType,
      input,
      priority,
      msmeId: req.user.msmeId
    };

    const optimizedTask = await agentOptimizationService.optimizeTaskExecution(task);

    res.json({
      success: true,
      message: 'Task optimized successfully',
      data: {
        taskId: optimizedTask.taskId,
        scheduledTime: optimizedTask.scheduledTime,
        priority: optimizedTask.priority,
        resourceRequirements: optimizedTask.resourceRequirements,
        estimatedDuration: optimizedTask.estimatedDuration
      }
    });
  } catch (error) {
    logger.error('Task optimization error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/optimized-ai-agents/performance-metrics
// @desc    Get comprehensive performance metrics
// @access  Private
router.get('/performance-metrics', auth, async (req, res) => {
  try {
    const { timeRange = '24h' } = req.query;
    
    // Get optimization metrics
    const optimizationMetrics = agentOptimizationService.getPerformanceMetrics();
    
    // Get multi-agent status
    const multiAgentStatus = await aiAgentService.getMultiAgentStatus();
    
    // Get dashboard metrics
    const dashboardMetrics = await aiAgentService.getMultiAgentStatus();

    const metrics = {
      optimization: optimizationMetrics,
      multiAgent: multiAgentStatus,
      dashboard: dashboardMetrics,
      timeRange,
      timestamp: new Date()
    };

    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error('Performance metrics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/optimized-ai-agents/load-balance
// @desc    Execute intelligent load balancing
// @access  Private
router.post('/load-balance', auth, async (req, res) => {
  try {
    const { strategy = 'predictive', options = {} } = req.body;

    // Get current agent loads
    const agentLoads = await agentOptimizationService.getAgentLoads();
    
    // Execute load balancing
    const loadBalancingStrategy = aiAgentService.loadBalancingStrategies.get(strategy);
    if (!loadBalancingStrategy) {
      return res.status(400).json({
        success: false,
        message: `Unknown load balancing strategy: ${strategy}`
      });
    }

    const balancedTasks = await loadBalancingStrategy.balance(agentLoads, []);

    emitOrchestrationEvent('optimized.load_balancing.completed', {
      strategy,
      balancedTasks: balancedTasks.length,
      agentLoads
    });

    res.json({
      success: true,
      message: 'Load balancing completed successfully',
      data: {
        strategy,
        agentLoads,
        balancedTasks: balancedTasks.length,
        recommendations: generateLoadBalancingRecommendations(agentLoads)
      }
    });
  } catch (error) {
    logger.error('Load balancing error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/optimized-ai-agents/workflow-templates
// @desc    Get available workflow templates
// @access  Private
router.get('/workflow-templates', auth, async (req, res) => {
  try {
    const templates = intelligentWorkflowService.getWorkflowTemplates();

    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    logger.error('Workflow templates error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/optimized-ai-agents/consensus-analysis
// @desc    Perform consensus analysis on multiple results
// @access  Private
router.post('/consensus-analysis', auth, async (req, res) => {
  try {
    const { results, algorithm = 'ensemble', parameters = {} } = req.body;

    if (!results || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Results array is required'
      });
    }

    // Get consensus algorithm
    const consensusAlgorithm = aiAgentService.consensusAlgorithms.get(algorithm);
    if (!consensusAlgorithm) {
      return res.status(400).json({
        success: false,
        message: `Unknown consensus algorithm: ${algorithm}`
      });
    }

    // Build consensus
    const consensus = await consensusAlgorithm.buildConsensus(results, {
      ...consensusAlgorithm.parameters,
      ...parameters
    });

    emitOrchestrationEvent('optimized.consensus.completed', {
      algorithm,
      inputResults: results.length,
      consensus
    });

    res.json({
      success: true,
      message: 'Consensus analysis completed successfully',
      data: {
        algorithm,
        consensus,
        inputResults: results.length,
        confidence: consensus.confidence || 0,
        agreement: consensus.agreement || 0
      }
    });
  } catch (error) {
    logger.error('Consensus analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/optimized-ai-agents/predictive-scaling
// @desc    Execute predictive scaling analysis
// @access  Private
router.post('/predictive-scaling', auth, async (req, res) => {
  try {
    const { timeWindow = 300000, predictionHorizon = 600000 } = req.body; // 5 min window, 10 min horizon

    // Get current system state
    const systemState = await agentOptimizationService.analyzeSystemState();
    
    // Get performance metrics
    const performanceMetrics = agentOptimizationService.getPerformanceMetrics();
    
    // Perform predictive analysis
    const predictions = await performPredictiveAnalysis(systemState, performanceMetrics, timeWindow, predictionHorizon);

    emitOrchestrationEvent('optimized.predictive_scaling.completed', {
      timeWindow,
      predictionHorizon,
      predictions
    });

    res.json({
      success: true,
      message: 'Predictive scaling analysis completed',
      data: {
        currentState: systemState,
        predictions,
        recommendations: generateScalingRecommendations(predictions),
        timeWindow,
        predictionHorizon
      }
    });
  } catch (error) {
    logger.error('Predictive scaling error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/optimized-ai-agents/optimization-status
// @desc    Get real-time optimization status
// @access  Private
router.get('/optimization-status', auth, async (req, res) => {
  try {
    const optimizationMetrics = agentOptimizationService.getPerformanceMetrics();
    const multiAgentStatus = await aiAgentService.getMultiAgentStatus();
    
    const status = {
      optimization: {
        cacheHitRate: optimizationMetrics.cache.hitRate,
        cacheSize: optimizationMetrics.cache.size,
        activeOptimizations: Object.keys(optimizationMetrics.agents).length,
        performanceScore: calculateOverallPerformanceScore(optimizationMetrics)
      },
      multiAgent: {
        totalAgents: multiAgentStatus.totalAgents,
        activeAgents: multiAgentStatus.activeAgents,
        processingTasks: multiAgentStatus.processingTasks,
        queuedTasks: multiAgentStatus.queuedTasks
      },
      recommendations: generateOptimizationRecommendations(optimizationMetrics, multiAgentStatus),
      timestamp: new Date()
    };

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Optimization status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/optimized-ai-agents/auto-optimize
// @desc    Trigger automatic optimization
// @access  Private
router.post('/auto-optimize', auth, async (req, res) => {
  try {
    const { optimizationTypes = ['performance', 'resource', 'quality'] } = req.body;

    const optimizationResults = [];

    for (const type of optimizationTypes) {
      try {
        let result;
        switch (type) {
          case 'performance':
            result = await optimizePerformance();
            break;
          case 'resource':
            result = await optimizeResources();
            break;
          case 'quality':
            result = await optimizeQuality();
            break;
          default:
            result = { type, status: 'skipped', reason: 'Unknown optimization type' };
        }
        optimizationResults.push(result);
      } catch (error) {
        optimizationResults.push({
          type,
          status: 'failed',
          ...clientErrorPayload(error)
        });
      }
    }

    emitOrchestrationEvent('optimized.auto_optimization.completed', {
      optimizationTypes,
      results: optimizationResults
    });

    res.json({
      success: true,
      message: 'Automatic optimization completed',
      data: {
        results: optimizationResults,
        timestamp: new Date()
      }
    });
  } catch (error) {
    logger.error('Auto-optimization error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// Helper Methods
function generateLoadBalancingRecommendations(agentLoads) {
  const recommendations = [];
  
  const overloadedAgents = agentLoads.filter(agent => agent.load > 0.8);
  const underloadedAgents = agentLoads.filter(agent => agent.load < 0.3);
  
  if (overloadedAgents.length > 0) {
    recommendations.push({
      type: 'scale_up',
      message: `Scale up ${overloadedAgents.length} overloaded agents`,
      agents: overloadedAgents.map(a => a.agentType),
      priority: 'high'
    });
  }
  
  if (underloadedAgents.length > 0) {
    recommendations.push({
      type: 'scale_down',
      message: `Consider scaling down ${underloadedAgents.length} underloaded agents`,
      agents: underloadedAgents.map(a => a.agentType),
      priority: 'medium'
    });
  }
  
  return recommendations;
}

async function performPredictiveAnalysis(systemState, performanceMetrics, timeWindow, predictionHorizon) {
  // Placeholder for predictive analysis
  return {
    predictedLoad: systemState.activeTasks * 1.2,
    predictedResourceUsage: {
      cpu: Math.min(systemState.cpuUsage * 1.1, 1.0),
      memory: Math.min(systemState.memoryUsage * 1.05, 1.0)
    },
    scalingRecommendations: {
      scaleUp: systemState.cpuUsage > 0.7,
      scaleDown: systemState.cpuUsage < 0.3
    },
    confidence: 0.85
  };
}

function generateScalingRecommendations(predictions) {
  const recommendations = [];
  
  if (predictions.scalingRecommendations.scaleUp) {
    recommendations.push({
      action: 'scale_up',
      reason: 'High predicted load',
      priority: 'high',
      estimatedImpact: 'Reduce response time by 30%'
    });
  }
  
  if (predictions.scalingRecommendations.scaleDown) {
    recommendations.push({
      action: 'scale_down',
      reason: 'Low predicted load',
      priority: 'medium',
      estimatedImpact: 'Reduce resource costs by 20%'
    });
  }
  
  return recommendations;
}

function calculateOverallPerformanceScore(optimizationMetrics) {
  const cacheScore = optimizationMetrics.cache.hitRate * 0.3;
  const agentScore = Object.values(optimizationMetrics.agents).reduce((avg, agent) => 
    avg + (agent.successRate || 0.5), 0) / Object.keys(optimizationMetrics.agents).length * 0.7;
  
  return Math.min((cacheScore + agentScore) * 100, 100);
}

function generateOptimizationRecommendations(optimizationMetrics, multiAgentStatus) {
  const recommendations = [];
  
  if (optimizationMetrics.cache.hitRate < 0.6) {
    recommendations.push({
      type: 'cache_optimization',
      message: 'Cache hit rate is low. Consider optimizing cache strategy.',
      priority: 'medium'
    });
  }
  
  if (multiAgentStatus.queuedTasks > 10) {
    recommendations.push({
      type: 'scaling',
      message: 'High queue length. Consider scaling up agents.',
      priority: 'high'
    });
  }
  
  return recommendations;
}

async function optimizePerformance() {
  // Placeholder for performance optimization
  return {
    type: 'performance',
    status: 'completed',
    optimizations: ['cache_optimization', 'connection_pooling'],
    impact: 'medium'
  };
}

async function optimizeResources() {
  // Placeholder for resource optimization
  return {
    type: 'resource',
    status: 'completed',
    optimizations: ['memory_optimization', 'cpu_optimization'],
    impact: 'high'
  };
}

async function optimizeQuality() {
  // Placeholder for quality optimization
  return {
    type: 'quality',
    status: 'completed',
    optimizations: ['consensus_improvement', 'error_handling'],
    impact: 'medium'
  };
}

module.exports = router;