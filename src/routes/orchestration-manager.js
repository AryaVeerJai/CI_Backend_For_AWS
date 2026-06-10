const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const auth = require('../middleware/auth');
const { resolveAuthorizedMsmeId } = require('../utils/msmeAuthorization');
const orchestrationManagerEventService = require('../services/orchestrationManagerEventService');
const aiAgentService = require('../services/aiAgentService');
const agentOrchestrationCuratorService = require('../services/agentOrchestrationCuratorService');
const orchestrationWorkflowRoutes = require('./orchestration-workflows');
const logger = require('../utils/logger');

router.use('/workflows', orchestrationWorkflowRoutes);

// @route   GET /api/orchestration-manager/events
// @desc    Get recent orchestration manager events
// @access  Private
router.get('/events', auth, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const events = orchestrationManagerEventService.getRecentEvents(limit);

    res.json({
      success: true,
      data: events
    });
  } catch (error) {
    logger.error('Get orchestration events error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/orchestration-manager/status
// @desc    Get orchestration manager status summary
// @access  Private
router.get('/status', auth, async (req, res) => {
  try {
    const multiAgentStatus = await aiAgentService.getMultiAgentStatus();
    const events = orchestrationManagerEventService.getRecentEvents(50);

    res.json({
      success: true,
      data: {
        totalEvents: events.length,
        lastEvent: events[0] || null,
        multiAgentStatus
      }
    });
  } catch (error) {
    logger.error('Get orchestration status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/orchestration-manager/emissions-reporting
// @desc    Orchestrate carbon emissions analysis and regulatory reporting outcomes
// @access  Private
router.post('/emissions-reporting', auth, async (req, res) => {
  try {
    const {
      msmeId,
      period,
      frameworks,
      transactions,
      documents,
      behaviorOverrides,
      contextOverrides,
      triggerSource
    } = req.body;

    const access = resolveAuthorizedMsmeId(req, msmeId);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.error
      });
    }

    const resolvedMsmeId = access.msmeId;
    if (!resolvedMsmeId) {
      return res.status(400).json({
        success: false,
        message: 'MSME ID is required'
      });
    }

    const result = await orchestrationManagerEventService.triggerEmissionsReportingOrchestration({
      msmeId: resolvedMsmeId,
      period: period || 'annual',
      frameworks,
      transactions,
      documents,
      behaviorOverrides,
      contextOverrides,
      triggerSource: triggerSource || 'api'
    });

    res.json({
      success: true,
      message: 'Emissions and reporting orchestration completed',
      data: result
    });
  } catch (error) {
    logger.error('Emissions reporting orchestration error:', error);
    res.status(error.message?.includes('required') ? 400 : 500).json({
      success: false,
      message: error.message || 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/orchestration-manager/trigger
// @desc    Trigger orchestration manager execution
// @access  Private
router.post('/trigger', auth, async (req, res) => {
  try {
    const {
      msmeId,
      msmeData,
      transactions,
      documents,
      behaviorOverrides,
      contextOverrides,
      triggerSource
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

    const result = await orchestrationManagerEventService.triggerOrchestration({
      msmeId: resolvedMsmeId,
      msmeData: safeMsmeData,
      transactions,
      documents,
      behaviorOverrides,
      contextOverrides,
      triggerSource: triggerSource || 'api'
    });

    res.json({
      success: true,
      message: 'Orchestration manager execution completed',
      data: result
    });
  } catch (error) {
    logger.error('Orchestration manager trigger error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/orchestration-manager/workflow/trigger
// @desc    Trigger a workflow execution via orchestration manager
// @access  Private
router.post('/workflow/trigger', auth, async (req, res) => {
  try {
    const { workflowId, msmeId, triggerData, triggerSource } = req.body;

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

    const execution = await orchestrationManagerEventService.triggerWorkflow({
      workflowId,
      msmeId: access.msmeId,
      triggerData,
      triggerSource: triggerSource || 'api'
    });

    res.json({
      success: true,
      message: 'Workflow execution triggered',
      data: execution
    });
  } catch (error) {
    logger.error('Workflow trigger error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/orchestration-manager/emit-event
// @desc    Emit an event into the orchestration manager event bus
// @access  Private
router.post('/emit-event', auth, auth.requireRole('admin'), async (req, res) => {
  try {
    const { eventType, payload, source } = req.body;

    if (!eventType) {
      return res.status(400).json({
        success: false,
        message: 'Event type is required'
      });
    }

    const event = await orchestrationManagerEventService.emitEvent(
      eventType,
      payload || {},
      source || 'api'
    );

    res.json({
      success: true,
      message: 'Event emitted successfully',
      data: event
    });
  } catch (error) {
    logger.error('Emit orchestration event error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/orchestration-manager/curated-catalog
// @desc    Get curated agent catalog and pipeline templates for orchestration
// @access  Private
router.get('/curated-catalog', auth, async (req, res) => {
  try {
    const catalog = aiAgentService.getCuratedOrchestrationCatalog();

    res.json({
      success: true,
      data: catalog
    });
  } catch (error) {
    logger.error('Get curated orchestration catalog error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/orchestration-manager/curated-plan
// @desc    Build a curated orchestration plan for a pipeline and context
// @access  Private
router.post('/curated-plan', auth, async (req, res) => {
  try {
    const {
      pipelineId = 'msme_emissions',
      context = {},
      orchestrationOptions = {}
    } = req.body;

    const plan = agentOrchestrationCuratorService.buildCuratedPlan({
      pipelineId,
      context,
      orchestrationOptions,
      sectorAgentType: context.sectorAgentType,
      processMachineryAgentType: context.processMachineryAgentType
    });

    res.json({
      success: true,
      message: 'Curated orchestration plan generated',
      data: plan
    });
  } catch (error) {
    logger.error('Build curated orchestration plan error:', error);
    res.status(error.message?.includes('Unknown orchestration pipeline') ? 400 : 500).json({
      success: false,
      message: error.message || 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/orchestration-manager/inventory-governance
// @desc    Run agentic GHG inventory governance (boundary, factors, assurance, BRSR reconcile)
// @access  Private
router.post('/inventory-governance', auth, async (req, res) => {
  try {
    const {
      msmeId,
      transactions,
      reportingPeriod,
      lockInventory,
      allowResidualScope3,
      frameworks
    } = req.body;

    const access = resolveAuthorizedMsmeId(req, msmeId);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.error
      });
    }

    const MSME = require('../models/MSME');
    const Transaction = require('../models/Transaction');
    const { runGhgInventoryGovernanceOrchestration } = require('../services/ghgInventoryGovernanceOrchestrator');

    const msme = await MSME.findById(access.msmeId).lean();
    if (!msme) {
      return res.status(404).json({ success: false, message: 'MSME profile not found' });
    }

    let txnRows = transactions;
    if (!Array.isArray(txnRows) || txnRows.length === 0) {
      txnRows = await Transaction.find({
        msmeId: access.msmeId,
        isSpam: { $ne: true },
        isDuplicate: { $ne: true }
      })
        .sort({ date: -1 })
        .limit(5000)
        .lean();
    }

    const result = await runGhgInventoryGovernanceOrchestration({
      msmeData: msme,
      transactions: txnRows,
      reportingPeriod: reportingPeriod || {},
      options: {
        useAsyncCalculation: true,
        lockInventory: lockInventory === true,
        allowResidualScope3: allowResidualScope3 === true,
        frameworks
      }
    });

    res.json({
      success: true,
      message: 'GHG inventory governance orchestration completed',
      data: result
    });
  } catch (error) {
    logger.error('Inventory governance orchestration error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;
