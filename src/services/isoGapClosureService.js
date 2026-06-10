const getCarbonCalculationService = () => require('./carbonCalculationService');
const { computeProductCarbonFootprint } = require('./productCfpService');

const DEFAULT_SOURCE = 'Internal default factor library';
const DEFAULT_SOURCE_VERSION = '2026.03';
const DEFAULT_CONFIDENCE_LEVEL = 0.95;

const toStatus = (isComplete) => (isComplete ? 'complete' : 'gap');

const asArray = (value) => (Array.isArray(value) ? value : []);

const safeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const buildChecklistItem = ({ id, title, description, isComplete, value = null, required = true, evidence = [] }) => ({
  id,
  title,
  description,
  required,
  status: toStatus(isComplete),
  value,
  evidence
});

const buildFactorEntry = ({
  id,
  category,
  factor,
  unit,
  source = DEFAULT_SOURCE,
  sourceVersion = DEFAULT_SOURCE_VERSION,
  method = 'emission_factor',
  uncertainty = {}
}) => {
  const numericFactor = safeNumber(factor);
  const relativeUncertainty = safeNumber(uncertainty.relativeUncertainty, 0.15);
  const lowerBound = uncertainty.lowerBound ?? (numericFactor * (1 - relativeUncertainty));
  const upperBound = uncertainty.upperBound ?? (numericFactor * (1 + relativeUncertainty));

  return {
    id,
    category,
    factor: numericFactor,
    unit,
    source,
    sourceVersion,
    method,
    uncertainty: {
      confidenceLevel: safeNumber(uncertainty.confidenceLevel, DEFAULT_CONFIDENCE_LEVEL),
      relativeUncertainty,
      lowerBound,
      upperBound,
      notes: uncertainty.notes || null
    },
    lastReviewedAt: uncertainty.lastReviewedAt || null
  };
};

const buildDefaultFactorRegistry = () => {
  const carbonCalculationService = getCarbonCalculationService();
  const emissionFactors = carbonCalculationService?.emissionFactors || {};
  const entries = [];

  entries.push(
    buildFactorEntry({
      id: 'electricity_grid_india',
      category: 'energy',
      factor: emissionFactors?.electricity?.grid ?? 0.8,
      unit: 'kgCO2e/kWh',
      source: 'Central Electricity Authority (India) baseline grid factor',
      sourceVersion: '2025',
      uncertainty: {
        relativeUncertainty: 0.12,
        notes: 'Country-average grid factor when supplier-specific factor unavailable.'
      }
    }),
    buildFactorEntry({
      id: 'fuel_diesel',
      category: 'fuel',
      factor: emissionFactors?.fuel?.diesel ?? 2.68,
      unit: 'kgCO2e/liter',
      source: 'IPCC combustion defaults + India fuel mix adaptation',
      sourceVersion: '2006/2019',
      uncertainty: {
        relativeUncertainty: 0.1
      }
    }),
    buildFactorEntry({
      id: 'fuel_petrol',
      category: 'fuel',
      factor: emissionFactors?.fuel?.petrol ?? 2.31,
      unit: 'kgCO2e/liter',
      source: 'IPCC combustion defaults + India fuel mix adaptation',
      sourceVersion: '2006/2019',
      uncertainty: {
        relativeUncertainty: 0.1
      }
    }),
    buildFactorEntry({
      id: 'material_steel',
      category: 'materials',
      factor: emissionFactors?.materials?.steel ?? 1.85,
      unit: 'kgCO2e/kg',
      source: 'Industry-average cradle-to-gate steel factor',
      sourceVersion: '2025',
      uncertainty: {
        relativeUncertainty: 0.2
      }
    })
  );

  return entries;
};

const normalizeFactorRegistry = (inputRegistry = []) => {
  const registry = asArray(inputRegistry);
  return registry
    .filter(entry => entry && typeof entry === 'object')
    .map((entry, index) => buildFactorEntry({
      id: entry.id || `factor_${index + 1}`,
      category: entry.category || 'other',
      factor: entry.factor,
      unit: entry.unit || 'kgCO2e/unit',
      source: entry.source || DEFAULT_SOURCE,
      sourceVersion: entry.sourceVersion || DEFAULT_SOURCE_VERSION,
      method: entry.method || 'emission_factor',
      uncertainty: entry.uncertainty || {}
    }));
};

const resolveFrameworkConfig = (input = {}) => {
  const frameworks = input.frameworks || input.context?.frameworks || {};
  return {
    iso14064: frameworks.iso14064 || {},
    iso14067: frameworks.iso14067 || {}
  };
};

const buildBoundaryDefinitionChecklist = (input = {}) => {
  const frameworkConfig = resolveFrameworkConfig(input).iso14064;
  const boundary = frameworkConfig.boundaryDefinitions || {};
  const includedFacilities = asArray(boundary.includedFacilities);

  const items = [
    buildChecklistItem({
      id: 'boundary_organizational',
      title: 'Organizational boundary',
      description: 'Define legal entities, sites, and inclusion criteria for inventory.',
      isComplete: Boolean(boundary.organizationalBoundary || input.msmeData?.companyName),
      value: boundary.organizationalBoundary || null
    }),
    buildChecklistItem({
      id: 'boundary_operational',
      title: 'Operational boundary',
      description: 'Define covered activities and scope categories.',
      isComplete: Boolean(boundary.operationalBoundary),
      value: boundary.operationalBoundary || null
    }),
    buildChecklistItem({
      id: 'boundary_consolidation_approach',
      title: 'Consolidation approach',
      description: 'Specify equity share, financial control, or operational control approach.',
      isComplete: Boolean(boundary.consolidationApproach),
      value: boundary.consolidationApproach || null
    }),
    buildChecklistItem({
      id: 'boundary_included_facilities',
      title: 'Included facilities list',
      description: 'List all included facilities and business units.',
      isComplete: includedFacilities.length > 0,
      value: includedFacilities
    })
  ];

  const completed = items.filter(item => item.status === 'complete').length;
  return {
    section: 'boundary_definitions',
    readinessScore: Math.round((completed / items.length) * 100),
    items
  };
};

const buildFactorRegistryChecklist = (input = {}) => {
  const frameworkConfig = resolveFrameworkConfig(input).iso14064;
  const providedRegistry = frameworkConfig.factorRegistry || input.factorRegistry || [];
  const factorRegistry = normalizeFactorRegistry(
    providedRegistry.length > 0 ? providedRegistry : buildDefaultFactorRegistry()
  );

  const missingSourceCount = factorRegistry.filter(entry => !entry.source || entry.source === DEFAULT_SOURCE).length;
  const missingUncertaintyCount = factorRegistry.filter(entry => {
    const uncertainty = entry.uncertainty || {};
    return !Number.isFinite(uncertainty.relativeUncertainty)
      || !Number.isFinite(uncertainty.lowerBound)
      || !Number.isFinite(uncertainty.upperBound);
  }).length;

  const items = [
    buildChecklistItem({
      id: 'factor_registry_presence',
      title: 'Factor registry availability',
      description: 'Maintain a central factor registry used for inventory and product CFP calculations.',
      isComplete: factorRegistry.length > 0,
      value: factorRegistry.length
    }),
    buildChecklistItem({
      id: 'factor_source_traceability',
      title: 'Source traceability',
      description: 'Each factor must include traceable source and version metadata.',
      isComplete: missingSourceCount === 0,
      value: {
        totalFactors: factorRegistry.length,
        missingSourceCount
      }
    }),
    buildChecklistItem({
      id: 'factor_uncertainty_fields',
      title: 'Factor uncertainty fields',
      description: 'Each factor must carry uncertainty bounds and confidence level.',
      isComplete: missingUncertaintyCount === 0,
      value: {
        totalFactors: factorRegistry.length,
        missingUncertaintyCount
      }
    })
  ];

  const completed = items.filter(item => item.status === 'complete').length;
  return {
    section: 'factor_registry',
    readinessScore: Math.round((completed / items.length) * 100),
    items,
    registry: factorRegistry
  };
};

const buildUncertaintyChecklist = (input = {}) => {
  const frameworkConfig = resolveFrameworkConfig(input);
  const uncertaintyConfig = {
    ...(frameworkConfig.iso14064?.uncertainty || {}),
    ...(frameworkConfig.iso14067?.uncertainty || {})
  };
  const dataQuality = input.dataQuality || input.context?.dataQuality || {};
  const factorRegistry = normalizeFactorRegistry(input.factorRegistry || frameworkConfig.iso14064?.factorRegistry || []);

  const hasDataQualityConfidence = Number.isFinite(dataQuality.confidence);
  const hasMethodDocumented = Boolean(uncertaintyConfig.combinationMethod || uncertaintyConfig.methodology);
  const hasQuantification = Number.isFinite(uncertaintyConfig.combinedRelativeUncertainty)
    || Number.isFinite(uncertaintyConfig.combinedAbsoluteUncertainty);
  const factorCoverage = factorRegistry.length === 0
    ? false
    : factorRegistry.every(entry => Number.isFinite(entry?.uncertainty?.relativeUncertainty));

  const items = [
    buildChecklistItem({
      id: 'uncertainty_data_quality_confidence',
      title: 'Activity data confidence score',
      description: 'Document confidence score for activity data used in calculations.',
      isComplete: hasDataQualityConfidence,
      value: dataQuality.confidence ?? null
    }),
    buildChecklistItem({
      id: 'uncertainty_methodology',
      title: 'Uncertainty methodology',
      description: 'Document uncertainty propagation/combination method.',
      isComplete: hasMethodDocumented,
      value: uncertaintyConfig.combinationMethod || uncertaintyConfig.methodology || null
    }),
    buildChecklistItem({
      id: 'uncertainty_quantification',
      title: 'Quantified uncertainty output',
      description: 'Maintain combined uncertainty value for reported totals.',
      isComplete: hasQuantification,
      value: uncertaintyConfig.combinedRelativeUncertainty
        ?? uncertaintyConfig.combinedAbsoluteUncertainty
        ?? null
    }),
    buildChecklistItem({
      id: 'uncertainty_factor_linkage',
      title: 'Factor uncertainty linkage',
      description: 'Link factor uncertainty fields from registry into calculations.',
      isComplete: factorCoverage,
      value: {
        factorCount: factorRegistry.length
      }
    })
  ];

  const completed = items.filter(item => item.status === 'complete').length;
  return {
    section: 'uncertainty_fields',
    readinessScore: Math.round((completed / items.length) * 100),
    items
  };
};

const buildGovernanceVerificationChecklist = (input = {}) => {
  const frameworkConfig = resolveFrameworkConfig(input).iso14064;
  const methodology = frameworkConfig.methodology || {};
  const governance = frameworkConfig.governance || {};
  const recalculationPolicy = frameworkConfig.recalculationPolicy || {};
  const verification = frameworkConfig.verification || {};
  const minimumEvidenceRetentionYears = safeNumber(frameworkConfig.minimumEvidenceRetentionYears, 7);
  const evidenceRetentionYears = safeNumber(governance.evidenceRetentionYears, 0);

  const methodologyDeclared = Boolean(
    methodology.protocolReference
    || methodology.quantificationApproach
    || methodology.standardPart
  );
  const inventoryManager = governance.inventoryManager || governance.owner || null;
  const recalculationPolicyDefined = Boolean(
    recalculationPolicy.policyStatement
    || (Array.isArray(recalculationPolicy.triggers) && recalculationPolicy.triggers.length > 0)
  );
  const verificationMetadataComplete = Boolean(
    verification.assuranceLevel
    && (verification.boundaryCoverage || verification.scopeCoverage || verification.evidencePackVersion)
  );

  const items = [
    buildChecklistItem({
      id: 'governance_methodology_reference',
      title: 'Methodology declaration',
      description: 'Document quantification methodology and factor selection hierarchy.',
      isComplete: methodologyDeclared,
      value: methodology.protocolReference || methodology.quantificationApproach || null
    }),
    buildChecklistItem({
      id: 'governance_inventory_owner',
      title: 'Inventory accountability owner',
      description: 'Assign owner responsible for GHG inventory preparation and review.',
      isComplete: Boolean(inventoryManager),
      value: inventoryManager
    }),
    buildChecklistItem({
      id: 'governance_recalculation_policy',
      title: 'Recalculation policy',
      description: 'Maintain recalculation policy for structural and methodological changes.',
      isComplete: recalculationPolicyDefined,
      value: {
        policyStatement: recalculationPolicy.policyStatement || null,
        triggerCount: Array.isArray(recalculationPolicy.triggers) ? recalculationPolicy.triggers.length : 0
      }
    }),
    buildChecklistItem({
      id: 'governance_verification_metadata',
      title: 'Verification readiness metadata',
      description: 'Capture assurance level, coverage details, and evidence package version.',
      isComplete: verificationMetadataComplete,
      value: {
        assuranceLevel: verification.assuranceLevel || null,
        boundaryCoverage: verification.boundaryCoverage || verification.scopeCoverage || null,
        evidencePackVersion: verification.evidencePackVersion || null
      }
    }),
    buildChecklistItem({
      id: 'governance_evidence_retention',
      title: 'Evidence retention policy',
      description: 'Retain inventory evidence for the minimum governance retention period.',
      isComplete: evidenceRetentionYears >= minimumEvidenceRetentionYears,
      value: {
        evidenceRetentionYears,
        minimumEvidenceRetentionYears
      }
    })
  ];

  const completed = items.filter(item => item.status === 'complete').length;
  return {
    section: 'governance_verification_controls',
    readinessScore: Math.round((completed / items.length) * 100),
    items
  };
};

const DEFAULT_LIFECYCLE_STAGES = {
  upstream: 'Purchased goods, inbound logistics, and supplier-related activities',
  operations: 'On-site energy, process emissions, and direct manufacturing activities',
  downstream: 'Distribution, product use phase, and end-of-life treatment',
  support: 'Maintenance, services, and shared overhead activities'
};

const buildProductCfpModuleSkeleton = (input = {}) => {
  const frameworkConfig = resolveFrameworkConfig(input).iso14067;
  const workflow = input.msmeData?.business?.manufacturingWorkflow || {};

  const moduleTemplate = {
    version: '1.0.0',
    moduleName: 'product_cfp',
    inputs: {
      productCatalog: {
        requiredFields: ['productId', 'productName', 'functionalUnit', 'declaredUnit']
      },
      lifecycleInventory: {
        requiredFields: ['stage', 'activityData', 'factorRef', 'allocationKey']
      },
      uncertainty: {
        requiredFields: ['relativeUncertainty', 'confidenceLevel', 'methodology']
      }
    },
    outputs: {
      productFootprint: 'kgCO2e per functional unit',
      stageBreakdown: 'upstream/operations/downstream/support',
      uncertainty: 'combined relative uncertainty'
    }
  };

  const productSignals = new Set([
    ...(asArray(workflow.units).flatMap(unit => asArray(unit?.products))),
    input.msmeData?.business?.primaryProducts
  ].filter(Boolean));

  const stageDefinitions = Object.keys(frameworkConfig.lifecycleStages || {}).length > 0
    ? frameworkConfig.lifecycleStages
    : DEFAULT_LIFECYCLE_STAGES;
  const hasStageDefinitions = Object.keys(stageDefinitions).length > 0;

  const items = [
    buildChecklistItem({
      id: 'cfp_functional_unit',
      title: 'Functional unit template',
      description: 'Declare a functional/declared unit for each product.',
      isComplete: Boolean(frameworkConfig.functionalUnit),
      value: frameworkConfig.functionalUnit || null
    }),
    buildChecklistItem({
      id: 'cfp_allocation_method',
      title: 'Allocation method template',
      description: 'Define allocation logic for shared processes.',
      isComplete: Boolean(frameworkConfig.allocationMethod),
      value: frameworkConfig.allocationMethod || null
    }),
    buildChecklistItem({
      id: 'cfp_product_catalog',
      title: 'Product catalog seed',
      description: 'Maintain list of products for CFP computation.',
      isComplete: productSignals.size > 0,
      value: Array.from(productSignals).slice(0, 10)
    }),
    buildChecklistItem({
      id: 'cfp_lifecycle_stage_map',
      title: 'Lifecycle stage map',
      description: 'Define stage boundaries for upstream/operations/downstream/support.',
      isComplete: hasStageDefinitions,
      value: stageDefinitions
    })
  ];

  const completed = items.filter(item => item.status === 'complete').length;
  const transactions = asArray(input.transactions);
  const productCfpResult = transactions.length > 0
    ? computeProductCarbonFootprint({
      transactions,
      msmeData: input.msmeData,
      frameworks: input.frameworks || input.context?.frameworks
    })
    : null;

  return {
    section: 'product_cfp_module',
    readinessScore: Math.round((completed / items.length) * 100),
    items,
    moduleTemplate,
    lifecycleStages: stageDefinitions,
    productCfp: productCfpResult,
    computationStatus: productCfpResult ? 'computed' : 'awaiting_transactions'
  };
};

const buildIsoGapClosureChecklist = (input = {}) => {
  const boundaryDefinitions = buildBoundaryDefinitionChecklist(input);
  const factorRegistry = buildFactorRegistryChecklist(input);
  const uncertaintyFields = buildUncertaintyChecklist({
    ...input,
    factorRegistry: factorRegistry.registry
  });
  const governanceVerificationControls = buildGovernanceVerificationChecklist(input);
  const productCfpModuleSkeleton = buildProductCfpModuleSkeleton(input);

  const sections = [
    boundaryDefinitions,
    factorRegistry,
    uncertaintyFields,
    governanceVerificationControls,
    productCfpModuleSkeleton
  ];
  const overallReadinessScore = Math.round(
    sections.reduce((sum, section) => sum + safeNumber(section.readinessScore), 0) / sections.length
  );

  const openGaps = sections.flatMap(section => (
    section.items
      .filter(item => item.status === 'gap')
      .map(item => ({
        section: section.section,
        id: item.id,
        title: item.title,
        description: item.description
      }))
  ));

  const priorityActions = openGaps.slice(0, 8).map((gap, index) => ({
    priority: index < 3 ? 'high' : index < 6 ? 'medium' : 'low',
    section: gap.section,
    action: `Close gap: ${gap.title}`,
    detail: gap.description
  }));

  return {
    generatedAt: new Date().toISOString(),
    overallReadinessScore,
    sections: {
      boundaryDefinitions,
      factorRegistry: {
        ...factorRegistry,
        registry: undefined
      },
      uncertaintyFields,
      governanceVerificationControls,
      productCfpModuleSkeleton
    },
    factorRegistry: factorRegistry.registry,
    openGaps,
    priorityActions
  };
};

module.exports = {
  buildIsoGapClosureChecklist,
  buildBoundaryDefinitionChecklist,
  buildFactorRegistryChecklist,
  buildUncertaintyChecklist,
  buildGovernanceVerificationChecklist,
  buildProductCfpModuleSkeleton,
  buildDefaultFactorRegistry,
  normalizeFactorRegistry
};
