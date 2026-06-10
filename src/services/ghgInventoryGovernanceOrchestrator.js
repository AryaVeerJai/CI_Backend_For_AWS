const boundaryEnforcerAgent = require('./agents/boundaryEnforcerAgent');
const assuranceGateAgent = require('./agents/assuranceGateAgent');
const factorRegistryAgent = require('./agents/factorRegistryAgent');
const brsrScopeReconciliationAgent = require('./agents/brsrScopeReconciliationAgent');
const governanceService = require('./ghgInventoryGovernanceService');
const carbonCalculationService = require('./carbonCalculationService');
const logger = require('../utils/logger');

/**
 * Agentic GHG inventory governance orchestration.
 * Pattern: parallel specialists (factor registry + boundary) → carbon calc → assurance + BRSR reconcile → version + audit.
 */
const runGhgInventoryGovernanceOrchestration = async ({
  msmeData = {},
  transactions = [],
  reportingPeriod = {},
  orchestrationId = null,
  options = {}
}) => {
  const orchId = orchestrationId || `ghg-gov-${Date.now()}`;
  const msmeId = msmeData._id || msmeData.id;
  const organizationId = msmeData.organizationId;

  const [factorRegistry, boundaryEnforcement] = await Promise.all([
    factorRegistryAgent.execute({ input: { skipSeed: options.skipFactorSeed } }),
    boundaryEnforcerAgent.execute({
      input: { msmeData, transactions }
    })
  ]);

  const included = boundaryEnforcement.includedTransactions || [];
  let assessment;

  if (options.useAsyncCalculation) {
    assessment = await carbonCalculationService.calculateMSMECarbonFootprintAsync(
      msmeData,
      included
    );
  } else {
    assessment = carbonCalculationService.calculateMSMECarbonFootprint(msmeData, included);
  }

  assessment.inventoryMetadata = assessment.inventoryMetadata || {};
  assessment.inventoryMetadata.boundaryEnforcement = {
    includedCount: boundaryEnforcement.includedCount,
    excludedCount: boundaryEnforcement.excludedCount,
    scope3ExcludedByCategory: boundaryEnforcement.scope3ExcludedByCategory
  };
  assessment.inventoryMetadata.factorRegistryVersion = factorRegistry.registryVersion;

  const governedAssessment = governanceService.applyGovernanceToAssessment(assessment, {
    boundary: boundaryEnforcement.boundary,
    includedTransactions: included,
    excludedCount: boundaryEnforcement.excludedCount,
    allowResidualScope3: options.allowResidualScope3 === true
  });

  const [assuranceGate, brsrReconciliation] = await Promise.all([
    assuranceGateAgent.execute({
      input: {
        msmeData,
        assessment: governedAssessment,
        inventoryMetadata: governedAssessment.inventoryMetadata,
        includedTransactions: included,
        boundary: boundaryEnforcement.boundary,
        assuranceOptions: options.assuranceOptions,
        frameworks: options.frameworks
      }
    }),
    brsrScopeReconciliationAgent.execute({
      input: {
        assessment: governedAssessment,
        allowResidualScope3: options.allowResidualScope3,
        frameworks: options.frameworks
      }
    })
  ]);

  governedAssessment.governance.assuranceEvaluation = assuranceGate.evaluation;
  governedAssessment.governance.brsrScopeReconciliation = brsrReconciliation.reconciliation;

  let inventoryVersion = null;
  if (options.persistVersion !== false) {
    try {
      inventoryVersion = await governanceService.createInventoryVersion({
        msmeId,
        organizationId,
        assessment: governedAssessment,
        boundary: boundaryEnforcement.boundary,
        organizationalBoundary: msmeData?.manufacturingProfile?.ghgOrganizationalBoundary,
        governanceResult: {
          orchestrator: 'ghg_inventory_governance_orchestrator',
          orchestrationId: orchId,
          factorRegistry,
          boundaryEnforcement,
          assuranceGate,
          brsrReconciliation,
          includedCount: boundaryEnforcement.includedCount,
          excludedCount: boundaryEnforcement.excludedCount
        },
        reportingPeriod,
        orchestrationId: orchId,
        lock: options.lockInventory === true
      });
    } catch (error) {
      logger.warn('Inventory version persist failed:', error.message);
    }
  }

  await governanceService.appendAuditLog({
    msmeId,
    organizationId,
    inventoryVersionId: inventoryVersion?._id,
    eventType: 'assurance_gate_evaluated',
    summary: `Governance orchestration ${orchId}: assurance ${assuranceGate.evaluation.readinessStatus}`,
    agentType: 'ghg_inventory_governance_orchestrator',
    orchestrationId: orchId,
    afterSnapshot: {
      totalCO2Emissions: governedAssessment.totalCO2Emissions,
      assuranceReady: assuranceGate.evaluation.assuranceReady,
      brsrDisclosureReady: brsrReconciliation.disclosureReady
    }
  });

  return {
    orchestrator: 'ghg_inventory_governance_orchestrator',
    orchestrationId: orchId,
    generatedAt: new Date().toISOString(),
    architecture: {
      pattern: 'parallel_specialists_sequential_inventory_lock',
      agents: [
        'factor_registry',
        'boundary_enforcer',
        'carbon_calculation_engine',
        'assurance_gate',
        'brsr_scope_reconciliation'
      ]
    },
    factorRegistry,
    boundaryEnforcement,
    assessment: governedAssessment,
    assuranceGate,
    brsrReconciliation,
    inventoryVersion: inventoryVersion
      ? {
        id: inventoryVersion._id,
        versionLabel: inventoryVersion.versionLabel,
        status: inventoryVersion.status
      }
      : null,
    summary: {
      totalCO2EmissionsKg: governedAssessment.totalCO2Emissions,
      transactionsIncluded: boundaryEnforcement.includedCount,
      transactionsExcluded: boundaryEnforcement.excludedCount,
      assuranceReady: assuranceGate.evaluation.assuranceReady,
      brsrDisclosureReady: brsrReconciliation.disclosureReady
    }
  };
};

module.exports = {
  runGhgInventoryGovernanceOrchestration
};
