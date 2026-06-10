const MSME = require('../models/MSME');
const Transaction = require('../models/Transaction');
const Document = require('../models/Document');
const CarbonAssessment = require('../models/CarbonAssessment');
const carbonCalculationService = require('./carbonCalculationService');
const carbonCreditsService = require('./carbonCreditsService');
const orchestrationManagerEventService = require('./orchestrationManagerEventService');
const aiAgentService = require('./aiAgentService');
const msmeEmissionsCuratedExecutor = require('./msmeEmissionsCuratedExecutor');
const { buildBRSRReport } = require('./brsrReportingService');
const { buildIsoGapClosureChecklist } = require('./isoGapClosureService');
const { aggregateInventoryMetadata } = require('../../../shared/carbonEmissionAnalytics');
const logger = require('../utils/logger');

const SUPPORTED_FRAMEWORKS = ['BRSR', 'ISO14064', 'ISO14067', 'CBAM'];

const { getDateRangeFromPeriod } = require('../utils/reportingPeriod');

const safeRound = (value, decimals = 2) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
};

const normalizeFrameworkList = (frameworks) => {
  if (!Array.isArray(frameworks) || frameworks.length === 0) {
    return ['BRSR', 'ISO14064'];
  }
  return frameworks
    .map(item => String(item || '').toUpperCase().replace(/[-\s]/g, ''))
    .filter(item => SUPPORTED_FRAMEWORKS.includes(item));
};

const buildReportingAgentCatalog = (frameworks = []) => {
  const catalog = {
    BRSR: [
      { agent: 'carbon_analyzer', role: 'Scope and category emissions for BRSR Principle 6' },
      { agent: 'compliance_monitor', role: 'BRSR mandatory field readiness' },
      { agent: 'report_generator', role: 'BRSR narrative and disclosure sections' }
    ],
    ISO14064: [
      { agent: 'compliance_monitor', role: 'ISO 14064 inventory controls' },
      { agent: 'iso_evidence_collector', role: 'Evidence pack compilation' },
      { agent: 'iso_gap_closure_planner', role: 'Gap closure prioritization' }
    ],
    ISO14067: [
      { agent: 'compliance_monitor', role: 'Product carbon footprint controls' },
      { agent: 'iso_audit_packager', role: 'Audit-grade boundary evidence' },
      { agent: 'process_machinery_profiler', role: 'Process LCI context' }
    ],
    CBAM: [
      { agent: 'carbon_analyzer', role: 'Embedded emissions for CBAM goods' },
      { agent: 'compliance_monitor', role: 'CBAM documentation readiness' },
      { agent: 'report_generator', role: 'Quarterly CBAM output structure' }
    ]
  };

  return frameworks.flatMap(framework => (
    (catalog[framework] || []).map(entry => ({ ...entry, framework, status: 'active' }))
  ));
};

const buildAssessmentFromCarbonAnalysis = ({
  carbonAnalysis,
  msme,
  transactions,
  periodRange
}) => {
  if (!carbonAnalysis || carbonAnalysis.error) {
    return {
      period: periodRange,
      totalCO2Emissions: 0,
      breakdown: {}
    };
  }

  const categoryBreakdown = carbonAnalysis.categoryBreakdown || {};
  const inventoryMetadata = aggregateInventoryMetadata(transactions, {
    organizationalBoundary: {
      entityName: msme?.companyName || msme?.businessName || null
    },
    documentCount: Array.isArray(transactions) ? transactions.length : 0
  });

  const scopeFromTransactions = inventoryMetadata.scopeTotals || {};
  const scope1 = safeRound(scopeFromTransactions.scope1 ?? (
    (categoryBreakdown.fuel || 0)
      + (categoryBreakdown.diesel || 0)
      + (categoryBreakdown.petrol || 0)
      + (categoryBreakdown.gas || 0)
      + (categoryBreakdown.lpg || 0)
      + (categoryBreakdown.natural_gas || 0)
      + (categoryBreakdown.coal || 0)
  ));
  const scope2 = safeRound(
    scopeFromTransactions.scope2LocationBased
    ?? scopeFromTransactions.scope2
    ?? ((categoryBreakdown.energy || 0) + (categoryBreakdown.electricity || 0))
  );
  const scope3 = safeRound(
    scopeFromTransactions.scope3
    ?? Math.max(0, safeRound(carbonAnalysis.totalEmissions) - scope1 - scope2)
  );

  return {
    period: periodRange,
    totalCO2Emissions: safeRound(carbonAnalysis.totalEmissions || scopeFromTransactions.grossTotal),
    breakdown: {
      scopes: {
        scope1,
        scope2,
        scope2LocationBased: scope2,
        scope2MarketBased: safeRound(inventoryMetadata.scope2DualReporting?.marketBasedKg ?? scope2),
        scope3
      },
      scope3GhgCategories: inventoryMetadata.scope3ByCategory || [],
      categoryBreakdown
    },
    inventoryMetadata,
    transactionCount: transactions.length,
    methodology: inventoryMetadata.methodology || 'agent_orchestrated_transaction_proxy',
    msmeId: msme?._id
  };
};

class CarbonEmissionsReportingOrchestrationService {
  async loadOperationalData(msmeId, period, providedTransactions, providedDocuments) {
    const { startDate, endDate } = getDateRangeFromPeriod(period);
    const periodRange = { startDate, endDate };

    const [msme, transactions, documents, assessments] = await Promise.all([
      MSME.findById(msmeId).lean(),
      Array.isArray(providedTransactions) && providedTransactions.length > 0
        ? Promise.resolve(providedTransactions)
        : Transaction.find({
          msmeId,
          date: { $gte: startDate, $lte: endDate },
          isSpam: { $ne: true },
          isDuplicate: { $ne: true }
        }).lean(),
      Array.isArray(providedDocuments)
        ? Promise.resolve(providedDocuments)
        : Document.find({
          msmeId,
          status: 'processed',
          'duplicateDetection.isDuplicate': { $ne: true }
        })
          .sort({ updatedAt: -1 })
          .limit(50)
          .lean(),
      CarbonAssessment.find({
        msmeId,
        $or: [
          { 'period.endDate': { $gte: startDate, $lte: endDate } },
          { createdAt: { $gte: startDate, $lte: endDate } }
        ]
      })
        .sort({ 'period.endDate': -1, createdAt: -1 })
        .limit(8)
        .lean()
    ]);

    if (!msme) {
      throw new Error('MSME profile not found for emissions and reporting orchestration');
    }

    if (!Array.isArray(transactions) || transactions.length === 0) {
      throw new Error('Transactions are required for emissions and reporting orchestration');
    }

    return {
      msme,
      transactions,
      documents,
      assessments,
      periodRange,
      bills: await Document.find({
        msmeId,
        documentType: 'bill',
        createdAt: { $gte: startDate, $lte: endDate }
      })
        .sort({ createdAt: -1 })
        .select('_id fileName originalName documentType status createdAt extractedData.amount')
        .lean()
    };
  }

  async runReportingAgentPipeline({
    frameworks,
    emissionsOrchestration,
    msme,
    transactions,
    documents,
    assessments,
    periodRange
  }) {
    const carbonAnalysis = emissionsOrchestration?.agentOutputs?.carbonAnalysis || {};
    const context = emissionsOrchestration?.context || {};
    const complianceInput = {
      carbonData: carbonAnalysis,
      transactions,
      documents,
      msmeData: msme,
      assessments,
      frameworks: context.frameworks,
      context,
      knownParameters: context.knownParameters,
      unknownParameters: context.unknownParameters,
      dataQuality: context.dataQuality,
      regulations: msme?.complianceProfile || {}
    };

    const agentOutputs = {};
    const stages = [];

    const runStage = async (stage, agentType, runner) => {
      stages.push({ stage, agent: agentType, status: 'in_progress', startedAt: new Date().toISOString() });
      try {
        const output = await runner();
        agentOutputs[agentType] = output;
        stages[stages.length - 1].status = 'completed';
        stages[stages.length - 1].completedAt = new Date().toISOString();
        return output;
      } catch (error) {
        stages[stages.length - 1].status = 'failed';
        stages[stages.length - 1].error = error.message;
        logger.warn(`Reporting agent stage failed (${agentType}):`, error.message);
        return null;
      }
    };

    await runStage('compliance_monitoring', 'compliance_monitor', () => (
      aiAgentService.complianceMonitorAgent({ input: complianceInput })
    ));

    if (frameworks.includes('ISO14064') || frameworks.includes('ISO14067')) {
      const gapClosureChecklist = buildIsoGapClosureChecklist({
        ...complianceInput,
        gapClosureChecklist: agentOutputs.compliance_monitor?.gapClosureChecklist
      });

      await runStage('iso_evidence_collection', 'iso_evidence_collector', () => (
        aiAgentService.isoEvidenceCollectorAgent({
          input: { ...complianceInput, gapClosureChecklist }
        })
      ));

      await runStage('iso_gap_closure_planning', 'iso_gap_closure_planner', () => (
        aiAgentService.isoGapClosurePlannerAgent({
          input: { ...complianceInput, gapClosureChecklist }
        })
      ));

      if (frameworks.includes('ISO14067')) {
        await runStage('iso_audit_packaging', 'iso_audit_packager', () => (
          aiAgentService.isoAuditPackagerAgent({
            input: { ...complianceInput, gapClosureChecklist }
          })
        ));
      }
    }

    await runStage('report_generation', 'report_generator', () => (
      aiAgentService.reportGeneratorAgent(
        msmeEmissionsCuratedExecutor.buildReportGeneratorTask({
          analysisContext: {
            carbonData: carbonAnalysis,
            context,
            knownParameters: context.knownParameters,
            unknownParameters: context.unknownParameters,
            orchestrationOptions: context.orchestrationOptions
          },
          parallelResults: {
            trend_analyzer: { trends: emissionsOrchestration?.agentOutputs?.trends?.trends }
          },
          recommendations: emissionsOrchestration?.agentOutputs?.recommendations,
          extras: {
            compliance: agentOutputs.compliance_monitor,
            behaviorProfiles: emissionsOrchestration?.behaviorProfiles,
            reportingFrameworks: frameworks,
            emissionsSummary: emissionsOrchestration?.emissionsSummary,
            period: periodRange
          }
        })
      )
    ));

    return {
      agentOutputs,
      stages,
      agentCatalog: buildReportingAgentCatalog(frameworks)
    };
  }

  async buildFrameworkReports({
    frameworks,
    msme,
    transactions,
    assessments,
    bills,
    period,
    emissionsOrchestration
  }) {
    const carbonAnalysis = emissionsOrchestration?.agentOutputs?.carbonAnalysis;
    const periodRange = emissionsOrchestration?.context?.periodRange
      || getDateRangeFromPeriod(period);
    const agentDerivedAssessment = buildAssessmentFromCarbonAnalysis({
      carbonAnalysis,
      msme,
      transactions,
      periodRange
    });
    const latestAssessment = assessments[0] || agentDerivedAssessment;

    const reports = {};
    const readiness = {};

    if (frameworks.includes('BRSR')) {
      let carbonCreditsAccount = null;
      let carbonCreditsSummary = {};
      try {
        carbonCreditsAccount = await carbonCreditsService.getMSMECredits(msme._id);
        carbonCreditsSummary = carbonCreditsService.getCreditSummary(carbonCreditsAccount);
      } catch (error) {
        carbonCreditsAccount = null;
        carbonCreditsSummary = {};
      }

      const brsrReport = buildBRSRReport({
        msme,
        assessment: latestAssessment,
        assessmentHistory: assessments.slice(1, 8),
        transactions,
        billAnnexure: bills,
        carbonCreditsSummary,
        carbonCreditsAccount,
        requestedPeriod: period
      });

      reports.BRSR = brsrReport;
      readiness.BRSR = {
        status: brsrReport?.brsrComplianceSummary?.overallStatus
          || (brsrReport?.brsrComplianceSummary?.disclosurePrepReady
            ?? brsrReport?.brsrComplianceSummary?.isBRSRCompliant
            ? 'aligned'
            : 'needs_improvement'),
        score: brsrReport?.brsrComplianceSummary?.readinessScore
          ?? brsrReport?.brsrComplianceSummary?.disclosureReadinessPercent
          ?? null,
        openGaps: Array.isArray(brsrReport?.brsrComplianceSummary?.openGaps)
          ? brsrReport.brsrComplianceSummary.openGaps.length
          : (brsrReport?.brsrComplianceSummary?.mandatoryFieldGaps?.length || 0)
      };
    }

    if (frameworks.includes('ISO14064') || frameworks.includes('ISO14067')) {
      const gapChecklist = buildIsoGapClosureChecklist({
        msmeData: msme,
        transactions,
        assessments,
        frameworks: emissionsOrchestration?.context?.frameworks,
        carbonData: carbonAnalysis
      });
      reports.isoGapClosure = gapChecklist;
      readiness.ISO14064 = {
        status: gapChecklist.overallReadinessScore >= 75 ? 'ready' : 'gap_closure_required',
        score: gapChecklist.overallReadinessScore,
        openGaps: Array.isArray(gapChecklist.openGaps) ? gapChecklist.openGaps.length : 0
      };
      if (frameworks.includes('ISO14067')) {
        readiness.ISO14067 = { ...readiness.ISO14064 };
      }
    }

    if (frameworks.includes('CBAM')) {
      const isExporter = Boolean(
        msme?.business?.exportMarkets?.length
        || msme?.complianceProfile?.cbamApplicable
      );
      readiness.CBAM = {
        status: isExporter ? 'monitoring' : 'not_required',
        score: isExporter ? 65 : 100,
        notes: isExporter
          ? 'CBAM agent pipeline prepared embedded-emissions evidence.'
          : 'CBAM reporting not required for current MSME export profile.'
      };
      reports.CBAM = {
        applicable: isExporter,
        embeddedEmissionsKg: safeRound(carbonAnalysis?.totalEmissions || latestAssessment?.totalCO2Emissions),
        generatedAt: new Date().toISOString()
      };
    }

    return { reports, readiness, latestAssessment };
  }

  async orchestrate({
    msmeId,
    period = 'annual',
    frameworks,
    transactions,
    documents,
    behaviorOverrides,
    contextOverrides,
    triggerSource = 'emissions_reporting_orchestrator'
  }) {
    const normalizedFrameworks = normalizeFrameworkList(frameworks);
    const operationalData = await this.loadOperationalData(
      msmeId,
      period,
      transactions,
      documents
    );

    const emissionsOrchestration = await orchestrationManagerEventService.triggerOrchestration({
      msmeId,
      msmeData: operationalData.msme,
      transactions: operationalData.transactions,
      documents: operationalData.documents,
      behaviorOverrides,
      contextOverrides: {
        ...(contextOverrides || {}),
        orchestrationOptions: {
          ...(contextOverrides?.orchestrationOptions || {}),
          orchestration: {
            ...(contextOverrides?.orchestrationOptions?.orchestration || {}),
            emitReport: true,
            emitRecommendations: true
          }
        },
        reportingFrameworks: normalizedFrameworks,
        period: operationalData.periodRange
      },
      triggerSource
    });

    const reportingPipeline = await this.runReportingAgentPipeline({
      frameworks: normalizedFrameworks,
      emissionsOrchestration,
      msme: operationalData.msme,
      transactions: operationalData.transactions,
      documents: operationalData.documents,
      assessments: operationalData.assessments,
      periodRange: operationalData.periodRange
    });

    const { reports, readiness, latestAssessment } = await this.buildFrameworkReports({
      frameworks: normalizedFrameworks,
      msme: operationalData.msme,
      transactions: operationalData.transactions,
      assessments: operationalData.assessments,
      bills: operationalData.bills,
      period,
      emissionsOrchestration
    });

    const compliance = reportingPipeline.agentOutputs.compliance_monitor || {};
    const overallReadinessScore = Object.values(readiness)
      .map(item => Number(item?.score))
      .filter(score => Number.isFinite(score))
      .reduce((sum, score, _, arr) => sum + score / arr.length, 0);

    return {
      orchestrationPattern: 'emissions_and_reporting_multi_agent',
      orchestrationId: emissionsOrchestration.orchestrationId,
      msmeId: String(msmeId),
      period,
      frameworks: normalizedFrameworks,
      generatedAt: new Date().toISOString(),
      emissions: {
        summary: emissionsOrchestration.emissionsSummary,
        valueChainReport: emissionsOrchestration.valueChainReport,
        agentOutputs: {
          carbonAnalysis: emissionsOrchestration.agentOutputs?.carbonAnalysis,
          recommendations: emissionsOrchestration.agentOutputs?.recommendations,
          anomalies: emissionsOrchestration.agentOutputs?.anomalies,
          trends: emissionsOrchestration.agentOutputs?.trends,
          compliance: emissionsOrchestration.agentOutputs?.compliance
        },
        assessment: latestAssessment,
        calculatedFootprint: await carbonCalculationService.calculateMSMECarbonFootprintAsync(
          operationalData.msme,
          operationalData.transactions
        ).catch(() => null)
      },
      reporting: {
        readiness,
        overallReadinessScore: safeRound(overallReadinessScore || compliance.readinessScore || 0, 1),
        complianceStatus: compliance.status || 'unknown',
        gapClosureChecklist: compliance.gapClosureChecklist || reports.isoGapClosure || null,
        agentCatalog: reportingPipeline.agentCatalog,
        agentPipeline: reportingPipeline.stages,
        agentOutputs: reportingPipeline.agentOutputs,
        narrativeReport: reportingPipeline.agentOutputs.report_generator || null,
        frameworkReports: reports
      },
      orchestrationPlan: emissionsOrchestration.orchestrationPlan,
      warnings: [
        ...(emissionsOrchestration.warnings || []),
        ...(compliance.issues?.length
          ? [{ message: 'Compliance gaps detected during reporting orchestration', issues: compliance.issues }]
          : [])
      ],
      userClarificationRequests: emissionsOrchestration.userClarificationRequests || [],
      interactions: emissionsOrchestration.interactions || []
    };
  }
}

module.exports = new CarbonEmissionsReportingOrchestrationService();
module.exports.CarbonEmissionsReportingOrchestrationService = CarbonEmissionsReportingOrchestrationService;
module.exports.SUPPORTED_FRAMEWORKS = SUPPORTED_FRAMEWORKS;
