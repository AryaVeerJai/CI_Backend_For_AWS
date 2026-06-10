const getCarbonCalculationService = () => require('../../carbonCalculationService');
const getIsoGapClosureService = () => require('../../isoGapClosureService');
const dataProcessorService = require('../dataProcessorAgent');
const verifiedKnowledgeRagService = require('../../verifiedKnowledgeRagService');
const carbonAnalyzerAgentImpl = require('../carbonAnalyzerAgent');
const recommendationEngineAgentImpl = require('../recommendationEngineAgent');
const reportGeneratorAgentImpl = require('../reportGeneratorAgent');
const {
  generateReportSummary,
  generateCarbonSection,
  generateCarbonCharts,
  generateTrendsSection,
  generateTrendCharts,
  generateRecommendationsSection
} = reportGeneratorAgentImpl;
const { ISO_FRAMEWORK_DEFAULTS } = require('../../../constants/isoFrameworkDefaults');
const { safeNumber, isFiniteNumber } = require('../../../utils/safeNumber');
const { normalizeCarbonAnalysisResponse, normalizeCarbonDataForRecommendations } = require('../carbonDataNormalization');
const transactionInsightAnalysis = require('../transactionInsightAnalysis');

const generateCarbonInsights = (analysis) => ([
  {
    type: 'emission_peak',
    message: 'Highest emissions detected in energy category',
    value: Math.max(...Object.values(analysis.categoryBreakdown))
  }
]);

const generateCarbonRecommendations = (analysis) => ([
  {
    category: 'energy',
    title: 'Switch to renewable energy',
    priority: 'high',
    potentialReduction: analysis.totalEmissions * 0.3
  }
]);

const {
  analyzeTransactionPatterns,
  detectEmissionAnomalies,
  detectSpendingAnomalies,
  detectFrequencyAnomalies,
  calculateAnomalySeverity,
  analyzeEmissionTrends,
  analyzeSpendingTrends,
  analyzeEfficiencyTrends,
  analyzeSustainabilityTrends,
  generateTrendPredictions,
  generateTrendInsights
} = transactionInsightAnalysis;

const generateSustainabilityRecommendations = (carbonData) => (
  recommendationEngineAgentImpl.generateCarbonBasedRecommendations(
    normalizeCarbonDataForRecommendations(carbonData)
  ).then((result) => result?.recommendations || result || []).catch(() => [])
);

const generateTransactionRecommendations = (transactions) => (
  recommendationEngineAgentImpl.generateTransactionBasedRecommendations(transactions)
    .catch(() => [])
);

const cleanTransactionData = (transaction) => transaction;
const classifyTransaction = (transaction) => transaction;
const enrichTransactionData = (transaction) => transaction;
const validateForCarbonCalculation = (transaction) => transaction;
const checkEnvironmentalCompliance = () => ({ issues: [], recommendations: [] });
const checkRegulatoryCompliance = () => ({ issues: [], recommendations: [] });

const normalizeFrameworkConfig = (value, defaults = {}) => {
  if (value === false) {
    return { ...defaults, enabled: false };
  }
  if (value === true) {
    return { ...defaults, enabled: true };
  }
  if (value && typeof value === 'object') {
    return {
      ...defaults,
      ...value,
      enabled: value.enabled !== false
    };
  }
  return { ...defaults };
};

const resolveIsoFrameworkConfig = (input = {}, frameworkKey) => {
  const defaults = ISO_FRAMEWORK_DEFAULTS[frameworkKey] || { enabled: false };
  const context = input.context || {};
  const frameworksFromInput = input.frameworks;
  const frameworksFromContext = context.frameworks;
  const frameworksFromOptions = context.orchestrationOptions?.frameworks;

  const candidates = [
    frameworksFromInput?.[frameworkKey],
    frameworksFromContext?.[frameworkKey],
    frameworksFromOptions?.[frameworkKey]
  ];

  const matchedConfig = candidates.find(candidate => candidate !== undefined);
  return normalizeFrameworkConfig(matchedConfig, defaults);
};

const buildIssue = ({ framework, code, severity, message, evidence = [] }) => ({
  framework,
  code,
  severity,
  message,
  evidence
});

const buildRecommendation = ({ framework, priority, title, action }) => ({
  framework,
  priority,
  title,
  action
});

const evaluateIso14064 = (input = {}) => {
  const framework = 'ISO 14064';
  const config = resolveIsoFrameworkConfig(input, 'iso14064');
  if (!config.enabled) {
    return {
      framework,
      enabled: false,
      readinessScore: 0,
      checks: [],
      issues: [],
      recommendations: [],
      evidenceUsed: [],
      status: 'not_enabled'
    };
  }

  const context = input.context || {};
  const knownParameters = input.knownParameters || context.knownParameters || {};
  const unknownParameters = input.unknownParameters || context.unknownParameters || {};
  const msmeData = input.msmeData || {};
  const carbonData = input.carbonData || {};
  const transactions = Array.isArray(input.transactions) ? input.transactions : [];
  const dataQuality = input.dataQuality || context.dataQuality || {};
  const issues = [];
  const recommendations = [];
  const evidenceUsed = [];

  const boundaryDefined = Boolean(
    msmeData.companyName ||
    context.regulatoryContext ||
    context.region ||
    knownParameters?.msmeProfile?.businessDomain
  );
  const hasEmissionsData = isFiniteNumber(carbonData.totalEmissions) && Number(carbonData.totalEmissions) > 0;
  const hasCategoryBreakdown = carbonData.categoryBreakdown
    && Object.keys(carbonData.categoryBreakdown).length > 0;
  const hasActivityData = transactions.length > 0;
  const scopeCoverageSignal = [hasEmissionsData, hasCategoryBreakdown, hasActivityData].filter(Boolean).length;
  const scopeCoverage = scopeCoverageSignal >= 2;
  const confidence = Number(dataQuality.confidence || 0);
  const dataQualityPass = confidence >= Number(config.minDataQualityConfidence);
  const baseYear = config.baseYear || context.frameworks?.iso14064?.baseYear || null;
  const baseYearPresent = Boolean(baseYear) || !config.requireBaseYear;
  const methodology = config.methodology || context.frameworks?.iso14064?.methodology || {};
  const governance = config.governance || context.frameworks?.iso14064?.governance || {};
  const recalculationPolicy = config.recalculationPolicy || context.frameworks?.iso14064?.recalculationPolicy || {};
  const verification = config.verification || context.frameworks?.iso14064?.verification || {};
  const inventoryManager = governance.inventoryManager || governance.owner || null;
  const methodologyDeclared = Boolean(
    methodology.protocolReference
    || methodology.quantificationApproach
    || methodology.standardPart
  );
  const recalculationPolicyPresent = Boolean(
    recalculationPolicy.policyStatement
    || (Array.isArray(recalculationPolicy.triggers) && recalculationPolicy.triggers.length > 0)
  );
  const verificationReady = Boolean(
    verification.assuranceLevel
    && (verification.boundaryCoverage || verification.scopeCoverage || verification.evidencePackVersion)
  );
  const evidenceRetentionYears = Number(governance.evidenceRetentionYears || 0);
  const evidenceRetentionPass = !config.requireEvidenceRetentionPolicy
    || evidenceRetentionYears >= Number(config.minimumEvidenceRetentionYears || 7);
  const unknownCount = Array.isArray(unknownParameters.weightedParameters)
    ? unknownParameters.weightedParameters.length
    : 0;
  const unknownCoveragePass = unknownCount <= Number(config.maxAllowedUnknownParameters || 3);

  const checks = [
    {
      id: 'boundary_definition',
      passed: boundaryDefined || !config.requireBoundaryDefinition,
      expected: 'Defined organizational boundary',
      actual: boundaryDefined ? 'Boundary metadata available' : 'Boundary metadata missing'
    },
    {
      id: 'scope_coverage',
      passed: scopeCoverage,
      expected: 'Sufficient scope/activity coverage',
      actual: `Coverage signals: ${scopeCoverageSignal}/3`
    },
    {
      id: 'data_quality_confidence',
      passed: dataQualityPass,
      expected: `Confidence >= ${config.minDataQualityConfidence}`,
      actual: `Confidence ${confidence.toFixed(2)}`
    },
    {
      id: 'base_year',
      passed: baseYearPresent,
      expected: 'Base year defined',
      actual: baseYear ? `Base year ${baseYear}` : 'Base year not provided'
    },
    {
      id: 'unknown_parameters',
      passed: unknownCoveragePass,
      expected: `Unknown parameters <= ${config.maxAllowedUnknownParameters}`,
      actual: `Unknown parameters ${unknownCount}`
    },
    {
      id: 'methodology_declaration',
      passed: methodologyDeclared || !config.requireMethodologyDeclaration,
      expected: 'Documented ISO 14064 quantification methodology',
      actual: methodologyDeclared
        ? (methodology.protocolReference || methodology.quantificationApproach || 'Methodology metadata available')
        : 'Methodology metadata missing'
    },
    {
      id: 'inventory_accountability',
      passed: Boolean(inventoryManager) || !config.requireInventoryManager,
      expected: 'Assigned inventory management owner',
      actual: inventoryManager || 'Inventory owner not assigned'
    },
    {
      id: 'recalculation_policy',
      passed: recalculationPolicyPresent || !config.requireRecalculationPolicy,
      expected: 'Defined recalculation policy and trigger events',
      actual: recalculationPolicyPresent ? 'Recalculation policy configured' : 'Recalculation policy missing'
    },
    {
      id: 'verification_readiness',
      passed: verificationReady || !config.requireVerificationReadiness,
      expected: 'Verification readiness metadata captured',
      actual: verificationReady ? 'Verification metadata available' : 'Verification metadata missing'
    },
    {
      id: 'evidence_retention',
      passed: evidenceRetentionPass,
      expected: `Evidence retention >= ${config.minimumEvidenceRetentionYears} years`,
      actual: `${evidenceRetentionYears || 0} years`
    }
  ];

  const getCheck = (id) => checks.find((check) => check.id === id);

  if (!getCheck('boundary_definition').passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14064_BOUNDARY_MISSING',
      severity: 'high',
      message: 'Organizational boundary is not fully defined for ISO 14064 accounting.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'high',
      title: 'Define organizational boundary',
      action: 'Document reporting boundary, facilities, and operational control assumptions.'
    }));
  } else {
    evidenceUsed.push('organizational_boundary_profile');
  }

  if (!getCheck('scope_coverage').passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14064_SCOPE_DATA_GAP',
      severity: 'high',
      message: 'Insufficient scope/activity data for complete GHG inventory.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'high',
      title: 'Expand scope data coverage',
      action: 'Capture missing activity data and ensure scope 1/2/3 mapping across transactions.'
    }));
  } else {
    evidenceUsed.push('scope_activity_dataset');
  }

  if (!getCheck('data_quality_confidence').passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14064_DATA_QUALITY_LOW',
      severity: 'medium',
      message: 'Data quality confidence is below ISO 14064 operational target.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'medium',
      title: 'Improve inventory data quality',
      action: 'Increase primary data share and reconcile outliers before reporting.'
    }));
  } else {
    evidenceUsed.push('quality_confidence_gate');
  }

  if (!getCheck('base_year').passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14064_BASE_YEAR_MISSING',
      severity: 'medium',
      message: 'Base year definition is missing for trend comparability.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'medium',
      title: 'Set ISO 14064 base year',
      action: 'Specify a base year and maintain recalculation triggers for structural changes.'
    }));
  } else {
    evidenceUsed.push('base_year_reference');
  }

  if (!getCheck('unknown_parameters').passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14064_UNKNOWN_PARAMETER_LOAD_HIGH',
      severity: 'medium',
      message: 'Too many unknown parameters reduce inventory reliability.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'medium',
      title: 'Resolve unknown parameter placeholders',
      action: 'Prioritize high-weight unknown categories and map them to verified factors.'
    }));
  } else {
    evidenceUsed.push('unknown_parameter_controls');
  }

  if (!getCheck('methodology_declaration').passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14064_METHODOLOGY_MISSING',
      severity: 'high',
      message: 'ISO 14064 quantification methodology reference is missing.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'high',
      title: 'Document quantification methodology',
      action: 'Capture methodology reference, quantification approach, and emission-factor hierarchy.'
    }));
  } else {
    evidenceUsed.push('methodology_reference');
  }

  if (!getCheck('inventory_accountability').passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14064_ACCOUNTABILITY_OWNER_MISSING',
      severity: 'high',
      message: 'Inventory accountability owner is not defined for ISO 14064 reporting.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'high',
      title: 'Assign inventory owner',
      action: 'Nominate accountable inventory owner and define review/approval responsibilities.'
    }));
  } else {
    evidenceUsed.push('inventory_accountability_owner');
  }

  if (!getCheck('recalculation_policy').passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14064_RECALCULATION_POLICY_MISSING',
      severity: 'medium',
      message: 'Recalculation policy is missing for structural or methodological changes.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'medium',
      title: 'Define recalculation policy',
      action: 'Document recalculation triggers (acquisitions, disposals, and methodology updates).'
    }));
  } else {
    evidenceUsed.push('recalculation_policy');
  }

  if (!getCheck('verification_readiness').passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14064_VERIFICATION_READINESS_MISSING',
      severity: 'medium',
      message: 'Verification readiness metadata is incomplete for external assurance.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'medium',
      title: 'Prepare verification metadata',
      action: 'Define assurance level, coverage boundary, and evidence package version for verification.'
    }));
  } else {
    evidenceUsed.push('verification_readiness_plan');
  }

  if (!getCheck('evidence_retention').passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14064_EVIDENCE_RETENTION_INSUFFICIENT',
      severity: 'medium',
      message: 'Evidence retention duration is below ISO 14064 governance target.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'medium',
      title: 'Extend evidence retention policy',
      action: `Retain supporting inventory records for at least ${config.minimumEvidenceRetentionYears} years.`
    }));
  } else {
    evidenceUsed.push('evidence_retention_policy');
  }

  const passedChecks = checks.filter(check => check.passed).length;
  const readinessScore = checks.length > 0
    ? Math.round((passedChecks / checks.length) * 100)
    : 0;

  return {
    framework,
    enabled: true,
    readinessScore,
    checks,
    issues,
    recommendations,
    evidenceUsed,
    controlSummary: {
      methodologyDeclared,
      inventoryManager,
      recalculationPolicyPresent,
      verificationReady,
      evidenceRetentionYears: Number.isFinite(evidenceRetentionYears) ? evidenceRetentionYears : null
    },
    status: issues.length > 0 ? 'gaps_detected' : 'aligned'
  };
};

const hasAnyProcessSignals = (knownParameters = {}, processMachineryProfile = {}, msmeData = {}) => {
  const workflow = msmeData?.business?.manufacturingWorkflow || {};
  const processCount = Array.isArray(knownParameters.processes) ? knownParameters.processes.length : 0;
  const machineryCount = Array.isArray(knownParameters.machinery) ? knownParameters.machinery.length : 0;
  const profiledProcesses = Array.isArray(processMachineryProfile.processes) ? processMachineryProfile.processes.length : 0;
  const unitProcesses = Array.isArray(workflow.units)
    ? workflow.units.flatMap(unit => unit?.processes || []).length
    : 0;
  return processCount + machineryCount + profiledProcesses + unitProcesses > 0;
};

const evaluateIso14067 = (input = {}) => {
  const framework = 'ISO 14067';
  const config = resolveIsoFrameworkConfig(input, 'iso14067');
  if (!config.enabled) {
    return {
      framework,
      enabled: false,
      readinessScore: 0,
      checks: [],
      issues: [],
      recommendations: [],
      evidenceUsed: [],
      status: 'not_enabled'
    };
  }

  const context = input.context || {};
  const knownParameters = input.knownParameters || context.knownParameters || {};
  const msmeData = input.msmeData || {};
  const processMachineryProfile = input.processMachineryProfile || {};
  const transactions = Array.isArray(input.transactions) ? input.transactions : [];
  const dataQuality = input.dataQuality || context.dataQuality || {};
  const iso14067Signals = input.iso14067Signals || context.iso14067Signals || {};
  const issues = [];
  const recommendations = [];
  const evidenceUsed = [];
  const workflow = msmeData?.business?.manufacturingWorkflow || {};

  const productSignals = new Set();
  if (Array.isArray(workflow.units)) {
    workflow.units.forEach(unit => {
      (unit?.products || []).forEach(product => productSignals.add(product));
    });
  }
  if (msmeData?.business?.primaryProducts) {
    productSignals.add(msmeData.business.primaryProducts);
  }

  const functionalUnit = config.functionalUnit
    || context.frameworks?.iso14067?.functionalUnit
    || null;
  const allocationMethod = config.allocationMethod
    || context.frameworks?.iso14067?.allocationMethod
    || null;
  const stageCoverage = {
    upstream: Array.isArray(workflow.supplyChain) && workflow.supplyChain.length > 0
      || (knownParameters.materialsConsumption?.total || 0) > 0,
    operations: hasAnyProcessSignals(knownParameters, processMachineryProfile, msmeData),
    downstream: transactions.some(transaction => {
      const description = String(transaction?.description || '').toLowerCase();
      const transactionType = String(transaction?.transactionType || '').toLowerCase();
      return transactionType === 'sale' || description.includes('dispatch') || description.includes('delivery');
    }),
    support: Array.isArray(workflow.employees) && workflow.employees.length > 0
      || (workflow.latestEstimate?.commuteEmissions || 0) > 0
  };
  const lifecycleCoverageRatio = Object.values(stageCoverage).filter(Boolean).length / Object.keys(stageCoverage).length;
  const lifecycleCoveragePass = lifecycleCoverageRatio >= Number(config.minLifeCycleCoverage);
  const boundaryRigorScore = safeNumber(iso14067Signals.boundaryRigorScore, 0);
  const normalizedBoundaryRigorScore = boundaryRigorScore > 1
    ? boundaryRigorScore / 100
    : boundaryRigorScore;
  const boundaryDefinitionPresent = normalizedBoundaryRigorScore > 0
    || Boolean(iso14067Signals.boundaryDescription)
    || Boolean(iso14067Signals.systemBoundaryType);
  const boundaryRigorPass = normalizedBoundaryRigorScore >= Number(config.minBoundaryRigorScore || 0);
  const lciGranularityScore = safeNumber(iso14067Signals.lciGranularityScore, 0);
  const normalizedLciGranularityScore = lciGranularityScore > 1
    ? lciGranularityScore / 100
    : lciGranularityScore;
  const lciRecordCount = safeNumber(iso14067Signals.lciRecordCount, 0);
  const productLevelLciPass = lciRecordCount > 0
    && normalizedLciGranularityScore >= Number(config.minLciGranularityScore || 0);
  const confidence = Number(dataQuality.confidence || 0);
  const qualityPass = confidence >= Number(config.minDataQualityConfidence);

  const checks = [
    {
      id: 'functional_unit',
      passed: Boolean(functionalUnit) || !config.requireFunctionalUnit,
      expected: 'Functional unit defined',
      actual: functionalUnit || 'Functional unit missing'
    },
    {
      id: 'allocation_method',
      passed: Boolean(allocationMethod) || !config.requireAllocationMethod,
      expected: 'Allocation method defined',
      actual: allocationMethod || 'Allocation method missing'
    },
    {
      id: 'product_signal',
      passed: productSignals.size > 0,
      expected: 'At least one declared product signal',
      actual: `${productSignals.size} product signals detected`
    },
    {
      id: 'lifecycle_coverage',
      passed: lifecycleCoveragePass,
      expected: `Lifecycle coverage >= ${config.minLifeCycleCoverage}`,
      actual: `Lifecycle coverage ${lifecycleCoverageRatio.toFixed(2)}`
    },
    {
      id: 'data_quality_confidence',
      passed: qualityPass,
      expected: `Confidence >= ${config.minDataQualityConfidence}`,
      actual: `Confidence ${confidence.toFixed(2)}`
    },
    {
      id: 'boundary_definition',
      passed: boundaryDefinitionPresent || !config.requireBoundaryDefinition,
      expected: 'System boundary definition documented',
      actual: boundaryDefinitionPresent
        ? `Boundary rigor ${normalizedBoundaryRigorScore.toFixed(2)}`
        : 'Boundary definition missing'
    },
    {
      id: 'boundary_rigor',
      passed: boundaryRigorPass,
      expected: `Boundary rigor >= ${config.minBoundaryRigorScore}`,
      actual: `Boundary rigor ${normalizedBoundaryRigorScore.toFixed(2)}`
    },
    {
      id: 'product_level_lci',
      passed: productLevelLciPass || !config.requireProductLevelLci,
      expected: `LCI granularity >= ${config.minLciGranularityScore}`,
      actual: `${lciRecordCount} records, granularity ${normalizedLciGranularityScore.toFixed(2)}`
    }
  ];

  if (!checks[0].passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14067_FUNCTIONAL_UNIT_MISSING',
      severity: 'high',
      message: 'Functional unit is missing for product carbon footprint reporting.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'high',
      title: 'Define product functional unit',
      action: 'Specify a declared/functional unit (e.g. kg, piece, batch) for each assessed product.'
    }));
  } else {
    evidenceUsed.push('functional_unit_definition');
  }

  if (!checks[1].passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14067_ALLOCATION_MISSING',
      severity: 'high',
      message: 'Allocation method is missing for shared process emissions.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'high',
      title: 'Set allocation method',
      action: 'Define mass/economic/energy allocation logic and apply consistently.'
    }));
  } else {
    evidenceUsed.push('allocation_method_definition');
  }

  if (!checks[2].passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14067_PRODUCT_SIGNAL_MISSING',
      severity: 'medium',
      message: 'No product signal found for ISO 14067 assessment.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'medium',
      title: 'Declare assessed products',
      action: 'Provide product identifiers in MSME profile or manufacturing workflow units.'
    }));
  } else {
    evidenceUsed.push('product_catalog_signals');
  }

  if (!checks[3].passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14067_LIFECYCLE_COVERAGE_LOW',
      severity: 'medium',
      message: 'Lifecycle stage coverage is below ISO 14067 target.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'medium',
      title: 'Expand lifecycle data coverage',
      action: 'Capture missing upstream, downstream, and support stage emissions evidence.'
    }));
  } else {
    evidenceUsed.push('lifecycle_stage_coverage');
  }

  if (!checks[4].passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14067_DATA_QUALITY_LOW',
      severity: 'medium',
      message: 'Data quality confidence is below ISO 14067 operational target.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'medium',
      title: 'Improve product-level data quality',
      action: 'Increase primary data share for product processes and supplier stages.'
    }));
  } else {
    evidenceUsed.push('quality_confidence_gate');
  }

  if (!checks[5].passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14067_BOUNDARY_DEFINITION_MISSING',
      severity: 'high',
      message: 'Boundary definition is missing for product carbon footprint reporting.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'high',
      title: 'Document system boundary definition',
      action: 'Define boundary type, included lifecycle stages, temporal/geographical coverage, and cut-off criteria.'
    }));
  } else {
    evidenceUsed.push('boundary_definition');
  }

  if (!checks[6].passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14067_BOUNDARY_RIGOR_LOW',
      severity: 'medium',
      message: 'Boundary rigor score is below ISO 14067 operational target.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'medium',
      title: 'Increase boundary rigor',
      action: 'Improve stage-specific rationale and document temporal, geographic, and cut-off assumptions.'
    }));
  } else {
    evidenceUsed.push('boundary_rigor');
  }

  if (!checks[7].passed) {
    issues.push(buildIssue({
      framework,
      code: 'ISO14067_LCI_GRANULARITY_LOW',
      severity: 'high',
      message: 'Product-level LCI granularity is below ISO 14067 target.'
    }));
    recommendations.push(buildRecommendation({
      framework,
      priority: 'high',
      title: 'Improve product-level LCI granularity',
      action: 'Capture stage-level activity data with factor references and allocation keys for each product.'
    }));
  } else {
    evidenceUsed.push('product_level_lci');
  }

  const passedChecks = checks.filter(check => check.passed).length;
  const readinessScore = checks.length > 0
    ? Math.round((passedChecks / checks.length) * 100)
    : 0;

  return {
    framework,
    enabled: true,
    readinessScore,
    checks,
    issues,
    recommendations,
    evidenceUsed,
    lifecycleStageCoverage: stageCoverage,
    status: issues.length > 0 ? 'gaps_detected' : 'aligned'
  };
};

const suggestEnergyOptimizations = () => [];
const suggestWasteOptimizations = () => [];
const suggestTransportOptimizations = () => [];
const suggestProcessOptimizations = () => [];
const calculatePotentialSavings = () => 0;
const prioritizeOptimizations = (optimizations) => optimizations;

const safeRound = (value, decimals = 2) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
};

const SENSITIVE_PATTERNS = [
  { label: 'email', regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, replacement: '[redacted-email]' },
  { label: 'phone', regex: /(\+?\d[\d\s-]{7,}\d)/g, replacement: '[redacted-phone]' },
  { label: 'pan', regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, replacement: '[redacted-pan]' },
  { label: 'gst', regex: /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, replacement: '[redacted-gst]' },
  { label: 'udyam', regex: /\bUDYAM-[A-Z]{2}-\d{2}-\d{7}\b/g, replacement: '[redacted-udyam]' }
];

const redactSensitiveText = (value) => {
  if (value === null || value === undefined) return value;
  let text = String(value);
  SENSITIVE_PATTERNS.forEach(pattern => {
    text = text.replace(pattern.regex, pattern.replacement);
  });
  return text;
};

const redactTransaction = (transaction) => {
  if (!transaction || typeof transaction !== 'object') return transaction;
  const redacted = { ...transaction };
  const fieldsToRedact = ['description', 'vendor', 'counterparty', 'reference', 'referenceId', 'notes'];
  fieldsToRedact.forEach(field => {
    if (typeof redacted[field] === 'string') {
      redacted[field] = redactSensitiveText(redacted[field]);
    }
  });
  return redacted;
};

const dataPrivacyAgent = async (task) => {
  const { input } = task || {};
  const transactions = Array.isArray(input?.transactions) ? input.transactions : [];
  const msmeData = input?.msmeData || {};
  const policyUpdates = input?.policyUpdates || input?.context?.policyUpdates;

  const redactedTransactions = transactions.map(redactTransaction);

  return {
    redactedTransactions,
    redactionSummary: {
      totalTransactions: transactions.length,
      redactedFields: ['description', 'vendor', 'counterparty', 'reference', 'referenceId', 'notes'],
      appliedRules: SENSITIVE_PATTERNS.map(pattern => pattern.label),
      policyStatus: policyUpdates?.status || 'placeholder'
    },
    policyContext: policyUpdates || {
      status: 'placeholder',
      notes: 'Government policy updates pending ingestion.'
    },
    msmeSnapshot: {
      companyName: msmeData.companyName,
      businessDomain: msmeData.businessDomain
    }
  };
};

const verifiedSourceRagAgent = async (task) => {
  const { input = {} } = task || {};
  const candidates = Array.isArray(input.candidates)
    ? input.candidates
    : (Array.isArray(input.transactions) ? input.transactions : []);
  const businessDomain = input.businessDomain || input.msmeData?.businessDomain || 'other';
  const context = {
    businessDomain,
    transactionType: input.transactionType || 'other',
    parameterType: input.parameterType || 'transaction',
    location: input.location || input.msmeData?.contact?.address?.state || ''
  };

  const classifications = verifiedKnowledgeRagService.classifyBatch(candidates, context).map(result => ({
    candidate: result.item,
    classification: result.result
  }));

  return {
    totalCandidates: candidates.length,
    resolvedCandidates: classifications.length,
    unresolvedCandidates: Math.max(0, candidates.length - classifications.length),
    classifications,
    verifiedSources: verifiedKnowledgeRagService.getVerifiedSources(),
    retrievalMethod: 'verified_registry_rag'
  };
};

const mapDocumentToTransactionType = (documentType) => {
  switch (documentType) {
    case 'invoice':
    case 'bill':
      return 'expense';
    case 'receipt':
      return 'purchase';
    case 'statement':
      return 'other';
    default:
      return 'other';
  }
};

const buildDocumentTransaction = (document) => {
  const extracted = document?.extractedData || {};
  if (!extracted.amount || !extracted.date) {
    return null;
  }
  return {
    source: 'document',
    sourceId: document._id?.toString() || document.fileName || `doc_${Date.now()}`,
    transactionType: mapDocumentToTransactionType(document.documentType),
    amount: extracted.amount,
    currency: extracted.currency || 'INR',
    description: extracted.description || document.originalName || 'Document transaction',
    vendor: extracted.vendor || { name: extracted.vendor?.name || null },
    category: extracted.category || 'other',
    subcategory: extracted.subcategory || 'general',
    date: extracted.date,
    metadata: {
      documentId: document._id?.toString(),
      documentType: document.documentType,
      documentName: document.originalName,
      extractedData: extracted
    }
  };
};

const documentAnalyzerAgent = async (task) => {
  const { input } = task || {};
  const documents = Array.isArray(input?.documents) ? input.documents : [];

  const summary = {
    totalDocuments: documents.length,
    processedDocuments: documents.filter(doc => doc?.status === 'processed').length,
    documentTypes: {},
    categoryBreakdown: {},
    vendorBreakdown: {},
    totalAmount: 0,
    averageAmount: 0,
    dateRange: { start: null, end: null }
  };

  const derivedTransactions = [];

  documents.forEach(document => {
    const documentType = document?.documentType || 'other';
    summary.documentTypes[documentType] = (summary.documentTypes[documentType] || 0) + 1;

    const extracted = document?.extractedData || {};
    if (extracted.category) {
      summary.categoryBreakdown[extracted.category] = (summary.categoryBreakdown[extracted.category] || 0) + 1;
    }
    if (extracted.vendor?.name) {
      summary.vendorBreakdown[extracted.vendor.name] = (summary.vendorBreakdown[extracted.vendor.name] || 0) + 1;
    }
    if (Number.isFinite(extracted.amount)) {
      summary.totalAmount += extracted.amount;
    }
    if (extracted.date) {
      const docDate = new Date(extracted.date);
      if (!summary.dateRange.start || docDate < new Date(summary.dateRange.start)) {
        summary.dateRange.start = docDate.toISOString();
      }
      if (!summary.dateRange.end || docDate > new Date(summary.dateRange.end)) {
        summary.dateRange.end = docDate.toISOString();
      }
    }

    const transaction = buildDocumentTransaction(document);
    if (transaction) {
      derivedTransactions.push(transaction);
    }
  });

  summary.averageAmount = documents.length > 0 ? summary.totalAmount / documents.length : 0;

  return {
    summary,
    derivedTransactions,
    documentIds: documents.map(document => document?._id?.toString()).filter(Boolean)
  };
};

const summarizeDataQuality = (dataQuality = {}) => ({
  confidence: Number.isFinite(dataQuality.confidence) ? dataQuality.confidence : null,
  completeness: Number.isFinite(dataQuality.completeness) ? dataQuality.completeness : null,
  consistency: Number.isFinite(dataQuality.consistency) ? dataQuality.consistency : null,
  coverage: Number.isFinite(dataQuality.coverage) ? dataQuality.coverage : null
});

const summarizeKnownParameters = (known = {}) => ({
  processCount: Array.isArray(known.processes) ? known.processes.length : 0,
  machineryCount: Array.isArray(known.machinery) ? known.machinery.length : 0,
  waterConsumption: known.waterConsumption?.total ?? null,
  fuelConsumption: known.fuelConsumption?.total ?? null,
  wasteGeneration: known.wasteGeneration?.total ?? null,
  materialsConsumption: known.materialsConsumption?.total ?? null,
  chemicalsConsumption: known.chemicalsConsumption?.total ?? null,
  airPollutants: Array.isArray(known.airPollution?.pollutants) ? known.airPollution.pollutants.length : 0
});

const summarizeUnknownParameters = (unknown = {}) => ({
  needsReview: Boolean(unknown.needsReview),
  detectedCategories: Array.isArray(unknown.detectedCategories)
    ? unknown.detectedCategories.slice(0, 5)
    : [],
  weightedCount: Array.isArray(unknown.weightedParameters)
    ? unknown.weightedParameters.length
    : 0
});

const summarizeFrameworks = (frameworks = {}) => ({
  iso14064: frameworks.iso14064 ? {
    enabled: frameworks.iso14064.enabled !== false,
    baseYear: frameworks.iso14064.baseYear || null
  } : null,
  iso14067: frameworks.iso14067 ? {
    enabled: frameworks.iso14067.enabled !== false,
    functionalUnit: frameworks.iso14067.functionalUnit || null
  } : null
});

const summarizeDocumentContext = (documentAnalysis, context = {}) => {
  const summary = documentAnalysis?.summary || context.documentSummary || {};
  return {
    totalDocuments: Number.isFinite(summary.totalDocuments) ? summary.totalDocuments : 0,
    processedDocuments: Number.isFinite(summary.processedDocuments) ? summary.processedDocuments : 0,
    categoryCount: summary.categoryBreakdown ? Object.keys(summary.categoryBreakdown).length : 0,
    vendorCount: summary.vendorBreakdown ? Object.keys(summary.vendorBreakdown).length : 0
  };
};

const buildSharedContext = ({
  stage,
  orchestrationId,
  msmeSnapshot,
  context = {},
  orchestrationPlan,
  transactions = [],
  processedTransactions = [],
  agentOutputs = {}
}) => {
  const transactionCount = processedTransactions.length || transactions.length;
  const dataQuality = summarizeDataQuality(context.dataQuality || agentOutputs.dataQuality);
  const knownParameters = summarizeKnownParameters(context.knownParameters);
  const unknownParameters = summarizeUnknownParameters(context.unknownParameters);
  const documentContext = summarizeDocumentContext(agentOutputs.documentAnalysis, context);
  const frameworks = summarizeFrameworks(context.frameworks);

  return {
    stage,
    orchestrationId: orchestrationId || null,
    msme: msmeSnapshot || null,
    businessDomain: context.businessDomain,
    industry: context.industry,
    region: context.region,
    season: context.season,
    transactionCount,
    dataQuality,
    knownParameters,
    unknownParameters,
    frameworks,
    policyStatus: context.policyUpdates?.status || 'unknown',
    documentContext,
    orchestrationPlan: orchestrationPlan ? {
      coordinationMode: orchestrationPlan.coordinationMode,
      parallelAgents: orchestrationPlan.parallelAgents,
      outputs: orchestrationPlan.outputs
    } : null
  };
};

const buildAgentBriefings = (sharedContext, input = {}) => {
  const baseBriefing = {
    stage: sharedContext.stage,
    orchestrationId: sharedContext.orchestrationId,
    policyStatus: sharedContext.policyStatus,
    dataQuality: sharedContext.dataQuality,
    transactionCount: sharedContext.transactionCount
  };

  return {
    data_processor: {
      ...baseBriefing,
      focus: 'data_enrichment',
      documentContext: sharedContext.documentContext,
      knownParameters: sharedContext.knownParameters
    },
    carbon_analyzer: {
      ...baseBriefing,
      focus: 'emissions_analysis',
      behaviorSignals: input.context?.behaviorSignals || {},
      knownParameters: sharedContext.knownParameters,
      unknownParameters: sharedContext.unknownParameters
    },
    anomaly_detector: {
      ...baseBriefing,
      focus: 'risk_detection',
      unknownParameters: sharedContext.unknownParameters
    },
    trend_analyzer: {
      ...baseBriefing,
      focus: 'trend_context',
      documentContext: sharedContext.documentContext
    },
    compliance_monitor: {
      ...baseBriefing,
      focus: 'regulatory_checks',
      policyStatus: sharedContext.policyStatus,
      frameworks: sharedContext.frameworks,
      knownParameters: sharedContext.knownParameters,
      unknownParameters: sharedContext.unknownParameters,
      inventoryGovernance: sharedContext.inventoryGovernance
    },
    inventory_governance: {
      ...baseBriefing,
      focus: 'ghg_inventory_governance',
      frameworks: sharedContext.frameworks
    },
    optimization_advisor: {
      ...baseBriefing,
      focus: 'optimization_targets',
      knownParameters: sharedContext.knownParameters
    },
    recommendation_engine: {
      ...baseBriefing,
      focus: 'recommendation_alignment',
      orchestrationPlan: sharedContext.orchestrationPlan
    },
    verified_source_rag: {
      ...baseBriefing,
      focus: 'verified_unknown_resolution',
      unknownParameters: sharedContext.unknownParameters,
      knownParameters: sharedContext.knownParameters
    },
    report_generator: {
      ...baseBriefing,
      focus: 'report_alignment',
      orchestrationPlan: sharedContext.orchestrationPlan
    },
    inventory_quality_advisor: {
      ...baseBriefing,
      focus: 'ghg_inventory_rigor',
      dataQuality: sharedContext.dataQuality
    },
    buyer_request_advisor: {
      ...baseBriefing,
      focus: 'buyer_audit_evidence',
      documentContext: sharedContext.documentContext
    },
    msme_goal_advisor: {
      ...baseBriefing,
      focus: 'goal_prioritization'
    },
    dpdp_privacy_advisor: {
      ...baseBriefing,
      focus: 'dpdp_consent_alignment'
    },
    environmental_kpi_advisor: {
      ...baseBriefing,
      focus: 'water_waste_kpis'
    }
  };
};

const buildOrchestrationMessages = (sharedContext) => {
  const messages = [];
  const timestamp = new Date().toISOString();

  const pushMessage = (targets, message, severity = 'info', context = {}) => {
    messages.push({
      targets: Array.isArray(targets) ? targets : [targets],
      message,
      severity,
      context,
      timestamp
    });
  };

  if (Number.isFinite(sharedContext.dataQuality?.confidence) &&
      sharedContext.dataQuality.confidence < 0.6) {
    pushMessage('broadcast', 'Data quality is below target; interpret results cautiously.', 'warning', {
      confidence: sharedContext.dataQuality.confidence
    });
  }

  if (sharedContext.unknownParameters?.needsReview) {
    pushMessage(['anomaly_detector', 'compliance_monitor'], 'Unknown parameters detected; prioritize review.', 'warning', {
      detectedCategories: sharedContext.unknownParameters.detectedCategories
    });
    pushMessage(
      ['verified_source_rag', 'data_processor'],
      'Unknown parameters require verified-source RAG resolution before final emissions lock.',
      'warning',
      { detectedCategories: sharedContext.unknownParameters.detectedCategories }
    );
  }

  if (sharedContext.policyStatus === 'placeholder') {
    pushMessage('compliance_monitor', 'Policy updates are placeholders; note regulatory uncertainty.', 'info');
  }

  if (sharedContext.frameworks?.iso14064?.enabled || sharedContext.frameworks?.iso14067?.enabled) {
    pushMessage(
      ['compliance_monitor', 'report_generator'],
      'ISO framework monitoring is enabled for this orchestration run.',
      'info',
      { frameworks: sharedContext.frameworks }
    );
  }

  if (sharedContext.documentContext?.totalDocuments === 0 && sharedContext.transactionCount > 0) {
    pushMessage('data_processor', 'No document context available; consider requesting supporting documents.', 'info');
  }

  return messages;
};

const orchestrationAgent = async (task) => {
  const { input } = task || {};
  const stage = input?.stage || 'unknown';
  const context = input?.context || {};
  const coordinationContext = input?.coordinationContext || {};
  const orchestrationId = input?.orchestrationId || coordinationContext.orchestrationId || null;

  const sharedContext = buildSharedContext({
    stage,
    orchestrationId,
    msmeSnapshot: input?.msmeSnapshot,
    context,
    orchestrationPlan: input?.orchestrationPlan,
    transactions: Array.isArray(input?.transactions) ? input.transactions : [],
    processedTransactions: Array.isArray(input?.processedTransactions) ? input.processedTransactions : [],
    agentOutputs: input?.agentOutputs || {}
  });

  const agentBriefings = buildAgentBriefings(sharedContext, input);
  const messages = buildOrchestrationMessages(sharedContext);

  return {
    stage,
    updatedAt: new Date().toISOString(),
    summary: {
      transactionCount: sharedContext.transactionCount,
      dataQuality: sharedContext.dataQuality,
      unknownParameters: sharedContext.unknownParameters,
      policyStatus: sharedContext.policyStatus
    },
    sharedContext,
    agentBriefings,
    messages
  };
};

const carbonAnalyzerAgent = async (task) => {
  const { input } = task || {};
  const transactions = Array.isArray(input?.transactions) ? input.transactions : [];

  if (transactions.length === 0) {
    return { error: 'Invalid input for carbon analyzer' };
  }

  const msmeData = input.msmeData || input.context?.msmeData || {};
  const rawAnalysis = await carbonAnalyzerAgentImpl.analyzeTransactions(transactions, {
    ...msmeData,
    context: input.context || {}
  });

  return normalizeCarbonAnalysisResponse(rawAnalysis);
};

const recommendationEngineAgent = async (task) => {
  const { input } = task || {};
  return recommendationEngineAgentImpl.generateRecommendations({
    carbonData: input?.carbonData ? normalizeCarbonDataForRecommendations(input.carbonData) : undefined,
    transactions: input?.transactions,
    msmeData: input?.msmeData,
    trends: input?.trends,
    anomalies: input?.anomalies,
    compliance: input?.compliance,
    optimization: input?.optimization
  });
};

const reportGeneratorAgent = async (task) => {
  const { input } = task || {};
  return reportGeneratorAgentImpl.generateReport(input || {});
};

const dataProcessorAgent = async (task) => {
  const { input } = task || {};
  const transactions = Array.isArray(input?.transactions) ? input.transactions : [];

  if (transactions.length === 0) {
    return {
      cleaned: [],
      classified: [],
      enriched: [],
      validated: [],
      documentRequests: [],
      statistics: {
        totalProcessed: 0,
        successfullyClassified: 0,
        validationErrors: 0,
        enrichmentApplied: 0,
        uncertainTransactions: 0,
        documentRequests: 0,
        autoLearnedCategories: 0,
        autoLearnedTransactionTypes: 0
      }
    };
  }

  return dataProcessorService.processTransactions(transactions, {
    context: input?.context,
    documents: input?.documents,
    documentSummary: input?.documentSummary,
    transactionTypeContext: input?.transactionTypeContext,
    thresholds: input?.thresholds || input?.orchestrationOptions?.thresholds || input?.context?.orchestrationOptions?.thresholds
  });
};

const anomalyDetectorAgent = async (task) => {
  const { input } = task || {};
  const transactions = Array.isArray(input?.transactions) ? input.transactions : [];
  const anomalies = [];

  if (transactions.length > 0) {
    const patterns = analyzeTransactionPatterns(transactions);
    anomalies.push(...detectEmissionAnomalies(patterns));
    anomalies.push(...detectSpendingAnomalies(patterns));
    anomalies.push(...detectFrequencyAnomalies(patterns));
  }

  return {
    anomalies,
    totalDetected: anomalies.length,
    severity: calculateAnomalySeverity(anomalies)
  };
};

const trendAnalyzerAgent = async (task) => {
  const { input } = task || {};
  const trendInput = {
    transactions: input?.transactions
      || input?.data?.transactions
      || (Array.isArray(input?.data) ? input.data : [])
  };
  const trends = {
    emissions: analyzeEmissionTrends(trendInput),
    spending: analyzeSpendingTrends(trendInput),
    efficiency: analyzeEfficiencyTrends(trendInput),
    sustainability: analyzeSustainabilityTrends(trendInput)
  };

  return {
    trends,
    predictions: generateTrendPredictions(trends),
    insights: generateTrendInsights(trends)
  };
};

const complianceMonitorAgent = async (task) => {
  const { input } = task;
  const isoGapClosureService = getIsoGapClosureService();
  const compliance = {
    status: 'compliant',
    issues: [],
    recommendations: [],
    frameworks: {},
    readinessScore: 0,
    gapClosureChecklist: null
  };

  if (input.carbonData) {
    const envCompliance = checkEnvironmentalCompliance(input.carbonData);
    compliance.issues.push(...envCompliance.issues);
    compliance.recommendations.push(...envCompliance.recommendations);
  }

  if (input.regulations) {
    const regCompliance = checkRegulatoryCompliance(input.regulations, input.data);
    compliance.issues.push(...regCompliance.issues);
    compliance.recommendations.push(...regCompliance.recommendations);
  }

  const iso14064 = evaluateIso14064(input);
  const iso14067 = evaluateIso14067(input);
  const enabledFrameworks = [iso14064, iso14067].filter(framework => framework.enabled);

  enabledFrameworks.forEach(frameworkResult => {
    compliance.frameworks[frameworkResult.framework] = frameworkResult;
    compliance.issues.push(...frameworkResult.issues);
    compliance.recommendations.push(...frameworkResult.recommendations);
  });

  if (enabledFrameworks.length > 0) {
    const totalReadiness = enabledFrameworks.reduce((sum, frameworkResult) => (
      sum + frameworkResult.readinessScore
    ), 0);
    compliance.readinessScore = Math.round(totalReadiness / enabledFrameworks.length);
  }

  compliance.gapClosureChecklist = isoGapClosureService.buildIsoGapClosureChecklist({
    ...input,
    frameworks: input.frameworks || input.context?.frameworks,
    context: input.context || {}
  });

  const checklistActions = Array.isArray(compliance.gapClosureChecklist?.priorityActions)
    ? compliance.gapClosureChecklist.priorityActions
    : [];
  compliance.recommendations.push(...checklistActions.map(action => ({
    framework: 'ISO Gap Closure',
    priority: action.priority,
    title: action.action,
    action: action.detail
  })));

  if (input.inventoryGovernance?.assuranceGate?.evaluation) {
    const gov = input.inventoryGovernance.assuranceGate.evaluation;
    compliance.inventoryGovernance = {
      assuranceReady: gov.assuranceReady,
      readinessStatus: gov.readinessStatus,
      blockers: gov.blockers,
      warnings: gov.warnings
    };
    if (!gov.assuranceReady) {
      compliance.status = 'non_compliant';
      gov.blockers.forEach((blocker) => {
        compliance.issues.push({
          code: blocker.code,
          message: blocker.message,
          source: 'inventory_governance'
        });
      });
    }
  }

  if (compliance.issues.length > 0) {
    compliance.status = 'non_compliant';
  }

  return compliance;
};

const isoEvidenceCollectorAgent = async (task) => {
  const { input = {} } = task || {};
  const isoGapClosureService = getIsoGapClosureService();
  const checklist = input.gapClosureChecklist || isoGapClosureService.buildIsoGapClosureChecklist(input);
  const documents = Array.isArray(input.documents) ? input.documents : [];
  const transactions = Array.isArray(input.transactions) ? input.transactions : [];
  const factorRegistry = Array.isArray(input.factorRegistry) && input.factorRegistry.length > 0
    ? input.factorRegistry
    : (checklist.factorRegistry || []);

  const evidenceRegister = {
    boundary: {
      name: 'Boundary definitions',
      evidenceCount: checklist.sections?.boundaryDefinitions?.items?.filter(item => item.status === 'complete').length || 0,
      requiredCount: checklist.sections?.boundaryDefinitions?.items?.length || 0,
      records: checklist.sections?.boundaryDefinitions?.items || []
    },
    factors: {
      name: 'Emission factor registry',
      evidenceCount: factorRegistry.length,
      requiredCount: 4,
      records: factorRegistry
    },
    uncertainty: {
      name: 'Uncertainty records',
      evidenceCount: checklist.sections?.uncertaintyFields?.items?.filter(item => item.status === 'complete').length || 0,
      requiredCount: checklist.sections?.uncertaintyFields?.items?.length || 0,
      records: checklist.sections?.uncertaintyFields?.items || []
    },
    productCFP: {
      name: 'Product CFP skeleton',
      evidenceCount: checklist.sections?.productCfpModuleSkeleton?.items?.filter(item => item.status === 'complete').length || 0,
      requiredCount: checklist.sections?.productCfpModuleSkeleton?.items?.length || 0,
      records: checklist.sections?.productCfpModuleSkeleton?.items || []
    },
    sourceData: {
      documentsProcessed: documents.length,
      transactionsProcessed: transactions.length,
      generatedAt: new Date().toISOString()
    }
  };

  return {
    certificationStage: 'evidence_collection',
    checklistSummary: {
      overallReadinessScore: checklist.overallReadinessScore,
      openGapCount: Array.isArray(checklist.openGaps) ? checklist.openGaps.length : 0
    },
    evidenceRegister
  };
};

const isoGapClosurePlannerAgent = async (task) => {
  const { input = {} } = task || {};
  const isoGapClosureService = getIsoGapClosureService();
  const checklist = input.gapClosureChecklist || isoGapClosureService.buildIsoGapClosureChecklist(input);
  const openGaps = Array.isArray(checklist.openGaps) ? checklist.openGaps : [];
  const ownerMap = {
    boundary_definitions: 'Sustainability Lead',
    factor_registry: 'Data & Inventory Team',
    uncertainty_fields: 'GHG Accounting Team',
    product_cfp_module_skeleton: 'Product Sustainability Team'
  };

  const actionPlan = openGaps.map((gap, index) => {
    const daysToClose = index < 3 ? 14 : index < 8 ? 30 : 45;
    const dueDate = new Date(Date.now() + daysToClose * 24 * 60 * 60 * 1000);
    return {
      id: `iso_gap_action_${index + 1}`,
      section: gap.section,
      title: gap.title,
      owner: ownerMap[gap.section] || 'Compliance Team',
      priority: index < 3 ? 'high' : index < 8 ? 'medium' : 'low',
      dueDate: dueDate.toISOString().slice(0, 10),
      description: gap.description,
      status: 'open'
    };
  });

  return {
    certificationStage: 'gap_closure_planning',
    openGapCount: openGaps.length,
    actionPlan,
    summary: {
      highPriorityActions: actionPlan.filter(action => action.priority === 'high').length,
      mediumPriorityActions: actionPlan.filter(action => action.priority === 'medium').length,
      lowPriorityActions: actionPlan.filter(action => action.priority === 'low').length
    }
  };
};

const isoAuditPackagerAgent = async (task) => {
  const { input = {} } = task || {};
  const checklist = input.gapClosureChecklist || {};
  const evidenceRegister = input.evidenceRegister || {};
  const actionPlan = Array.isArray(input.actionPlan) ? input.actionPlan : [];
  const overallReadinessScore = Number.isFinite(checklist.overallReadinessScore)
    ? checklist.overallReadinessScore
    : 0;

  const packageSections = [
    'Management and boundary declaration',
    'GHG inventory methodology and factor sources',
    'Uncertainty quantification and controls',
    'Product CFP module definition and lifecycle assumptions',
    'Gap closure plan and remediation tracking'
  ];

  return {
    certificationStage: 'audit_packaging',
    auditPackage: {
      generatedAt: new Date().toISOString(),
      readinessScore: overallReadinessScore,
      packageSections,
      evidenceSummary: {
        boundaryItems: evidenceRegister.boundary?.evidenceCount || 0,
        factorEntries: evidenceRegister.factors?.evidenceCount || 0,
        uncertaintyItems: evidenceRegister.uncertainty?.evidenceCount || 0,
        productCfpItems: evidenceRegister.productCFP?.evidenceCount || 0
      },
      openActions: actionPlan.filter(action => action.status !== 'closed').length
    },
    certificationStatus: overallReadinessScore >= 85
      ? 'ready_for_external_verification'
      : 'gap_closure_required'
  };
};

const optimizationAdvisorAgent = async (task) => {
  const { input } = task;
  const optimizations = [];

  if (input.carbonData) {
    optimizations.push(...suggestEnergyOptimizations(input.carbonData));
    optimizations.push(...suggestWasteOptimizations(input.carbonData));
    optimizations.push(...suggestTransportOptimizations(input.carbonData));
  }

  if (input.processes) {
    optimizations.push(...suggestProcessOptimizations(input.processes));
  }

  return {
    optimizations,
    potentialSavings: calculatePotentialSavings(optimizations),
    implementationPriority: prioritizeOptimizations(optimizations)
  };
};

const handlers = {
  carbon_analyzer: carbonAnalyzerAgent,
  data_privacy: dataPrivacyAgent,
  verified_source_rag: verifiedSourceRagAgent,
  document_analyzer: documentAnalyzerAgent,
  orchestration_agent: orchestrationAgent,
  recommendation_engine: recommendationEngineAgent,
  data_processor: dataProcessorAgent,
  anomaly_detector: anomalyDetectorAgent,
  trend_analyzer: trendAnalyzerAgent,
  compliance_monitor: complianceMonitorAgent,
  iso_evidence_collector: isoEvidenceCollectorAgent,
  iso_gap_closure_planner: isoGapClosurePlannerAgent,
  iso_audit_packager: isoAuditPackagerAgent,
  optimization_advisor: optimizationAdvisorAgent,
  report_generator: reportGeneratorAgent,
  inventory_governance: async (task) => {
    const orchestrator = require('../../ghgInventoryGovernanceOrchestrator');
    return orchestrator.runGhgInventoryGovernanceOrchestration(task.input || task);
  }
};

const getHandler = (type) => handlers[type];

module.exports = {
  handlers,
  getHandler,
  helpers: {
    generateCarbonInsights,
    generateCarbonRecommendations,
    generateSustainabilityRecommendations,
    generateTransactionRecommendations,
    cleanTransactionData,
    classifyTransaction,
    enrichTransactionData,
    validateForCarbonCalculation,
    analyzeTransactionPatterns,
    detectEmissionAnomalies,
    detectSpendingAnomalies,
    detectFrequencyAnomalies,
    calculateAnomalySeverity,
    analyzeEmissionTrends,
    analyzeSpendingTrends,
    analyzeEfficiencyTrends,
    analyzeSustainabilityTrends,
    generateTrendPredictions,
    generateTrendInsights,
    checkEnvironmentalCompliance,
    checkRegulatoryCompliance,
    evaluateIso14064,
    evaluateIso14067,
    resolveIsoFrameworkConfig,
    buildIsoGapClosureChecklist: (...args) => getIsoGapClosureService().buildIsoGapClosureChecklist(...args),
    isoEvidenceCollectorAgent,
    isoGapClosurePlannerAgent,
    isoAuditPackagerAgent,
    suggestEnergyOptimizations,
    suggestWasteOptimizations,
    suggestTransportOptimizations,
    suggestProcessOptimizations,
    calculatePotentialSavings,
    prioritizeOptimizations,
    generateReportSummary,
    generateCarbonSection,
    generateCarbonCharts,
    generateTrendsSection,
    generateTrendCharts,
    generateRecommendationsSection
  }
};
