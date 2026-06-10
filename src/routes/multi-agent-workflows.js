const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const auth = require('../middleware/auth');
const { resolveAuthorizedMsmeId } = require('../utils/msmeAuthorization');
const AIWorkflow = require('../models/AIWorkflow');
const AIExecution = require('../models/AIExecution');
const aiAgentService = require('../services/aiAgentService');
const logger = require('../utils/logger');

// @route   POST /api/multi-agent-workflows
// @desc    Create multi-agent workflow
// @access  Private (Admin only)
router.post('/', auth, auth.requireRole('admin'), async (req, res) => {
  try {
    const workflowData = {
      ...req.body,
      createdBy: req.user.id,
      type: 'multi_agent',
      coordination: {
        mode: req.body.coordinationMode || 'parallel',
        parallelGroups: req.body.parallelGroups || [],
        dependencies: req.body.dependencies || {}
      }
    };

    const workflow = new AIWorkflow(workflowData);
    await workflow.save();

    logger.info(`Multi-agent workflow created: ${workflow.name}`, {
      workflowId: workflow._id,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Multi-agent workflow created successfully',
      data: workflow
    });
  } catch (error) {
    logger.error('Create multi-agent workflow error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/multi-agent-workflows
// @desc    Get all multi-agent workflows
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const workflows = await AIWorkflow.find({ type: 'multi_agent' })
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name email');

    res.json({
      success: true,
      data: workflows
    });
  } catch (error) {
    logger.error('Get multi-agent workflows error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/multi-agent-workflows/:id
// @desc    Get single multi-agent workflow
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const workflow = await AIWorkflow.findById(req.params.id)
      .populate('createdBy', 'name email');

    if (!workflow) {
      return res.status(404).json({
        success: false,
        message: 'Multi-agent workflow not found'
      });
    }

    res.json({
      success: true,
      data: workflow
    });
  } catch (error) {
    logger.error('Get multi-agent workflow error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/multi-agent-workflows/:id/execute
// @desc    Execute multi-agent workflow
// @access  Private
router.post('/:id/execute', auth, async (req, res) => {
  try {
    const { msmeId, triggerData } = req.body;

    const access = resolveAuthorizedMsmeId(req, msmeId);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.error
      });
    }

    const execution = await aiAgentService.executeMultiAgentWorkflow(
      req.params.id,
      access.msmeId,
      triggerData || {}
    );

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
    logger.error('Execute multi-agent workflow error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/multi-agent-workflows/:id/executions
// @desc    Get workflow executions
// @access  Private
router.get('/:id/executions', auth, async (req, res) => {
  try {
    const { status, limit = 10, page = 1 } = req.query;
    
    const query = { 
      workflowId: req.params.id,
      msmeId: req.user.msmeId
    };
    if (status) query.status = status;

    const executions = await AIExecution.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await AIExecution.countDocuments(query);

    res.json({
      success: true,
      data: {
        executions,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });
  } catch (error) {
    logger.error('Get workflow executions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/multi-agent-workflows/executions/:executionId
// @desc    Get execution details
// @access  Private
router.get('/executions/:executionId', auth, async (req, res) => {
  try {
    const execution = await AIExecution.findOne({
      executionId: req.params.executionId,
      msmeId: req.user.msmeId
    }).populate('workflowId', 'name description');

    if (!execution) {
      return res.status(404).json({
        success: false,
        message: 'Execution not found'
      });
    }

    res.json({
      success: true,
      data: execution
    });
  } catch (error) {
    logger.error('Get execution details error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/multi-agent-workflows/templates
// @desc    Create workflow from template
// @access  Private
router.post('/templates', auth, async (req, res) => {
  try {
    const { templateType, msmeId, customizations = {} } = req.body;

    const access = resolveAuthorizedMsmeId(req, msmeId);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.error
      });
    }

    const templates = {
      carbon_analysis_workflow: {
        name: 'Carbon Analysis Workflow',
        description: 'Comprehensive carbon footprint analysis using multiple AI agents',
        trigger: {
          type: 'manual',
          source: 'api'
        },
        steps: [
          {
            stepId: 'data_processing',
            agentId: null, // Will be set based on available agents
            taskType: 'data_processing',
            parameters: {},
            dependencies: []
          },
          {
            stepId: 'carbon_calculation',
            agentId: null,
            taskType: 'carbon_analysis',
            parameters: {},
            dependencies: ['data_processing']
          },
          {
            stepId: 'anomaly_detection',
            agentId: null,
            taskType: 'anomaly_detection',
            parameters: {},
            dependencies: ['carbon_calculation']
          },
          {
            stepId: 'recommendation_generation',
            agentId: null,
            taskType: 'recommendation_generation',
            parameters: {},
            dependencies: ['carbon_calculation', 'anomaly_detection']
          }
        ],
        coordination: {
          mode: 'hybrid',
          parallelGroups: [
            ['data_processing'],
            ['carbon_calculation'],
            ['anomaly_detection', 'recommendation_generation']
          ]
        }
      },
      sustainability_assessment_workflow: {
        name: 'Sustainability Assessment Workflow',
        description: 'Comprehensive sustainability assessment and optimization',
        trigger: {
          type: 'scheduled',
          source: 'system'
        },
        steps: [
          {
            stepId: 'data_collection',
            agentId: null,
            taskType: 'data_processing',
            parameters: {},
            dependencies: []
          },
          {
            stepId: 'carbon_analysis',
            agentId: null,
            taskType: 'carbon_analysis',
            parameters: {},
            dependencies: ['data_collection']
          },
          {
            stepId: 'compliance_check',
            agentId: null,
            taskType: 'compliance_check',
            parameters: {},
            dependencies: ['data_collection']
          },
          {
            stepId: 'trend_analysis',
            agentId: null,
            taskType: 'trend_analysis',
            parameters: {},
            dependencies: ['carbon_analysis']
          },
          {
            stepId: 'optimization_advice',
            agentId: null,
            taskType: 'optimization_advice',
            parameters: {},
            dependencies: ['carbon_analysis', 'compliance_check', 'trend_analysis']
          },
          {
            stepId: 'report_generation',
            agentId: null,
            taskType: 'report_generation',
            parameters: {},
            dependencies: ['optimization_advice']
          }
        ],
        coordination: {
          mode: 'hybrid',
          parallelGroups: [
            ['data_collection'],
            ['carbon_analysis', 'compliance_check'],
            ['trend_analysis'],
            ['optimization_advice'],
            ['report_generation']
          ]
        }
      }
    };

    const template = templates[templateType];
    if (!template) {
      return res.status(400).json({
        success: false,
        message: 'Invalid template type'
      });
    }

    // Apply customizations
    const workflowData = {
      ...template,
      ...customizations,
      msmeId: access.msmeId,
      createdBy: req.user.id,
      type: 'multi_agent'
    };

    const workflow = new AIWorkflow(workflowData);
    await workflow.save();

    logger.info(`Multi-agent workflow created from template: ${templateType}`, {
      workflowId: workflow._id,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Multi-agent workflow created from template',
      data: workflow
    });
  } catch (error) {
    logger.error('Create workflow from template error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;
