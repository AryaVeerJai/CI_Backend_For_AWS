/**
 * ISO framework defaults for compliance evaluation (standardHandlers / reporting).
 */
const ISO_FRAMEWORK_DEFAULTS = {
  iso14064: {
    enabled: true,
    minDataQualityConfidence: 0.65,
    maxAllowedUnknownParameters: 3,
    requireBaseYear: true,
    requireBoundaryDefinition: true,
    requireMethodologyDeclaration: true,
    requireInventoryManager: true,
    requireRecalculationPolicy: true,
    requireVerificationReadiness: true,
    requireEvidenceRetentionPolicy: true,
    minimumEvidenceRetentionYears: 7
  },
  iso14067: {
    enabled: true,
    minDataQualityConfidence: 0.6,
    minLifeCycleCoverage: 0.6,
    minBoundaryRigorScore: 0.6,
    minLciGranularityScore: 0.6,
    requireFunctionalUnit: true,
    requireAllocationMethod: true,
    requireBoundaryDefinition: true,
    requireProductLevelLci: true
  }
};

/**
 * Extended ISO framework fields used by MSME emissions orchestration defaults.
 */
const ORCHESTRATION_ISO_FRAMEWORK_DEFAULTS = {
  iso14064: {
    enabled: true,
    minDataQualityConfidence: ISO_FRAMEWORK_DEFAULTS.iso14064.minDataQualityConfidence,
    maxAllowedUnknownParameters: ISO_FRAMEWORK_DEFAULTS.iso14064.maxAllowedUnknownParameters,
    requireBaseYear: true,
    boundaryDefinitions: {
      organizationalBoundary: null,
      operationalBoundary: null,
      consolidationApproach: null,
      includedFacilities: []
    },
    factorRegistry: [],
    uncertainty: {
      methodology: null,
      combinationMethod: null,
      combinedRelativeUncertainty: null
    }
  },
  iso14067: {
    enabled: true,
    minDataQualityConfidence: ISO_FRAMEWORK_DEFAULTS.iso14067.minDataQualityConfidence,
    minLifeCycleCoverage: 0.6,
    requireFunctionalUnit: true,
    requireAllocationMethod: true,
    functionalUnit: '1 unit of finished product',
    allocationMethod: null,
    lifecycleStages: {
      upstream: null,
      operations: null,
      downstream: null,
      support: null
    },
    uncertainty: {
      methodology: null,
      combinedRelativeUncertainty: null
    }
  }
};

module.exports = {
  ISO_FRAMEWORK_DEFAULTS,
  ORCHESTRATION_ISO_FRAMEWORK_DEFAULTS
};
