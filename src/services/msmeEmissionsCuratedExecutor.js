const agentOrchestrationCuratorService = require('./agentOrchestrationCuratorService');

/**
 * Curator-driven execution helpers for MSME emissions orchestration.
 * Keeps msmeEmissionsOrchestrationService focused on context assembly and I/O.
 */
class MsmeEmissionsCuratedExecutor {
  planIncludesAgent(curatedPlan, agentType) {
    return agentOrchestrationCuratorService.planIncludesAgent(curatedPlan, agentType);
  }

  listPlannedAgents(curatedPlan) {
    return (curatedPlan?.stages || [])
      .filter((stage) => !stage.skipped)
      .flatMap((stage) => stage.agents || []);
  }

  shouldRunAgent(curatedPlan, agentType, { orchestrationOptions = {} } = {}) {
    if (!this.planIncludesAgent(curatedPlan, agentType)) {
      return false;
    }
    if (agentType === 'esg_analyzer' && orchestrationOptions.orchestration?.runEsgAnalysis === false) {
      return false;
    }
    return true;
  }

  shouldRunDocumentAnalyzer(documents = [], orchestrationOptions = {}) {
    const hasDocuments = Array.isArray(documents) && documents.length > 0;
    return hasDocuments || orchestrationOptions.orchestration?.skipDocumentAnalysisWhenEmpty === false;
  }

  buildSkippedDocumentAnalysis(documents = []) {
    return {
      skipped: true,
      reason: 'no_documents_available',
      derivedTransactions: [],
      summary: {
        totalDocuments: Array.isArray(documents) ? documents.length : 0,
        analyzedDocuments: 0
      }
    };
  }

  buildDocumentAnalyzerTask({ documents, msmeProfile, baseContext, coordinationPayload = {} }) {
    return {
      input: {
        documents,
        msmeData: msmeProfile,
        context: baseContext,
        ...coordinationPayload
      }
    };
  }

  shouldRunDataPrivacy(transactions = []) {
    return Array.isArray(transactions) && transactions.length > 0;
  }

  buildDataPrivacyTask({ transactions, msmeProfile, baseContext, coordinationPayload = {} }) {
    return {
      input: {
        transactions,
        msmeData: msmeProfile,
        context: baseContext,
        policyUpdates: baseContext?.policyUpdates,
        ...coordinationPayload
      }
    };
  }

  getPreProcessingStage(agentType) {
    const stages = {
      document_analyzer: 'document_analysis',
      data_privacy: 'data_privacy'
    };
    return stages[agentType] || null;
  }

  shouldRunRecommendationEngine(orchestrationPlan) {
    if (orchestrationPlan?.outputs?.recommendations === false) {
      return false;
    }
    return this.planIncludesAgent(orchestrationPlan, 'recommendation_engine');
  }

  shouldRunReportGenerator(orchestrationPlan) {
    if (orchestrationPlan?.outputs?.report === false) {
      return false;
    }
    return this.planIncludesAgent(orchestrationPlan, 'report_generator');
  }

  buildRecommendationEngineTask({
    analysisContext,
    parallelResults = {},
    processMachineryProfile,
    coordinationPayload = {}
  }) {
    const orchestrationOptions = analysisContext.orchestrationOptions || {};
    return {
      input: {
        carbonData: analysisContext.carbonData,
        transactions: analysisContext.transactions,
        msmeData: analysisContext.msmeData,
        trends: parallelResults.trend_analyzer?.trends,
        anomalies: parallelResults.anomaly_detector,
        compliance: parallelResults.compliance_monitor,
        optimization: parallelResults.optimization_advisor,
        behaviorProfiles: analysisContext.behaviorProfiles,
        context: analysisContext.context,
        knownParameters: analysisContext.knownParameters,
        unknownParameters: analysisContext.unknownParameters,
        dynamicParameters: analysisContext.dynamicParameters,
        transactionTypeContext: analysisContext.transactionTypeContext,
        processMachineryProfile,
        orchestrationOptions,
        ...coordinationPayload
      }
    };
  }

  buildReportGeneratorTask({
    analysisContext,
    parallelResults = {},
    recommendations = null,
    processMachineryProfile,
    coordinationPayload = {},
    extras = {}
  }) {
    const orchestrationOptions = analysisContext.orchestrationOptions || {};
    return {
      input: {
        carbonData: analysisContext.carbonData,
        trends: parallelResults.trend_analyzer?.trends,
        recommendations: recommendations?.recommendations || recommendations,
        behaviorProfiles: analysisContext.behaviorProfiles,
        context: analysisContext.context,
        knownParameters: analysisContext.knownParameters,
        unknownParameters: analysisContext.unknownParameters,
        dynamicParameters: analysisContext.dynamicParameters,
        transactionTypeContext: analysisContext.transactionTypeContext,
        processMachineryProfile,
        orchestrationOptions,
        ...extras,
        ...coordinationPayload
      }
    };
  }

  getPostProcessingStage(agentType) {
    const stages = {
      recommendation_engine: 'recommendation_generation',
      report_generator: 'report_generation'
    };
    return stages[agentType] || null;
  }

  buildEsgAnalyzerTask(analysisContext) {
    return {
      input: {
        msmeData: analysisContext.msmeData,
        transactions: analysisContext.transactions,
        smsData: analysisContext.smsData || [],
        carbonData: analysisContext.carbonData,
        context: analysisContext.context
      }
    };
  }

  buildAnomalyDetectorTask(analysisContext, coordinationPayload = {}) {
    const orchestrationOptions = analysisContext.orchestrationOptions || {};
    return {
      input: {
        transactions: analysisContext.transactions,
        carbonData: analysisContext.carbonData,
        behaviorProfiles: analysisContext.behaviorProfiles,
        context: analysisContext.context,
        unknownParameters: analysisContext.unknownParameters,
        dynamicParameters: analysisContext.dynamicParameters,
        transactionTypeContext: analysisContext.transactionTypeContext,
        dataQuality: analysisContext.dataQuality,
        orchestrationOptions,
        thresholds: orchestrationOptions.thresholds,
        ...coordinationPayload
      }
    };
  }

  buildTrendAnalyzerTask(analysisContext, coordinationPayload = {}) {
    const orchestrationOptions = analysisContext.orchestrationOptions || {};
    return {
      input: {
        data: {
          carbonData: analysisContext.carbonData,
          behaviorProfiles: analysisContext.behaviorProfiles,
          context: analysisContext.context,
          processMachineryProfile: analysisContext.processMachineryProfile,
          transactionStats: analysisContext.transactionStats,
          dataQuality: analysisContext.dataQuality,
          unknownParameters: analysisContext.unknownParameters,
          dynamicParameters: analysisContext.dynamicParameters,
          transactionTypeContext: analysisContext.transactionTypeContext
        },
        orchestrationOptions,
        ...coordinationPayload
      }
    };
  }

  buildComplianceMonitorTask(analysisContext, coordinationPayload = {}) {
    const orchestrationOptions = analysisContext.orchestrationOptions || {};
    return {
      input: {
        carbonData: analysisContext.carbonData,
        regulations: analysisContext.context.regulatoryContext,
        policyUpdates: analysisContext.policyUpdates,
        knownParameters: analysisContext.knownParameters,
        unknownParameters: analysisContext.unknownParameters,
        dynamicParameters: analysisContext.dynamicParameters,
        transactionTypeContext: analysisContext.transactionTypeContext,
        context: analysisContext.context,
        frameworks: analysisContext.context.frameworks,
        msmeData: analysisContext.msmeData,
        transactions: analysisContext.transactions,
        dataQuality: analysisContext.dataQuality,
        processMachineryProfile: analysisContext.processMachineryProfile,
        inventoryGovernance: analysisContext.inventoryGovernance,
        orchestrationOptions,
        ...coordinationPayload
      }
    };
  }

  buildOptimizationAdvisorTask(analysisContext, coordinationPayload = {}) {
    const orchestrationOptions = analysisContext.orchestrationOptions || {};
    return {
      input: {
        carbonData: analysisContext.carbonData,
        processes: analysisContext.context.processContext,
        knownParameters: analysisContext.knownParameters,
        unknownParameters: analysisContext.unknownParameters,
        dynamicParameters: analysisContext.dynamicParameters,
        transactionTypeContext: analysisContext.transactionTypeContext,
        context: analysisContext.context,
        processMachineryProfile: analysisContext.processMachineryProfile,
        orchestrationOptions,
        ...coordinationPayload
      }
    };
  }

  getParallelAgentStage(agentType) {
    const stages = {
      anomaly_detector: 'anomaly_detection',
      trend_analyzer: 'trend_analysis',
      compliance_monitor: 'compliance_check',
      optimization_advisor: 'optimization_advice'
    };
    return stages[agentType] || null;
  }

  buildParallelAgentTask(agentType, analysisContext, coordinationPayload = {}) {
    const builders = {
      anomaly_detector: () => this.buildAnomalyDetectorTask(analysisContext, coordinationPayload),
      trend_analyzer: () => this.buildTrendAnalyzerTask(analysisContext, coordinationPayload),
      compliance_monitor: () => this.buildComplianceMonitorTask(analysisContext, coordinationPayload),
      optimization_advisor: () => this.buildOptimizationAdvisorTask(analysisContext, coordinationPayload)
    };
    const build = builders[agentType];
    return build ? build() : null;
  }
}

module.exports = new MsmeEmissionsCuratedExecutor();
