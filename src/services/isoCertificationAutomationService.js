const MSME = require('../models/MSME');
const aiAgentService = require('./aiAgentService');
const msmeEmissionsOrchestrationService = require('./msmeEmissionsOrchestrationService');
const isoGapClosureService = require('./isoGapClosureService');

class IsoCertificationAutomationService {
  async automateCertification({
    msmeId,
    msmeData,
    transactions = [],
    documents = [],
    behaviorOverrides = {},
    contextOverrides = {},
    frameworks = {}
  }) {
    if (!Array.isArray(transactions) || transactions.length === 0) {
      throw new Error('Transactions data is required for ISO certification automation');
    }

    const resolvedMsmeId = msmeId || msmeData?._id;
    let resolvedMsmeData = msmeData;
    if (!resolvedMsmeData && resolvedMsmeId) {
      resolvedMsmeData = await MSME.findById(resolvedMsmeId).lean();
    }
    if (!resolvedMsmeData) {
      throw new Error('MSME profile not found for ISO certification automation');
    }

    const mergedContextOverrides = {
      ...(contextOverrides || {}),
      frameworks: {
        ...(contextOverrides?.frameworks || {}),
        ...(frameworks || {})
      }
    };

    const orchestration = await msmeEmissionsOrchestrationService.orchestrateEmissions({
      msmeId: resolvedMsmeId || resolvedMsmeData?._id?.toString(),
      msmeData: resolvedMsmeData,
      transactions,
      documents,
      behaviorOverrides,
      contextOverrides: mergedContextOverrides
    });

    const complianceResult = orchestration?.agentOutputs?.compliance
      || await aiAgentService.complianceMonitorAgent({
        input: {
          msmeData: resolvedMsmeData,
          transactions,
          documents,
          carbonData: orchestration?.agentOutputs?.carbonAnalysis,
          knownParameters: orchestration?.context?.knownParameters,
          unknownParameters: orchestration?.context?.unknownParameters,
          dataQuality: orchestration?.context?.dataQuality,
          processMachineryProfile: orchestration?.processMachineryProfile,
          context: orchestration?.context || {},
          frameworks: mergedContextOverrides.frameworks
        }
      });

    const gapClosureChecklist = complianceResult?.gapClosureChecklist
      || isoGapClosureService.buildIsoGapClosureChecklist({
        msmeData: resolvedMsmeData,
        transactions,
        documents,
        dataQuality: orchestration?.context?.dataQuality,
        knownParameters: orchestration?.context?.knownParameters,
        frameworks: mergedContextOverrides.frameworks,
        context: orchestration?.context || {}
      });

    const evidenceCollection = await aiAgentService.isoEvidenceCollectorAgent({
      input: {
        msmeData: resolvedMsmeData,
        transactions,
        documents,
        gapClosureChecklist,
        factorRegistry: gapClosureChecklist?.factorRegistry || [],
        context: orchestration?.context || {}
      }
    });

    const gapClosurePlan = await aiAgentService.isoGapClosurePlannerAgent({
      input: {
        msmeData: resolvedMsmeData,
        gapClosureChecklist,
        context: orchestration?.context || {}
      }
    });

    const auditPackaging = await aiAgentService.isoAuditPackagerAgent({
      input: {
        msmeData: resolvedMsmeData,
        gapClosureChecklist,
        evidenceRegister: evidenceCollection?.evidenceRegister || {},
        actionPlan: gapClosurePlan?.actionPlan || []
      }
    });

    return {
      orchestrationId: orchestration.orchestrationId,
      msmeId: orchestration.msmeId || resolvedMsmeId || resolvedMsmeData?._id?.toString(),
      readinessScore: complianceResult?.readinessScore || gapClosureChecklist?.overallReadinessScore || 0,
      complianceStatus: complianceResult?.status || 'non_compliant',
      certificationStatus: auditPackaging?.certificationStatus || 'gap_closure_required',
      granularAgentPipeline: orchestration.granularAgentPipeline || [],
      userClarificationRequests: orchestration.userClarificationRequests || [],
      userClarificationSummary: orchestration.userClarificationSummary || {
        total: 0,
        important: 0,
        recommended: 0
      },
      outputs: {
        compliance: complianceResult,
        gapClosureChecklist,
        evidenceCollection,
        gapClosurePlan,
        auditPackaging
      }
    };
  }
}

module.exports = new IsoCertificationAutomationService();
