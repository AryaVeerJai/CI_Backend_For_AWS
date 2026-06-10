const organizationalBoundaryAgent = require('./agents/organizationalBoundaryAgent');
const operationalBoundaryAgent = require('./agents/operationalBoundaryAgent');
const { normalizeGhgOperationalBoundary } = require('../utils/ghgBoundaryFields');

/**
 * Agentic GHG boundary orchestration: runs organizational and operational boundary
 * agents in parallel, then merges a coherent guidance object for UI and inventory design.
 */
const runGhgBoundaryAgentOrchestration = async ({
  msmeData = {},
  workflowSummary = {}
}) => {
  const [organizational, operational] = await Promise.all([
    Promise.resolve(organizationalBoundaryAgent.analyzeOrganizationalBoundary({ msmeData })),
    Promise.resolve(operationalBoundaryAgent.analyzeOperationalBoundary({ msmeData, workflowSummary }))
  ]);

  const mergedOperationalDraft = normalizeGhgOperationalBoundary(
    {
      scope1StationaryCombustion: operational.scope1Toggles?.scope1StationaryCombustion,
      scope1MobileCombustion: operational.scope1Toggles?.scope1MobileCombustion,
      scope1ProcessEmissions: operational.scope1Toggles?.scope1ProcessEmissions,
      scope1FugitiveEmissions: operational.scope1Toggles?.scope1FugitiveEmissions,
      scope2LocationBased: operational.scope2Toggles?.scope2LocationBased,
      scope2MarketBased: operational.scope2Toggles?.scope2MarketBased,
      scope3CategoriesIncluded: operational.suggestedScope3CategoriesIncluded,
      materialityThresholdPercent: operational.materialityThresholdPercent,
      operationalBoundaryDefinitionSummary: [
        'Operational boundary follows GHG Protocol Corporate Standard.',
        `Organizational approach signal: ${organizational.suggestedConsolidationApproach}.`
      ].join(' ')
    },
    {}
  );

  return {
    orchestrator: 'ghg_boundary_orchestrator',
    generatedAt: new Date().toISOString(),
    architecture: {
      pattern: 'parallel_specialists_with_merge',
      agents: ['organizational_boundary_agent', 'operational_boundary_agent']
    },
    organizational,
    operational,
    mergedOperationalDraft,
    narrative: [
      organizational.reportingEntityDescription,
      ...operational.notes
    ].filter(Boolean)
  };
};

module.exports = {
  runGhgBoundaryAgentOrchestration
};
