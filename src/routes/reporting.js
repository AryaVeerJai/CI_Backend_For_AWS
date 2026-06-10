const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  loadOrgReportingContext,
  buildAssessmentFilterForUser,
  buildTransactionFilterForUser
} = require('../services/complianceHubService');
const { assertReportingProfile } = require('../utils/reportingProfileGate');
const MSME = require('../models/MSME');
const CarbonAssessment = require('../models/CarbonAssessment');
const Transaction = require('../models/Transaction');
const Document = require('../models/Document');
const ComplianceHubRecord = require('../models/ComplianceHubRecord');
const carbonCalculationService = require('../services/carbonCalculationService');
const carbonCreditsService = require('../services/carbonCreditsService');
const User = require('../models/User');
const isoGapClosureService = require('../services/isoGapClosureService');
const { buildBRSRReport } = require('../services/brsrReportingService');
const { helpers: standardHandlerHelpers } = require('../services/agents/handlers/standardHandlers');
const {
  generateBRSRReportPdf,
  generateGenericReportPdf,
  generateCbamReportPdf
} = require('../services/pdfReportService');
const {
  aggregateTransactionEmissionsByProduct,
  applyReportingConfigurationToBreakdown
} = require('../utils/reportingProductAggregation');
const { getOperationalProfile } = require('../services/organizationProfileService');
const sendEmail = require('../utils/sendEmail');
const { requireMsmePlanFeature } = require('../middleware/enforceMsmePlanLimits');
const { assertMsmeFeatureAccess } = require('../services/planEntitlementService');
const {
  enrichCbamGoodsWithTiers,
  assessCbamSubmissionReadiness,
  resolveCbamComplianceStatus,
  buildSebiBrsrExport,
  buildBrsrXbrlSkeleton,
  buildCbamRegistryCsv,
  buildIso14064AuditPack,
  validateIso14067ReportGate,
  buildReportReadinessMeta
} = require('../services/reportStandardsExportService');

const ensureBrsrExportAccess = async (req, res) => {
  const access = await assertMsmeFeatureAccess({
    userId: req.user.userId,
    msmeId: req.user.msmeId,
    role: req.user.role,
    feature: 'brsrExports'
  });
  if (!access.allowed) {
    res.status(403).json(access.denial);
    return false;
  }
  return true;
};

const mapAssessmentRecommendationToApi = (rec = {}, index = 0) => {
  const implementationCost = safeNumber(rec.implementationCost ?? rec.estimatedSavings);
  const priority = String(rec.priority || '').toLowerCase();
  const impact = priority === 'high' || priority === 'very high'
    ? 'High'
    : priority === 'medium'
      ? 'Medium'
      : 'Low';
  const cost = implementationCost >= 30000 ? 'High' : implementationCost >= 10000 ? 'Medium' : 'Low';
  const status = rec.isImplemented || rec.status === 'completed'
    ? 'Completed'
    : rec.status === 'in_progress' || rec.status === 'In Progress'
      ? 'In Progress'
      : 'Not Implemented';

  return {
    id: rec.id || rec._id || index + 1,
    title: rec.title || 'Recommendation',
    category: rec.category || null,
    impact,
    cost,
    savings: rec.description || rec.savings || '',
    status,
    priority: index + 1,
    estimatedCO2Reduction: safeRound(safeNumber(rec.potentialCO2Reduction ?? rec.estimatedCO2Reduction), 1),
    estimatedSavings: safeRound(implementationCost, 0),
    implementationTime: rec.paybackPeriod
      ? `${rec.paybackPeriod} month payback`
      : rec.implementationTime || null
  };
};

const buildRecommendationsPayload = (assessment, msme) => {
  if (!assessment) {
    return { items: [], dataStatus: 'no_assessments' };
  }

  const stored = Array.isArray(assessment.recommendations) ? assessment.recommendations : [];
  const items = (stored.length > 0
    ? stored
    : carbonCalculationService.generateRecommendations(assessment, msme)
  ).map(mapAssessmentRecommendationToApi);

  return {
    items,
    dataStatus: items.length > 0 ? 'available' : 'no_recommendations'
  };
};

const resolveIsCbamExporter = (msme = {}, transactions = [], hubRecord = null) => {
  const exportMarkets = [
    ...(Array.isArray(msme?.business?.exportMarkets) ? msme.business.exportMarkets : []),
    ...(Array.isArray(hubRecord?.exportProfile?.primaryRegions) ? hubRecord.exportProfile.primaryRegions : [])
  ].filter(Boolean);

  if (msme?.businessDomain === 'export_import') {
    return true;
  }
  if (msme?.manufacturingProfile?.exportActivity === true) {
    return true;
  }
  if (exportMarkets.some((market) => /eu|europe|european union/i.test(String(market)))) {
    return true;
  }
  if (Array.isArray(hubRecord?.exportProfile?.cbamGoodsCategories) && hubRecord.exportProfile.cbamGoodsCategories.length > 0) {
    return true;
  }

  return transactions.some((transaction) => {
    const type = String(transaction?.transactionType || '').toLowerCase();
    const description = String(transaction?.description || '').toLowerCase();
    return type === 'sale' || description.includes('export') || description.includes('shipment');
  });
};

const deriveCbamDocumentationStatus = ({
  isExporter,
  assessments = [],
  transactions = [],
  hubRecord = null
}) => {
  const hasAssessments = assessments.length > 0;
  const hasEnergyEvidence = transactions.some((transaction) => (
    ['energy', 'utilities', 'telecom'].includes(String(transaction?.category || '').toLowerCase())
  ));
  const hasExportTransactions = transactions.some((transaction) => {
    const type = String(transaction?.transactionType || '').toLowerCase();
    const description = String(transaction?.description || '').toLowerCase();
    return type === 'sale' || description.includes('export') || description.includes('shipment');
  });
  const hasSupplierEvidence = Array.isArray(hubRecord?.exportProfile?.cbamGoodsCategories)
    && hubRecord.exportProfile.cbamGoodsCategories.length > 0;
  const verificationReady = ['ready_for_review', 'assurance_ready'].includes(
    String(hubRecord?.assurance?.readinessStatus || '')
  );

  const statusFor = (complete, inProgress) => {
    if (complete) return 'complete';
    if (inProgress) return 'in_progress';
    return 'missing';
  };

  return [
    {
      id: 'quarterly_submission',
      title: 'Quarterly CBAM submission packet',
      status: statusFor(false, isExporter && hasAssessments && hasExportTransactions),
      owner: 'Compliance'
    },
    {
      id: 'supplier',
      title: 'Supplier indirect-emission evidence',
      status: statusFor(false, isExporter && hasSupplierEvidence),
      owner: 'Procurement'
    },
    {
      id: 'production',
      title: 'Production direct-emission ledger',
      status: statusFor(false, isExporter && hasAssessments),
      owner: 'Operations'
    },
    {
      id: 'electricity',
      title: 'Purchased electricity supporting data',
      status: statusFor(isExporter && hasEnergyEvidence, isExporter && hasAssessments && !hasEnergyEvidence),
      owner: 'Utilities'
    },
    {
      id: 'verification',
      title: 'Third-party verification plan',
      status: statusFor(isExporter && verificationReady, isExporter && hasAssessments && !verificationReady),
      owner: 'Compliance'
    }
  ];
};

const buildComparisonDataFromContext = (latestAssessment, msme, previousAssessment = null) => {
  if (!latestAssessment) {
    return {
      dataStatus: 'no_assessments',
      industryAverage: null,
      userPerformance: null,
      performanceImprovement: null,
      goalProgress: null,
      benchmarkData: [],
      industryBenchmarkAvailable: false
    };
  }

  const totalEmissionsKg = safeNumber(latestAssessment.totalCO2Emissions);
  const carbonScore = safeNumber(latestAssessment.carbonScore);
  const categoryData = buildCategoryDataFromAssessment(latestAssessment);
  const previousTotal = safeNumber(previousAssessment?.totalCO2Emissions);
  const performanceImprovement = previousTotal > 0
    ? safeRound(((previousTotal - totalEmissionsKg) / previousTotal) * 100, 1)
    : null;

  return {
    dataStatus: 'available',
    industryAverage: null,
    userPerformance: carbonScore > 0 ? carbonScore : null,
    userTotalEmissionsTonnes: safeRound(totalEmissionsKg / 1000, 2),
    previousAssessmentEmissionsTonnes: previousTotal > 0 ? safeRound(previousTotal / 1000, 2) : null,
    performanceImprovement,
    goalProgress: carbonScore > 0 ? safeRound(carbonScore, 1) : null,
    benchmarkData: categoryData.map((category) => ({
      category: category.name,
      user: totalEmissionsKg > 0 ? safeRound((safeNumber(category.value) / totalEmissionsKg) * 100, 1) : 0,
      industry: null,
      emissionsKgCO2e: safeNumber(category.value)
    })),
    industryBenchmarkAvailable: false
  };
};

const cbamGoodsCatalog = [
  {
    id: 'iron_steel',
    name: 'Iron & Steel Products',
    hsCode: '7208',
    baseIntensity: 2.1,
    baseVolume: 48,
    scope: 'Scope 1+2',
    category: 'steel',
    dataQuality: 'estimated'
  },
  {
    id: 'aluminum_profiles',
    name: 'Aluminum Profiles',
    hsCode: '7604',
    baseIntensity: 8.6,
    baseVolume: 18,
    scope: 'Scope 1+2',
    category: 'aluminum',
    dataQuality: 'supplier'
  },
  {
    id: 'cement_clinker',
    name: 'Cement Clinker',
    hsCode: '2523',
    baseIntensity: 0.86,
    baseVolume: 32,
    scope: 'Scope 1+2',
    category: 'cement',
    dataQuality: 'estimated'
  },
  {
    id: 'nitrogen_fertilizers',
    name: 'Nitrogen Fertilizers',
    hsCode: '3102',
    baseIntensity: 2.5,
    baseVolume: 14,
    scope: 'Scope 1+2',
    category: 'fertilizer',
    dataQuality: 'primary'
  },
  {
    id: 'hydrogen',
    name: 'Hydrogen',
    hsCode: '2804',
    baseIntensity: 10.0,
    baseVolume: 6,
    scope: 'Scope 1+2',
    category: 'hydrogen',
    dataQuality: 'estimated'
  },
  {
    id: 'electricity',
    name: 'Electricity',
    hsCode: '2716',
    baseIntensity: 0.45,
    baseVolume: 80,
    scope: 'Scope 2',
    category: 'electricity',
    dataQuality: 'estimated'
  }
];

const cbamKeywordMap = [
  { category: 'steel', keywords: ['steel', 'iron', 'metal'] },
  { category: 'aluminum', keywords: ['aluminum', 'aluminium', 'bauxite'] },
  { category: 'cement', keywords: ['cement', 'clinker'] },
  { category: 'fertilizer', keywords: ['fertilizer', 'fertiliser', 'ammonia'] },
  { category: 'hydrogen', keywords: ['hydrogen', 'electrolysis'] },
  { category: 'electricity', keywords: ['electricity', 'power', 'energy'] }
];

const getCompanyScale = (companyType) => {
  switch (companyType) {
    case 'micro':
      return 0.6;
    case 'small':
      return 0.85;
    case 'medium':
      return 1.15;
    default:
      return 0.9;
  }
};

const roundTo = (value, decimals = 1) => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};

const safeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const sumBy = (items, selector) => items.reduce((sum, item) => sum + selector(item), 0);

const getQuarterLabel = (year, quarter) => `Q${quarter} ${year}`;

const getRecentQuarters = (count) => {
  const now = new Date();
  let year = now.getFullYear();
  let quarter = Math.floor(now.getMonth() / 3) + 1;
  const quarters = [];

  for (let i = 0; i < count; i += 1) {
    quarters.unshift({ year, quarter });
    quarter -= 1;
    if (quarter === 0) {
      quarter = 4;
      year -= 1;
    }
  }

  return quarters;
};

const getQuarterFromDate = (dateLike) => {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return { year, quarter };
};

const getQuarterKey = (year, quarter) => `${year}-Q${quarter}`;

const getQuarterCountFromPeriod = (period = 'quarter') => {
  const normalized = String(period || '').toLowerCase();
  if (normalized === 'year' || normalized === 'annual' || normalized === '1year') {
    return 4;
  }
  if (normalized === '6months' || normalized === 'half-year') {
    return 2;
  }
  return 1;
};

const createQuarterRecord = ({ year, quarter }) => ({
  year,
  quarter,
  period: getQuarterLabel(year, quarter),
  directEmbeddedEmissions: 0,
  indirectEmbeddedEmissions: 0,
  embeddedEmissions: 0,
  estimatedLiabilityEUR: 0,
  exportVolume: 0,
  hasAssessmentData: false
});

const normalizeQuarterRecords = (records = [], carbonPriceEUR = 90) => {
  return records.map((record) => {
    const directEmbeddedEmissions = roundTo(safeNumber(record.directEmbeddedEmissions), 1);
    const indirectEmbeddedEmissions = roundTo(safeNumber(record.indirectEmbeddedEmissions), 1);
    const embeddedEmissions = roundTo(directEmbeddedEmissions + indirectEmbeddedEmissions, 1);

    return {
      ...record,
      directEmbeddedEmissions,
      indirectEmbeddedEmissions,
      embeddedEmissions,
      estimatedLiabilityEUR: Math.round(embeddedEmissions * carbonPriceEUR)
    };
  });
};

const aggregateQuarterlyEmbeddedEmissions = ({
  assessments = [],
  transactions = [],
  quarters = [],
  carbonPriceEUR = 90
}) => {
  const quarterRecords = quarters.map(createQuarterRecord);
  const quarterRecordMap = new Map(
    quarterRecords.map((record) => [getQuarterKey(record.year, record.quarter), record])
  );

  assessments.forEach((assessment) => {
    const referenceDate = assessment?.period?.endDate || assessment?.createdAt;
    const quarterInfo = getQuarterFromDate(referenceDate);
    if (!quarterInfo) return;

    const quarterRecord = quarterRecordMap.get(getQuarterKey(quarterInfo.year, quarterInfo.quarter));
    if (!quarterRecord) return;

    let direct = safeNumber(assessment?.esgScopes?.scope1?.total);
    let indirect = safeNumber(assessment?.esgScopes?.scope2?.total);
    const total = safeNumber(assessment?.totalCO2Emissions);

    // Fallback when scope values are absent but total emissions exist.
    if (direct + indirect <= 0 && total > 0) {
      direct = total * 0.65;
      indirect = total * 0.35;
    }

    quarterRecord.directEmbeddedEmissions += direct;
    quarterRecord.indirectEmbeddedEmissions += indirect;
    quarterRecord.hasAssessmentData = true;
  });

  // Supplement quarter data from transaction scope tags if no assessment exists for that quarter.
  transactions.forEach((transaction) => {
    const quarterInfo = getQuarterFromDate(transaction?.date || transaction?.createdAt);
    if (!quarterInfo) return;

    const quarterRecord = quarterRecordMap.get(getQuarterKey(quarterInfo.year, quarterInfo.quarter));
    if (!quarterRecord || quarterRecord.hasAssessmentData) return;

    const scopeBreakdown = transaction?.carbonFootprint?.emissionBreakdown || {};
    const direct = safeNumber(scopeBreakdown.scope1);
    const indirect = safeNumber(scopeBreakdown.scope2);

    if (direct + indirect <= 0) return;

    quarterRecord.directEmbeddedEmissions += direct;
    quarterRecord.indirectEmbeddedEmissions += indirect;
  });

  return normalizeQuarterRecords(quarterRecords, carbonPriceEUR);
};

const inferWorkflowDirectIndirect = (msme = {}) => {
  const latestEstimate = msme?.business?.manufacturingWorkflow?.latestEstimate || {};
  const total = safeNumber(latestEstimate.totalCO2Emissions);
  if (total <= 0) {
    return { directEmbeddedEmissions: 0, indirectEmbeddedEmissions: 0 };
  }

  const machinery = safeNumber(latestEstimate.machineryEmissions);
  const directEmbeddedEmissions = Math.min(total, machinery > 0 ? machinery : total * 0.65);
  const indirectEmbeddedEmissions = Math.max(0, total - directEmbeddedEmissions);

  return {
    directEmbeddedEmissions: roundTo(directEmbeddedEmissions, 1),
    indirectEmbeddedEmissions: roundTo(indirectEmbeddedEmissions, 1)
  };
};

const extractCbamSignals = (msme = {}) => {
  const workflowUnits = Array.isArray(msme?.business?.manufacturingWorkflow?.units)
    ? msme.business.manufacturingWorkflow.units
    : [];
  const unitProducts = workflowUnits.flatMap((unit) => unit?.products || []);
  const processNames = workflowUnits.flatMap((unit) => (unit?.processes || []).map((process) => process?.name));

  return [
    msme?.industry,
    msme?.business?.primaryProducts,
    ...unitProducts,
    ...processNames
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
};

const getNextCbamDeadline = () => {
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3) + 1;
  const year = now.getFullYear();
  const dueMonthMap = { 1: 3, 2: 6, 3: 9, 4: 0 };
  const dueMonth = dueMonthMap[quarter];
  const dueYear = quarter === 4 ? year + 1 : year;
  return new Date(dueYear, dueMonth + 1, 0);
};

const { getDateRangeFromPeriod: resolveReportingPeriodRange } = require('../utils/reportingPeriod');
const getDateRangeFromPeriod = (period) => resolveReportingPeriodRange(period, { defaultPeriod: '6months' });

const safeRound = (value, decimals = 2) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(numeric * factor) / factor;
};

const normalizeCbamTransactionMapping = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'product' ? 'product' : 'company';
};

const normalizeMultiValueFilter = (value) => {
  if (!value) return [];
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      parsed = value.split(/[,;|]/g);
    }
  }
  const values = Array.isArray(parsed) ? parsed : [parsed];
  const seen = new Set();
  return values
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const transactionMatchesCbamMapping = (transaction = {}, options = {}) => {
  const mappingMode = normalizeCbamTransactionMapping(options.mappingMode);
  if (mappingMode === 'company') {
    return String(transaction?.ownership || '').toLowerCase() !== 'product';
  }

  if (String(transaction?.ownership || '').toLowerCase() === 'product') {
    if (!Array.isArray(options.selectedProducts) || options.selectedProducts.length === 0) {
      return true;
    }
    const assignedNames = Array.isArray(transaction?.productAttribution?.assignedProducts)
      ? transaction.productAttribution.assignedProducts.map((entry) => String(entry?.productName || '').toLowerCase())
      : [];
    const selectedNames = options.selectedProducts.map((entry) => String(entry || '').toLowerCase());
    return selectedNames.some((name) => assignedNames.includes(name));
  }

  return false;
};
const buildCompanyOperationsProfile = (msme = {}) => {
  const enterprise = msme?.enterpriseProfile;
  if (enterprise) {
    const facilities = Array.isArray(enterprise.facilities) ? enterprise.facilities : [];
    const materialCategories = (enterprise.scope3Materiality?.categories || [])
      .filter((c) => c.material);
    return {
      companyProfile: {
        companyName: enterprise.companyName || msme?.companyName || 'Enterprise',
        companyType: msme?.companyType || 'medium',
        industry: enterprise.industry || msme?.industry || 'General',
        businessDomain: msme?.businessDomain || enterprise.sector || 'manufacturing',
        listingStatus: enterprise.listingStatus || null,
        reportingEntityType: enterprise.reportingEntityType || null,
        registrations: {
          cinNumber: enterprise.cinNumber || null,
          gstNumber: enterprise.gstNumber || msme?.gstNumber || null,
          panNumber: enterprise.panNumber || null
        },
        location: {
          city: enterprise.contact?.address?.city || null,
          state: enterprise.contact?.address?.state || null,
          country: enterprise.contact?.address?.country || 'India'
        }
      },
      operationsProfile: {
        consolidationApproach: enterprise.consolidationApproach || null,
        brsrApplicability: enterprise.brsrApplicability || null,
        facilityCount: facilities.length,
        facilities: facilities.map((f) => ({
          name: f.name,
          state: f.state,
          operationalControl: f.operationalControl,
          scope1Sources: f.scope1Sources || [],
          scope2Sources: f.scope2Sources || []
        })),
        scope3MaterialCategories: materialCategories.length,
        regulatoryMandates: enterprise.regulatoryMandates || {}
      }
    };
  }

  const workflow = msme?.business?.manufacturingWorkflow || {};
  const units = Array.isArray(workflow?.units) ? workflow.units : [];
  const employees = Array.isArray(workflow?.employees) ? workflow.employees : [];

  return {
    companyProfile: {
      companyName: msme?.companyName || 'MSME',
      companyType: msme?.companyType || 'small',
      industry: msme?.industry || 'General',
      businessDomain: msme?.businessDomain || 'other',
      establishmentYear: msme?.establishmentYear || null,
      registrations: {
        udyamRegistrationNumber: msme?.udyamRegistrationNumber || null,
        gstNumber: msme?.gstNumber || null,
        panNumber: msme?.panNumber || null
      },
      location: {
        city: msme?.contact?.address?.city || msme?.manufacturingProfile?.locationCity || null,
        state: msme?.contact?.address?.state || msme?.manufacturingProfile?.locationState || null,
        country: msme?.contact?.address?.country || msme?.manufacturingProfile?.locationCountry || 'India'
      }
    },
    operationsProfile: {
      annualTurnoverINR: safeNumber(msme?.business?.annualTurnover),
      employeeCount: safeNumber(msme?.business?.numberOfEmployees),
      manufacturingUnits: safeNumber(msme?.business?.manufacturingUnits),
      workflowUnitsTracked: units.length,
      workflowEmployeesTracked: employees.length,
      primaryProducts: msme?.business?.primaryProducts || null,
      primaryEnergySource: msme?.manufacturingProfile?.primaryEnergySource || null,
      wasteManagementPractice: msme?.manufacturingProfile?.wasteManagementPractice || null
    }
  };
};

const buildReportAgents = ({
  reportType,
  isExporter = false
}) => {
  const catalog = {
    BRSR: [
      {
        agent: 'report_generator',
        role: 'Builds BRSR disclosure-ready narrative and report sections',
        status: 'active'
      },
      {
        agent: 'compliance_monitor',
        role: 'Checks BRSR mandatory field coverage and compliance score',
        status: 'active'
      },
      {
        agent: 'carbon_analyzer',
        role: 'Maps emissions to GHG Protocol scopes and hotspot categories',
        status: 'active'
      }
    ],
    CBAM: [
      {
        agent: 'report_generator',
        role: 'Builds quarterly CBAM compliance output',
        status: 'active'
      },
      {
        agent: 'compliance_monitor',
        role: 'Tracks documentation readiness and filing deadlines',
        status: 'active'
      },
      {
        agent: 'carbon_analyzer',
        role: 'Calculates embedded direct and indirect emissions',
        status: 'active'
      }
    ],
    ISO14064: [
      {
        agent: 'compliance_monitor',
        role: 'Evaluates ISO 14064 inventory controls and requirements',
        status: 'active'
      },
      {
        agent: 'iso_evidence_collector',
        role: 'Compiles evidence packs for governance and verification controls',
        status: 'active'
      },
      {
        agent: 'iso_gap_closure_planner',
        role: 'Prioritizes actionable closure plan for open conformance gaps',
        status: 'active'
      }
    ],
    ISO14067: [
      {
        agent: 'compliance_monitor',
        role: 'Evaluates product-carbon-footprint compliance and controls',
        status: 'active'
      },
      {
        agent: 'process_machinery_profiler',
        role: 'Builds process and machinery context for product LCI',
        status: 'active'
      },
      {
        agent: 'iso_audit_packager',
        role: 'Packages audit-grade boundary and LCI evidence outputs',
        status: 'active'
      }
    ]
  };

  const agents = catalog[reportType] || [];
  return {
    reportType,
    orchestrationPattern: 'multi_agent_orchestration',
    generatedAt: new Date().toISOString(),
    agents,
    notes: reportType === 'CBAM' && !isExporter
      ? 'CBAM agents are provisioned but reporting is currently not required for non-exporting profile.'
      : 'Agents contributed to report generation and compliance interpretation.'
  };
};

const safeDivide = (numerator, denominator) => {
  const numericDenominator = Number(denominator);
  if (!Number.isFinite(numericDenominator) || numericDenominator === 0) {
    return 0;
  }
  return safeRound(Number(numerator) / numericDenominator, 4);
};

const toSlug = (value = '') => String(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'product';

const ISO_LIFECYCLE_STAGES = ['upstream', 'operations', 'downstream', 'support'];
const ISO_LIFECYCLE_STAGE_LABELS = {
  upstream: 'Upstream',
  operations: 'Operations',
  downstream: 'Downstream',
  support: 'Support'
};

const UPSTREAM_PARTNER_TYPES = new Set(['supplier', 'inbound_logistics', 'warehouse']);
const DOWNSTREAM_PARTNER_TYPES = new Set(['distributor', 'customer_delivery', 'third_party_logistics']);

const resolveSupplyChainStage = (partnerType = '') => {
  const normalized = String(partnerType || '').toLowerCase();
  if (UPSTREAM_PARTNER_TYPES.has(normalized)) return 'upstream';
  if (DOWNSTREAM_PARTNER_TYPES.has(normalized)) return 'downstream';
  return 'support';
};

const inferDefaultFactorUnit = (factorRef = '') => {
  const normalized = String(factorRef || '').toLowerCase();
  if (normalized.startsWith('material:')) return 'kgCO2e/kg';
  if (normalized.startsWith('machinery:')) return 'kgCO2e/kWh';
  if (normalized.startsWith('transport:')) return 'kgCO2e/tkm';
  if (normalized.startsWith('commute:')) return 'kgCO2e/km';
  return 'kgCO2e/unit';
};

const inferFactorCategory = (factorRef = '') => {
  const normalized = String(factorRef || '').toLowerCase();
  if (normalized.startsWith('material:')) return 'materials';
  if (normalized.startsWith('machinery:')) return 'energy';
  if (normalized.startsWith('transport:')) return 'fuel';
  if (normalized.startsWith('commute:')) return 'fuel';
  return 'other';
};

const resolveFactorMeta = (factorRegistry = [], factorRef = '') => {
  const category = inferFactorCategory(factorRef);
  const byCategory = factorRegistry.find((entry) => String(entry?.category || '').toLowerCase() === category);
  return byCategory || null;
};

const buildProductCatalog = (msme = {}) => {
  const workflow = msme?.business?.manufacturingWorkflow || {};
  const unitProducts = Array.isArray(workflow.units)
    ? workflow.units.flatMap(unit => (unit?.products || []).map(product => String(product || '').trim()).filter(Boolean))
    : [];
  const catalog = Array.from(new Set([
    ...unitProducts,
    String(msme?.business?.primaryProducts || '').trim()
  ].filter(Boolean)));

  return catalog.map((productName, index) => ({
    productId: `${toSlug(productName)}_${index + 1}`,
    productName,
    declaredUnit: 'unit',
    functionalUnit: null
  }));
};

const buildIso14067BoundaryDefinition = ({
  msme = {},
  frameworkConfig = {},
  lifecycleSignals = {},
  lciGranularityScore = 0
}) => {
  const configuredStages = frameworkConfig.lifecycleStages || {};
  const stageMap = ISO_LIFECYCLE_STAGES.reduce((acc, stage) => {
    const stageConfig = configuredStages?.[stage];
    let included;
    if (typeof stageConfig === 'boolean') {
      included = stageConfig;
    } else if (stageConfig && typeof stageConfig === 'object' && typeof stageConfig.included === 'boolean') {
      included = stageConfig.included;
    } else {
      included = Boolean(lifecycleSignals?.[stage]);
    }

    acc[stage] = {
      stage,
      label: ISO_LIFECYCLE_STAGE_LABELS[stage],
      included,
      rationale: stageConfig?.rationale || null
    };
    return acc;
  }, {});

  const includedStages = ISO_LIFECYCLE_STAGES.filter(stage => stageMap[stage].included);
  const excludedStages = ISO_LIFECYCLE_STAGES.filter(stage => !stageMap[stage].included);
  const cutOffCriteria = frameworkConfig.cutOffCriteria || {
    massPercentThreshold: 5,
    energyPercentThreshold: 5,
    environmentalSignificanceRule: 'High-impact flows are always included'
  };
  const boundaryType = frameworkConfig.systemBoundaryType
    || (includedStages.includes('downstream') ? 'cradle_to_grave' : 'cradle_to_gate');
  const hasDescription = Boolean(frameworkConfig.boundaryDescription);
  const hasTemporalCoverage = Boolean(frameworkConfig.temporalCoverage);
  const hasGeographicalCoverage = Boolean(frameworkConfig.geographicalCoverage || msme?.contact?.address?.country);
  const stageCoverageScore = safeRound((includedStages.length / ISO_LIFECYCLE_STAGES.length) * 100, 1);
  const rigorScore = safeRound(
    (
      (hasDescription ? 25 : 0)
      + (hasTemporalCoverage ? 15 : 0)
      + (hasGeographicalCoverage ? 15 : 0)
      + (Number.isFinite(cutOffCriteria?.massPercentThreshold) ? 10 : 0)
      + stageCoverageScore * 0.2
      + lciGranularityScore * 0.15
    ),
    1
  );

  return {
    systemBoundaryType: boundaryType,
    boundaryDescription: frameworkConfig.boundaryDescription || 'Product system boundary defined from manufacturing workflow and transaction evidence.',
    temporalCoverage: frameworkConfig.temporalCoverage || 'Most recent selected reporting period',
    geographicalCoverage: frameworkConfig.geographicalCoverage || msme?.contact?.address?.country || 'India',
    cutOffCriteria,
    includedStages,
    excludedStages,
    stageMap,
    stageCoverageScore,
    rigorScore
  };
};

const buildIso14067ProductLci = ({
  msme = {},
  frameworkConfig = {},
  factorRegistry = []
}) => {
  const workflow = msme?.business?.manufacturingWorkflow || {};
  const latestEstimate = workflow.latestEstimate || {};
  const productCatalog = buildProductCatalog(msme);
  const fallbackProductName = productCatalog[0]?.productName || 'Finished product';
  const productState = new Map(productCatalog.map((product) => ([
    product.productName,
    {
      ...product,
      functionalUnit: frameworkConfig.functionalUnit || '1 unit of finished product',
      totalFootprint: 0,
      stageTotals: {
        upstream: 0,
        operations: 0,
        downstream: 0,
        support: 0
      },
      records: []
    }
  ])));

  const unitProductMap = new Map(
    (Array.isArray(workflow.units) ? workflow.units : []).map(unit => ([
      unit?.unitId,
      Array.isArray(unit?.products) && unit.products.length > 0
        ? unit.products.map(product => String(product || '').trim()).filter(Boolean)
        : [fallbackProductName]
    ]))
  );

  let recordCursor = 1;
  const pushRecord = ({
    productNames = [],
    stage = 'operations',
    activityType = 'generic_activity',
    activityName,
    activityData = 0,
    activityUnit = 'unit',
    emissionFactor = 0,
    factorRef = 'factor:generic',
    factorUnit,
    sourceType = 'primary_workflow',
    sourceRef = null,
    emission = 0
  }) => {
    const resolvedProductNames = productNames.length > 0 ? productNames : [fallbackProductName];
    const positiveEmission = Math.max(0, safeNumber(emission));
    if (positiveEmission <= 0) return;
    const share = positiveEmission / resolvedProductNames.length;
    resolvedProductNames.forEach((productName) => {
      if (!productState.has(productName)) {
        productState.set(productName, {
          productId: `${toSlug(productName)}_${productState.size + 1}`,
          productName,
          declaredUnit: 'unit',
          functionalUnit: frameworkConfig.functionalUnit || '1 unit of finished product',
          totalFootprint: 0,
          stageTotals: { upstream: 0, operations: 0, downstream: 0, support: 0 },
          records: []
        });
      }
      const product = productState.get(productName);
      product.totalFootprint += share;
      product.stageTotals[stage] = safeNumber(product.stageTotals[stage]) + share;
      product.records.push({
        recordId: `lci_${recordCursor++}`,
        stage,
        activityType,
        activityName: activityName || activityType,
        activityData: safeRound(activityData, 4),
        activityUnit,
        emissionFactor: safeRound(emissionFactor, 6),
        factorRef,
        factorUnit: factorUnit || inferDefaultFactorUnit(factorRef),
        sourceType,
        sourceRef,
        emission: safeRound(share, 4),
        allocationShare: safeRound(1 / resolvedProductNames.length, 4)
      });
    });
  };

  const unitsFromEstimate = Array.isArray(latestEstimate.unitBreakdown) ? latestEstimate.unitBreakdown : [];
  unitsFromEstimate.forEach((unit) => {
    const unitProducts = unitProductMap.get(unit?.unitId)
      || (Array.isArray(unit?.products) && unit.products.length > 0 ? unit.products : [fallbackProductName]);
    const unitProcesses = Array.isArray(unit?.processBreakdown) ? unit.processBreakdown : [];
    unitProcesses.forEach((process) => {
      const rawMaterialBreakdown = Array.isArray(process?.rawMaterialBreakdown) ? process.rawMaterialBreakdown : [];
      rawMaterialBreakdown.forEach((material) => {
        pushRecord({
          productNames: unitProducts,
          stage: 'upstream',
          activityType: material?.isPackagingMaterial ? 'packaging_material' : 'raw_material',
          activityName: material?.name || 'Raw material',
          activityData: safeNumber(material?.quantityKg),
          activityUnit: 'kg',
          emissionFactor: safeNumber(material?.emissionFactor),
          factorRef: `material:${toSlug(material?.name || 'raw_material')}`,
          sourceRef: `unit:${unit?.unitId || 'na'}/process:${process?.processName || 'na'}`,
          emission: safeNumber(material?.co2Emissions)
        });
      });

      const machineryBreakdown = Array.isArray(process?.machineryBreakdown) ? process.machineryBreakdown : [];
      machineryBreakdown.forEach((machinery) => {
        const fuelType = machinery?.fuelType || 'electricity';
        pushRecord({
          productNames: unitProducts,
          stage: 'operations',
          activityType: 'machinery_energy',
          activityName: machinery?.name || 'Machinery operation',
          activityData: safeNumber(machinery?.estimatedConsumption),
          activityUnit: fuelType === 'electricity' ? 'kWh' : 'liter',
          emissionFactor: safeNumber(machinery?.emissionFactor),
          factorRef: `machinery:${toSlug(fuelType)}`,
          sourceRef: `unit:${unit?.unitId || 'na'}/process:${process?.processName || 'na'}`,
          emission: safeNumber(machinery?.co2Emissions)
        });
      });
    });
  });

  const supplyChainBreakdown = Array.isArray(latestEstimate.supplyChainBreakdown) ? latestEstimate.supplyChainBreakdown : [];
  supplyChainBreakdown.forEach((entry) => {
    const unitProducts = unitProductMap.get(entry?.assignedUnitId) || [fallbackProductName];
    pushRecord({
      productNames: unitProducts,
      stage: resolveSupplyChainStage(entry?.partnerType),
      activityType: 'transport',
      activityName: entry?.partnerName || 'Supply chain transport',
      activityData: safeNumber(entry?.estimatedTonKm),
      activityUnit: 'ton_km',
      emissionFactor: safeNumber(entry?.emissionFactorKgPerTonKm),
      factorRef: `transport:${toSlug(entry?.transportMode || 'road_diesel')}`,
      sourceRef: `supply_chain:${toSlug(entry?.partnerName || 'partner')}`,
      emission: safeNumber(entry?.scope3Emissions)
    });
  });

  const employeeCommuteBreakdown = Array.isArray(latestEstimate.employeeCommuteBreakdown)
    ? latestEstimate.employeeCommuteBreakdown
    : [];
  employeeCommuteBreakdown.forEach((entry) => {
    const unitProducts = unitProductMap.get(entry?.assignedUnitId) || [fallbackProductName];
    pushRecord({
      productNames: unitProducts,
      stage: 'support',
      activityType: 'employee_commute',
      activityName: entry?.name || 'Employee commute',
      activityData: safeNumber(entry?.monthlyDistanceKm),
      activityUnit: 'km',
      emissionFactor: safeNumber(entry?.emissionFactorKgPerKm),
      factorRef: `commute:${toSlug(entry?.commuteMode || 'two_wheeler')}`,
      sourceRef: `employee:${toSlug(entry?.name || 'employee')}`,
      emission: safeNumber(entry?.scope3Emissions)
    });
  });

  if ([...productState.values()].every(product => product.records.length === 0)) {
    const fallbackStageBreakdown = Array.isArray(latestEstimate?.valueChainEmissions?.stageBreakdown)
      ? latestEstimate.valueChainEmissions.stageBreakdown
      : [];
    fallbackStageBreakdown.forEach((stageEntry) => {
      pushRecord({
        productNames: [...productState.keys()],
        stage: stageEntry?.stage || 'operations',
        activityType: 'value_chain_stage',
        activityName: stageEntry?.label || stageEntry?.stage || 'Value chain stage',
        activityData: 1,
        activityUnit: 'stage_share',
        emissionFactor: safeNumber(stageEntry?.co2Emissions),
        factorRef: `value_chain:${toSlug(stageEntry?.stage || 'operations')}`,
        sourceType: 'modeled_fallback',
        sourceRef: 'latest_estimate.valueChainEmissions',
        emission: safeNumber(stageEntry?.co2Emissions)
      });
    });
  }

  const productFootprints = [...productState.values()].map((product) => ({
    productId: product.productId,
    productName: product.productName,
    declaredUnit: product.declaredUnit,
    functionalUnit: product.functionalUnit,
    totalFootprint: safeRound(product.totalFootprint, 4),
    perFunctionalUnit: safeRound(product.totalFootprint, 4),
    stageBreakdown: ISO_LIFECYCLE_STAGES.map((stage) => ({
      stage,
      label: ISO_LIFECYCLE_STAGE_LABELS[stage],
      emissions: safeRound(product.stageTotals[stage], 4)
    })),
    lciRecordCount: product.records.length
  }));

  const flattenedRecords = [...productState.values()].flatMap(product => product.records.map(record => ({
    ...record,
    productId: product.productId,
    productName: product.productName
  })));

  const stageRecordCount = ISO_LIFECYCLE_STAGES.reduce((acc, stage) => {
    acc[stage] = flattenedRecords.filter(record => record.stage === stage).length;
    return acc;
  }, {});
  const productsWithInventory = productFootprints.filter(product => product.lciRecordCount > 0).length;
  const stageCoverage = ISO_LIFECYCLE_STAGES.filter(stage => stageRecordCount[stage] > 0).length;
  const recordCompleteness = flattenedRecords.length > 0
    ? flattenedRecords.filter(record => record.factorRef && Number.isFinite(record.activityData)).length / flattenedRecords.length
    : 0;
  const lciGranularityScore = safeRound(
    (
      safeDivide(productsWithInventory, Math.max(1, productFootprints.length)) * 35
      + safeDivide(stageCoverage, ISO_LIFECYCLE_STAGES.length) * 35
      + recordCompleteness * 30
    ) * 100 / 100,
    1
  );

  const totalFootprint = safeRound(
    productFootprints.reduce((sum, product) => sum + safeNumber(product.totalFootprint), 0),
    4
  );
  const combinedRelativeUncertainty = totalFootprint > 0
    ? safeRound(
      Math.sqrt(
        flattenedRecords.reduce((sum, record) => {
          const relativeUncertainty = Number.isFinite(record?.relativeUncertainty)
            ? record.relativeUncertainty
            : 0.15;
          return sum + Math.pow(safeNumber(record.emission) * relativeUncertainty, 2);
        }, 0)
      ) / totalFootprint,
      4
    )
    : 0;

  const configuredCombinedUncertainty = frameworkConfig?.uncertainty?.combinedRelativeUncertainty;
  const relativeUncertainty = Number.isFinite(Number(configuredCombinedUncertainty))
    ? Number(configuredCombinedUncertainty)
    : combinedRelativeUncertainty;
  const uncertaintyProfile = {
    methodology: frameworkConfig?.uncertainty?.methodology || 'Root-sum-square propagation over allocated LCI records',
    confidenceLevel: safeRound(safeNumber(frameworkConfig?.uncertainty?.confidenceLevel, 0.95), 2),
    relativeUncertainty: safeRound(relativeUncertainty, 4),
    absoluteUncertainty: safeRound(totalFootprint * relativeUncertainty, 4),
    lowerBound: safeRound(Math.max(0, totalFootprint * (1 - relativeUncertainty)), 4),
    upperBound: safeRound(totalFootprint * (1 + relativeUncertainty), 4)
  };

  const lciCoverage = {
    totalRecords: flattenedRecords.length,
    productsWithInventory,
    totalProducts: productFootprints.length,
    stageRecordCount,
    recordCompleteness: safeRound(recordCompleteness, 4),
    granularityScore: lciGranularityScore
  };

  return {
    factorRegistry,
    productCatalog: productFootprints.map((product) => ({
      productId: product.productId,
      productName: product.productName,
      declaredUnit: product.declaredUnit,
      functionalUnit: product.functionalUnit,
      lciRecordCount: product.lciRecordCount
    })),
    productFootprints,
    records: flattenedRecords,
    lciCoverage,
    totalFootprint,
    uncertaintyProfile
  };
};

const buildIso14064Visualization = ({
  scopeData = {},
  dataQuality = {},
  checks = [],
  governanceItems = [],
  assessments = []
}) => {
  const qualityBreakdown = [
    { metric: 'Completeness', value: safeRound(safeNumber(dataQuality?.completeness) * 100, 1) },
    { metric: 'Consistency', value: safeRound(safeNumber(dataQuality?.consistency) * 100, 1) },
    { metric: 'Coverage', value: safeRound(safeNumber(dataQuality?.coverage) * 100, 1) },
    { metric: 'Confidence', value: safeRound(safeNumber(dataQuality?.confidence) * 100, 1) }
  ];

  const scopeContribution = [
    { scope: 'Scope 1', emissions: safeNumber(scopeData?.scope1?.total), percentage: safeNumber(scopeData?.scope1?.percentage) },
    { scope: 'Scope 2', emissions: safeNumber(scopeData?.scope2?.total), percentage: safeNumber(scopeData?.scope2?.percentage) },
    { scope: 'Scope 3', emissions: safeNumber(scopeData?.scope3?.total), percentage: safeNumber(scopeData?.scope3?.percentage) }
  ];

  const complianceChecks = checks.map((check) => ({
    id: check.id,
    label: String(check.id || '').replace(/_/g, ' '),
    status: check.passed ? 'pass' : 'gap',
    score: check.passed ? 100 : 0
  }));

  const governanceCoverage = governanceItems.map((item) => ({
    id: item.id,
    control: item.title,
    status: item.status,
    score: item.status === 'complete' ? 100 : 0
  }));

  const emissionsTrend = [...assessments]
    .sort((a, b) => new Date(a?.period?.endDate || a?.createdAt) - new Date(b?.period?.endDate || b?.createdAt))
    .slice(-8)
    .map((assessment) => ({
      period: new Date(assessment?.period?.endDate || assessment?.createdAt).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      total: safeRound(safeNumber(assessment?.totalCO2Emissions), 2),
      scope1: safeRound(safeNumber(assessment?.esgScopes?.scope1?.total), 2),
      scope2: safeRound(safeNumber(assessment?.esgScopes?.scope2?.total), 2),
      scope3: safeRound(safeNumber(assessment?.esgScopes?.scope3?.total), 2)
    }));

  return {
    scopeContribution,
    qualityBreakdown,
    complianceChecks,
    governanceCoverage,
    emissionsTrend
  };
};

const buildIso14067Visualization = ({
  productFootprints = [],
  records = [],
  lciCoverage = {},
  boundaryDefinition = {},
  uncertaintyProfile = {}
}) => {
  const lifecycleStageContribution = ISO_LIFECYCLE_STAGES.map((stage) => ({
    stage,
    label: ISO_LIFECYCLE_STAGE_LABELS[stage],
    emissions: safeRound(
      productFootprints.reduce((sum, product) => {
        const stageEntry = (product.stageBreakdown || []).find(entry => entry.stage === stage);
        return sum + safeNumber(stageEntry?.emissions);
      }, 0),
      4
    )
  }));

  const productComparison = productFootprints.map((product) => ({
    productName: product.productName,
    totalFootprint: safeRound(product.totalFootprint, 4),
    perFunctionalUnit: safeRound(product.perFunctionalUnit, 4),
    lciRecords: product.lciRecordCount
  }));

  const lciRecordsByStage = ISO_LIFECYCLE_STAGES.map((stage) => ({
    stage,
    label: ISO_LIFECYCLE_STAGE_LABELS[stage],
    records: safeNumber(lciCoverage?.stageRecordCount?.[stage], 0)
  }));

  const boundaryCoverage = ISO_LIFECYCLE_STAGES.map((stage) => ({
    stage,
    label: ISO_LIFECYCLE_STAGE_LABELS[stage],
    included: boundaryDefinition?.includedStages?.includes(stage) ? 1 : 0
  }));

  const uncertaintyBand = [
    {
      label: 'Lower',
      value: safeNumber(uncertaintyProfile?.lowerBound)
    },
    {
      label: 'Estimated',
      value: safeRound(
        safeNumber(uncertaintyProfile?.lowerBound)
        + safeNumber(uncertaintyProfile?.absoluteUncertainty),
        4
      )
    },
    {
      label: 'Upper',
      value: safeNumber(uncertaintyProfile?.upperBound)
    }
  ];

  return {
    lifecycleStageContribution,
    productComparison,
    lciRecordsByStage,
    boundaryCoverage,
    uncertaintyBand,
    lciRecordHeatmap: records.slice(0, 100).map((record) => ({
      productName: record.productName,
      stage: record.stage,
      emission: safeRound(record.emission, 4),
      activityType: record.activityType
    }))
  };
};

const buildCategoryDataFromAssessment = (assessment) => {
  const latestBreakdown = assessment?.breakdown || {};
  const categoryValues = [
    { name: 'Energy', value: Number(latestBreakdown?.energy?.total) || 0, color: '#8884d8' },
    { name: 'Transportation', value: Number(latestBreakdown?.transportation?.co2Emissions) || 0, color: '#82ca9d' },
    { name: 'Waste', value: Number(latestBreakdown?.waste?.total) || 0, color: '#ffc658' },
    { name: 'Water', value: Number(latestBreakdown?.water?.co2Emissions) || 0, color: '#ff7300' },
    { name: 'Materials', value: Number(latestBreakdown?.materials?.co2Emissions) || 0, color: '#00ff00' },
    { name: 'Manufacturing', value: Number(latestBreakdown?.manufacturing?.co2Emissions) || 0, color: '#0088fe' }
  ];

  const total = categoryValues.reduce((sum, category) => sum + category.value, 0);
  return categoryValues.map(category => ({
    ...category,
    value: total > 0 ? safeRound((category.value / total) * 100, 1) : 0
  }));
};

const buildScopeDataFromAssessment = (assessment) => {
  const esgScopes = assessment?.esgScopes || {};
  const scope1 = Number(esgScopes?.scope1?.total) || 0;
  const scope2 = Number(esgScopes?.scope2?.total) || 0;
  const scope3 = Number(esgScopes?.scope3?.total) || 0;
  const total = scope1 + scope2 + scope3;

  return {
    scope1: {
      total: safeRound(scope1, 2),
      percentage: total > 0 ? safeRound((scope1 / total) * 100, 1) : 0,
      breakdown: esgScopes?.scope1?.breakdown || {}
    },
    scope2: {
      total: safeRound(scope2, 2),
      percentage: total > 0 ? safeRound((scope2 / total) * 100, 1) : 0,
      breakdown: esgScopes?.scope2?.breakdown || {}
    },
    scope3: {
      total: safeRound(scope3, 2),
      percentage: total > 0 ? safeRound((scope3 / total) * 100, 1) : 0,
      breakdown: esgScopes?.scope3?.breakdown || {}
    },
    total: safeRound(total, 2)
  };
};

const loadComplianceHubRecord = async (msme = {}) => {
  if (!msme?._id && !msme?.organizationId) {
    return null;
  }

  try {
    const filters = [];
    if (msme._id) {
      filters.push({ msmeId: msme._id });
    }
    if (msme.organizationId) {
      filters.push({ organizationId: msme.organizationId });
    }
    return await ComplianceHubRecord.findOne({ $or: filters }).lean();
  } catch {
    return null;
  }
};

const buildTrendDataFromAssessments = (assessments = []) => {
  if (!Array.isArray(assessments) || assessments.length === 0) {
    return [];
  }

  const sorted = [...assessments].sort((a, b) => {
    return new Date(a.period?.endDate || a.createdAt) - new Date(b.period?.endDate || b.createdAt);
  });

  const latest = sorted[sorted.length - 1];
  const previous = sorted[sorted.length - 2];
  const recentQuarter = sorted.slice(Math.max(0, sorted.length - 3));
  const previousQuarter = sorted.slice(Math.max(0, sorted.length - 6), Math.max(0, sorted.length - 3));

  const sumEmissions = entries => entries.reduce((sum, entry) => sum + (Number(entry.totalCO2Emissions) || 0), 0);
  const latestEmission = Number(latest?.totalCO2Emissions) || 0;
  const previousEmission = Number(previous?.totalCO2Emissions) || 0;
  const quarterCurrent = sumEmissions(recentQuarter);
  const quarterPrevious = sumEmissions(previousQuarter);

  const currentYear = new Date().getFullYear();
  const thisYearAssessments = sorted.filter((entry) => (
    new Date(entry.period?.endDate || entry.createdAt).getFullYear() === currentYear
  ));
  const priorYearAssessments = sorted.filter((entry) => (
    new Date(entry.period?.endDate || entry.createdAt).getFullYear() === currentYear - 1
  ));
  const yearCurrent = thisYearAssessments.length > 0 ? sumEmissions(thisYearAssessments) : sumEmissions(sorted);
  const yearPrevious = priorYearAssessments.length > 0
    ? sumEmissions(priorYearAssessments)
    : (sorted.length >= 2 ? sumEmissions(sorted.slice(0, sorted.length - 1)) : 0);

  const changePercent = (current, baseline) => {
    if (!baseline) return 0;
    return safeRound(((current - baseline) / baseline) * 100, 1);
  };

  return [
    {
      period: 'This Month',
      current: safeRound(latestEmission, 1),
      previous: safeRound(previousEmission, 1),
      change: changePercent(latestEmission, previousEmission)
    },
    {
      period: 'This Quarter',
      current: safeRound(quarterCurrent, 1),
      previous: safeRound(quarterPrevious, 1),
      change: changePercent(quarterCurrent, quarterPrevious)
    },
    {
      period: 'This Year',
      current: safeRound(yearCurrent, 1),
      previous: safeRound(yearPrevious, 1),
      change: changePercent(yearCurrent, yearPrevious)
    }
  ];
};

const buildCarbonSeries = (assessments = []) => {
  if (!Array.isArray(assessments) || assessments.length === 0) {
    return [];
  }

  const sorted = [...assessments].sort((a, b) => {
    return new Date(a.period?.endDate || a.createdAt) - new Date(b.period?.endDate || b.createdAt);
  });

  return sorted.map((assessment, index) => {
    const currentValue = Number(assessment.totalCO2Emissions) || 0;
    const previous = sorted[index - 1];
    const previousValue = Number(previous?.totalCO2Emissions) || currentValue;
    const reduction = previous ? Math.max(0, previousValue - currentValue) : 0;

    return {
      month: new Date(assessment.period?.endDate || assessment.createdAt).toLocaleDateString('en-US', { month: 'short' }),
      carbonFootprint: safeRound(currentValue, 1),
      target: safeRound(currentValue * 0.9, 1),
      reduction: safeRound(reduction, 1)
    };
  });
};

const buildCbamReport = ({
  msme,
  period = 'quarter',
  assessments = [],
  transactions = [],
  mappingMode = 'company',
  selectedProducts = [],
  hubRecord = null
}) => {
  const { companyProfile, operationsProfile } = buildCompanyOperationsProfile(msme);
  const profileText = extractCbamSignals(msme);
  const matchedCategories = new Set();
  cbamKeywordMap.forEach(({ category, keywords }) => {
    if (keywords.some(keyword => profileText.includes(keyword))) {
      matchedCategories.add(category);
    }
  });

  const isExporter = resolveIsCbamExporter(msme, transactions, hubRecord);

  const companyScale = getCompanyScale(msme?.companyType);
  let baseGoods = cbamGoodsCatalog.filter(good => matchedCategories.has(good.category));
  const hubCategories = (hubRecord?.exportProfile?.cbamGoodsCategories || [])
    .map((category) => String(category).toLowerCase());
  if (hubCategories.length > 0) {
    const hubMatchedGoods = cbamGoodsCatalog.filter((good) => (
      hubCategories.includes(good.category)
      || hubCategories.includes(good.id)
      || hubCategories.some((category) => good.name.toLowerCase().includes(category))
    ));
    if (hubMatchedGoods.length > 0) {
      baseGoods = hubMatchedGoods;
    }
  }
  const selectedGoods = baseGoods.length > 0 ? baseGoods : (isExporter ? cbamGoodsCatalog.slice(0, 2) : []);
  const carbonPriceEUR = 90;

  const quarterCount = getQuarterCountFromPeriod(period);
  const quarters = getRecentQuarters(quarterCount);
  const quarterlySeries = aggregateQuarterlyEmbeddedEmissions({
    assessments,
    transactions,
    quarters,
    carbonPriceEUR
  });

  const currentQuarterSeries = quarterlySeries[quarterlySeries.length - 1] || createQuarterRecord(quarters[quarters.length - 1]);
  let totalDirectEmbeddedEmissions = safeNumber(currentQuarterSeries.directEmbeddedEmissions);
  let totalIndirectEmbeddedEmissions = safeNumber(currentQuarterSeries.indirectEmbeddedEmissions);

  if (totalDirectEmbeddedEmissions + totalIndirectEmbeddedEmissions <= 0) {
    const fallback = inferWorkflowDirectIndirect(msme);
    totalDirectEmbeddedEmissions = fallback.directEmbeddedEmissions;
    totalIndirectEmbeddedEmissions = fallback.indirectEmbeddedEmissions;
  }

  const totalEmbeddedEmissions = roundTo(totalDirectEmbeddedEmissions + totalIndirectEmbeddedEmissions, 1);
  const directShare = totalEmbeddedEmissions > 0 ? totalDirectEmbeddedEmissions / totalEmbeddedEmissions : 0;
  const indirectShare = totalEmbeddedEmissions > 0 ? totalIndirectEmbeddedEmissions / totalEmbeddedEmissions : 0;
  const weightedBase = selectedGoods.map((good, index) => ({
    ...good,
    weightedScore: good.baseIntensity * good.baseVolume * companyScale * (1 + index * 0.05)
  }));
  const weightedTotal = sumBy(weightedBase, (item) => item.weightedScore) || 1;

  const goods = isExporter ? weightedBase.map((good, index) => {
    const share = good.weightedScore / weightedTotal;
    const exportVolumeTonnes = roundTo(good.baseVolume * companyScale * (1 + index * 0.05), 1);
    const embeddedEmissions = totalEmbeddedEmissions > 0
      ? roundTo(totalEmbeddedEmissions * share, 1)
      : roundTo(exportVolumeTonnes * good.baseIntensity, 1);
    const directEmbeddedEmissions = roundTo(embeddedEmissions * (directShare || 0.65), 1);
    const indirectEmbeddedEmissions = roundTo(embeddedEmissions * (indirectShare || 0.35), 1);
    const emissionIntensity = exportVolumeTonnes > 0 ? roundTo(embeddedEmissions / exportVolumeTonnes, 2) : 0;
    const estimatedLiabilityEUR = Math.round(embeddedEmissions * carbonPriceEUR);
    const reportingStatus = assessments.length > 0
      ? (good.dataQuality === 'primary' || good.dataQuality === 'supplier' ? 'in_progress' : 'pending')
      : 'pending';

    return {
      id: good.id,
      name: good.name,
      hsCode: good.hsCode,
      exportVolumeTonnes,
      embeddedEmissions,
      directEmbeddedEmissions,
      indirectEmbeddedEmissions,
      emissionIntensity,
      scope: 'Direct + Indirect',
      dataQuality: good.dataQuality,
      reportingStatus,
      carbonPriceEUR,
      estimatedLiabilityEUR
    };
  }) : [];

  goods.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));

  const documentation = deriveCbamDocumentationStatus({
    isExporter,
    assessments,
    transactions,
    hubRecord
  });

  const docComplete = documentation.filter(item => item.status === 'complete').length;
  const docInProgress = documentation.filter(item => item.status === 'in_progress').length;
  const readinessScore = isExporter
    ? Math.round(((docComplete + docInProgress * 0.5) / documentation.length) * 100)
    : 0;

  const enrichedGoods = enrichCbamGoodsWithTiers(goods);
  const cbamSubmissionReadiness = assessCbamSubmissionReadiness({
    goods: enrichedGoods,
    documentation,
    overview: { readinessScore }
  });
  const complianceStatus = resolveCbamComplianceStatus({
    isExporter,
    readinessScore,
    submissionReadiness: cbamSubmissionReadiness
  });

  const totalExportVolume = roundTo(sumBy(enrichedGoods, item => item.exportVolumeTonnes), 1);
  const estimatedLiabilityEUR = Math.round((totalEmbeddedEmissions > 0 ? totalEmbeddedEmissions : sumBy(enrichedGoods, item => item.embeddedEmissions)) * carbonPriceEUR);
  const coveredGoodsCount = enrichedGoods.length;

  const exposureLevel = !isExporter
    ? 'None'
    : totalEmbeddedEmissions > 150
      ? 'High'
      : totalEmbeddedEmissions > 80
        ? 'Medium'
        : 'Low';

  const emissionsTrend = (quarterlySeries || []).map((quarterEntry) => {
    const ratio = totalEmbeddedEmissions > 0
      ? quarterEntry.embeddedEmissions / totalEmbeddedEmissions
      : 1;
    const exportVolume = roundTo(Math.max(0, totalExportVolume * ratio), 1);
    return {
      period: quarterEntry.period,
      directEmbeddedEmissions: quarterEntry.directEmbeddedEmissions,
      indirectEmbeddedEmissions: quarterEntry.indirectEmbeddedEmissions,
      embeddedEmissions: quarterEntry.embeddedEmissions,
      exportVolume,
      estimatedLiabilityEUR: quarterEntry.estimatedLiabilityEUR
    };
  });

  const recommendations = [];
  if (!isExporter) {
    recommendations.push('No EU CBAM reporting required for the current business domain. Update export markets if this changes.');
  } else {
    recommendations.push('Generate and archive the CBAM embedded-emissions report every quarter before EU filing deadlines.');
    recommendations.push('Track direct (scope 1) and indirect (scope 2) emissions separately for each covered product.');
    recommendations.push('Request supplier-specific emission factors for high-intensity materials.');
    recommendations.push('Finalize EU importer declarations ahead of the next reporting deadline.');
    recommendations.push('Align production emissions ledger with CBAM embedded direct and indirect guidance.');
    recommendations.push('Schedule third-party verification before the next submission window.');
    if (cbamSubmissionReadiness.blockedReasons?.length) {
      cbamSubmissionReadiness.blockedReasons.forEach((reason) => recommendations.unshift(reason));
    }
    if (cbamSubmissionReadiness.tierSummary?.tier1Count === 0) {
      recommendations.unshift('Upgrade to Tier 1 installation-level emissions data before EU registry submission.');
    }
  }

  const reportReadiness = buildReportReadinessMeta({
    reportType: 'CBAM',
    cbamReport: {
      goods: enrichedGoods,
      documentation,
      overview: { readinessScore, complianceStatus }
    }
  });

  const nextDeadline = getNextCbamDeadline();
  const currentQuarterInfo = getQuarterFromDate(new Date()) || { year: new Date().getFullYear(), quarter: Math.floor(new Date().getMonth() / 3) + 1 };
  const summary = isExporter
    ? `CBAM ${complianceStatus} — ${totalEmbeddedEmissions} tCO2e embedded, ${coveredGoodsCount} covered goods`
    : 'CBAM not required for current export profile';

  return {
    summary,
    companyProfile,
    operationsProfile,
    reportReadiness,
    cbamSubmissionReadiness,
    overview: {
      reportingPeriod: getQuarterLabel(currentQuarterInfo.year, currentQuarterInfo.quarter),
      reportingFrequency: 'Quarterly',
      reportingQuarter: getQuarterLabel(currentQuarterInfo.year, currentQuarterInfo.quarter),
      nextDeadline: nextDeadline.toISOString(),
      lastSubmitted: null,
      exposureLevel,
      complianceStatus,
      totalEmbeddedEmissions,
      totalDirectEmbeddedEmissions: roundTo(totalDirectEmbeddedEmissions, 1),
      totalIndirectEmbeddedEmissions: roundTo(totalIndirectEmbeddedEmissions, 1),
      totalExportVolume,
      estimatedLiabilityEUR,
      readinessScore,
      coveredGoodsCount,
      methodology: 'Quarterly aggregation of scope-1 (direct) and scope-2 (indirect) embedded emissions',
      transactionMapping: normalizeCbamTransactionMapping(mappingMode),
      selectedProducts
    },
    ghgProtocol: {
      standard: 'GHG Protocol Corporate Standard',
      boundary: 'Embedded emissions for EU-bound covered goods',
      scopesIncluded: ['Scope 1', 'Scope 2'],
      directVsIndirect: {
        directEmbeddedEmissions: roundTo(totalDirectEmbeddedEmissions, 1),
        indirectEmbeddedEmissions: roundTo(totalIndirectEmbeddedEmissions, 1)
      }
    },
    brsrComplianceReference: {
      framework: 'SEBI BRSR Principle 6',
      relevance: 'CBAM embedded emissions are aligned to emissions evidence used in BRSR environmental disclosure narratives.'
    },
    goods: enrichedGoods,
    emissionsTrend,
    documentation,
    recommendations,
    msmeProfile: {
      companyName: msme?.companyName || 'MSME',
      companyType: msme?.companyType || 'small',
      industry: msme?.industry || 'General',
      businessDomain: msme?.businessDomain || 'services',
      gstNumber: msme?.gstNumber || null,
      manufacturingUnits: safeNumber(msme?.business?.manufacturingUnits),
      numberOfEmployees: safeNumber(msme?.business?.numberOfEmployees),
      annualTurnover: safeNumber(msme?.business?.annualTurnover)
    },
    reportAgents: buildReportAgents({
      reportType: 'CBAM',
      isExporter
    })
  };
};

const buildCbamReportForMsme = async ({
  msmeId,
  period = 'quarter',
  mappingMode = 'company',
  selectedProducts = []
}) => {
  const msme = await MSME.findById(msmeId).lean();
  if (!msme) {
    return null;
  }

  const quarterCount = getQuarterCountFromPeriod(period);
  const quarters = getRecentQuarters(quarterCount);
  const oldestQuarter = quarters[0];
  const startDate = new Date(oldestQuarter.year, (oldestQuarter.quarter - 1) * 3, 1);
  const endDate = new Date();

  const [assessments, transactions] = await Promise.all([
    CarbonAssessment.find({
      msmeId,
      $or: [
        { 'period.endDate': { $gte: startDate, $lte: endDate } },
        { createdAt: { $gte: startDate, $lte: endDate } }
      ]
    })
      .sort({ 'period.endDate': 1, createdAt: 1 })
      .lean(),
    Transaction.find({
      msmeId,
      date: { $gte: startDate, $lte: endDate },
      isSpam: { $ne: true },
      isDuplicate: { $ne: true }
    }).lean()
  ]);

  const filteredTransactions = transactions.filter((transaction) => transactionMatchesCbamMapping(
    transaction,
    {
      mappingMode,
      selectedProducts
    }
  ));
  const hubRecord = await loadComplianceHubRecord(msme);

  const cbamReport = buildCbamReport({
    msme,
    period,
    assessments,
    transactions: filteredTransactions,
    mappingMode,
    selectedProducts,
    hubRecord
  });

  return {
    msme,
    cbamReport
  };
};

const buildBRSRReportForMsme = async ({
  msmeId,
  period = 'annual'
}) => {
  const msme = await MSME.findById(msmeId).lean();
  if (!msme) {
    return null;
  }

  const { startDate, endDate } = getDateRangeFromPeriod(period);
  const assessmentQuery = {
    msmeId,
    $or: [
      { 'period.endDate': { $gte: startDate, $lte: endDate } },
      { createdAt: { $gte: startDate, $lte: endDate } }
    ]
  };

  const [assessments, transactions, bills] = await Promise.all([
    CarbonAssessment.find(assessmentQuery)
      .sort({ 'period.endDate': -1, createdAt: -1 })
      .lean(),
    Transaction.find({
      msmeId,
      date: { $gte: startDate, $lte: endDate },
      isSpam: { $ne: true },
      isDuplicate: { $ne: true }
    }).lean(),
    Document.find({
      msmeId,
      documentType: 'bill',
      createdAt: { $gte: startDate, $lte: endDate }
    })
      .sort({ createdAt: -1 })
      .select('_id fileName originalName documentType status createdAt extractedData.amount')
      .lean()
  ]);

  let latestAssessment = assessments[0] || null;
  if (!latestAssessment && transactions.length > 0) {
    const calculated = await carbonCalculationService.calculateMSMECarbonFootprintAsync(
      msme,
      transactions
    );
    latestAssessment = {
      ...calculated,
      period: { startDate, endDate }
    };
  }

  const assessmentHistory = assessments.slice(1, 8);
  let carbonCreditsAccount = null;
  let carbonCreditsSummary = {};
  try {
    carbonCreditsAccount = await carbonCreditsService.getMSMECredits(msmeId);
    carbonCreditsSummary = carbonCreditsService.getCreditSummary(carbonCreditsAccount);
  } catch (error) {
    // Keep BRSR generation resilient even if credits service is unavailable.
    carbonCreditsAccount = null;
    carbonCreditsSummary = {};
  }

  const brsrReport = buildBRSRReport({
    msme,
    assessment: latestAssessment || { period: { startDate, endDate }, totalCO2Emissions: 0, breakdown: {} },
    assessmentHistory,
    transactions,
    billAnnexure: bills,
    carbonCreditsSummary,
    carbonCreditsAccount,
    requestedPeriod: period
  });

  return {
    msme,
    brsrReport
  };
};

const buildIsoDataQuality = ({ assessments = [], transactions = [] }) => {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return {
      completeness: assessments.length > 0 ? 0.6 : 0,
      consistency: assessments.length > 0 ? 0.6 : 0,
      coverage: assessments.length > 0 ? 0.6 : 0,
      confidence: assessments.length > 0 ? 0.6 : 0
    };
  }

  const validTransactions = transactions.filter(transaction => (
    Boolean(transaction?.category) && Number.isFinite(Number(transaction?.amount))
  ));
  const completeness = validTransactions.length / transactions.length;
  const consistency = transactions.filter(transaction => Number(transaction?.amount) >= 0).length / transactions.length;
  const coverage = Math.min(1, new Set(transactions.map(tx => String(tx?.category || '').toLowerCase()).filter(Boolean)).size / 6);
  const confidence = Math.min(1, completeness * 0.4 + consistency * 0.3 + coverage * 0.3);

  return {
    completeness: safeRound(completeness, 2),
    consistency: safeRound(consistency, 2),
    coverage: safeRound(coverage, 2),
    confidence: safeRound(confidence, 2)
  };
};

const buildOrganizationAndProductReporting = ({
  msme = {},
  transactions = [],
  reportingConfig = {}
}) => {
  const aggregatedBreakdown = aggregateTransactionEmissionsByProduct({
    transactions,
    msme
  });

  return applyReportingConfigurationToBreakdown({
    breakdown: aggregatedBreakdown,
    config: reportingConfig
  });
};

const buildKnownParametersFromMsme = (msme = {}) => {
  const enterprise = msme?.enterpriseProfile;
  if (enterprise) {
    const facilities = Array.isArray(enterprise.facilities) ? enterprise.facilities : [];
    const scope3Categories = (enterprise.scope3Materiality?.categories || [])
      .filter((c) => c.material)
      .map((c) => c.category)
      .filter(Boolean);
    return {
      msmeProfile: {
        businessDomain: msme.businessDomain || enterprise.sector,
        industry: enterprise.industry || msme.industry,
        companyType: msme.companyType || 'medium',
        segment: 'enterprise'
      },
      processes: facilities.flatMap((f) => f.scope1Sources || []).filter(Boolean),
      machinery: facilities.flatMap((f) => f.scope2Sources || []).filter(Boolean),
      scope3Categories,
      materialsConsumption: {
        total: scope3Categories.length,
        source: 'enterprise_scope3_materiality'
      },
      metadata: {
        source: 'enterprise_profile',
        consolidationApproach: enterprise.consolidationApproach,
        reportingEntityType: enterprise.reportingEntityType
      }
    };
  }

  const workflow = msme?.business?.manufacturingWorkflow || {};
  const workflowUnits = Array.isArray(workflow.units) ? workflow.units : [];
  const processes = workflowUnits.flatMap(unit => (unit?.processes || []).map(process => process?.name).filter(Boolean));
  const machinery = workflowUnits.flatMap(unit =>
    (unit?.processes || []).flatMap(process => (process?.machineries || []).map(item => item?.name).filter(Boolean))
  );
  const totalMaterialsKg = workflowUnits.reduce((sum, unit) => (
    sum + (unit?.processes || []).reduce((processSum, process) => (
      processSum + (process?.rawMaterials || []).reduce((rawSum, material) => rawSum + safeNumber(material?.quantityKg), 0)
    ), 0)
  ), 0);

  return {
    msmeProfile: {
      businessDomain: msme.businessDomain,
      industry: msme.industry,
      companyType: msme.companyType
    },
    processes,
    machinery,
    materialsConsumption: {
      total: safeRound(totalMaterialsKg, 2),
      source: 'msme_workflow'
    },
    metadata: {
      source: 'msme_workflow'
    }
  };
};

const buildCarbonAgentInput = (assessment) => {
  if (!assessment) {
    return {
      totalEmissions: 0,
      categoryBreakdown: {}
    };
  }

  return {
    totalEmissions: safeNumber(assessment.totalCO2Emissions),
    categoryBreakdown: {
      energy: safeNumber(assessment?.breakdown?.energy?.total),
      transportation: safeNumber(assessment?.breakdown?.transportation?.co2Emissions),
      waste: safeNumber(assessment?.breakdown?.waste?.total),
      water: safeNumber(assessment?.breakdown?.water?.co2Emissions),
      materials: safeNumber(assessment?.breakdown?.materials?.co2Emissions)
    }
  };
};

const getIsoLifecycleSignals = (msme = {}, transactions = []) => {
  const workflow = msme?.business?.manufacturingWorkflow || {};
  const downstreamSignal = transactions.some((transaction) => {
    const type = String(transaction?.transactionType || '').toLowerCase();
    const description = String(transaction?.description || '').toLowerCase();
    return type === 'sale' || description.includes('delivery') || description.includes('dispatch');
  });

  return {
    upstream: (Array.isArray(workflow.supplyChain) && workflow.supplyChain.length > 0)
      || safeNumber(workflow?.latestEstimate?.rawMaterialEmissions) > 0,
    operations: (Array.isArray(workflow.units) && workflow.units.length > 0)
      || safeNumber(workflow?.latestEstimate?.machineryEmissions) > 0,
    downstream: downstreamSignal
      || safeNumber(workflow?.latestEstimate?.supplyChainEmissions) > 0,
    support: (Array.isArray(workflow.employees) && workflow.employees.length > 0)
      || safeNumber(workflow?.latestEstimate?.commuteEmissions) > 0
  };
};

const buildISO14064Report = ({
  msme,
  assessment,
  assessments = [],
  transactions,
  dataQuality,
  frameworkConfig,
  reportingConfig = {}
}) => {
  const { companyProfile, operationsProfile } = buildCompanyOperationsProfile(msme);
  const scopeData = buildScopeDataFromAssessment(assessment);
  const organizationAndProductBreakdown = buildOrganizationAndProductReporting({
    msme,
    transactions,
    reportingConfig
  });
  const knownParameters = buildKnownParametersFromMsme(msme);
  const carbonData = buildCarbonAgentInput(assessment);
  const evaluation = standardHandlerHelpers.evaluateIso14064({
    msmeData: msme,
    carbonData,
    transactions,
    knownParameters,
    dataQuality,
    context: {
      frameworks: {
        iso14064: frameworkConfig
      },
      knownParameters,
      dataQuality
    }
  });
  const gapClosureChecklist = isoGapClosureService.buildIsoGapClosureChecklist({
    msmeData: msme,
    transactions,
    carbonData,
    dataQuality,
    knownParameters,
    context: {
      dataQuality,
      frameworks: {
        iso14064: frameworkConfig
      }
    },
    frameworks: {
      iso14064: frameworkConfig
    }
  });
  const governanceVerificationControls = gapClosureChecklist.sections.governanceVerificationControls;
  const governanceItems = Array.isArray(governanceVerificationControls?.items)
    ? governanceVerificationControls.items
    : [];
  const governanceCompleteCount = governanceItems.filter(item => item.status === 'complete').length;
  const governanceCoverage = governanceItems.length > 0
    ? safeRound((governanceCompleteCount / governanceItems.length) * 100, 1)
    : 0;
  const visualization = buildIso14064Visualization({
    scopeData,
    dataQuality,
    checks: evaluation.checks,
    governanceItems,
    assessments
  });
  const reportReadiness = buildReportReadinessMeta({
    reportType: 'ISO14064',
    isoReport: {
      overview: {
        readinessScore: evaluation.readinessScore,
        status: evaluation.status,
        totalCO2Emissions: safeRound(carbonData.totalEmissions, 2)
      }
    }
  });

  return {
    inventorySummary: `ISO 14064 ${evaluation.status} — ${evaluation.readinessScore}% readiness, ${safeRound(carbonData.totalEmissions, 2)} tCO2e inventory`,
    companyProfile,
    operationsProfile,
    reportReadiness,
    evaluation,
    overview: {
      standard: 'ISO 14064',
      objective: 'Organizational greenhouse gas inventory and accounting readiness',
      readinessScore: evaluation.readinessScore,
      status: evaluation.status,
      alignmentCategory: evaluation.status === 'aligned'
        ? 'aligned_for_external_verification'
        : 'gap_closure_required',
      reportingPeriod: {
        startDate: assessment?.period?.startDate || null,
        endDate: assessment?.period?.endDate || null
      },
      totalCO2Emissions: safeRound(carbonData.totalEmissions, 2),
      confidence: dataQuality.confidence
    },
    ghgProtocol: {
      standard: 'GHG Protocol Corporate Standard',
      reportingBoundary: 'Organization-level scope inventory',
      scopes: {
        scope1: safeRound(scopeData.scope1?.total || 0, 2),
        scope2: safeRound(scopeData.scope2?.total || 0, 2),
        scope3: safeRound(scopeData.scope3?.total || 0, 2)
      },
      scopeContributionPercent: {
        scope1: safeRound(scopeData.scope1?.percentage || 0, 2),
        scope2: safeRound(scopeData.scope2?.percentage || 0, 2),
        scope3: safeRound(scopeData.scope3?.percentage || 0, 2)
      }
    },
    brsrComplianceReference: {
      framework: 'SEBI BRSR Principle 6',
      relevance: 'ISO 14064 scope inventory can be directly referenced in BRSR greenhouse gas disclosures.'
    },
    inventory: {
      scopes: scopeData,
      transactionCount: transactions.length,
      company: {
        companyName: msme?.companyName || 'MSME',
        industry: msme?.industry || 'General',
        businessDomain: msme?.businessDomain || 'other'
      },
      baseYear: frameworkConfig.baseYear || null,
      organizationAndProductBreakdown
    },
    checks: evaluation.checks,
    issues: evaluation.issues,
    recommendations: evaluation.recommendations,
    evidenceUsed: evaluation.evidenceUsed,
    governanceAndVerification: {
      readinessScore: safeRound(governanceVerificationControls?.readinessScore || 0, 1),
      controlCoverage: governanceCoverage,
      controls: governanceItems,
      controlSummary: evaluation.controlSummary || {}
    },
    gapClosureChecklist: {
      overallReadinessScore: gapClosureChecklist.overallReadinessScore,
      sections: {
        boundaryDefinitions: gapClosureChecklist.sections.boundaryDefinitions,
        factorRegistry: gapClosureChecklist.sections.factorRegistry,
        uncertaintyFields: gapClosureChecklist.sections.uncertaintyFields,
        governanceVerificationControls: gapClosureChecklist.sections.governanceVerificationControls
      },
      openGaps: gapClosureChecklist.openGaps,
      priorityActions: gapClosureChecklist.priorityActions
    },
    factorRegistry: gapClosureChecklist.factorRegistry,
    visualization,
    aiAgentSummary: buildReportAgents({
      reportType: 'ISO14064'
    }),
    reportAgents: buildReportAgents({
      reportType: 'ISO14064'
    })
  };
};

const buildISO14067Report = ({
  msme,
  assessment,
  transactions,
  dataQuality,
  frameworkConfig,
  reportingConfig = {}
}) => {
  const { companyProfile, operationsProfile } = buildCompanyOperationsProfile(msme);
  const workflow = msme?.business?.manufacturingWorkflow || {};
  const organizationAndProductBreakdown = buildOrganizationAndProductReporting({
    msme,
    transactions,
    reportingConfig
  });
  const knownParameters = buildKnownParametersFromMsme(msme);
  const products = Array.from(new Set([
    ...(Array.isArray(workflow.units) ? workflow.units.flatMap(unit => unit?.products || []) : []),
    msme?.business?.primaryProducts
  ].filter(Boolean)));

  const lifecycleSignals = getIsoLifecycleSignals(msme, transactions);
  const lifecycleCoverage = Object.values(lifecycleSignals).filter(Boolean).length / 4;
  const evaluation = standardHandlerHelpers.evaluateIso14067({
    msmeData: msme,
    transactions,
    knownParameters,
    processMachineryProfile: {
      processes: knownParameters.processes,
      machinery: knownParameters.machinery
    },
    dataQuality,
    context: {
      frameworks: {
        iso14067: frameworkConfig
      },
      knownParameters,
      dataQuality
    }
  });
  const gapClosureChecklist = isoGapClosureService.buildIsoGapClosureChecklist({
    msmeData: msme,
    transactions,
    dataQuality,
    knownParameters,
    processMachineryProfile: {
      processes: knownParameters.processes,
      machinery: knownParameters.machinery
    },
    context: {
      dataQuality,
      frameworks: {
        iso14067: frameworkConfig
      }
    },
    frameworks: {
      iso14067: frameworkConfig
    }
  });
  const factorRegistry = Array.isArray(gapClosureChecklist.factorRegistry) ? gapClosureChecklist.factorRegistry : [];
  const productLci = buildIso14067ProductLci({
    msme,
    frameworkConfig,
    factorRegistry
  });
  const boundaryDefinition = buildIso14067BoundaryDefinition({
    msme,
    frameworkConfig,
    lifecycleSignals,
    lciGranularityScore: productLci?.lciCoverage?.granularityScore
  });
  const visualization = buildIso14067Visualization({
    productFootprints: productLci.productFootprints,
    records: productLci.records,
    lciCoverage: productLci.lciCoverage,
    boundaryDefinition,
    uncertaintyProfile: productLci.uncertaintyProfile
  });

  const totalProductFootprint = safeRound(productLci.totalFootprint, 4);
  const productCount = productLci.productFootprints.length || products.length || 1;
  const perFunctionalUnit = safeRound(totalProductFootprint / productCount, 4);
  const readinessScore = safeRound(
    (
      safeNumber(evaluation.readinessScore) * 0.55
      + safeNumber(boundaryDefinition.rigorScore) * 0.25
      + safeNumber(productLci?.lciCoverage?.granularityScore) * 0.2
    ),
    1
  );
  const uncertaintyMethodology = frameworkConfig?.uncertainty?.methodology
    || productLci?.uncertaintyProfile?.methodology;
  const combinedRelativeUncertainty = frameworkConfig?.uncertainty?.combinedRelativeUncertainty
    ?? productLci?.uncertaintyProfile?.relativeUncertainty;
  const relativeUncertaintyForContext = Number.isFinite(Number(combinedRelativeUncertainty))
    ? Number(combinedRelativeUncertainty)
    : null;
  const boundaryRigorScoreForContext = safeRound(safeNumber(boundaryDefinition.rigorScore) / 100, 4);
  const lciGranularityScoreForContext = safeRound(safeNumber(productLci?.lciCoverage?.granularityScore) / 100, 4);

  const enhancedEvaluation = standardHandlerHelpers.evaluateIso14067({
    msmeData: msme,
    transactions,
    knownParameters,
    processMachineryProfile: {
      processes: knownParameters.processes,
      machinery: knownParameters.machinery
    },
    dataQuality,
    context: {
      frameworks: {
        iso14067: {
          ...frameworkConfig,
          uncertainty: {
            ...(frameworkConfig.uncertainty || {}),
            methodology: uncertaintyMethodology || frameworkConfig?.uncertainty?.methodology || null,
            combinedRelativeUncertainty: relativeUncertaintyForContext
          }
        }
      },
      knownParameters,
      dataQuality,
      iso14067Signals: {
        boundaryRigorScore: boundaryRigorScoreForContext,
        boundaryDescription: boundaryDefinition.boundaryDescription,
        systemBoundaryType: boundaryDefinition.systemBoundaryType,
        lciGranularityScore: lciGranularityScoreForContext,
        lciRecordCount: productLci?.lciCoverage?.totalRecords || 0
      }
    }
  });
  const exportValidation = validateIso14067ReportGate({
    evaluation: { ...enhancedEvaluation, readinessScore },
    frameworkConfig,
    productLci
  });
  const reportReadiness = buildReportReadinessMeta({
    reportType: 'ISO14067',
    isoReport: {
      overview: {
        readinessScore,
        status: enhancedEvaluation.status,
        functionalUnit: frameworkConfig.functionalUnit
      }
    }
  });

  return {
    productSummary: `ISO 14067 ${enhancedEvaluation.status} — ${readinessScore}% readiness, ${productCount} product(s), ${totalProductFootprint} kgCO2e total footprint`,
    companyProfile,
    operationsProfile,
    reportReadiness,
    exportValidation,
    overview: {
      standard: 'ISO 14067',
      objective: 'Product carbon footprint quantification and communication with product-level LCI and boundary rigor controls',
      readinessScore,
      status: enhancedEvaluation.status,
      functionalUnit: frameworkConfig.functionalUnit || '1 unit of finished product',
      allocationMethod: frameworkConfig.allocationMethod || null,
      declaredUnit: frameworkConfig.declaredUnit || 'unit',
      confidence: dataQuality.confidence
    },
    ghgProtocol: {
      standard: 'GHG Protocol Product Standard (mapped from organizational data)',
      note: 'Product footprint output is cross-referenced with organizational scope inventory for consistency.',
      scopesReferenced: ['Scope 1', 'Scope 2', 'Scope 3']
    },
    brsrComplianceReference: {
      framework: 'SEBI BRSR Principle 6',
      relevance: 'Product-level lifecycle hotspots support environmental improvement narratives in BRSR disclosures.'
    },
    productFootprint: {
      productCount: productLci.productFootprints.length,
      products: productLci.productFootprints.slice(0, 10).map(item => item.productName),
      productCatalog: productLci.productCatalog,
      productLevelFootprints: productLci.productFootprints,
      totalProductFootprint,
      estimatedFootprintPerFunctionalUnit: perFunctionalUnit,
      lifecycleCoverage: safeRound(lifecycleCoverage, 2),
      lifecycleStages: lifecycleSignals,
      boundaryDefinition,
      uncertaintyProfile: productLci.uncertaintyProfile,
      lciCoverage: productLci.lciCoverage,
      organizationAndProductBreakdown
    },
    checks: enhancedEvaluation.checks,
    issues: enhancedEvaluation.issues,
    recommendations: enhancedEvaluation.recommendations,
    evidenceUsed: enhancedEvaluation.evidenceUsed,
    gapClosureChecklist: {
      overallReadinessScore: gapClosureChecklist.overallReadinessScore,
      sections: {
        boundaryDefinitions: gapClosureChecklist.sections.boundaryDefinitions,
        factorRegistry: gapClosureChecklist.sections.factorRegistry,
        uncertaintyFields: gapClosureChecklist.sections.uncertaintyFields,
        productCfpModuleSkeleton: gapClosureChecklist.sections.productCfpModuleSkeleton
      },
      openGaps: gapClosureChecklist.openGaps,
      priorityActions: gapClosureChecklist.priorityActions
    },
    factorRegistry,
    lciRecords: productLci.records,
    visualization,
    productCfpModuleSkeleton: gapClosureChecklist.sections.productCfpModuleSkeleton,
    aiAgentSummary: buildReportAgents({
      reportType: 'ISO14067'
    }),
    reportAgents: buildReportAgents({
      reportType: 'ISO14067'
    })
  };
};

const buildISO14064ReportForMsme = async ({
  msmeId,
  period = 'annual',
  frameworkConfig = {},
  reportingConfig = {}
}) => {
  const msme = await MSME.findById(msmeId).lean();
  if (!msme) {
    return null;
  }

  const { startDate, endDate } = getDateRangeFromPeriod(period);
  const [assessments, transactions] = await Promise.all([
    CarbonAssessment.find({
      msmeId,
      $or: [
        { 'period.endDate': { $gte: startDate, $lte: endDate } },
        { createdAt: { $gte: startDate, $lte: endDate } }
      ]
    })
      .sort({ 'period.endDate': -1, createdAt: -1 })
      .lean(),
    Transaction.find({
      msmeId,
      date: { $gte: startDate, $lte: endDate },
      isSpam: { $ne: true },
      isDuplicate: { $ne: true }
    }).lean()
  ]);

  const assessment = assessments[0] || null;
  const dataQuality = buildIsoDataQuality({ assessments, transactions });
  const iso14064Report = buildISO14064Report({
    msme,
    assessment,
    assessments,
    transactions,
    dataQuality,
    reportingConfig,
    frameworkConfig: {
      enabled: true,
      ...frameworkConfig
    }
  });

  return {
    msme,
    iso14064Report
  };
};

const buildISO14067ReportForMsme = async ({
  msmeId,
  period = '6months',
  frameworkConfig = {},
  reportingConfig = {}
}) => {
  const msme = await MSME.findById(msmeId).lean();
  if (!msme) {
    return null;
  }

  const { startDate, endDate } = getDateRangeFromPeriod(period);
  const [assessments, transactions] = await Promise.all([
    CarbonAssessment.find({
      msmeId,
      $or: [
        { 'period.endDate': { $gte: startDate, $lte: endDate } },
        { createdAt: { $gte: startDate, $lte: endDate } }
      ]
    })
      .sort({ 'period.endDate': -1, createdAt: -1 })
      .lean(),
    Transaction.find({
      msmeId,
      date: { $gte: startDate, $lte: endDate },
      isSpam: { $ne: true },
      isDuplicate: { $ne: true }
    }).lean()
  ]);

  const assessment = assessments[0] || null;
  const dataQuality = buildIsoDataQuality({ assessments, transactions });
  const iso14067Report = buildISO14067Report({
    msme,
    assessment,
    assessments,
    transactions,
    dataQuality,
    reportingConfig,
    frameworkConfig: {
      enabled: true,
      ...frameworkConfig
    }
  });

  return {
    msme,
    iso14067Report
  };
};

const buildIsoGapClosureForMsme = async ({
  msmeId,
  period = 'annual',
  framework = 'all',
  frameworkConfig = {}
}) => {
  const msme = await MSME.findById(msmeId).lean();
  if (!msme) {
    return null;
  }

  const { startDate, endDate } = getDateRangeFromPeriod(period);
  const [assessments, transactions] = await Promise.all([
    CarbonAssessment.find({
      msmeId,
      $or: [
        { 'period.endDate': { $gte: startDate, $lte: endDate } },
        { createdAt: { $gte: startDate, $lte: endDate } }
      ]
    })
      .sort({ 'period.endDate': -1, createdAt: -1 })
      .lean(),
    Transaction.find({
      msmeId,
      date: { $gte: startDate, $lte: endDate },
      isSpam: { $ne: true },
      isDuplicate: { $ne: true }
    }).lean()
  ]);

  const dataQuality = buildIsoDataQuality({ assessments, transactions });
  const knownParameters = buildKnownParametersFromMsme(msme);
  const latestAssessment = assessments[0] || null;
  const frameworks = {
    iso14064: frameworkConfig.iso14064 || {},
    iso14067: frameworkConfig.iso14067 || {}
  };
  if (framework === 'iso14064') {
    frameworks.iso14067 = { enabled: false };
  }
  if (framework === 'iso14067') {
    frameworks.iso14064 = { enabled: false };
  }

  const checklist = isoGapClosureService.buildIsoGapClosureChecklist({
    msmeData: msme,
    transactions,
    carbonData: buildCarbonAgentInput(latestAssessment),
    dataQuality,
    knownParameters,
    frameworks,
    context: {
      frameworks,
      dataQuality,
      knownParameters
    }
  });

  return {
    msme,
    checklist
  };
};

const buildBRSRReportForUser = async (userContext, period = 'annual') => {
  const context = await loadOrgReportingContext(userContext, period);
  if (!context) {
    return null;
  }
  return {
    msme: context.msme,
    brsrReport: context.brsrReport,
    segment: context.segment
  };
};

const buildCbamReportForUser = async (userContext, {
  period = 'quarter',
  mappingMode = 'company',
  selectedProducts = []
} = {}) => {
  const context = await loadOrgReportingContext(userContext, period);
  if (!context) {
    return null;
  }

  const quarterCount = getQuarterCountFromPeriod(period);
  const quarters = getRecentQuarters(quarterCount);
  const oldestQuarter = quarters[0];
  const startDate = new Date(oldestQuarter.year, (oldestQuarter.quarter - 1) * 3, 1);
  const endDate = new Date();

  const assessments = await CarbonAssessment.find(
    buildAssessmentFilterForUser(userContext, startDate, endDate)
  )
    .sort({ 'period.endDate': 1, createdAt: 1 })
    .lean();

  const filteredTransactions = context.transactions.filter((transaction) => transactionMatchesCbamMapping(
    transaction,
    { mappingMode, selectedProducts }
  ));
  const hubRecord = await loadComplianceHubRecord(context.msme);

  const cbamReport = buildCbamReport({
    msme: context.msme,
    period,
    assessments,
    transactions: filteredTransactions,
    mappingMode,
    selectedProducts,
    hubRecord
  });

  return {
    msme: context.msme,
    cbamReport,
    segment: context.segment
  };
};

const buildISO14064ReportForUser = async (userContext, {
  period = 'annual',
  frameworkConfig = {},
  reportingConfig = {}
} = {}) => {
  const context = await loadOrgReportingContext(userContext, period);
  if (!context) {
    return null;
  }

  const { startDate, endDate } = getDateRangeFromPeriod(period);
  const assessments = await CarbonAssessment.find(
    buildAssessmentFilterForUser(userContext, startDate, endDate)
  )
    .sort({ 'period.endDate': -1, createdAt: -1 })
    .lean();

  const assessment = context.latestAssessment || assessments[0] || null;
  const dataQuality = buildIsoDataQuality({ assessments, transactions: context.transactions });
  const iso14064Report = buildISO14064Report({
    msme: context.msme,
    assessment,
    assessments,
    transactions: context.transactions,
    dataQuality,
    reportingConfig,
    frameworkConfig: {
      enabled: true,
      ...frameworkConfig
    }
  });

  return {
    msme: context.msme,
    iso14064Report,
    segment: context.segment
  };
};

const buildISO14067ReportForUser = async (userContext, {
  period = '6months',
  frameworkConfig = {},
  reportingConfig = {}
} = {}) => {
  const context = await loadOrgReportingContext(userContext, period);
  if (!context) {
    return null;
  }

  const { startDate, endDate } = getDateRangeFromPeriod(period);
  const assessments = await CarbonAssessment.find(
    buildAssessmentFilterForUser(userContext, startDate, endDate)
  )
    .sort({ 'period.endDate': -1, createdAt: -1 })
    .lean();

  const assessment = context.latestAssessment || assessments[0] || null;
  const dataQuality = buildIsoDataQuality({ assessments, transactions: context.transactions });
  const iso14067Report = buildISO14067Report({
    msme: context.msme,
    assessment,
    assessments,
    transactions: context.transactions,
    dataQuality,
    reportingConfig,
    frameworkConfig: {
      enabled: true,
      ...frameworkConfig
    }
  });

  return {
    msme: context.msme,
    iso14067Report,
    segment: context.segment
  };
};

const buildIsoGapClosureForUser = async (userContext, {
  period = 'annual',
  framework = 'all',
  frameworkConfig = {}
} = {}) => {
  const context = await loadOrgReportingContext(userContext, period);
  if (!context) {
    return null;
  }

  const { startDate, endDate } = getDateRangeFromPeriod(period);
  const assessments = await CarbonAssessment.find(
    buildAssessmentFilterForUser(userContext, startDate, endDate)
  )
    .sort({ 'period.endDate': -1, createdAt: -1 })
    .lean();

  const dataQuality = buildIsoDataQuality({ assessments, transactions: context.transactions });
  const knownParameters = buildKnownParametersFromMsme(context.msme);
  const latestAssessment = context.latestAssessment || assessments[0] || null;
  const frameworks = {
    iso14064: frameworkConfig.iso14064 || {},
    iso14067: frameworkConfig.iso14067 || {}
  };
  if (framework === 'iso14064') {
    frameworks.iso14067 = { enabled: false };
  }
  if (framework === 'iso14067') {
    frameworks.iso14064 = { enabled: false };
  }

  const checklist = isoGapClosureService.buildIsoGapClosureChecklist({
    msmeData: context.msme,
    transactions: context.transactions,
    carbonData: buildCarbonAgentInput(latestAssessment),
    dataQuality,
    knownParameters,
    frameworks,
    context: {
      frameworks,
      dataQuality,
      knownParameters
    }
  });

  return {
    msme: context.msme,
    checklist,
    segment: context.segment
  };
};

// Get carbon footprint data
router.get('/carbon-footprint', auth, async (req, res) => {
  try {
    const { period = '6months' } = req.query;

    if (!assertReportingProfile(req, res)) {
      return;
    }

    const { startDate, endDate } = getDateRangeFromPeriod(period);
    const assessments = await CarbonAssessment.find(
      buildAssessmentFilterForUser(req.user, startDate, endDate)
    )
      .sort({ 'period.endDate': 1 })
      .lean();

    const latestAssessment = assessments.length > 0 ? assessments[assessments.length - 1] : null;
    const hasAssessments = assessments.length > 0;

    res.json({
      success: true,
      data: {
        dataStatus: hasAssessments ? 'available' : 'no_assessments',
        carbonData: hasAssessments ? buildCarbonSeries(assessments) : [],
        categoryData: latestAssessment ? buildCategoryDataFromAssessment(latestAssessment) : [],
        trendData: hasAssessments ? buildTrendDataFromAssessments(assessments) : [],
        scopeData: latestAssessment ? buildScopeDataFromAssessment(latestAssessment) : {
          scope1: { total: 0, percentage: 0, breakdown: {} },
          scope2: { total: 0, percentage: 0, breakdown: {} },
          scope3: { total: 0, percentage: 0, breakdown: {} },
          total: 0
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching carbon footprint data',
      ...clientErrorPayload(error)
    });
  }
});

// Get recommendations data
router.get('/recommendations', auth, async (req, res) => {
  try {
    const { status, impact, cost } = req.query;

    if (!assertReportingProfile(req, res)) {
      return;
    }

    const context = await loadOrgReportingContext(req.user, '6months');
    if (!context) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const { items, dataStatus } = buildRecommendationsPayload(context.latestAssessment, context.msme);
    let filteredRecommendations = items;

    if (status) {
      filteredRecommendations = filteredRecommendations.filter((rec) => (
        rec.status.toLowerCase() === String(status).toLowerCase()
      ));
    }

    if (impact) {
      filteredRecommendations = filteredRecommendations.filter((rec) => (
        rec.impact.toLowerCase() === String(impact).toLowerCase()
      ));
    }

    if (cost) {
      filteredRecommendations = filteredRecommendations.filter((rec) => (
        rec.cost.toLowerCase() === String(cost).toLowerCase()
      ));
    }

    res.json({
      success: true,
      data: filteredRecommendations,
      dataStatus
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching recommendations data',
      ...clientErrorPayload(error)
    });
  }
});

// Get trends data
router.get('/trends', auth, async (req, res) => {
  try {
    const { period = '6months' } = req.query;

    if (!assertReportingProfile(req, res)) {
      return;
    }

    const { startDate, endDate } = getDateRangeFromPeriod(period);
    const assessments = await CarbonAssessment.find(
      buildAssessmentFilterForUser(req.user, startDate, endDate)
    )
      .sort({ 'period.endDate': 1 })
      .lean();

    const hasAssessments = assessments.length > 0;

    res.json({
      success: true,
      data: {
        dataStatus: hasAssessments ? 'available' : 'no_assessments',
        carbonData: hasAssessments ? buildCarbonSeries(assessments) : [],
        trendData: hasAssessments ? buildTrendDataFromAssessments(assessments) : [],
        period
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching trends data',
      ...clientErrorPayload(error)
    });
  }
});

// Get comparison data
router.get('/comparisons', auth, async (req, res) => {
  try {
    if (!assertReportingProfile(req, res)) {
      return;
    }

    const context = await loadOrgReportingContext(req.user, '6months');
    if (!context) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const { startDate, endDate } = getDateRangeFromPeriod('6months');
    const assessments = await CarbonAssessment.find(
      buildAssessmentFilterForUser(req.user, startDate, endDate)
    )
      .sort({ 'period.endDate': 1, createdAt: 1 })
      .lean();

    const latestAssessment = assessments.length > 0 ? assessments[assessments.length - 1] : context.latestAssessment;
    const previousAssessment = assessments.length > 1 ? assessments[assessments.length - 2] : null;
    const comparisonData = buildComparisonDataFromContext(latestAssessment, context.msme, previousAssessment);

    res.json({
      success: true,
      data: comparisonData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching comparison data',
      ...clientErrorPayload(error)
    });
  }
});

// Get CBAM reporting data for MSME
router.get('/cbam', auth, async (req, res) => {
  try {
    const { period = 'quarter', format = 'json' } = req.query;
    const mappingMode = normalizeCbamTransactionMapping(req.query.transactionMapping);
    const selectedProducts = normalizeMultiValueFilter(req.query.selectedProducts);

    if (!assertReportingProfile(req, res)) {
      return;
    }

    const reportContext = await buildCbamReportForUser(req.user, {
      period,
      mappingMode,
      selectedProducts
    });
    if (!reportContext) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }
    const { msme, cbamReport } = reportContext;

    if (String(format).toLowerCase() === 'pdf') {
      const reportId = `CBAM-${Date.now()}`;
      const pdfBuffer = await generateCbamReportPdf(cbamReport, { reportId });
      const safeCompanyName = String(msme?.companyName || 'MSME')
        .replace(/[^a-z0-9-_]/gi, '_')
        .slice(0, 50);
      const filename = `${safeCompanyName}_CBAM_${new Date().toISOString().slice(0, 10)}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Report-Id', reportId);
      return res.send(pdfBuffer);
    }

    if (String(format).toLowerCase() === 'csv' || String(format).toLowerCase() === 'registry') {
      const registry = buildCbamRegistryCsv(cbamReport);
      res.setHeader('Content-Type', registry.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${registry.filename}"`);
      return res.send(registry.csv);
    }

    res.json({
      success: true,
      data: cbamReport
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching CBAM reporting data',
      ...clientErrorPayload(error)
    });
  }
});

// Get BRSR compliant report for MSME
router.get('/brsr', auth, requireMsmePlanFeature('brsrExports'), async (req, res) => {
  try {
    const { period = 'annual', format = 'json', force = 'false' } = req.query;

    // Prevent caching at all levels (browser, phone, proxy)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (!assertReportingProfile(req, res)) {
      return;
    }

    const reportContext = await buildBRSRReportForUser(req.user, period, force === 'true');
    if (!reportContext) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const { brsrReport, msme } = reportContext;

    if (String(format).toLowerCase() === 'pdf') {
      const reportId = `BRSR-${Date.now()}`;
      const pdfBuffer = await generateBRSRReportPdf(brsrReport, { reportId });
      const safeCompanyName = String(msme?.companyName || 'MSME')
        .replace(/[^a-z0-9-_]/gi, '_')
        .slice(0, 50);
      const filename = `${safeCompanyName}_BRSR_${Date.now()}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Report-Id', reportId);
      return res.send(pdfBuffer);
    }

    const normalizedFormat = String(format).toLowerCase();
    if (normalizedFormat === 'sebi' || normalizedFormat === 'sebi-json') {
      return res.json({
        success: true,
        data: buildSebiBrsrExport(brsrReport)
      });
    }
    if (normalizedFormat === 'xbrl') {
      const xbrl = buildBrsrXbrlSkeleton(brsrReport);
      res.setHeader('Content-Type', xbrl.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${xbrl.filename}"`);
      return res.send(xbrl.xml);
    }

    res.json({
      success: true,
      data: brsrReport
    });
  } catch (error) {
    console.error('BRSR PDF Generation Error:', error);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({
      success: false,
      message: 'Error generating BRSR report',
      ...clientErrorPayload(error)
    });
  }
});

// Get ISO 14064 carbon accounting report
router.get('/iso-14064', auth, async (req, res) => {
  try {
    const {
      period = 'annual',
      format = 'json',
      baseYear,
      methodologyReference,
      quantificationApproach,
      inventoryOwner,
      evidenceRetentionYears,
      assuranceLevel,
      boundaryCoverage,
      evidencePackVersion,
      boundaryDescription,
      temporalCoverage,
      geographicalCoverage,
      cutOffMassPercent,
      cutOffEnergyPercent,
      uncertaintyMethodology,
      combinedRelativeUncertainty,
      includeOrganizationSummary,
      includeProductBreakdown,
      includeProductScopeBreakdown,
      includeAttributionStats,
      includeUnassignedProducts,
      productLimit,
      productIds,
      productNames
    } = req.query;

    if (!assertReportingProfile(req, res)) {
      return;
    }

    const reportContext = await buildISO14064ReportForUser(req.user, {
      period,
      reportingConfig: {
        includeOrganizationSummary,
        includeProductBreakdown,
        includeProductScopeBreakdown,
        includeAttributionStats,
        includeUnassignedProducts,
        productLimit,
        productIds,
        productNames
      },
      frameworkConfig: {
        baseYear: baseYear ? Number(baseYear) : undefined,
        methodology: {
          protocolReference: methodologyReference || undefined,
          quantificationApproach: quantificationApproach || undefined
        },
        governance: {
          inventoryManager: inventoryOwner || undefined,
          evidenceRetentionYears: evidenceRetentionYears ? Number(evidenceRetentionYears) : undefined
        },
        verification: {
          assuranceLevel: assuranceLevel || undefined,
          boundaryCoverage: boundaryCoverage || undefined,
          evidencePackVersion: evidencePackVersion || undefined
        },
        boundaryDescription: boundaryDescription || undefined,
        temporalCoverage: temporalCoverage || undefined,
        geographicalCoverage: geographicalCoverage || undefined,
        cutOffCriteria: {
          massPercentThreshold: Number.isFinite(Number(cutOffMassPercent))
            ? Number(cutOffMassPercent)
            : undefined,
          energyPercentThreshold: Number.isFinite(Number(cutOffEnergyPercent))
            ? Number(cutOffEnergyPercent)
            : undefined
        },
        uncertainty: {
          methodology: uncertaintyMethodology || undefined,
          combinedRelativeUncertainty: Number.isFinite(Number(combinedRelativeUncertainty))
            ? Number(combinedRelativeUncertainty)
            : undefined
        }
      }
    });
    if (!reportContext) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const { iso14064Report, msme } = reportContext;
    if (String(format).toLowerCase() === 'pdf') {
      const reportId = `ISO14064-${Date.now()}`;
      const pdfBuffer = await generateGenericReportPdf({
        title: `${msme?.companyName || 'MSME'} ISO 14064 Report`,
        companyProfile: iso14064Report.companyProfile,
        operationsProfile: iso14064Report.operationsProfile,
        summary: {
          readinessScore: `${iso14064Report.overview.readinessScore}%`,
          status: iso14064Report.overview.status,
          totalCO2Emissions: `${iso14064Report.overview.totalCO2Emissions} tCO2e`,
          confidence: iso14064Report.overview.confidence
        },
        emissionsAndCompliance: {
          ghgProtocol: iso14064Report?.ghgProtocol?.standard || 'GHG Protocol Corporate Standard',
          scope1: safeRound(iso14064Report?.ghgProtocol?.scopes?.scope1 || 0, 2),
          scope2: safeRound(iso14064Report?.ghgProtocol?.scopes?.scope2 || 0, 2),
          scope3: safeRound(iso14064Report?.ghgProtocol?.scopes?.scope3 || 0, 2),
          brsrReference: iso14064Report?.brsrComplianceReference?.framework || 'SEBI BRSR Principle 6'
        },
        sections: [
          'Organizational Boundary',
          'Scope Inventory (1/2/3)',
          'Data Quality Controls',
          'Gap Analysis and Recommendations'
        ],
        carbonVisualization: iso14064Report.visualization,
        carbonVisualizationKind: 'iso14064',
        notes: `Report ID: ${reportId}`
      });
      const safeCompanyName = String(msme?.companyName || 'MSME')
        .replace(/[^a-z0-9-_]/gi, '_')
        .slice(0, 50);
      const filename = `${safeCompanyName}_ISO14064_${new Date().toISOString().slice(0, 10)}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Report-Id', reportId);
      return res.send(pdfBuffer);
    }

    if (String(format).toLowerCase() === 'audit-pack') {
      const auditPack = buildIso14064AuditPack({
        isoReport: iso14064Report,
        gapChecklist: {
          factorRegistry: iso14064Report.factorRegistry,
          sections: iso14064Report.gapClosureChecklist?.sections,
          overallReadinessScore: iso14064Report.gapClosureChecklist?.overallReadinessScore,
          openGaps: iso14064Report.gapClosureChecklist?.openGaps,
          priorityActions: iso14064Report.gapClosureChecklist?.priorityActions
        },
        msme
      });
      return res.json({ success: true, data: auditPack });
    }

    return res.json({
      success: true,
      data: iso14064Report
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error generating ISO 14064 report',
      ...clientErrorPayload(error)
    });
  }
});

// Get ISO 14067 product carbon footprint report
router.get('/iso-14067', auth, async (req, res) => {
  try {
    const {
      period = '6months',
      format = 'json',
      functionalUnit,
      allocationMethod,
      systemBoundaryType,
      boundaryDescription,
      temporalCoverage,
      geographicalCoverage,
      cutOffMassPercent,
      cutOffEnergyPercent,
      minBoundaryRigorScore,
      minLciGranularityScore,
      uncertaintyMethodology,
      combinedRelativeUncertainty,
      includeOrganizationSummary,
      includeProductBreakdown,
      includeProductScopeBreakdown,
      includeAttributionStats,
      includeUnassignedProducts,
      productLimit,
      productIds,
      productNames
    } = req.query;

    if (!assertReportingProfile(req, res)) {
      return;
    }

    const reportContext = await buildISO14067ReportForUser(req.user, {
      period,
      reportingConfig: {
        includeOrganizationSummary,
        includeProductBreakdown,
        includeProductScopeBreakdown,
        includeAttributionStats,
        includeUnassignedProducts,
        productLimit,
        productIds,
        productNames
      },
      frameworkConfig: {
        functionalUnit: functionalUnit || undefined,
        allocationMethod: allocationMethod || undefined,
        systemBoundaryType: systemBoundaryType || undefined,
        boundaryDescription: boundaryDescription || undefined,
        temporalCoverage: temporalCoverage || undefined,
        geographicalCoverage: geographicalCoverage || undefined,
        cutOffCriteria: {
          massPercentThreshold: Number.isFinite(Number(cutOffMassPercent))
            ? Number(cutOffMassPercent)
            : undefined,
          energyPercentThreshold: Number.isFinite(Number(cutOffEnergyPercent))
            ? Number(cutOffEnergyPercent)
            : undefined
        },
        minBoundaryRigorScore: Number.isFinite(Number(minBoundaryRigorScore))
          ? Number(minBoundaryRigorScore)
          : undefined,
        minLciGranularityScore: Number.isFinite(Number(minLciGranularityScore))
          ? Number(minLciGranularityScore)
          : undefined,
        uncertainty: {
          methodology: uncertaintyMethodology || undefined,
          combinedRelativeUncertainty: Number.isFinite(Number(combinedRelativeUncertainty))
            ? Number(combinedRelativeUncertainty)
            : undefined
        }
      }
    });
    if (!reportContext) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const { iso14067Report, msme } = reportContext;
    if (String(format).toLowerCase() === 'pdf') {
      const reportId = `ISO14067-${Date.now()}`;
      const pdfBuffer = await generateGenericReportPdf({
        title: `${msme?.companyName || 'MSME'} ISO 14067 Report`,
        companyProfile: iso14067Report.companyProfile,
        operationsProfile: iso14067Report.operationsProfile,
        summary: {
          readinessScore: `${iso14067Report.overview.readinessScore}%`,
          status: iso14067Report.overview.status,
          functionalUnit: iso14067Report.overview.functionalUnit,
          lifecycleCoverage: iso14067Report.productFootprint.lifecycleCoverage
        },
        emissionsAndCompliance: {
          ghgProtocol: iso14067Report?.ghgProtocol?.standard || 'GHG Protocol Product Standard',
          productFootprintTotal: safeRound(iso14067Report?.productFootprint?.totalProductFootprint || 0, 2),
          boundaryRigorScore: safeRound(iso14067Report?.productFootprint?.boundaryDefinition?.rigorScore || 0, 1),
          brsrReference: iso14067Report?.brsrComplianceReference?.framework || 'SEBI BRSR Principle 6'
        },
        sections: [
          'Product Definition and Functional Unit',
          'Lifecycle Stage Coverage',
          'Product Carbon Footprint Quantification',
          'Gap Analysis and Recommendations'
        ],
        carbonVisualization: iso14067Report.visualization,
        carbonVisualizationKind: 'iso14067',
        notes: `Report ID: ${reportId}`
      });
      const safeCompanyName = String(msme?.companyName || 'MSME')
        .replace(/[^a-z0-9-_]/gi, '_')
        .slice(0, 50);
      const filename = `${safeCompanyName}_ISO14067_${new Date().toISOString().slice(0, 10)}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Report-Id', reportId);
      return res.send(pdfBuffer);
    }

    return res.json({
      success: true,
      data: iso14067Report
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error generating ISO 14067 report',
      ...clientErrorPayload(error)
    });
  }
});

// Get ISO gap-closure checklist (AI agent aligned)
router.get('/iso-gap-closure', auth, async (req, res) => {
  try {
    const { period = 'annual', framework = 'all' } = req.query;

    if (!assertReportingProfile(req, res)) {
      return;
    }

    const reportContext = await buildIsoGapClosureForUser(req.user, {
      period,
      framework: String(framework || 'all').toLowerCase()
    });

    if (!reportContext) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    return res.json({
      success: true,
      data: {
        company: {
          companyName: reportContext.msme?.companyName || 'MSME',
          industry: reportContext.msme?.industry || 'General',
          businessDomain: reportContext.msme?.businessDomain || 'other'
        },
        checklist: reportContext.checklist
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error generating ISO gap-closure checklist',
      ...clientErrorPayload(error)
    });
  }
});

// Get GHG inventory audit log (ISO 14064 governance)
router.get('/ghg-inventory-audit-log', auth, async (req, res) => {
  try {
    const GhgInventoryAuditLog = require('../models/GhgInventoryAuditLog');
    const { limit = 50, page = 1 } = req.query;

    if (!assertReportingProfile(req, res)) {
      return;
    }

    const msme = await MSME.findOne({ userId: req.user.userId || req.user._id }).select('_id organizationId').lean();
    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const filter = { msmeId: msme._id };
    const [entries, total] = await Promise.all([
      GhgInventoryAuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      GhgInventoryAuditLog.countDocuments(filter)
    ]);

    return res.json({
      success: true,
      data: {
        entries,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching GHG inventory audit log',
      ...clientErrorPayload(error)
    });
  }
});

// Generate comprehensive report
router.post('/generate', auth, async (req, res) => {
  try {
    const { reportType = 'comprehensive', dateRange = '6months', format = 'pdf' } = req.body;
    const normalizedReportType = String(reportType).toLowerCase();
    const normalizedFormat = String(format || 'pdf').toLowerCase();

    if (normalizedReportType === 'cbam') {
      if (!assertReportingProfile(req, res)) {
        return;
      }

      const reportContext = await buildCbamReportForUser(req.user, {
        period: dateRange
      });
      if (!reportContext) {
        return res.status(404).json({
          success: false,
          message: 'MSME profile not found'
        });
      }

      const { msme, cbamReport } = reportContext;
      const reportId = `CBAM-${Date.now()}`;

      if (normalizedFormat === 'pdf') {
        const pdfBuffer = await generateCbamReportPdf(cbamReport, { reportId });
        const safeCompanyName = String(msme?.companyName || 'MSME')
          .replace(/[^a-z0-9-_]/gi, '_')
          .slice(0, 50);
        const filename = `${safeCompanyName}_CBAM_${new Date().toISOString().slice(0, 10)}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Report-Id', reportId);
        return res.send(pdfBuffer);
      }

      return res.json({
        success: true,
        message: 'CBAM report generated successfully',
        data: {
          reportId,
          reportType: 'cbam',
          generatedAt: new Date().toISOString(),
          format: normalizedFormat,
          report: cbamReport
        }
      });
    }

    if (normalizedReportType === 'brsr') {
      if (!(await ensureBrsrExportAccess(req, res))) {
        return;
      }
      if (!assertReportingProfile(req, res)) {
        return;
      }

      const reportContext = await buildBRSRReportForUser(req.user, dateRange);
      if (!reportContext) {
        return res.status(404).json({
          success: false,
          message: 'MSME profile not found'
        });
      }

      const { msme, brsrReport } = reportContext;
      const reportId = `BRSR-${Date.now()}`;

      if (normalizedFormat === 'pdf') {
        const pdfBuffer = await generateBRSRReportPdf(brsrReport, { reportId });
        const safeCompanyName = String(msme?.companyName || 'MSME')
          .replace(/[^a-z0-9-_]/gi, '_')
          .slice(0, 50);
        const filename = `${safeCompanyName}_BRSR_${new Date().toISOString().slice(0, 10)}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Report-Id', reportId);
        return res.send(pdfBuffer);
      }

      return res.json({
        success: true,
        message: 'BRSR report generated successfully',
        data: {
          reportId,
          reportType: 'brsr',
          generatedAt: new Date().toISOString(),
          format: normalizedFormat,
          report: brsrReport
        }
      });
    }

    if (normalizedReportType === 'iso14064' || normalizedReportType === 'iso-14064') {
      if (!assertReportingProfile(req, res)) {
        return;
      }

      const reportContext = await buildISO14064ReportForUser(req.user, {
        period: dateRange
      });
      if (!reportContext) {
        return res.status(404).json({
          success: false,
          message: 'MSME profile not found'
        });
      }

      const { msme, iso14064Report } = reportContext;
      const reportId = `ISO14064-${Date.now()}`;

      if (normalizedFormat === 'pdf') {
        const pdfBuffer = await generateGenericReportPdf({
          title: `${msme?.companyName || 'MSME'} ISO 14064 Report`,
          summary: {
            readinessScore: `${iso14064Report.overview.readinessScore}%`,
            status: iso14064Report.overview.status,
            totalCO2Emissions: `${iso14064Report.overview.totalCO2Emissions} tCO2e`
          },
          sections: ['Boundary', 'Scope Inventory', 'Data Quality', 'Gap Closure Plan'],
          carbonVisualization: iso14064Report.visualization,
          carbonVisualizationKind: 'iso14064',
          notes: `Report ID: ${reportId}`
        });
        const safeCompanyName = String(msme?.companyName || 'MSME')
          .replace(/[^a-z0-9-_]/gi, '_')
          .slice(0, 50);
        const filename = `${safeCompanyName}_ISO14064_${new Date().toISOString().slice(0, 10)}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Report-Id', reportId);
        return res.send(pdfBuffer);
      }

      return res.json({
        success: true,
        message: 'ISO 14064 report generated successfully',
        data: {
          reportId,
          reportType: 'iso-14064',
          generatedAt: new Date().toISOString(),
          format: normalizedFormat,
          report: iso14064Report
        }
      });
    }

    if (normalizedReportType === 'iso14067' || normalizedReportType === 'iso-14067') {
      if (!assertReportingProfile(req, res)) {
        return;
      }

      const reportContext = await buildISO14067ReportForUser(req.user, {
        period: dateRange
      });
      if (!reportContext) {
        return res.status(404).json({
          success: false,
          message: 'MSME profile not found'
        });
      }

      const { msme, iso14067Report } = reportContext;
      const reportId = `ISO14067-${Date.now()}`;

      if (normalizedFormat === 'pdf') {
        const pdfBuffer = await generateGenericReportPdf({
          title: `${msme?.companyName || 'MSME'} ISO 14067 Report`,
          summary: {
            readinessScore: `${iso14067Report.overview.readinessScore}%`,
            status: iso14067Report.overview.status,
            functionalUnit: iso14067Report.overview.functionalUnit
          },
          sections: ['Product Definition', 'Lifecycle Coverage', 'Product Footprint', 'Gap Closure Plan'],
          carbonVisualization: iso14067Report.visualization,
          carbonVisualizationKind: 'iso14067',
          notes: `Report ID: ${reportId}`
        });
        const safeCompanyName = String(msme?.companyName || 'MSME')
          .replace(/[^a-z0-9-_]/gi, '_')
          .slice(0, 50);
        const filename = `${safeCompanyName}_ISO14067_${new Date().toISOString().slice(0, 10)}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Report-Id', reportId);
        return res.send(pdfBuffer);
      }

      return res.json({
        success: true,
        message: 'ISO 14067 report generated successfully',
        data: {
          reportId,
          reportType: 'iso-14067',
          generatedAt: new Date().toISOString(),
          format: normalizedFormat,
          report: iso14067Report
        }
      });
    }

    if (!assertReportingProfile(req, res)) {
      return;
    }

    const reportContext = await loadOrgReportingContext(req.user, dateRange);
    if (!reportContext) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const { msme, latestAssessment } = reportContext;
    const previousAssessment = latestAssessment
      ? await CarbonAssessment.findOne({
        ...buildAssessmentFilterForUser(req.user, new Date(0), latestAssessment.createdAt),
        createdAt: { $lt: latestAssessment.createdAt }
      }).sort({ createdAt: -1 }).lean()
      : null;

    const operational = await getOperationalProfile(req.user);
    const msmeData = operational?.profile || msme;
    const savings = latestAssessment
      ? carbonCalculationService.calculateCarbonSavings(msmeData, latestAssessment, previousAssessment)
      : null;

    const reportId = `RPT-${Date.now()}`;
    const totalCarbonFootprint = safeRound(Number(latestAssessment?.totalCO2Emissions) || 0, 2);
    const implementedCount = latestAssessment?.recommendations?.filter((rec) => rec?.isImplemented).length || 0;
    const scopeData = latestAssessment ? buildScopeDataFromAssessment(latestAssessment) : null;
    const categoryData = latestAssessment ? buildCategoryDataFromAssessment(latestAssessment) : [];
    const { items: recommendationItems } = buildRecommendationsPayload(latestAssessment, msme);
    const comparisonData = buildComparisonDataFromContext(latestAssessment, msme, previousAssessment);
    const trendData = latestAssessment ? buildTrendDataFromAssessments([latestAssessment, previousAssessment].filter(Boolean)) : [];

    const reportData = {
      reportId,
      generatedAt: new Date().toISOString(),
      reportType: normalizedReportType || 'comprehensive',
      dateRange,
      format: normalizedFormat,
      dataStatus: latestAssessment ? 'available' : 'no_assessments',
      summary: {
        totalCarbonFootprint,
        reduction: safeRound(Number(savings?.savingsPercentage) || 0, 1),
        recommendationsImplemented: implementedCount,
        totalSavings: safeRound(Number(savings?.totalSavings) || 0, 2),
        co2Reduction: safeRound(Number(savings?.periodSavings) || 0, 2),
        carbonScore: safeRound(Number(latestAssessment?.carbonScore) || 0, 1)
      },
      sections: [
        'Executive Summary',
        'Carbon Footprint Analysis',
        'Recommendations Status',
        'Performance Trends',
        'Industry Comparison',
        'Action Plan'
      ],
      sectionDetails: [
        {
          title: 'Executive Summary',
          content: latestAssessment
            ? `Total footprint ${totalCarbonFootprint} tCO2e with carbon score ${safeRound(Number(latestAssessment.carbonScore) || 0, 1)}.`
            : 'No carbon assessment available for the selected period.'
        },
        {
          title: 'Carbon Footprint Analysis',
          content: scopeData
            ? [
              `Scope 1: ${safeRound(scopeData.scope1?.total || 0, 2)} tCO2e`,
              `Scope 2: ${safeRound(scopeData.scope2?.total || 0, 2)} tCO2e`,
              `Scope 3: ${safeRound(scopeData.scope3?.total || 0, 2)} tCO2e`
            ]
            : ['Complete a carbon assessment to populate scope inventory.']
        },
        {
          title: 'Recommendations Status',
          content: recommendationItems.length > 0
            ? recommendationItems.slice(0, 8).map((rec) => `${rec.title} (${rec.status})`)
            : ['No recommendations generated for the latest assessment.']
        },
        {
          title: 'Performance Trends',
          content: trendData.length > 0
            ? trendData.map((row) => `${row.period}: ${row.current} tCO2e (${row.change}% vs prior)`)
            : ['Insufficient assessment history for trend comparison.']
        },
        {
          title: 'Industry Comparison',
          content: comparisonData.industryBenchmarkAvailable
            ? ['Industry benchmark comparison is not configured for this workspace.']
            : [
              `User carbon score: ${comparisonData.userPerformance ?? 'n/a'}`,
              ...(comparisonData.benchmarkData || []).slice(0, 5).map((row) => (
                `${row.category}: ${row.emissionsKgCO2e} kgCO2e (${row.user}% of total)`
              ))
            ]
        },
        {
          title: 'Action Plan',
          content: recommendationItems.filter((rec) => rec.status !== 'Completed').slice(0, 5).map((rec) => rec.title)
        }
      ],
      recommendations: recommendationItems,
      categoryBreakdown: categoryData,
      assessmentId: latestAssessment?._id || null,
      companyName: msme?.companyName || 'MSME'
    };

    if (normalizedFormat === 'pdf') {
      const pdfBuffer = await generateGenericReportPdf({
        title: `${msme?.companyName || 'MSME'} ${String(reportType || 'Comprehensive')} Sustainability Report`,
        summary: reportData.summary,
        sections: reportData.sections,
        sectionDetails: reportData.sectionDetails,
        recommendationsList: recommendationItems.slice(0, 10),
        emissionsAndCompliance: scopeData ? {
          scope1: safeRound(scopeData.scope1?.total || 0, 2),
          scope2: safeRound(scopeData.scope2?.total || 0, 2),
          scope3: safeRound(scopeData.scope3?.total || 0, 2),
          total: safeRound(scopeData.total || 0, 2),
          carbonScore: safeRound(Number(latestAssessment?.carbonScore) || 0, 1)
        } : undefined,
        notes: `Report ID: ${reportId} · Date range: ${dateRange}${latestAssessment ? '' : ' · No assessment data'}`
      });
      const safeCompanyName = String(msme?.companyName || 'MSME')
        .replace(/[^a-z0-9-_]/gi, '_')
        .slice(0, 50);
      const filename = `${safeCompanyName}_Sustainability_${new Date().toISOString().slice(0, 10)}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Report-Id', reportId);
      return res.send(pdfBuffer);
    }

    return res.json({
      success: true,
      message: 'Report generated successfully',
      data: reportData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error generating report',
      ...clientErrorPayload(error)
    });
  }
});

// Export report
router.post('/export', auth, async (req, res) => {
  try {
    const {
      reportType = 'brsr',
      dateRange = 'annual',
      format = 'pdf',
      reportId = `EXP-${Date.now()}`
    } = req.body || {};
    const normalizedReportType = String(reportType).toLowerCase();
    const normalizedFormat = String(format || 'pdf').toLowerCase();

    if (normalizedFormat !== 'pdf' && normalizedFormat !== 'json'
      && normalizedFormat !== 'sebi' && normalizedFormat !== 'sebi-json'
      && normalizedFormat !== 'xbrl' && normalizedFormat !== 'csv'
      && normalizedFormat !== 'registry' && normalizedFormat !== 'audit-pack') {
      return res.status(400).json({
        success: false,
        message: 'Supported formats: pdf, json, sebi-json, xbrl (BRSR), csv/registry (CBAM), audit-pack (ISO 14064)'
      });
    }

    if (normalizedReportType === 'brsr') {
      if (!(await ensureBrsrExportAccess(req, res))) {
        return;
      }
      if (!assertReportingProfile(req, res)) {
        return;
      }
      const reportContext = await buildBRSRReportForUser(req.user, dateRange);
      if (!reportContext) {
        return res.status(404).json({
          success: false,
          message: 'MSME profile not found'
        });
      }

      if (normalizedFormat === 'sebi' || normalizedFormat === 'sebi-json') {
        return res.json({
          success: true,
          data: buildSebiBrsrExport(reportContext.brsrReport)
        });
      }
      if (normalizedFormat === 'xbrl') {
        const xbrl = buildBrsrXbrlSkeleton(reportContext.brsrReport);
        res.setHeader('Content-Type', xbrl.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${xbrl.filename}"`);
        return res.send(xbrl.xml);
      }

      const pdfBuffer = await generateBRSRReportPdf(reportContext.brsrReport, { reportId });
      const safeCompanyName = String(reportContext?.msme?.companyName || 'MSME')
        .replace(/[^a-z0-9-_]/gi, '_')
        .slice(0, 50);
      const filename = `${safeCompanyName}_BRSR_Export_${new Date().toISOString().slice(0, 10)}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(pdfBuffer);
    }

    if (normalizedReportType === 'cbam') {
      if (!assertReportingProfile(req, res)) {
        return;
      }
      const reportContext = await buildCbamReportForUser(req.user, {
        period: dateRange
      });
      if (!reportContext) {
        return res.status(404).json({
          success: false,
          message: 'MSME profile not found'
        });
      }

      if (normalizedFormat === 'csv' || normalizedFormat === 'registry') {
        const registry = buildCbamRegistryCsv(reportContext.cbamReport);
        res.setHeader('Content-Type', registry.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${registry.filename}"`);
        return res.send(registry.csv);
      }

      const pdfBuffer = await generateCbamReportPdf(reportContext.cbamReport, { reportId });
      const safeCompanyName = String(reportContext?.msme?.companyName || 'MSME')
        .replace(/[^a-z0-9-_]/gi, '_')
        .slice(0, 50);
      const filename = `${safeCompanyName}_CBAM_Export_${new Date().toISOString().slice(0, 10)}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(pdfBuffer);
    }

    if (normalizedReportType === 'iso14064' || normalizedReportType === 'iso-14064') {
      if (!assertReportingProfile(req, res)) {
        return;
      }

      const reportContext = await buildISO14064ReportForUser(req.user, {
        period: dateRange
      });
      if (!reportContext) {
        return res.status(404).json({
          success: false,
          message: 'MSME profile not found'
        });
      }

      if (normalizedFormat === 'audit-pack') {
        const auditPack = buildIso14064AuditPack({
          isoReport: reportContext.iso14064Report,
          gapChecklist: {
            factorRegistry: reportContext.iso14064Report.factorRegistry,
            sections: reportContext.iso14064Report.gapClosureChecklist?.sections,
            overallReadinessScore: reportContext.iso14064Report.gapClosureChecklist?.overallReadinessScore,
            openGaps: reportContext.iso14064Report.gapClosureChecklist?.openGaps,
            priorityActions: reportContext.iso14064Report.gapClosureChecklist?.priorityActions
          },
          msme: reportContext.msme
        });
        return res.json({ success: true, data: auditPack });
      }

      const pdfBuffer = await generateGenericReportPdf({
        title: `${reportContext?.msme?.companyName || 'MSME'} ISO 14064 Report`,
        summary: {
          readinessScore: `${reportContext.iso14064Report.overview.readinessScore}%`,
          status: reportContext.iso14064Report.overview.status,
          totalCO2Emissions: `${reportContext.iso14064Report.overview.totalCO2Emissions} tCO2e`
        },
        sections: ['Boundary', 'Scope Inventory', 'Data Quality', 'Gap Closure Plan'],
        carbonVisualization: reportContext.iso14064Report.visualization,
        carbonVisualizationKind: 'iso14064',
        notes: `Export ID: ${reportId}`
      });
      const safeCompanyName = String(reportContext?.msme?.companyName || 'MSME')
        .replace(/[^a-z0-9-_]/gi, '_')
        .slice(0, 50);
      const filename = `${safeCompanyName}_ISO14064_Export_${new Date().toISOString().slice(0, 10)}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(pdfBuffer);
    }

    if (normalizedReportType === 'iso14067' || normalizedReportType === 'iso-14067') {
      if (!assertReportingProfile(req, res)) {
        return;
      }

      const reportContext = await buildISO14067ReportForUser(req.user, {
        period: dateRange
      });
      if (!reportContext) {
        return res.status(404).json({
          success: false,
          message: 'MSME profile not found'
        });
      }

      const pdfBuffer = await generateGenericReportPdf({
        title: `${reportContext?.msme?.companyName || 'MSME'} ISO 14067 Report`,
        summary: {
          readinessScore: `${reportContext.iso14067Report.overview.readinessScore}%`,
          status: reportContext.iso14067Report.overview.status,
          functionalUnit: reportContext.iso14067Report.overview.functionalUnit
        },
        sections: ['Product Definition', 'Lifecycle Coverage', 'Product Footprint', 'Gap Closure Plan'],
        carbonVisualization: reportContext.iso14067Report.visualization,
        carbonVisualizationKind: 'iso14067',
        notes: `Export ID: ${reportId}`
      });
      const safeCompanyName = String(reportContext?.msme?.companyName || 'MSME')
        .replace(/[^a-z0-9-_]/gi, '_')
        .slice(0, 50);
      const filename = `${safeCompanyName}_ISO14067_Export_${new Date().toISOString().slice(0, 10)}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(pdfBuffer);
    }

    const pdfBuffer = await generateGenericReportPdf({
      title: `${String(reportType)} Sustainability Report`,
      notes: `Generated export for ${String(reportType)}`
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Sustainability_Export_${Date.now()}.pdf"`);
    return res.send(pdfBuffer);

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error exporting report',
      ...clientErrorPayload(error)
    });
  }
});

// Email report as PDF attachment
router.post('/email', auth, async (req, res) => {
  try {
    const { reportType = 'brsr', dateRange = 'annual', recipientEmail } = req.body || {};
    const normalizedReportType = String(reportType || 'brsr').toLowerCase();
    const to = String(recipientEmail || '').trim();

    if (!to) {
      return res.status(400).json({
        success: false,
        message: 'Recipient email is required'
      });
    }

    if (!assertReportingProfile(req, res)) {
      return;
    }

    let reportContext = null;
    let pdfBuffer = null;
    let reportTitle = '';
    let filePrefix = '';
    const reportId = `MAIL-${Date.now()}`;

    if (normalizedReportType === 'brsr') {
      if (!(await ensureBrsrExportAccess(req, res))) {
        return;
      }
      reportContext = await buildBRSRReportForUser(req.user, dateRange);
      if (!reportContext) {
        return res.status(404).json({ success: false, message: 'MSME profile not found' });
      }
      pdfBuffer = await generateBRSRReportPdf(reportContext.brsrReport, { reportId });
      reportTitle = 'BRSR Report';
      filePrefix = 'BRSR';
    } else if (normalizedReportType === 'cbam') {
      reportContext = await buildCbamReportForUser(req.user, { period: dateRange });
      if (!reportContext) {
        return res.status(404).json({ success: false, message: 'MSME profile not found' });
      }
      pdfBuffer = await generateCbamReportPdf(reportContext.cbamReport, { reportId });
      reportTitle = 'CBAM Report';
      filePrefix = 'CBAM';
    } else if (normalizedReportType === 'iso14064' || normalizedReportType === 'iso-14064') {
      reportContext = await buildISO14064ReportForUser(req.user, { period: dateRange });
      if (!reportContext) {
        return res.status(404).json({ success: false, message: 'MSME profile not found' });
      }
      pdfBuffer = await generateGenericReportPdf({
        title: `${reportContext?.msme?.companyName || 'MSME'} ISO 14064 Report`,
        summary: {
          readinessScore: `${reportContext.iso14064Report.overview.readinessScore}%`,
          status: reportContext.iso14064Report.overview.status,
          totalCO2Emissions: `${reportContext.iso14064Report.overview.totalCO2Emissions} tCO2e`
        },
        sections: ['Boundary', 'Scope Inventory', 'Data Quality', 'Gap Closure Plan'],
        carbonVisualization: reportContext.iso14064Report.visualization,
        carbonVisualizationKind: 'iso14064',
        notes: `Email ID: ${reportId}`
      });
      reportTitle = 'ISO 14064 Report';
      filePrefix = 'ISO14064';
    } else if (normalizedReportType === 'iso14067' || normalizedReportType === 'iso-14067') {
      reportContext = await buildISO14067ReportForUser(req.user, { period: dateRange });
      if (!reportContext) {
        return res.status(404).json({ success: false, message: 'MSME profile not found' });
      }
      pdfBuffer = await generateGenericReportPdf({
        title: `${reportContext?.msme?.companyName || 'MSME'} ISO 14067 Report`,
        summary: {
          readinessScore: `${reportContext.iso14067Report.overview.readinessScore}%`,
          status: reportContext.iso14067Report.overview.status,
          functionalUnit: reportContext.iso14067Report.overview.functionalUnit
        },
        sections: ['Product Definition', 'Lifecycle Coverage', 'Product Footprint', 'Gap Closure Plan'],
        carbonVisualization: reportContext.iso14067Report.visualization,
        carbonVisualizationKind: 'iso14067',
        notes: `Email ID: ${reportId}`
      });
      reportTitle = 'ISO 14067 Report';
      filePrefix = 'ISO14067';
    } else {
      return res.status(400).json({
        success: false,
        message: `Unsupported report type: ${reportType}`
      });
    }

    const safeCompanyName = String(reportContext?.msme?.companyName || 'MSME')
      .replace(/[^a-z0-9-_]/gi, '_')
      .slice(0, 50);
    const filename = `${safeCompanyName}_${filePrefix}_${new Date().toISOString().slice(0, 10)}.pdf`;

    await sendEmail({
      to,
      subject: `${safeCompanyName} ${reportTitle}`,
      html: `<p>Please find attached your ${reportTitle} generated from Sustainow Carbon Intelligence.</p>`,
      text: `Please find attached your ${reportTitle} generated from Sustainow Carbon Intelligence.`,
      attachments: [
        {
          filename,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    });

    return res.json({
      success: true,
      message: `${reportTitle} sent successfully`,
      data: {
        reportType: normalizedReportType,
        recipientEmail: to,
        sentAt: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error emailing report',
      ...clientErrorPayload(error)
    });
  }
});

// Diagnostic route to test PDF generation
router.get('/diagnostic/pdf', async (req, res) => {
  try {
    const { generateBRSRReportPdf } = require('../services/pdfReportService');
    const dummyReport = {
      generatedAt: new Date().toISOString(),
      organization: { companyName: 'Diagnostic Test MSME' },
      environmental: { greenhouseGasEmissions: { total: 100, scope1: 50, scope2: 30, scope3: 20 } },
      reportingPeriod: { financialYear: 'FY 2024-25', requestedPeriod: 'annual' }
    };
    const pdfBuffer = await generateBRSRReportPdf(dummyReport, { reportId: 'DIAG-123' });
    res.setHeader('Content-Type', 'application/pdf');
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('PDF Diagnostic Error:', error);
    res.status(500).json({
      success: false,
      message: 'PDF generation failed diagnostic',
      error: error.message,
      stack: error.stack
    });
  }
});

// Get report catalog and navigation metadata for disclosure exports
router.get('/', auth, (req, res) => {
  res.json({
    success: true,
    data: {
      reports: [
        { id: 'brsr', label: 'BRSR Principle 6', path: '/api/reporting/brsr', formats: ['json', 'pdf', 'sebi-json', 'xbrl'] },
        { id: 'cbam', label: 'CBAM', path: '/api/reporting/cbam', formats: ['json', 'pdf', 'csv'] },
        { id: 'iso-14064', label: 'ISO 14064', path: '/api/reporting/iso-14064', formats: ['json', 'pdf', 'audit-pack'] },
        { id: 'iso-14067', label: 'ISO 14067', path: '/api/reporting/iso-14067', formats: ['json', 'pdf'] },
        { id: 'iso-gap-closure', label: 'ISO gap closure', path: '/api/reporting/iso-gap-closure', formats: ['json'] }
      ],
      links: {
        dashboard: '/api/reporting/dashboard',
        history: '/api/reporting/history',
        generate: '/api/reporting/generate',
        email: '/api/reporting/email'
      }
    }
  });
});

// Get report history
router.get('/history', auth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    if (!assertReportingProfile(req, res)) {
      return;
    }

    const assessmentFilter = buildAssessmentFilterForUser(
      req.user,
      new Date(0),
      new Date()
    );
    const [assessments, total] = await Promise.all([
      CarbonAssessment.find(assessmentFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CarbonAssessment.countDocuments(assessmentFilter)
    ]);

    const reports = assessments.map((assessment, index) => ({
      id: `RPT-${assessment._id}`,
      title: `Carbon Assessment Report ${new Date(assessment.createdAt).toISOString().slice(0, 10)}`,
      generatedAt: assessment.createdAt,
      type: assessment.assessmentType || 'assessment',
      status: assessment.status || 'completed',
      format: 'json',
      size: null,
      summary: {
        carbonScore: safeRound(assessment.carbonScore || 0, 2),
        totalCO2Emissions: safeRound(assessment.totalCO2Emissions || 0, 2)
      },
      sequence: skip + index + 1
    }));

    res.json({
      success: true,
      data: {
        reports,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching report history',
      ...clientErrorPayload(error)
    });
  }
});

// Get dashboard summary
router.get('/dashboard', auth, (req, res) => {
  try {
    return (async () => {
      if (!assertReportingProfile(req, res)) {
        return;
      }

      const msmeId = req.user.msmeId;
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfYear = new Date(now.getFullYear(), 0, 1);

      const [monthlyAssessments, yearlyAssessments] = await Promise.all([
        CarbonAssessment.find({
          msmeId,
          $or: [
            { 'period.endDate': { $gte: startOfMonth, $lte: now } },
            { createdAt: { $gte: startOfMonth, $lte: now } }
          ]
        }).sort({ createdAt: -1 }).lean(),
        CarbonAssessment.find({
          msmeId,
          $or: [
            { 'period.endDate': { $gte: startOfYear, $lte: now } },
            { createdAt: { $gte: startOfYear, $lte: now } }
          ]
        }).sort({ createdAt: -1 }).lean()
      ]);

      const latestAssessment = monthlyAssessments[0] || yearlyAssessments[0] || null;
      const previousAssessment = yearlyAssessments[1] || null;
      const currentMonthEmissions = monthlyAssessments.reduce(
        (sum, a) => sum + (Number(a.totalCO2Emissions) || 0),
        0
      );
      const yearToDateEmissions = yearlyAssessments.reduce(
        (sum, a) => sum + (Number(a.totalCO2Emissions) || 0),
        0
      );
      const previousEmissions = Number(previousAssessment?.totalCO2Emissions) || 0;
      const reduction = previousEmissions > 0
        ? safeRound(((previousEmissions - (Number(latestAssessment?.totalCO2Emissions) || 0)) / previousEmissions) * 100, 2)
        : 0;

      const keyMetrics = latestAssessment ? {
        energyEfficiency: Math.max(0, 100 - safeRound((Number(latestAssessment?.breakdown?.energy?.total) || 0) / 10, 1)),
        wasteReduction: Math.max(0, 100 - safeRound((Number(latestAssessment?.breakdown?.waste?.total) || 0) / 10, 1)),
        waterConservation: Math.max(0, 100 - safeRound((Number(latestAssessment?.breakdown?.water?.co2Emissions) || 0) / 10, 1)),
        renewableEnergy: latestAssessment?.breakdown?.energy?.total
          ? safeRound(
            ((Number(latestAssessment?.breakdown?.energy?.electricity?.consumption) || 0)
            / Math.max(Number(latestAssessment?.breakdown?.energy?.total) || 1, 1)) * 100,
            1
          )
          : 0
      } : {
        energyEfficiency: 0,
        wasteReduction: 0,
        waterConservation: 0,
        renewableEnergy: 0
      };

      const recentAchievements = (latestAssessment?.recommendations || [])
        .filter((rec) => rec?.isImplemented)
        .slice(0, 5)
        .map((rec) => ({
          title: rec.title || 'Implemented recommendation',
          description: rec.description || 'Sustainability recommendation implemented',
          date: rec.implementationDate || latestAssessment?.createdAt,
          points: Math.max(10, Math.round(Number(rec.potentialCO2Reduction || 0)))
        }));

      const upcomingGoals = (latestAssessment?.recommendations || [])
        .filter((rec) => !rec?.isImplemented)
        .slice(0, 5)
        .map((rec) => ({
          title: rec.title || 'Sustainability goal',
          targetDate: rec.paybackPeriod
            ? new Date(Date.now() + Number(rec.paybackPeriod) * 30 * 24 * 60 * 60 * 1000)
            : null,
          progress: 0,
          priority: rec.priority || 'medium'
        }));

      return res.json({
        success: true,
        data: {
          currentMonth: {
            carbonFootprint: safeRound(currentMonthEmissions, 2),
            target: safeRound(currentMonthEmissions * 0.9, 2),
            reduction,
            trend: reduction > 0 ? 'down' : 'up'
          },
          yearToDate: {
            carbonFootprint: safeRound(yearToDateEmissions, 2),
            target: safeRound(yearToDateEmissions * 0.9, 2),
            reduction,
            trend: reduction > 0 ? 'down' : 'up'
          },
          keyMetrics,
          recentAchievements,
          upcomingGoals
        }
      });
    })();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard data',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;