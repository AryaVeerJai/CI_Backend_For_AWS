const crypto = require('crypto');
const UserPrivacySettings = require('../models/UserPrivacySettings');
const ComplianceHubRecord = require('../models/ComplianceHubRecord');
const { loadMsmeReportingContext } = require('./complianceHubService');
const isoGapClosureService = require('./isoGapClosureService');
const isoCertificationAutomationService = require('./isoCertificationAutomationService');
const orchestrationRuntimeService = require('./orchestrationRuntimeService');
const logger = require('../utils/logger');

const { VALID_SIGNUP_GOALS } = require('../constants/msmeSignupGoals');

const ADVISORY_AGENT_TYPES = [
  'inventory_quality_advisor',
  'environmental_kpi_advisor',
  'buyer_request_advisor',
  'dpdp_privacy_advisor',
  'msme_goal_advisor'
];

class MsmeAdvisoryOrchestrationService {
  /**
   * Run multi-agent MSME advisory via orchestrationRuntimeService.
   */
  async runAdvisory({
    msmeId,
    userId,
    signupGoal = 'baseline_footprint',
    period = 'annual',
    includeAuditPack = false,
    processingFlags = {}
  }) {
    if (!msmeId) {
      throw new Error('MSME ID is required for advisory orchestration');
    }

    const normalizedGoal = VALID_SIGNUP_GOALS.has(signupGoal)
      ? signupGoal
      : 'baseline_footprint';

    const advisoryId = `adv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const context = await loadMsmeReportingContext(msmeId, period);

    if (!context?.msme) {
      throw new Error('MSME profile not found for advisory orchestration');
    }

    const msmeData = context.msme;
    const transactions = context.transactions || [];
    const documents = context.bills || [];
    const latestAssessment = context.latestAssessment || null;
    const hasAssessment = Boolean(latestAssessment);

    const hubRecord = await ComplianceHubRecord.findOne({ msmeId }).lean();
    const privacySettings = userId
      ? await UserPrivacySettings.findOne({ userId }).lean()
      : null;

    const totalEmissionsKg = Number(
      latestAssessment?.totalCO2Emissions
      || latestAssessment?.totalEmissions
      || latestAssessment?.carbonFootprint?.totalCO2
      || context.totalKg
      || 0
    );

    const dataQuality = {
      score: this.estimateDataCompleteness({
        msmeData,
        transactionCount: transactions.length,
        documentCount: documents.length,
        hasAssessment,
        totalEmissionsKg
      }),
      hasScopeBreakdown: Boolean(latestAssessment?.esgScopes || latestAssessment?.scopeBreakdown),
      confidence: transactions.length >= 10 ? 0.75 : transactions.length >= 3 ? 0.55 : 0.35
    };

    const gapClosureChecklist = isoGapClosureService.buildIsoGapClosureChecklist({
      msmeData,
      transactions,
      documents,
      dataQuality
    });

    const advisoryState = {
      msmeData,
      transactions,
      documents,
      dataQuality,
      gapClosureChecklist,
      hubRecord,
      privacySettings,
      processingFlags,
      normalizedGoal,
      totalEmissionsKg,
      auditPackaging: null,
      inventoryQuality: null,
      environmentalKpi: null,
      buyerAdvisory: null,
      dpdpAdvisory: null
    };

    if (includeAuditPack && transactions.length > 0) {
      try {
        const automation = await isoCertificationAutomationService.automateCertification({
          msmeId,
          msmeData,
          transactions,
          documents
        });
        advisoryState.auditPackaging = automation.outputs?.auditPackaging || null;
      } catch (error) {
        logger.warn('Audit pack generation skipped during MSME advisory', {
          msmeId,
          message: error.message
        });
      }
    }

    const runtimeResults = [];
    const startedAt = Date.now();

    const foundationResults = await orchestrationRuntimeService.executeRegisteredAgentTasks([
      {
        type: 'inventory_quality_advisor',
        input: this.buildAgentInput('inventory_quality_advisor', advisoryState)
      },
      {
        type: 'environmental_kpi_advisor',
        input: this.buildAgentInput('environmental_kpi_advisor', advisoryState)
      }
    ], { mode: 'parallel', continueOnError: false });

    runtimeResults.push(...foundationResults);
    advisoryState.inventoryQuality = this.requireAgentResult(foundationResults, 'inventory_quality_advisor');
    advisoryState.environmentalKpi = this.requireAgentResult(foundationResults, 'environmental_kpi_advisor');

    const midResults = await orchestrationRuntimeService.executeRegisteredAgentTasks([
      {
        type: 'buyer_request_advisor',
        input: this.buildAgentInput('buyer_request_advisor', advisoryState)
      },
      {
        type: 'dpdp_privacy_advisor',
        input: this.buildAgentInput('dpdp_privacy_advisor', advisoryState)
      }
    ], { mode: 'parallel', continueOnError: false });

    runtimeResults.push(...midResults);
    advisoryState.buyerAdvisory = this.requireAgentResult(midResults, 'buyer_request_advisor');
    advisoryState.dpdpAdvisory = this.requireAgentResult(midResults, 'dpdp_privacy_advisor');

    const goalResults = await orchestrationRuntimeService.executeRegisteredAgentTasks([
      {
        type: 'msme_goal_advisor',
        input: this.buildAgentInput('msme_goal_advisor', advisoryState)
      }
    ], { continueOnError: false });

    runtimeResults.push(...goalResults);
    const goalAdvisory = this.requireAgentResult(goalResults, 'msme_goal_advisor');

    const agentPipeline = this.formatAgentPipeline(runtimeResults, startedAt);
    const { inventoryQuality, environmentalKpi, buyerAdvisory, dpdpAdvisory } = advisoryState;

    const trustPanel = {
      dataCompletenessScore: inventoryQuality.dataCompletenessScore,
      inventoryQualityScore: inventoryQuality.inventoryQualityScore,
      inventoryQualityLevel: inventoryQuality.level,
      uncertaintyNote: inventoryQuality.combinedUncertaintyNote,
      activitySharePct: inventoryQuality.activitySharePct,
      period,
      generatedAt: new Date().toISOString()
    };

    return {
      advisoryId,
      msmeId: msmeId.toString(),
      signupGoal: normalizedGoal,
      period,
      trustPanel,
      agentPipeline,
      outputs: {
        inventoryQuality,
        environmentalKpi,
        buyerAdvisory,
        dpdpAdvisory,
        goalAdvisory,
        auditPackaging: advisoryState.auditPackaging
      },
      nextBestAction: goalAdvisory.prioritizedActions?.[0] || null
    };
  }

  buildAgentInput(agentType, state) {
    switch (agentType) {
      case 'inventory_quality_advisor':
        return {
          msmeData: state.msmeData,
          transactions: state.transactions,
          dataQuality: state.dataQuality,
          gapClosureChecklist: state.gapClosureChecklist
        };
      case 'environmental_kpi_advisor':
        return { msmeData: state.msmeData, transactions: state.transactions };
      case 'buyer_request_advisor':
        return {
          supplierQuestionnaires: state.hubRecord?.supplierQuestionnaires || [],
          documentCount: state.documents.length,
          totalEmissionsKg: state.totalEmissionsKg,
          inventoryQuality: state.inventoryQuality,
          auditPackaging: state.auditPackaging
        };
      case 'dpdp_privacy_advisor':
        return {
          privacySettings: state.privacySettings || {},
          processingFlags: state.processingFlags
        };
      case 'msme_goal_advisor':
        return {
          signupGoal: state.normalizedGoal,
          inventoryQuality: state.inventoryQuality,
          buyerAdvisory: state.buyerAdvisory,
          environmentalKpi: state.environmentalKpi,
          dpdpAdvisory: state.dpdpAdvisory,
          dataCompletenessScore: state.inventoryQuality?.dataCompletenessScore
        };
      default:
        return {};
    }
  }

  requireAgentResult(results, agentType) {
    const entry = results.find((r) => r.agent === agentType);
    if (!entry || entry.status !== 'completed') {
      throw new Error(`MSME advisory agent failed: ${agentType}`);
    }
    return entry.result;
  }

  formatAgentPipeline(runtimeResults, pipelineStartedAt) {
    return runtimeResults
      .filter((r) => ADVISORY_AGENT_TYPES.includes(r.agent))
      .map((r) => ({
        agentType: r.agent,
        status: r.status === 'completed' ? 'completed' : 'failed',
        durationMs: Date.now() - pipelineStartedAt,
        error: r.error || undefined,
        completedAt: new Date().toISOString()
      }));
  }

  estimateDataCompleteness({
    msmeData,
    transactionCount,
    documentCount,
    hasAssessment,
    totalEmissionsKg
  }) {
    let score = 0;
    if (msmeData?.companyName) score += 20;
    if (transactionCount > 0) score += 25;
    if (documentCount > 0) score += 20;
    if (hasAssessment && totalEmissionsKg > 0) score += 35;
    return Math.min(100, score);
  }

  /** Invoke via AI agent service registry when agents are registered in DB. */
  async runAdvisoryViaAgentService(taskInput) {
    return this.runAdvisory(taskInput);
  }
}

const service = new MsmeAdvisoryOrchestrationService();

module.exports = service;
module.exports.MsmeAdvisoryOrchestrationService = MsmeAdvisoryOrchestrationService;
module.exports.VALID_SIGNUP_GOALS = VALID_SIGNUP_GOALS;
