const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const auth = require('../middleware/auth');
const AIWorkflow = require('../models/AIWorkflow');
const AIExecution = require('../models/AIExecution');
const aiAgentService = require('../services/aiAgentService');
const logger = require('../utils/logger');

router.use(auth);

// @route   GET /api/ai-workflows
// @desc    Get all AI workflows
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { status, category, isActive } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (category) query.category = category;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const workflows = await AIWorkflow.find(query)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name email');

    res.json({
      success: true,
      data: workflows
    });
  } catch (error) {
    logger.error('Get AI workflows error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/ai-workflows
// @desc    Create new AI workflow
// @access  Private (Admin only)
router.post('/', auth.requireRole('admin'), async (req, res) => {
  try {
    const workflowData = {
      ...req.body,
      createdBy: req.user.id
    };

    // Validate workflow steps
    const validation = await validateWorkflowSteps(workflowData.steps);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid workflow configuration',
        errors: validation.errors
      });
    }

    const workflow = new AIWorkflow(workflowData);
    await workflow.save();

    logger.info(`AI Workflow created: ${workflow.name}`, {
      workflowId: workflow._id,
      createdBy: req.user.id,
      stepsCount: workflow.steps.length
    });

    res.status(201).json({
      success: true,
      message: 'AI workflow created successfully',
      data: workflow
    });
  } catch (error) {
    logger.error('Create AI workflow error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PUT /api/ai-workflows/:id
// @desc    Update AI workflow
// @access  Private (Admin only)
router.put('/:id', auth.requireRole('admin'), async (req, res) => {
  try {
    const workflow = await AIWorkflow.findById(req.params.id);
    
    if (!workflow) {
      return res.status(404).json({
        success: false,
        message: 'AI workflow not found'
      });
    }

    // Validate workflow steps if provided
    if (req.body.steps) {
      const validation = await validateWorkflowSteps(req.body.steps);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          message: 'Invalid workflow configuration',
          errors: validation.errors
        });
      }
    }

    // Update workflow
    Object.assign(workflow, req.body);
    workflow.version += 1;
    await workflow.save();

    logger.info(`AI Workflow updated: ${workflow.name}`, {
      workflowId: workflow._id,
      updatedBy: req.user.id,
      version: workflow.version
    });

    res.json({
      success: true,
      message: 'AI workflow updated successfully',
      data: workflow
    });
  } catch (error) {
    logger.error('Update AI workflow error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   DELETE /api/ai-workflows/:id
// @desc    Delete AI workflow
// @access  Private (Admin only)
router.delete('/:id', auth.requireRole('admin'), async (req, res) => {
  try {
    const workflow = await AIWorkflow.findById(req.params.id);
    
    if (!workflow) {
      return res.status(404).json({
        success: false,
        message: 'AI workflow not found'
      });
    }

    // Soft delete
    workflow.isActive = false;
    workflow.status = 'archived';
    await workflow.save();

    logger.info(`AI Workflow archived: ${workflow.name}`, {
      workflowId: workflow._id,
      archivedBy: req.user.id
    });

    res.json({
      success: true,
      message: 'AI workflow archived successfully'
    });
  } catch (error) {
    logger.error('Delete AI workflow error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/ai-workflows/:id/execute
// @desc    Execute AI workflow
// @access  Private
router.post('/:id/execute', async (req, res) => {
  try {
    const workflow = await AIWorkflow.findById(req.params.id);
    
    if (!workflow || !workflow.isActive) {
      return res.status(404).json({
        success: false,
        message: 'AI workflow not found or inactive'
      });
    }

    const { triggerData = {} } = req.body;

    const execution = await aiAgentService.executeWorkflow(
      workflow._id,
      req.user.msmeId,
      triggerData
    );

    logger.info(`AI Workflow execution started: ${workflow.name}`, {
      workflowId: workflow._id,
      executionId: execution.executionId,
      msmeId: req.user.msmeId
    });

    res.json({
      success: true,
      message: 'Workflow execution started',
      data: {
        executionId: execution.executionId,
        status: execution.status,
        estimatedCompletion: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
      }
    });
  } catch (error) {
    logger.error('Execute AI workflow error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/ai-workflows/:id/executions
// @desc    Get workflow executions
// @access  Private
router.get('/:id/executions', async (req, res) => {
  try {
    const { status, limit = 10, page = 1 } = req.query;
    
    const query = { 
      workflowId: req.params.id,
      msmeId: req.user.msmeId
    };
    if (status) query.status = status;

    const executions = await AIExecution.find(query)
      .sort({ startedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('workflowId', 'name description');

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

// @route   GET /api/ai-workflows/:id/executions/:executionId
// @desc    Get single workflow execution
// @access  Private
router.get('/:id/executions/:executionId', async (req, res) => {
  try {
    const execution = await AIExecution.findOne({
      _id: req.params.executionId,
      workflowId: req.params.id,
      msmeId: req.user.msmeId
    }).populate('workflowId', 'name description');

    if (!execution) {
      return res.status(404).json({
        success: false,
        message: 'Workflow execution not found'
      });
    }

    res.json({
      success: true,
      data: execution
    });
  } catch (error) {
    logger.error('Get workflow execution error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/ai-workflows/:id/executions/:executionId/cancel
// @desc    Cancel workflow execution
// @access  Private
router.post('/:id/executions/:executionId/cancel', async (req, res) => {
  try {
    const execution = await AIExecution.findOne({
      _id: req.params.executionId,
      workflowId: req.params.id,
      msmeId: req.user.msmeId
    });

    if (!execution) {
      return res.status(404).json({
        success: false,
        message: 'Workflow execution not found'
      });
    }

    if (execution.status !== 'running') {
      return res.status(400).json({
        success: false,
        message: 'Execution cannot be cancelled in current status'
      });
    }

    execution.status = 'cancelled';
    execution.completedAt = new Date();
    await execution.save();

    logger.info(`Workflow execution cancelled: ${execution.executionId}`, {
      executionId: execution.executionId,
      cancelledBy: req.user.id
    });

    res.json({
      success: true,
      message: 'Workflow execution cancelled successfully'
    });
  } catch (error) {
    logger.error('Cancel workflow execution error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/ai-workflows/templates
// @desc    Get workflow templates
// @access  Private
router.get('/templates', async (req, res) => {
  try {
    const templates = [
      {
        name: 'Carbon Assessment Workflow',
        description: 'Complete carbon footprint assessment with analysis and recommendations',
        category: 'carbon_assessment',
        steps: [
          {
            stepId: 'data_processing',
            taskType: 'data_processing',
            description: 'Process and clean transaction data'
          },
          {
            stepId: 'carbon_analysis',
            taskType: 'carbon_analysis',
            description: 'Analyze carbon emissions and calculate footprint'
          },
          {
            stepId: 'recommendations',
            taskType: 'recommendation_generation',
            description: 'Generate sustainability recommendations'
          },
          {
            stepId: 'report_generation',
            taskType: 'report_generation',
            description: 'Generate comprehensive assessment report'
          }
        ]
      },
      {
        name: 'Transaction Analysis Workflow',
        description: 'Analyze transaction patterns and detect anomalies',
        category: 'transaction_analysis',
        steps: [
          {
            stepId: 'data_cleaning',
            taskType: 'data_processing',
            description: 'Clean and validate transaction data'
          },
          {
            stepId: 'anomaly_detection',
            taskType: 'anomaly_detection',
            description: 'Detect unusual patterns and anomalies'
          },
          {
            stepId: 'trend_analysis',
            taskType: 'trend_analysis',
            description: 'Analyze trends and patterns'
          }
        ]
      },
      {
        name: 'Compliance Monitoring Workflow',
        description: 'Monitor environmental compliance and generate reports',
        category: 'compliance',
        steps: [
          {
            stepId: 'compliance_check',
            taskType: 'compliance_check',
            description: 'Check environmental compliance requirements'
          },
          {
            stepId: 'gap_analysis',
            taskType: 'compliance_analysis',
            description: 'Identify compliance gaps and issues'
          },
          {
            stepId: 'report_generation',
            taskType: 'report_generation',
            description: 'Generate compliance report'
          }
        ]
      },
      {
        name: 'ISO Certification Automation Workflow',
        description: 'Automate ISO 14064/14067 readiness through evidence collection, gap closure planning, and audit packaging',
        category: 'iso_certification',
        steps: [
          {
            stepId: 'compliance_check',
            taskType: 'compliance_check',
            description: 'Run ISO compliance monitoring and collect framework gaps'
          },
          {
            stepId: 'evidence_collection',
            taskType: 'report_generation',
            description: 'Collect ISO evidence register and factor traceability records'
          },
          {
            stepId: 'gap_closure_plan',
            taskType: 'optimization_suggestion',
            description: 'Build prioritized ISO gap-closure action plan'
          },
          {
            stepId: 'audit_packaging',
            taskType: 'report_generation',
            description: 'Package audit-ready ISO certification readiness bundle'
          }
        ]
      }
    ];

    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    logger.error('Get workflow templates error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/ai-workflows/:id
// @desc    Get single AI workflow
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const workflow = await AIWorkflow.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('steps.agentId', 'name type capabilities');

    if (!workflow) {
      return res.status(404).json({
        success: false,
        message: 'AI workflow not found'
      });
    }

    res.json({
      success: true,
      data: workflow
    });
  } catch (error) {
    logger.error('Get AI workflow error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// Helper method to validate workflow steps
async function validateWorkflowSteps(steps) {
  const errors = [];
  
  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push('Workflow must have at least one step');
    return { isValid: false, errors };
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    
    if (!step.stepId) {
      errors.push(`Step ${i + 1}: stepId is required`);
    }
    
    if (!step.agentId) {
      errors.push(`Step ${i + 1}: agentId is required`);
    }
    
    if (!step.taskType) {
      errors.push(`Step ${i + 1}: taskType is required`);
    }
  }

  // Check for circular dependencies
  const stepIds = steps.map(s => s.stepId);
  for (const step of steps) {
    if (step.dependencies) {
      for (const dep of step.dependencies) {
        if (!stepIds.includes(dep)) {
          errors.push(`Step ${step.stepId}: dependency ${dep} not found`);
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

module.exports = router;