const { handlers: standardHandlers } = require('./handlers/standardHandlers');
const sectorProfilerAgent = require('./sectorProfilerAgent');
const processMachineryProfilerAgent = require('./processMachineryProfilerAgent');
const verifiedKnowledgeRagService = require('../verifiedKnowledgeRagService');
const enterpriseComplianceAgent = require('./enterpriseComplianceAgent');
const brsrMandateAgent = require('./brsrMandateAgent');
const patIntensityAgent = require('./patIntensityAgent');
const boundaryEnforcerAgent = require('./boundaryEnforcerAgent');
const assuranceGateAgent = require('./assuranceGateAgent');
const factorRegistryAgent = require('./factorRegistryAgent');
const brsrScopeReconciliationAgent = require('./brsrScopeReconciliationAgent');
const inventoryQualityAdvisorAgent = require('./inventoryQualityAdvisorAgent');
const buyerRequestAdvisorAgent = require('./buyerRequestAdvisorAgent');
const msmeGoalAdvisorAgent = require('./msmeGoalAdvisorAgent');
const dpdpPrivacyAdvisorAgent = require('./dpdpPrivacyAdvisorAgent');
const environmentalKpiAdvisorAgent = require('./environmentalKpiAdvisorAgent');
const esgAnalyzerAgent = require('./esgAnalyzerAgent');

const buildProfilerHandler = (type, profiler) => async (task) => {
  const { input } = task || {};
  if (!input || !input.msmeData) {
    return { error: `Invalid input for ${type} profiler` };
  }
  return profiler.analyzeProfile(input);
};

const sectorProfilerHandler = buildProfilerHandler('sector', sectorProfilerAgent);
const processMachineryProfilerHandler = buildProfilerHandler('process/machinery', processMachineryProfilerAgent);
const verifiedKnowledgeRagHandler = async (task = {}) => {
  const { input = {} } = task;
  const items = Array.isArray(input.items) ? input.items : [];
  const result = verifiedKnowledgeRagService.classifyBatch(items, {
    businessDomain: input.businessDomain || 'other',
    transactionType: input.transactionType || 'other',
    parameterType: input.parameterType || 'transaction',
    location: input.location || ''
  });
  return {
    totalItems: items.length,
    resolvedItems: result.length,
    matches: result,
    verifiedSources: verifiedKnowledgeRagService.getVerifiedSources()
  };
};

const getHandler = (agentType) => {
  if (!agentType) return null;
  if (agentType === 'sector_profiler' || agentType.startsWith('sector_profiler_')) {
    return sectorProfilerHandler;
  }
  if (agentType === 'process_machinery_profiler' || agentType.startsWith('process_machinery_profiler_')) {
    return processMachineryProfilerHandler;
  }
  if (agentType === 'verified_source_rag' || agentType.startsWith('verified_source_rag_')) {
    return verifiedKnowledgeRagHandler;
  }
  if (agentType === 'enterprise_compliance' || agentType.startsWith('enterprise_compliance_')) {
    return (task) => enterpriseComplianceAgent.execute(task);
  }
  if (agentType === 'brsr_mandate' || agentType.startsWith('brsr_mandate_')) {
    return (task) => brsrMandateAgent.execute(task);
  }
  if (agentType === 'pat_intensity' || agentType.startsWith('pat_intensity_')) {
    return (task) => patIntensityAgent.execute(task);
  }
  if (agentType === 'boundary_enforcer' || agentType.startsWith('boundary_enforcer_')) {
    return (task) => boundaryEnforcerAgent.execute(task);
  }
  if (agentType === 'assurance_gate' || agentType.startsWith('assurance_gate_')) {
    return (task) => assuranceGateAgent.execute(task);
  }
  if (agentType === 'factor_registry' || agentType.startsWith('factor_registry_')) {
    return (task) => factorRegistryAgent.execute(task);
  }
  if (agentType === 'brsr_scope_reconciliation' || agentType.startsWith('brsr_scope_reconciliation_')) {
    return (task) => brsrScopeReconciliationAgent.execute(task);
  }
  if (agentType === 'inventory_governance' || agentType.startsWith('inventory_governance_')) {
    const orchestrator = require('../ghgInventoryGovernanceOrchestrator');
    return (task) => orchestrator.runGhgInventoryGovernanceOrchestration(task.input || task);
  }
  if (agentType === 'inventory_quality_advisor') {
    return (task) => inventoryQualityAdvisorAgent.execute(task);
  }
  if (agentType === 'buyer_request_advisor') {
    return (task) => buyerRequestAdvisorAgent.execute(task);
  }
  if (agentType === 'msme_goal_advisor') {
    return (task) => msmeGoalAdvisorAgent.execute(task);
  }
  if (agentType === 'dpdp_privacy_advisor') {
    return (task) => dpdpPrivacyAdvisorAgent.execute(task);
  }
  if (agentType === 'environmental_kpi_advisor') {
    return (task) => environmentalKpiAdvisorAgent.execute(task);
  }
  if (agentType === 'esg_analyzer' || agentType.startsWith('esg_analyzer_')) {
    return async (task) => {
      const { input = {} } = task;
      return esgAnalyzerAgent.analyzeESGMetrics(
        input.msmeData || input.msmeProfile,
        input.transactions || [],
        input.smsData || []
      );
    };
  }
  return standardHandlers[agentType];
};

const getSupportedTypes = () => [
  ...Object.keys(standardHandlers),
  'sector_profiler',
  'process_machinery_profiler',
  'verified_source_rag',
  'enterprise_compliance',
  'brsr_mandate',
  'pat_intensity',
  'boundary_enforcer',
  'assurance_gate',
  'factor_registry',
  'brsr_scope_reconciliation',
  'inventory_governance',
  'inventory_quality_advisor',
  'buyer_request_advisor',
  'msme_goal_advisor',
  'dpdp_privacy_advisor',
  'environmental_kpi_advisor',
  'esg_analyzer'
];

module.exports = {
  getHandler,
  getSupportedTypes
};
