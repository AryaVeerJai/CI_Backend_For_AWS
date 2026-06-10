const enterpriseComplianceAgent = require('./agents/enterpriseComplianceAgent');
const brsrMandateAgent = require('./agents/brsrMandateAgent');
const patIntensityAgent = require('./agents/patIntensityAgent');
const agentOrchestrationCuratorService = require('./agentOrchestrationCuratorService');
const orchestrationRuntimeService = require('./orchestrationRuntimeService');
const { runGhgBoundaryAgentOrchestration } = require('./ghgBoundaryAgentOrchestrator');
const logger = require('../utils/logger');
const {
  ENTERPRISE_WORKFLOW_SECTIONS,
  buildInitialEnterpriseWorkflow
} = require('../constants/enterpriseWorkflowSections');

const buildInitialWorkflow = () => buildInitialEnterpriseWorkflow();

const ENTERPRISE_INSIGHT_AGENTS = [
  'carbon_analyzer',
  'recommendation_engine',
  'trend_analyzer',
  'anomaly_detector',
  'compliance_monitor',
  'report_generator',
  'verified_source_rag',
  'data_privacy'
];

const buildEnterpriseAgentInput = (agentType, enterpriseProfile, brsr) => {
  switch (agentType) {
    case 'carbon_analyzer':
      return { enterpriseProfile, framework: 'GHG_Protocol' };
    case 'recommendation_engine':
      return { enterpriseProfile, segment: 'enterprise' };
    case 'trend_analyzer':
      return { enterpriseProfile, horizonMonths: 12 };
    case 'anomaly_detector':
      return { enterpriseProfile, scope: 'facility_inventory' };
    case 'compliance_monitor':
      return { framework: 'BRSR', enterpriseProfile };
    case 'report_generator':
      return { framework: 'SEBI_BRSR', enterpriseProfile, brsr };
    case 'verified_source_rag':
      return {
        businessDomain: enterpriseProfile.industry,
        location: enterpriseProfile.contact?.address?.state
      };
    case 'data_privacy':
      return { scope: 'enterprise_inventory' };
    default:
      return { enterpriseProfile };
  }
};

const runEnterpriseAgentPipeline = async (enterpriseProfile) => {
  const compliance = await enterpriseComplianceAgent.execute({
    input: { enterpriseProfile }
  });
  const brsr = await brsrMandateAgent.execute({
    input: { enterpriseProfile }
  });
  const pat = await patIntensityAgent.execute({
    input: { enterpriseProfile }
  });

  let boundaryGuidance = null;
  try {
    boundaryGuidance = await runGhgBoundaryAgentOrchestration({
      msmeData: {
        companyName: enterpriseProfile.companyName,
        businessDomain: 'manufacturing',
        contact: enterpriseProfile.contact,
        business: {
          manufacturingWorkflow: {
            ghgOperationalBoundary: {
              consolidationApproach: enterpriseProfile.consolidationApproach,
              reportingEntityType: enterpriseProfile.reportingEntityType
            }
          }
        }
      }
    });
  } catch (error) {
    logger.warn('Enterprise boundary agent orchestration partial failure:', error.message);
  }

  const curatedPlan = agentOrchestrationCuratorService.buildCuratedPlan({
    pipelineId: 'enterprise',
    context: { enterpriseProfile, brsr }
  });

  const preExecutedStages = new Set(['enterprise', 'boundary']);
  const executionPlan = {
    ...curatedPlan,
    stages: curatedPlan.stages.filter((stageDef) => !preExecutedStages.has(stageDef.stage))
  };

  const curatedStageResults = await orchestrationRuntimeService.executeCuratedPlan(executionPlan, {
    continueOnError: true,
    buildTaskInput: (agentType) => buildEnterpriseAgentInput(agentType, enterpriseProfile, brsr)
  });

  const plannedAgents = new Set(
    executionPlan.stages.flatMap((stage) => (stage.skipped ? [] : stage.agents || []))
  );

  const supplementalTasks = ENTERPRISE_INSIGHT_AGENTS
    .filter((agentType) => !plannedAgents.has(agentType))
    .map((agentType) => ({
      type: agentType,
      input: buildEnterpriseAgentInput(agentType, enterpriseProfile, brsr)
    }));

  const supplementalResults = supplementalTasks.length > 0
    ? await orchestrationRuntimeService.executeRegisteredAgentTasks(supplementalTasks, {
      mode: 'sequential',
      continueOnError: true
    })
    : [];

  const orchestrationResults = [
    ...curatedStageResults.flatMap((stage) => stage.results || []),
    ...supplementalResults
  ];

  return {
    compliance,
    brsr,
    pat,
    boundaryGuidance,
    orchestrationResults,
    orchestrationPlan: {
      pipelineId: curatedPlan.pipelineId,
      pipelineName: curatedPlan.pipelineName,
      stages: curatedPlan.stages
    },
    summary: `Enterprise mandate assessment complete. ${compliance.applicableMandates?.length || 0} Indian regulatory tracks active. Readiness: ${compliance.readinessScore}%.`
  };
};

const markWorkflowProgress = (sections, completedKeys = []) => {
  const now = new Date();
  return sections.map((section) => {
    if (completedKeys.includes(section.key)) {
      return { ...section, status: 'completed', completedAt: now };
    }
    if (section.status === 'completed') {
      return section;
    }
    const firstPendingIdx = ENTERPRISE_WORKFLOW_SECTIONS.findIndex(
      (s) => !completedKeys.includes(s.key) && s.key === section.key
    );
    if (firstPendingIdx === 0 || completedKeys.length > 0) {
      const inProgressKey = ENTERPRISE_WORKFLOW_SECTIONS.find(
        (s) => !completedKeys.includes(s.key)
      )?.key;
      if (section.key === inProgressKey) {
        return { ...section, status: 'in_progress' };
      }
    }
    return section;
  });
};

module.exports = {
  ENTERPRISE_WORKFLOW_SECTIONS,
  buildInitialWorkflow,
  runEnterpriseAgentPipeline,
  markWorkflowProgress
};
