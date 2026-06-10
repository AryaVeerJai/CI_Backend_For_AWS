const express = require('express');
const logger = require('../utils/logger');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const auth = require('../middleware/auth');
const AIAgent = require('../models/AIAgent');
const AITask = require('../models/AITask');
const AIWorkflow = require('../models/AIWorkflow');
const AIExecution = require('../models/AIExecution');
const aiAgentService = require('../services/aiAgentService');
const msmeEmissionsOrchestrationService = require('../services/msmeEmissionsOrchestrationService');
const isoCertificationAutomationService = require('../services/isoCertificationAutomationService');
const msmeAdvisoryOrchestrationService = require('../services/msmeAdvisoryOrchestrationService');
const { VALID_SIGNUP_GOALS } = require('../services/msmeAdvisoryOrchestrationService');
const orchestrationManagerEventService = require('../services/orchestrationManagerEventService');
const { createOrchestrationEventEmitter } = require('../utils/orchestrationEvents');
const { resolveAuthorizedMsmeId } = require('../utils/msmeAuthorization');

const emitOrchestrationEvent = createOrchestrationEventEmitter(
  orchestrationManagerEventService,
  'ai-agents'
);

router.use(auth);

// @route   GET /api/ai-agents
// @desc    Get all AI agents
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { type, status, isActive } = req.query;
    
    const query = {};
    if (type) query.type = type;
    if (status) query.status = status;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const agents = await AIAgent.find(query)
      .sort({ createdAt: -1 })
      .select('-configuration.parameters'); // Exclude sensitive config

    res.json({
      success: true,
      data: agents
    });
  } catch (error) {
    logger.error('Get AI agents error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/ai-agents
// @desc    Create new AI agent
// @access  Private (Admin only)
router.post('/', auth.requireRole('admin'), async (req, res) => {
  try {
    const agentData = {
      ...req.body,
      createdBy: req.user.id
    };

    const agent = new AIAgent(agentData);
    await agent.save();

    // Register agent with service
    await aiAgentService.registerAgent(agent);

    logger.info(`AI Agent created: ${agent.name}`, {
      agentId: agent._id,
      type: agent.type,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'AI agent created successfully',
      data: agent
    });
  } catch (error) {
    logger.error('Create AI agent error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PUT /api/ai-agents/:id
// @desc    Update AI agent
// @access  Private (Admin only)
router.put('/:id', auth.requireRole('admin'), async (req, res) => {
  try {
    const agent = await AIAgent.findById(req.params.id);
    
    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'AI agent not found'
      });
    }

    // Update agent data
    Object.assign(agent, req.body);
    agent.lastUpdated = new Date();
    await agent.save();

    // Re-register agent with service
    await aiAgentService.registerAgent(agent);

    logger.info(`AI Agent updated: ${agent.name}`, {
      agentId: agent._id,
      updatedBy: req.user.id
    });

    res.json({
      success: true,
      message: 'AI agent updated successfully',
      data: agent
    });
  } catch (error) {
    logger.error('Update AI agent error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   DELETE /api/ai-agents/:id
// @desc    Delete AI agent
// @access  Private (Admin only)
router.delete('/:id', auth.requireRole('admin'), async (req, res) => {
  try {
    const agent = await AIAgent.findById(req.params.id);
    
    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'AI agent not found'
      });
    }

    // Soft delete
    agent.isActive = false;
    agent.status = 'inactive';
    await agent.save();

    logger.info(`AI Agent deactivated: ${agent.name}`, {
      agentId: agent._id,
      deactivatedBy: req.user.id
    });

    res.json({
      success: true,
      message: 'AI agent deactivated successfully'
    });
  } catch (error) {
    logger.error('Delete AI agent error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/ai-agents/:id/tasks
// @desc    Create task for AI agent
// @access  Private
router.post('/:id/tasks', async (req, res) => {
  try {
    const agent = await AIAgent.findById(req.params.id);
    
    if (!agent || !agent.isActive) {
      return res.status(404).json({
        success: false,
        message: 'AI agent not found or inactive'
      });
    }

    const taskData = {
      agentId: agent._id,
      msmeId: req.user.msmeId,
      ...req.body
    };

    const task = await aiAgentService.createTask(taskData);

    res.status(201).json({
      success: true,
      message: 'Task created successfully',
      data: task
    });
  } catch (error) {
    logger.error('Create AI task error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/ai-agents/:id/tasks
// @desc    Get tasks for AI agent
// @access  Private
router.get('/:id/tasks', async (req, res) => {
  try {
    const { status, limit = 10, page = 1 } = req.query;
    
    const query = { 
      agentId: req.params.id,
      msmeId: req.user.msmeId
    };
    if (status) query.status = status;

    const tasks = await AITask.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await AITask.countDocuments(query);

    res.json({
      success: true,
      data: {
        tasks,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });
  } catch (error) {
    logger.error('Get AI tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/ai-agents/:id/performance
// @desc    Get AI agent performance metrics
// @access  Private
router.get('/:id/performance', async (req, res) => {
  try {
    const agent = await AIAgent.findById(req.params.id);
    
    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'AI agent not found'
      });
    }

    // Get recent tasks for additional metrics
    const recentTasks = await AITask.find({
      agentId: agent._id,
      msmeId: req.user.msmeId,
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
    });

    const performance = {
      ...agent.performance,
      recentActivity: {
        tasksLast30Days: recentTasks.length,
        successRateLast30Days: recentTasks.length > 0 
          ? (recentTasks.filter(t => t.status === 'completed').length / recentTasks.length * 100).toFixed(1)
          : 0,
        averageProcessingTime: recentTasks.length > 0
          ? recentTasks.reduce((sum, t) => sum + (t.metadata?.actualDuration || 0), 0) / recentTasks.length
          : 0
      }
    };

    res.json({
      success: true,
      data: performance
    });
  } catch (error) {
    logger.error('Get AI agent performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/ai-agents/analyze-carbon
// @desc    Analyze carbon data using AI agents
// @access  Private
router.post('/analyze-carbon', async (req, res) => {
  try {
    const { transactions, msmeData } = req.body;

    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({
        success: false,
        message: 'Transactions data is required'
      });
    }

    // Create task for carbon analyzer agent
    const carbonAnalyzerAgent = await AIAgent.findOne({ type: 'carbon_analyzer', isActive: true });
    
    if (!carbonAnalyzerAgent) {
      return res.status(404).json({
        success: false,
        message: 'Carbon analyzer agent not available'
      });
    }

    const task = await aiAgentService.createTask({
      agentId: carbonAnalyzerAgent._id,
      msmeId: req.user.msmeId,
      taskType: 'carbon_analysis',
      input: { transactions, msmeData },
      priority: 'high'
    });

    res.json({
      success: true,
      message: 'Carbon analysis task created',
      data: {
        taskId: task.taskId,
        status: task.status,
        estimatedCompletion: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
      }
    });
  } catch (error) {
    logger.error('Carbon analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/ai-agents/generate-recommendations
// @desc    Generate recommendations using AI agents
// @access  Private
router.post('/generate-recommendations', async (req, res) => {
  try {
    const input = req.body;

    const recommendationAgent = await AIAgent.findOne({ type: 'recommendation_engine', isActive: true });
    
    if (!recommendationAgent) {
      return res.status(404).json({
        success: false,
        message: 'Recommendation engine agent not available'
      });
    }

    const task = await aiAgentService.createTask({
      agentId: recommendationAgent._id,
      msmeId: req.user.msmeId,
      taskType: 'recommendation_generation',
      input,
      priority: 'medium'
    });

    res.json({
      success: true,
      message: 'Recommendation generation task created',
      data: {
        taskId: task.taskId,
        status: task.status,
        estimatedCompletion: new Date(Date.now() + 3 * 60 * 1000) // 3 minutes
      }
    });
  } catch (error) {
    logger.error('Recommendation generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/ai-agents/process-data
// @desc    Process transaction data using AI agents
// @access  Private
router.post('/process-data', async (req, res) => {
  try {
    const { transactions } = req.body;

    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({
        success: false,
        message: 'Transactions data is required'
      });
    }

    const dataProcessorAgent = await AIAgent.findOne({ type: 'data_processor', isActive: true });
    
    if (!dataProcessorAgent) {
      return res.status(404).json({
        success: false,
        message: 'Data processor agent not available'
      });
    }

    const task = await aiAgentService.createTask({
      agentId: dataProcessorAgent._id,
      msmeId: req.user.msmeId,
      taskType: 'data_processing',
      input: { transactions },
      priority: 'medium'
    });

    res.json({
      success: true,
      message: 'Data processing task created',
      data: {
        taskId: task.taskId,
        status: task.status,
        estimatedCompletion: new Date(Date.now() + 2 * 60 * 1000) // 2 minutes
      }
    });
  } catch (error) {
    logger.error('Data processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/ai-agents/orchestrate-msme-emissions
// @desc    Orchestrate multi-agent emissions analysis by MSME context
// @access  Private
router.post('/orchestrate-msme-emissions', async (req, res) => {
  try {
    const {
      msmeId,
      msmeData,
      transactions,
      documents,
      behaviorOverrides,
      contextOverrides
    } = req.body;

    const access = resolveAuthorizedMsmeId(req, msmeId);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.error
      });
    }
    const resolvedMsmeId = access.msmeId;
    const safeMsmeData = req.user.role === 'admin' ? msmeData : undefined;

    if (!resolvedMsmeId && !safeMsmeData) {
      return res.status(400).json({
        success: false,
        message: 'MSME ID or MSME profile data is required'
      });
    }

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Transactions data is required for orchestration'
      });
    }

    const result = await msmeEmissionsOrchestrationService.orchestrateEmissions({
      msmeId: resolvedMsmeId,
      msmeData: safeMsmeData,
      transactions,
      documents,
      behaviorOverrides,
      contextOverrides
    });

    emitOrchestrationEvent('orchestration.msme_emissions.completed', {
      msmeId: resolvedMsmeId,
      orchestrationId: result.orchestrationId,
      outputs: result.orchestrationPlan?.outputs || {}
    });

    res.json({
      success: true,
      message: 'MSME emissions orchestration completed',
      data: result
    });
  } catch (error) {
    logger.error('MSME emissions orchestration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/ai-agents/automate-iso-certification
// @desc    Run AI-agent automation for ISO 14064/14067 certification readiness
// @access  Private
router.post('/automate-iso-certification', async (req, res) => {
  try {
    const {
      msmeId,
      msmeData,
      transactions,
      documents,
      behaviorOverrides,
      contextOverrides,
      frameworks
    } = req.body || {};

    const access = resolveAuthorizedMsmeId(req, msmeId);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.error
      });
    }
    const resolvedMsmeId = access.msmeId;
    const safeMsmeData = req.user.role === 'admin' ? msmeData : undefined;

    if (!resolvedMsmeId && !safeMsmeData) {
      return res.status(400).json({
        success: false,
        message: 'MSME ID or MSME profile data is required'
      });
    }

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Transactions data is required for ISO automation'
      });
    }

    const automationResult = await isoCertificationAutomationService.automateCertification({
      msmeId: resolvedMsmeId,
      msmeData: safeMsmeData,
      transactions,
      documents,
      behaviorOverrides,
      contextOverrides,
      frameworks
    });

    emitOrchestrationEvent('iso.certification.automation.completed', {
      msmeId: automationResult.msmeId,
      orchestrationId: automationResult.orchestrationId,
      readinessScore: automationResult.readinessScore,
      certificationStatus: automationResult.certificationStatus
    });

    return res.json({
      success: true,
      message: 'ISO certification automation completed',
      data: automationResult
    });
  } catch (error) {
    logger.error('ISO certification automation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/ai-agents/msme-advisory
// @desc    Run MSME advisory orchestration (inventory quality, buyer inbox, DPDP, goals)
// @access  Private
router.post('/msme-advisory', async (req, res) => {
  try {
    const {
      msmeId,
      signupGoal,
      period = 'annual',
      includeAuditPack = false,
      processingFlags = {}
    } = req.body || {};

    const access = resolveAuthorizedMsmeId(req, msmeId);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.error
      });
    }

    if (signupGoal && !VALID_SIGNUP_GOALS.has(signupGoal)) {
      return res.status(400).json({
        success: false,
        message: `Invalid signupGoal. Allowed: ${[...VALID_SIGNUP_GOALS].join(', ')}`
      });
    }

    const result = await msmeAdvisoryOrchestrationService.runAdvisory({
      msmeId: access.msmeId,
      userId: req.user?.userId || req.user?.id,
      signupGoal: signupGoal || 'baseline_footprint',
      period,
      includeAuditPack: includeAuditPack === true,
      processingFlags
    });

    emitOrchestrationEvent('msme.advisory.completed', {
      msmeId: access.msmeId,
      advisoryId: result.advisoryId,
      signupGoal: result.signupGoal,
      inventoryQualityScore: result.trustPanel?.inventoryQualityScore
    });

    return res.json({
      success: true,
      message: 'MSME advisory orchestration completed',
      data: result
    });
  } catch (error) {
    logger.error('MSME advisory orchestration error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/ai-agents/multi-agent-workflow
// @desc    Execute multi-agent workflow
// @access  Private
router.post('/multi-agent-workflow', async (req, res) => {
  try {
    const { workflowId, msmeId, triggerData } = req.body;

    if (!workflowId) {
      return res.status(400).json({
        success: false,
        message: 'Workflow ID is required'
      });
    }

    const access = resolveAuthorizedMsmeId(req, msmeId);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.error
      });
    }

    const execution = await aiAgentService.executeMultiAgentWorkflow(
      workflowId,
      access.msmeId,
      triggerData || {}
    );

    emitOrchestrationEvent('workflow.multi_agent.triggered', {
      msmeId: access.msmeId,
      workflowId,
      executionId: execution.executionId,
      steps: execution.steps.length
    });

    res.json({
      success: true,
      message: 'Multi-agent workflow execution started',
      data: {
        executionId: execution.executionId,
        status: execution.status,
        steps: execution.steps.length,
        parallelGroups: execution.coordination.parallelGroups.length
      }
    });
  } catch (error) {
    logger.error('Multi-agent workflow execution error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/ai-agents/multi-agent-status
// @desc    Get multi-agent system status
// @access  Private
router.get('/multi-agent-status', async (req, res) => {
  try {
    const status = await aiAgentService.getMultiAgentStatus();

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Get multi-agent status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/ai-agents/coordinate-agents
// @desc    Coordinate multiple agents for a specific task
// @access  Private
router.post('/coordinate-agents', async (req, res) => {
  try {
    const { agentIds, taskType, input, coordinationMode = 'parallel' } = req.body;

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

    const coordinationId = `coord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const tasks = [];

    // Create tasks for each agent
    for (const agentId of agentIds) {
      const agent = await AIAgent.findById(agentId);
      if (!agent || !agent.isActive) {
        continue; // Skip inactive agents
      }

      const task = await aiAgentService.createTask({
        agentId,
        msmeId: req.user.msmeId,
        taskType,
        input: {
          ...input,
          coordinationId,
          coordinationMode,
          participatingAgents: agentIds
        },
        priority: 'high',
        metadata: {
          coordinationId,
          coordinationMode,
          participatingAgents: agentIds
        }
      });

      tasks.push(task);
    }

    // Execute coordination based on mode
    let results;
    if (coordinationMode === 'parallel') {
      results = await aiAgentService.executeParallelCoordination(tasks);
    } else if (coordinationMode === 'sequential') {
      results = await aiAgentService.executeSequentialCoordination(tasks);
    } else if (coordinationMode === 'consensus') {
      results = await aiAgentService.executeConsensusCoordination(tasks);
    } else {
      throw new Error(`Unknown coordination mode: ${coordinationMode}`);
    }

    emitOrchestrationEvent('agents.coordination.completed', {
      msmeId: req.user.msmeId,
      coordinationId,
      coordinationMode,
      taskType,
      tasks: tasks.map(task => ({
        taskId: task.taskId,
        agentId: task.agentId,
        status: task.status
      })),
      results
    });

    res.json({
      success: true,
      message: 'Agent coordination completed',
      data: {
        coordinationId,
        mode: coordinationMode,
        participatingAgents: agentIds,
        tasks: tasks.map(t => ({
          taskId: t.taskId,
          agentId: t.agentId,
          status: t.status
        })),
        results
      }
    });
  } catch (error) {
    logger.error('Agent coordination error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/ai-agents/balance-load
// @desc    Balance load across agents
// @access  Private (Admin only)
router.post('/balance-load', auth.requireRole('admin'), async (req, res) => {
  try {
    await aiAgentService.balanceAgentLoad();

    emitOrchestrationEvent('agents.load_balanced', {
      msmeId: req.user.msmeId
    });

    res.json({
      success: true,
      message: 'Agent load balancing completed'
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

// @route   GET /api/ai-agents/coordination/:coordinationId
// @desc    Get coordination results
// @access  Private
router.get('/coordination/:coordinationId', async (req, res) => {
  try {
    const { coordinationId } = req.params;

    // Find all tasks with this coordination ID
    const tasks = await AITask.find({
      'metadata.coordinationId': coordinationId,
      msmeId: req.user.msmeId
    }).populate('agentId', 'name type');

    const results = {
      coordinationId,
      totalTasks: tasks.length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      failedTasks: tasks.filter(t => t.status === 'failed').length,
      tasks: tasks.map(task => ({
        taskId: task.taskId,
        agentName: task.agentId?.name,
        agentType: task.agentId?.type,
        status: task.status,
        output: task.output,
        error: task.error,
        duration: task.metadata?.actualDuration
      }))
    };

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    logger.error('Get coordination results error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/ai-agents/dashboard-metrics
// @desc    Get dashboard metrics for multi-agent system
// @access  Private
router.get('/dashboard-metrics', async (req, res) => {
  try {
    const { timeRange = '24h' } = req.query;
    
    // Calculate time range
    const now = new Date();
    let startTime;
    switch (timeRange) {
      case '1h':
        startTime = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      default:
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    // Get task metrics
    const taskMetrics = await AITask.aggregate([
      {
        $match: {
          msmeId: req.user.msmeId,
          createdAt: { $gte: startTime }
        }
      },
      {
        $group: {
          _id: {
            status: '$status',
            hour: { $hour: '$createdAt' }
          },
          count: { $sum: 1 },
          avgDuration: { $avg: '$metadata.actualDuration' }
        }
      },
      {
        $sort: { '_id.hour': 1 }
      }
    ]);

    // Get agent performance metrics
    const agentMetrics = await AITask.aggregate([
      {
        $match: {
          msmeId: req.user.msmeId,
          createdAt: { $gte: startTime }
        }
      },
      {
        $group: {
          _id: '$agentId',
          totalTasks: { $sum: 1 },
          completedTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          failedTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          },
          avgDuration: { $avg: '$metadata.actualDuration' }
        }
      },
      {
        $lookup: {
          from: 'aigents',
          localField: '_id',
          foreignField: '_id',
          as: 'agent'
        }
      },
      {
        $unwind: '$agent'
      },
      {
        $project: {
          agentName: '$agent.name',
          agentType: '$agent.type',
          totalTasks: 1,
          completedTasks: 1,
          failedTasks: 1,
          successRate: {
            $multiply: [
              { $divide: ['$completedTasks', '$totalTasks'] },
              100
            ]
          },
          avgDuration: 1
        }
      }
    ]);

    // Get hourly metrics for charts
    const hourlyMetrics = await AITask.aggregate([
      {
        $match: {
          msmeId: req.user.msmeId,
          createdAt: { $gte: startTime }
        }
      },
      {
        $group: {
          _id: {
            hour: { $hour: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          activeTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] }
          },
          completedTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          failedTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          },
          avgResponseTime: { $avg: '$metadata.actualDuration' }
        }
      },
      {
        $sort: { '_id.day': 1, '_id.hour': 1 }
      }
    ]);

    const metrics = {
      timeRange,
      taskMetrics,
      agentMetrics,
      hourlyMetrics,
      summary: {
        totalTasks: taskMetrics.reduce((sum, m) => sum + m.count, 0),
        completedTasks: taskMetrics
          .filter(m => m._id.status === 'completed')
          .reduce((sum, m) => sum + m.count, 0),
        failedTasks: taskMetrics
          .filter(m => m._id.status === 'failed')
          .reduce((sum, m) => sum + m.count, 0),
        averageResponseTime: taskMetrics
          .filter(m => m.avgDuration)
          .reduce((sum, m) => sum + m.avgDuration, 0) / 
          taskMetrics.filter(m => m.avgDuration).length || 0
      }
    };

    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error('Get dashboard metrics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/ai-agents/:id
// @desc    Get single AI agent
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const agent = await AIAgent.findById(req.params.id).select('-configuration.parameters');
    
    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'AI agent not found'
      });
    }

    res.json({
      success: true,
      data: agent
    });
  } catch (error) {
    logger.error('Get AI agent error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;