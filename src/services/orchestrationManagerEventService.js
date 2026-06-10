const EventEmitter = require('events');
const AIWorkflow = require('../models/AIWorkflow');
const aiAgentService = require('./aiAgentService');
const orchestrationManagerService = require('./msmeEmissionsOrchestrationService');
const carbonEmissionsReportingOrchestrationService = require('./carbonEmissionsReportingOrchestrationService');
const logger = require('../utils/logger');

class OrchestrationManagerEventService extends EventEmitter {
  constructor() {
    super();
    this.eventLog = [];
    this.maxEvents = 200;
    this.externalListenersRegistered = false;
  }

  registerExternalListeners({
    realTimeMonitoring,
    enhancedMonitoringService,
    dataFlowOptimizationService
  }) {
    if (this.externalListenersRegistered) {
      return;
    }

    this.externalListenersRegistered = true;

    if (realTimeMonitoring?.on) {
      realTimeMonitoring.on('dataUpdated', (payload) => {
        this.handleExternalEvent('monitoring.data_updated', payload, 'real_time_monitoring');
      });
      realTimeMonitoring.on('alert', (payload) => {
        this.handleExternalEvent('monitoring.alert', payload, 'real_time_monitoring');
      });
      realTimeMonitoring.on('monitoringStarted', (payload) => {
        this.handleExternalEvent('monitoring.started', payload, 'real_time_monitoring');
      });
      realTimeMonitoring.on('monitoringStopped', (payload) => {
        this.handleExternalEvent('monitoring.stopped', payload, 'real_time_monitoring');
      });
    }

    if (enhancedMonitoringService?.on) {
      enhancedMonitoringService.on('systemMetrics', (payload) => {
        this.handleExternalEvent('monitoring.system_metrics', payload, 'enhanced_monitoring');
      });
      enhancedMonitoringService.on('agentMetrics', (payload) => {
        this.handleExternalEvent('monitoring.agent_metrics', payload, 'enhanced_monitoring');
      });
      enhancedMonitoringService.on('workflowMetrics', (payload) => {
        this.handleExternalEvent('monitoring.workflow_metrics', payload, 'enhanced_monitoring');
      });
      enhancedMonitoringService.on('anomalies', (payload) => {
        this.handleExternalEvent('monitoring.anomalies', payload, 'enhanced_monitoring');
      });
      enhancedMonitoringService.on('recommendations', (payload) => {
        this.handleExternalEvent('monitoring.recommendations', payload, 'enhanced_monitoring');
      });
      enhancedMonitoringService.on('alert', (payload) => {
        this.handleExternalEvent('monitoring.alert', payload, 'enhanced_monitoring');
      });
    }

    if (dataFlowOptimizationService?.on) {
      dataFlowOptimizationService.on('performanceUpdate', (payload) => {
        this.handleExternalEvent('optimization.performance_update', payload, 'data_flow_optimization');
      });
    }

    logger.info('Orchestration manager event listeners registered');
  }

  async triggerOrchestration({
    msmeId,
    msmeData,
    transactions,
    documents,
    behaviorOverrides,
    contextOverrides,
    triggerSource = 'manual'
  }) {
    const startEvent = this.recordEvent({
      type: 'orchestration.triggered',
      source: triggerSource,
      msmeId,
      payload: { transactions, contextOverrides, behaviorOverrides },
      status: 'in_progress'
    });

    try {
      const result = await orchestrationManagerService.orchestrateEmissions({
        msmeId,
        msmeData,
        transactions,
        documents,
        behaviorOverrides,
        contextOverrides
      });

      this.updateEvent(startEvent.id, {
        status: 'completed',
        orchestrationId: result.orchestrationId
      });

      this.recordEvent({
        type: 'orchestration.completed',
        source: triggerSource,
        msmeId,
        payload: { orchestrationId: result.orchestrationId },
        status: 'completed'
      });

      return result;
    } catch (error) {
      this.updateEvent(startEvent.id, {
        status: 'failed',
        error: error.message
      });
      throw error;
    }
  }

  async triggerEmissionsReportingOrchestration({
    msmeId,
    period = 'annual',
    frameworks,
    transactions,
    documents,
    behaviorOverrides,
    contextOverrides,
    triggerSource = 'manual'
  }) {
    const startEvent = this.recordEvent({
      type: 'emissions_reporting.triggered',
      source: triggerSource,
      msmeId,
      payload: { period, frameworks },
      status: 'in_progress'
    });

    try {
      const result = await carbonEmissionsReportingOrchestrationService.orchestrate({
        msmeId,
        period,
        frameworks,
        transactions,
        documents,
        behaviorOverrides,
        contextOverrides,
        triggerSource
      });

      this.updateEvent(startEvent.id, {
        status: 'completed',
        orchestrationId: result.orchestrationId
      });

      this.recordEvent({
        type: 'emissions_reporting.completed',
        source: triggerSource,
        msmeId,
        payload: {
          orchestrationId: result.orchestrationId,
          frameworks: result.frameworks,
          overallReadinessScore: result.reporting?.overallReadinessScore
        },
        status: 'completed'
      });

      return result;
    } catch (error) {
      this.updateEvent(startEvent.id, {
        status: 'failed',
        error: error.message
      });
      throw error;
    }
  }

  async triggerWorkflow({ workflowId, msmeId, triggerData, triggerSource = 'manual' }) {
    const startEvent = this.recordEvent({
      type: 'workflow.triggered',
      source: triggerSource,
      msmeId,
      payload: { workflowId, triggerData },
      status: 'in_progress'
    });

    try {
      const execution = await aiAgentService.executeMultiAgentWorkflow(
        workflowId,
        msmeId,
        triggerData || {}
      );

      this.updateEvent(startEvent.id, {
        status: 'completed',
        workflowExecutions: [{
          workflowId,
          executionId: execution.executionId,
          status: execution.status
        }]
      });

      return execution;
    } catch (error) {
      this.updateEvent(startEvent.id, {
        status: 'failed',
        error: error.message
      });
      throw error;
    }
  }

  async emitEvent(eventType, payload = {}, source = 'manual') {
    return this.handleExternalEvent(eventType, payload, source);
  }

  async handleExternalEvent(eventType, payload = {}, source = 'external') {
    const event = this.recordEvent({
      type: eventType,
      source,
      msmeId: this.resolveMsmeId(payload),
      payload,
      status: 'received'
    });

    try {
      await this.triggerEventBasedWorkflows(eventType, payload, event.id);
      this.updateEvent(event.id, { status: 'processed' });
    } catch (error) {
      this.updateEvent(event.id, {
        status: 'failed',
        error: error.message
      });
    }

    this.emit('orchestrationEvent', event);
    return event;
  }

  getRecentEvents(limit = 20) {
    return this.eventLog.slice(0, limit);
  }

  recordEvent({ type, source, msmeId, payload, status }) {
    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      source,
      msmeId,
      status,
      triggeredAt: new Date().toISOString(),
      payloadSummary: this.summarizePayload(payload),
      workflowExecutions: [],
      orchestrationId: null
    };

    this.eventLog.unshift(event);
    if (this.eventLog.length > this.maxEvents) {
      this.eventLog.pop();
    }

    return event;
  }

  updateEvent(eventId, updates) {
    const event = this.eventLog.find(item => item.id === eventId);
    if (event) {
      Object.assign(event, updates);
    }
  }

  summarizePayload(payload) {
    if (!payload) return null;
    const summary = {};

    if (payload.transactions) {
      const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];
      summary.transactions = {
        count: transactions.length,
        categories: [...new Set(transactions.map(txn => txn.category).filter(Boolean))].slice(0, 5)
      };
    }

    if (payload.transaction) {
      summary.transaction = {
        category: payload.transaction.category,
        amount: payload.transaction.amount,
        date: payload.transaction.date
      };
    }

    if (payload.carbonData) {
      summary.carbonData = {
        totalCO2Emissions: payload.carbonData.totalCO2Emissions || payload.carbonData.totalEmissions,
        categories: payload.carbonData.categoryBreakdown
          ? Object.keys(payload.carbonData.categoryBreakdown).slice(0, 5)
          : []
      };
    }

    if (payload.alerts) {
      summary.alerts = {
        count: Array.isArray(payload.alerts) ? payload.alerts.length : 1,
        severities: Array.isArray(payload.alerts)
          ? [...new Set(payload.alerts.map(alert => alert.severity).filter(Boolean))]
          : [payload.alerts.severity].filter(Boolean)
      };
    }

    if (payload.workflowId) {
      summary.workflowId = payload.workflowId;
    }

    return summary;
  }

  resolveMsmeId(payload) {
    if (!payload) return null;
    return payload.msmeId || payload.msme?.id || payload.msme?._id || null;
  }

  async triggerEventBasedWorkflows(eventType, payload, eventId) {
    const workflows = await AIWorkflow.find({
      'trigger.type': 'event_based',
      'trigger.events': eventType,
      status: 'active',
      isActive: true
    }).lean();

    if (!workflows.length) {
      return [];
    }

    const msmeId = this.resolveMsmeId(payload);
    if (!msmeId) {
      this.updateEvent(eventId, {
        status: 'skipped',
        error: 'MSME ID missing for event-based workflow trigger'
      });
      return [];
    }

    const executions = [];
    for (const workflow of workflows) {
      try {
        const execution = await aiAgentService.executeMultiAgentWorkflow(
          workflow._id,
          msmeId,
          payload || {}
        );
        executions.push({
          workflowId: workflow._id,
          executionId: execution.executionId,
          status: execution.status
        });
      } catch (error) {
        executions.push({
          workflowId: workflow._id,
          status: 'failed',
          error: error.message
        });
      }
    }

    this.updateEvent(eventId, { workflowExecutions: executions });
    return executions;
  }
}

module.exports = new OrchestrationManagerEventService();
