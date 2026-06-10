const { buildValueChainReport } = require('./valueChainReportingService');

const PRINCIPLE_TITLES = [
  'Principle 1: Businesses should conduct and govern themselves with integrity and in a manner that is Ethical, Transparent and Accountable',
  'Principle 2: Businesses should provide goods and services in a manner that is sustainable and safe',
  'Principle 3: Businesses should respect and promote the well-being of all employees, including those in their value chains',
  'Principle 4: Businesses should respect the interests of and be responsive to all their stakeholders',
  'Principle 5: Businesses should respect and promote human rights',
  'Principle 6: Businesses should respect and make efforts to protect and restore the environment',
  'Principle 7: Businesses, when engaging in influencing public and regulatory policy, should do so in a manner that is responsible and transparent',
  'Principle 8: Businesses should promote inclusive growth and equitable development',
  'Principle 9: Businesses should engage with and provide value to their consumers in a responsible manner'
];

const SOLAR_ESTIMATED_PRICE_PER_KWH_INR = 5;
const GRID_EMISSION_FACTOR_KG_CO2_PER_KWH = 0.8;
const RENEWABLE_EMISSION_FACTOR_KG_CO2_PER_KWH = 0.1;
const SOLAR_USAGE_REDUCTION_KG_CO2_PER_KWH =
  GRID_EMISSION_FACTOR_KG_CO2_PER_KWH - RENEWABLE_EMISSION_FACTOR_KG_CO2_PER_KWH;
const CARBON_CREDIT_PER_KG_CO2 = 0.1;
const KG_CO2_PER_CARBON_CREDIT = 1 / CARBON_CREDIT_PER_KG_CO2;

const roundTo = (value, decimals = 2) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(numeric * factor) / factor;
};

const asNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const asOptionalNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const pickFirstFinite = (...values) => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return 0;
};

const extractEmissionValue = (value) => {
  if (value && typeof value === 'object') {
    return asNumber(
      value.co2Emissions ??
      value.total ??
      value.value ??
      value.generated
    );
  }
  return asNumber(value);
};

const ensureDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const hasSolarKeyword = (value = '') => String(value || '').toLowerCase().includes('solar');

const isSolarTransaction = (transaction = {}) => {
  const subcategory = String(transaction?.subcategory || '').toLowerCase();
  const tags = Array.isArray(transaction?.tags) ? transaction.tags : [];

  if (subcategory === 'solar') {
    return true;
  }

  return (
    hasSolarKeyword(transaction?.description) ||
    hasSolarKeyword(transaction?.vendor?.name) ||
    tags.some(tag => hasSolarKeyword(tag))
  );
};

const getFinancialYear = (referenceDate = new Date()) => {
  const date = ensureDate(referenceDate) || new Date();
  const month = date.getMonth();
  const year = date.getFullYear();
  if (month >= 3) {
    return `FY ${year}-${String(year + 1).slice(-2)}`;
  }
  return `FY ${year - 1}-${String(year).slice(-2)}`;
};

const ghgGovernance = require('../../../shared/ghgInventoryGovernance');
const {
  buildBrsrGhgInventoryBoundaries,
  withCompletenessFlag,
  assessOrganizationalBoundaryComplete,
  assessOperationalBoundaryComplete
} = require('../../../shared/ghgBoundaryBrsr');
const {
  assessScope3Quality,
  buildReportReadinessMeta
} = require('./reportStandardsExportService');

const normalizeScopeTotals = (assessment = {}, options = {}) => {
  const totalCO2Emissions = asNumber(assessment.totalCO2Emissions);
  const allowResidualScope3 = options.allowResidualScope3 === true;
  const reconciled = assessment.governance?.brsrScopeReconciliation
    || ghgGovernance.reconcileBrsrScopeTotals(assessment, {
      allowResidualScope3
    });

  const scope1 = roundTo(reconciled.scope1, 2);
  const scope2 = roundTo(reconciled.scope2, 2);
  const scope3 = roundTo(reconciled.scope3, 2);

  const totalScopes = scope1 + scope2 + scope3;
  const denominator = totalScopes > 0 ? totalScopes : totalCO2Emissions;

  return {
    scope1,
    scope2,
    scope3,
    totalScopes: roundTo(totalScopes, 2),
    scopeAllocationSource: reconciled.scopeAllocationSource,
    scopesExplicitlyMeasured: reconciled.scopesExplicitlyMeasured,
    residualScope3Used: reconciled.residualScope3Used,
    methodologicalWarning: reconciled.methodologicalWarning,
    percentages: {
      scope1: denominator > 0 ? roundTo((scope1 / denominator) * 100, 2) : 0,
      scope2: denominator > 0 ? roundTo((scope2 / denominator) * 100, 2) : 0,
      scope3: denominator > 0 ? roundTo((scope3 / denominator) * 100, 2) : 0
    }
  };
};

const getComplianceChecklist = ({
  msme = {},
  scopeTotals,
  assessment,
  annualTurnover = 0,
  employeeCount = 0,
  carbonCreditsSummary = {}
}) => {
  const hasAnyRegulatoryIdentifier = Boolean(
    msme?.udyamRegistrationNumber || msme?.gstNumber || msme?.panNumber
  );
  const organizationalBoundary = msme?.manufacturingProfile?.ghgOrganizationalBoundary || {};
  const operationalBoundary = msme?.operations?.ghgOperationalBoundary || {};
  const mandatoryFields = {
    companyName: Boolean(msme.companyName),
    industry: Boolean(msme.industry),
    businessDomain: Boolean(msme.businessDomain),
    registrationsDisclosed: hasAnyRegulatoryIdentifier,
    turnoverDisclosed: annualTurnover > 0,
    employeeCountDisclosed: employeeCount > 0,
    reportingPeriod: Boolean(assessment?.period?.startDate && assessment?.period?.endDate),
    organizationalBoundaryDocumented: assessOrganizationalBoundaryComplete(organizationalBoundary),
    operationalBoundaryDocumented: assessOperationalBoundaryComplete(operationalBoundary),
    totalCO2Emissions: asNumber(assessment?.totalCO2Emissions) >= 0,
    scope1Disclosed: scopeTotals.scope1 >= 0,
    scope2Disclosed: scopeTotals.scope2 >= 0,
    scope3Disclosed: scopeTotals.scope3 >= 0
  };

  const completedCount = Object.values(mandatoryFields).filter(Boolean).length;
  const completenessScore = roundTo((completedCount / Object.keys(mandatoryFields).length) * 100, 1);

  const environmentalCompliance = {
    hasEnvironmentalClearance: Boolean(msme?.environmentalCompliance?.hasEnvironmentalClearance),
    hasPollutionControlBoard: Boolean(msme?.environmentalCompliance?.hasPollutionControlBoard),
    hasWasteManagement: Boolean(msme?.environmentalCompliance?.hasWasteManagement)
  };
  const environmentalComplianceScore = roundTo(
    (Object.values(environmentalCompliance).filter(Boolean).length / Object.keys(environmentalCompliance).length) * 100,
    1
  );
  const carbonCreditsDisclosure = {
    earnedCredits: asNumber(carbonCreditsSummary?.earnedCredits),
    availableCredits: asNumber(carbonCreditsSummary?.availableCredits),
    retiredCredits: asNumber(carbonCreditsSummary?.retiredCredits),
    transferredInCredits: asNumber(carbonCreditsSummary?.transferredInCredits),
    transferredOutCredits: asNumber(carbonCreditsSummary?.transferredOutCredits),
    disclosed: Object.prototype.hasOwnProperty.call(carbonCreditsSummary || {}, 'availableCredits')
  };
  const policySignalsAvailable = Boolean(
    msme?.manufacturingProfile?.esgMaturityLevel
    || msme?.manufacturingProfile?.carbonAccountingPractice
    || (Array.isArray(assessment?.recommendations) && assessment.recommendations.length > 0)
  );
  const governanceDocumented = policySignalsAvailable && asNumber(assessment?.carbonScore) > 0;
  const templateAlignment = {
    sectionA: {
      title: 'General Disclosures',
      status: mandatoryFields.companyName && mandatoryFields.industry ? 'complete' : 'partial'
    },
    sectionB: {
      title: 'Management and Process Disclosures',
      status: !mandatoryFields.companyName
        ? 'partial'
        : governanceDocumented
          ? 'complete'
          : policySignalsAvailable
            ? 'partial'
            : 'partial'
    },
    sectionC: {
      title: 'Principle-wise Performance Disclosures',
      status: (scopeTotals.scope1 + scopeTotals.scope2 + scopeTotals.scope3) > 0 ? 'complete' : 'partial'
    }
  };

  const disclosurePrepReady = completenessScore >= 75;

  return {
    mandatoryFields,
    environmentalCompliance,
    environmentalComplianceScore,
    carbonCreditsDisclosure,
    templateAlignment,
    completenessScore,
    disclosurePrepReady,
    /** @deprecated Use disclosurePrepReady — does not indicate SEBI statutory compliance */
    isBRSRCompliant: disclosurePrepReady,
    complianceNote: 'Internal disclosure readiness score only — not SEBI-validated statutory compliance.'
  };
};

const buildMsmeProfileDetails = (msme = {}) => ({
  legalIdentity: {
    companyName: msme?.companyName || 'MSME',
    companyType: msme?.companyType || 'small',
    establishmentYear: msme?.establishmentYear || null,
    udyamRegistrationNumber: msme?.udyamRegistrationNumber || null,
    gstNumber: msme?.gstNumber || null,
    panNumber: msme?.panNumber || null
  },
  businessProfile: {
    industry: msme?.industry || 'General',
    businessDomain: msme?.businessDomain || 'other',
    primaryProducts: msme?.business?.primaryProducts || null,
    annualTurnoverINR: asNumber(msme?.business?.annualTurnover),
    employeeCount: asNumber(msme?.business?.numberOfEmployees),
    manufacturingUnits: asNumber(msme?.business?.manufacturingUnits)
  },
  location: {
    city: msme?.contact?.address?.city || msme?.manufacturingProfile?.locationCity || null,
    state: msme?.contact?.address?.state || msme?.manufacturingProfile?.locationState || null,
    country: msme?.contact?.address?.country || msme?.manufacturingProfile?.locationCountry || 'India',
    pincode: msme?.contact?.address?.pincode || null
  },
  operationalFineDetails: {
    industrySector: msme?.manufacturingProfile?.industrySector || null,
    nicCode: msme?.manufacturingProfile?.nicCode || null,
    operationalDaysPerYear: asNumber(msme?.manufacturingProfile?.operationalDaysPerYear),
    plantAreaSqft: asNumber(msme?.manufacturingProfile?.plantAreaSqft),
    primaryEnergySource: msme?.manufacturingProfile?.primaryEnergySource || null,
    backupEnergySource: msme?.manufacturingProfile?.backupEnergySource || null,
    waterSource: msme?.manufacturingProfile?.waterSource || null,
    wasteManagementPractice: msme?.manufacturingProfile?.wasteManagementPractice || null,
    certifications: Array.isArray(msme?.manufacturingProfile?.certifications)
      ? msme.manufacturingProfile.certifications
      : [],
    regulatoryExposure: Array.isArray(msme?.manufacturingProfile?.regulatoryExposure)
      ? msme.manufacturingProfile.regulatoryExposure
      : []
  }
});

const buildCarbonSavingsDetails = ({
  assessment = {},
  assessmentHistory = [],
  totalCO2Emissions = 0,
  solarPowerGenerationAndUsage = {}
}) => {
  const recommendations = Array.isArray(assessment?.recommendations)
    ? assessment.recommendations
    : [];
  const implementedRecommendations = recommendations.filter((item) => (
    Boolean(item?.isImplemented) || String(item?.status || '').toLowerCase() === 'completed'
  ));

  const potentialRecommendationSavingsKgCO2e = roundTo(
    recommendations.reduce((sum, item) => sum + asNumber(item?.potentialCO2Reduction), 0),
    2
  );
  const realizedRecommendationSavingsKgCO2e = roundTo(
    implementedRecommendations.reduce((sum, item) => sum + asNumber(item?.actualCO2Saved), 0),
    2
  );

  const historicalEmissions = [asNumber(assessment?.totalCO2Emissions)]
    .concat(
      (Array.isArray(assessmentHistory) ? assessmentHistory : [])
        .map((item) => asNumber(item?.totalCO2Emissions))
        .filter((value) => value > 0)
    )
    .filter((value) => value > 0);

  const baselineEmissionsKgCO2e = historicalEmissions.length > 0
    ? Math.max(...historicalEmissions)
    : asNumber(totalCO2Emissions);
  const trendReductionKgCO2e = baselineEmissionsKgCO2e > 0
    ? roundTo(Math.max(0, baselineEmissionsKgCO2e - asNumber(totalCO2Emissions)), 2)
    : 0;
  const trendReductionPercent = baselineEmissionsKgCO2e > 0
    ? roundTo((trendReductionKgCO2e / baselineEmissionsKgCO2e) * 100, 2)
    : 0;

  const solarReductionKgCO2e = roundTo(
    asNumber(solarPowerGenerationAndUsage?.emissionReductionPotential?.totalKgCO2e),
    2
  );
  const netSavingsKgCO2e = roundTo(
    trendReductionKgCO2e + realizedRecommendationSavingsKgCO2e + solarReductionKgCO2e,
    2
  );
  const potentialTotalSavingsKgCO2e = roundTo(
    trendReductionKgCO2e + potentialRecommendationSavingsKgCO2e + solarReductionKgCO2e,
    2
  );

  return {
    unit: 'kgCO2e',
    baselineEmissionsKgCO2e: roundTo(baselineEmissionsKgCO2e, 2),
    currentEmissionsKgCO2e: roundTo(totalCO2Emissions, 2),
    trendReductionKgCO2e,
    trendReductionPercent,
    recommendations: {
      totalRecommendations: recommendations.length,
      implementedRecommendations: implementedRecommendations.length,
      potentialSavingsKgCO2e: potentialRecommendationSavingsKgCO2e,
      realizedSavingsKgCO2e: realizedRecommendationSavingsKgCO2e
    },
    renewableAndSolar: {
      solarSavingsKgCO2e: solarReductionKgCO2e
    },
    netSavingsKgCO2e,
    potentialTotalSavingsKgCO2e,
    estimatedSavingsCreditEquivalent: roundTo(netSavingsKgCO2e * CARBON_CREDIT_PER_KG_CO2, 2),
    methodology:
      'Savings combine baseline trend improvement, implemented recommendation outcomes, and measured solar emission-reduction potential.'
  };
};

const buildCarbonCreditsSummary = ({
  carbonCredits = null,
  solarPowerGenerationAndUsage = {},
  carbonSavingsDetails = {}
}) => {
  const allocationHistory = Array.isArray(carbonCredits?.allocationHistory)
    ? carbonCredits.allocationHistory
    : [];
  const transactions = Array.isArray(carbonCredits?.transactions)
    ? carbonCredits.transactions
    : [];

  const earnedCredits = roundTo(
    allocationHistory.reduce((sum, item) => sum + asNumber(item?.creditsAllocated), 0),
    2
  );
  const transferredInCredits = roundTo(
    transactions.reduce((sum, item) => (
      item?.type === 'transfer' && item?.metadata?.direction === 'in'
        ? sum + asNumber(item?.amount)
        : sum
    ), 0),
    2
  );
  const transferredOutCredits = roundTo(
    transactions.reduce((sum, item) => (
      item?.type === 'transfer' && item?.metadata?.direction === 'out'
        ? sum + asNumber(item?.amount)
        : sum
    ), 0),
    2
  );
  const availableCredits = roundTo(asNumber(carbonCredits?.availableCredits), 2);
  const usedCredits = roundTo(asNumber(carbonCredits?.usedCredits), 2);
  const retiredCredits = roundTo(asNumber(carbonCredits?.retiredCredits), 2);
  const totalCreditsInAccount = roundTo(availableCredits + usedCredits + retiredCredits, 2);

  const estimatedSolarCredits = roundTo(
    asNumber(solarPowerGenerationAndUsage?.carbonCreditBenefits?.estimatedCarbonCredits),
    2
  );
  const estimatedSavingsCredits = roundTo(
    asNumber(carbonSavingsDetails?.estimatedSavingsCreditEquivalent),
    2
  );

  return {
    availableCredits,
    usedCredits,
    retiredCredits,
    totalCreditsInAccount,
    earnedCredits,
    transferredInCredits,
    transferredOutCredits,
    netTransferredCredits: roundTo(transferredInCredits - transferredOutCredits, 2),
    estimatedNewCreditsFromSolar: estimatedSolarCredits,
    estimatedCreditsFromSavings: estimatedSavingsCredits,
    creditConversion: {
      kgCO2ePerCredit: roundTo(KG_CO2_PER_CARBON_CREDIT, 2),
      creditsPerKgCO2e: CARBON_CREDIT_PER_KG_CO2
    },
    marketLinkage: {
      poolId: carbonCredits?.poolId || 'indian_carbon_market_pool',
      accountStatus: totalCreditsInAccount > 0 ? 'active' : 'new_or_no_credits',
      lastContributionDate: carbonCredits?.lastContributionDate || null
    }
  };
};

const buildAssuranceAndComplianceNarrative = ({
  msme = {},
  assessment = {},
  compliance = {},
  carbonSavingsDetails = {},
  carbonCreditsSummary = {}
}) => {
  const assessmentStatus = String(assessment?.status || 'draft').toLowerCase();
  const hasReviewSignals = Boolean(assessment?.reviewedBy || assessment?.reviewedAt);
  const assuranceLevel = hasReviewSignals
    ? 'internally_reviewed'
    : assessmentStatus === 'approved'
      ? 'approved'
      : 'management_prepared';

  const disclosurePrepReady = Boolean(
    compliance?.disclosurePrepReady ?? compliance?.isBRSRCompliant
  );

  return {
    overallStatus: disclosurePrepReady ? 'aligned' : 'needs_improvement',
    reportingTemplate: {
      regulator: 'SEBI',
      framework: 'BRSR Principle 6 Environmental Pack (India)',
      preparedFor: 'Indian sustainability disclosure preparation — not statutory filing'
    },
    assurance: {
      level: assuranceLevel,
      assessmentStatus,
      reviewedAt: assessment?.reviewedAt || null,
      notes: assessment?.notes || null
    },
    complianceSnapshot: {
      brsrCompletenessScore: roundTo(asNumber(compliance?.completenessScore), 1),
      disclosurePrepReady,
      isBRSRCompliant: disclosurePrepReady,
      environmentalComplianceScore: roundTo(asNumber(compliance?.environmentalComplianceScore), 1),
      registrationsDisclosed: Boolean(
        msme?.udyamRegistrationNumber || msme?.gstNumber || msme?.panNumber
      )
    },
    mandatoryChecklist: compliance?.mandatoryFields || {},
    templateAlignment: compliance?.templateAlignment || {},
    climatePerformanceSnapshot: {
      netCarbonSavingsKgCO2e: roundTo(asNumber(carbonSavingsDetails?.netSavingsKgCO2e), 2),
      availableCarbonCredits: roundTo(asNumber(carbonCreditsSummary?.availableCredits), 2),
      retiredCarbonCredits: roundTo(asNumber(carbonCreditsSummary?.retiredCredits), 2)
    }
  };
};

const buildPrincipleWisePerformance = ({
  scopeTotals,
  assessment = {},
  transactions = [],
  totalCO2Emissions = 0,
  solarPowerGenerationAndUsage = {}
}) => {
  const renewableTransactions = transactions.filter(
    transaction => transaction?.category === 'energy' && transaction?.subcategory === 'renewable'
  ).length;

  const environmentalIndicators = {
    totalGHGEmissions: roundTo(totalCO2Emissions, 2),
    scopeEmissions: {
      scope1: scopeTotals.scope1,
      scope2: scopeTotals.scope2,
      scope3: scopeTotals.scope3
    },
    scopeContributionPercent: scopeTotals.percentages,
    renewableEnergyTransactions: renewableTransactions,
    wasteEmissions: roundTo(extractEmissionValue(assessment?.breakdown?.waste?.total), 2),
    waterEmissions: roundTo(extractEmissionValue(assessment?.breakdown?.water?.co2Emissions), 2),
    solarPowerGenerationAndUsage: {
      generationKwh: roundTo(asNumber(solarPowerGenerationAndUsage?.generationKwh), 2),
      usageKwh: roundTo(asNumber(solarPowerGenerationAndUsage?.usageKwh), 2),
      emissionReductionPotentialKgCO2e: roundTo(
        asNumber(solarPowerGenerationAndUsage?.emissionReductionPotential?.totalKgCO2e),
        2
      ),
      estimatedCarbonCredits: roundTo(
        asNumber(solarPowerGenerationAndUsage?.carbonCreditBenefits?.estimatedCarbonCredits),
        2
      ),
      eligibleForCarbonCreditBenefits: Boolean(
        solarPowerGenerationAndUsage?.carbonCreditBenefits?.eligibleForCarbonCreditBenefits
      )
    }
  };

  return PRINCIPLE_TITLES.map((title, index) => {
    const principleNumber = index + 1;

    if (principleNumber === 6) {
      return {
        principle: principleNumber,
        title,
        status: totalCO2Emissions > 0 ? 'reported' : 'limited_data',
        indicators: environmentalIndicators
      };
    }

    return {
      principle: principleNumber,
      title,
      status: 'out_of_pack_scope',
      indicators: {},
      note: 'Principles 1–5 and 7–9 require separate social/governance data modules. This pack covers Principle 6 (environment) only.'
    };
  });
};

const toDisplayLabel = (value = '') => String(value || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, char => char.toUpperCase());

const resolveAssessmentPeriodLabel = (assessment = {}, fallbackIndex = 0) => {
  const endDate = ensureDate(assessment?.period?.endDate || assessment?.createdAt);
  if (!endDate) {
    return `Period ${fallbackIndex + 1}`;
  }
  const quarter = Math.floor(endDate.getMonth() / 3) + 1;
  return `Q${quarter} ${endDate.getFullYear()}`;
};

const buildCategoryEmissionBreakdown = (assessment = {}, totalCO2Emissions = 0) => {
  const categories = [
    { key: 'energy', label: 'Energy', value: extractEmissionValue(assessment?.breakdown?.energy?.total) },
    { key: 'materials', label: 'Materials', value: extractEmissionValue(assessment?.breakdown?.materials?.co2Emissions) },
    { key: 'transportation', label: 'Transportation', value: extractEmissionValue(assessment?.breakdown?.transportation?.co2Emissions) },
    { key: 'waste', label: 'Waste', value: extractEmissionValue(assessment?.breakdown?.waste?.total) },
    { key: 'water', label: 'Water', value: extractEmissionValue(assessment?.breakdown?.water?.co2Emissions) },
    { key: 'manufacturing', label: 'Manufacturing', value: extractEmissionValue(assessment?.breakdown?.manufacturing?.co2Emissions) }
  ].map((item) => ({
    ...item,
    value: roundTo(item.value, 2)
  }));

  const computedTotal = categories.reduce((sum, item) => sum + item.value, 0);
  
  if (computedTotal === 0 && totalCO2Emissions > 0) {
    categories.push({
      key: 'uncategorized',
      label: 'Uncategorized',
      value: roundTo(totalCO2Emissions, 2)
    });
  }

  const denominator = computedTotal > 0 ? computedTotal : totalCO2Emissions;

  return categories.map((item) => ({
    ...item,
    sharePercent: denominator > 0 ? roundTo((item.value / denominator) * 100, 2) : 0
  }));
};

const buildScopeBreakdownRows = (scopeData = {}, scopeTotal = 0) => {
  const breakdown = scopeData?.breakdown || {};
  const rows = Object.keys(breakdown).map((key) => ({
    key,
    label: toDisplayLabel(key),
    emissions: roundTo(asNumber(breakdown[key]), 2)
  }));

  return rows
    .filter((row) => row.emissions > 0)
    .sort((left, right) => right.emissions - left.emissions)
    .map((row) => ({
      ...row,
      sharePercentWithinScope: scopeTotal > 0 ? roundTo((row.emissions / scopeTotal) * 100, 2) : 0
    }));
};

const buildScopeBreakdowns = (assessment = {}, scopeTotals = {}) => {
  const esgScopes = assessment?.esgScopes || {};
  return {
    scope1: buildScopeBreakdownRows(esgScopes.scope1 || {}, scopeTotals.scope1),
    scope2: buildScopeBreakdownRows(esgScopes.scope2 || {}, scopeTotals.scope2),
    scope3: buildScopeBreakdownRows(esgScopes.scope3 || {}, scopeTotals.scope3)
  };
};

const buildAssessmentTrend = ({ assessment, assessmentHistory = [], scopeTotals }) => {
  const currentRow = {
    period: resolveAssessmentPeriodLabel(assessment, 0),
    totalEmissions: roundTo(asNumber(assessment?.totalCO2Emissions), 2),
    scope1: roundTo(scopeTotals.scope1, 2),
    scope2: roundTo(scopeTotals.scope2, 2),
    scope3: roundTo(scopeTotals.scope3, 2)
  };

  const historicalRows = (Array.isArray(assessmentHistory) ? assessmentHistory : [])
    .map((entry, index) => {
      const totals = normalizeScopeTotals(entry);
      return {
        period: resolveAssessmentPeriodLabel(entry, index + 1),
        totalEmissions: roundTo(asNumber(entry?.totalCO2Emissions), 2),
        scope1: roundTo(totals.scope1, 2),
        scope2: roundTo(totals.scope2, 2),
        scope3: roundTo(totals.scope3, 2),
        _sortDate: ensureDate(entry?.period?.endDate || entry?.createdAt)?.getTime() || 0
      };
    })
    .sort((left, right) => left._sortDate - right._sortDate)
    .slice(-3)
    .map(({ _sortDate, ...row }) => row);

  const trend = [...historicalRows, currentRow];
  const previous = trend.length > 1 ? trend[trend.length - 2] : null;
  const emissionChangePercent = previous && previous.totalEmissions > 0
    ? roundTo(((currentRow.totalEmissions - previous.totalEmissions) / previous.totalEmissions) * 100, 2)
    : null;

  return {
    periods: trend,
    periodCount: trend.length,
    emissionChangePercent
  };
};

const buildWorkflowEmissionDetails = (msme = {}, totalCO2Emissions = 0) => {
  const workflow = msme?.business?.manufacturingWorkflow || {};
  const latestEstimate = workflow?.latestEstimate || {};
  const units = Array.isArray(workflow?.units) ? workflow.units : [];
  const employees = Array.isArray(workflow?.employees) ? workflow.employees : [];

  const processEmissions = roundTo(asNumber(latestEstimate?.totalCO2Emissions), 2);
  const scope3Commuting = roundTo(asNumber(latestEstimate?.scope3Emissions || latestEstimate?.commuteEmissions), 2);
  const workflowTotal = roundTo(processEmissions + scope3Commuting, 2);
  const contributionToBRSRTotal = totalCO2Emissions > 0
    ? roundTo((workflowTotal / totalCO2Emissions) * 100, 2)
    : 0;

  return {
    isAvailable: workflowTotal > 0 || units.length > 0,
    unitsTracked: units.length,
    employeesTracked: employees.length,
    machineryEmissions: roundTo(asNumber(latestEstimate?.machineryEmissions), 2),
    rawMaterialEmissions: roundTo(asNumber(latestEstimate?.rawMaterialEmissions), 2),
    packagingMaterialEmissions: roundTo(asNumber(latestEstimate?.packagingMaterialEmissions), 2),
    scope3Commuting,
    processEmissions,
    workflowTotal,
    contributionToBRSRTotal
  };
};

const buildSolarPowerGenerationAndUsage = ({
  msme = {},
  assessment = {},
  transactions = []
}) => {
  const solarProfile = msme?.business?.solarPower || {};
  const explicitGenerationKwh = pickFirstFinite(
    solarProfile?.annualGenerationKwh,
    solarProfile?.generationKwh,
    assessment?.breakdown?.energy?.solar?.generationKwh,
    assessment?.breakdown?.energy?.solarGenerationKwh
  );
  const explicitUsageKwh = pickFirstFinite(
    solarProfile?.annualUsageKwh,
    solarProfile?.usageKwh,
    assessment?.breakdown?.energy?.solar?.usageKwh,
    assessment?.breakdown?.energy?.solarUsageKwh
  );
  const installedCapacityKw = roundTo(pickFirstFinite(
    solarProfile?.installedCapacityKw,
    solarProfile?.capacityKw,
    assessment?.breakdown?.energy?.solar?.installedCapacityKw
  ), 2);

  const solarTransactions = (Array.isArray(transactions) ? transactions : []).filter((transaction) => (
    transaction?.category === 'energy' && (
      String(transaction?.subcategory || '').toLowerCase() === 'solar' || isSolarTransaction(transaction)
    )
  ));
  const solarEnergySpendINR = roundTo(
    solarTransactions.reduce((sum, transaction) => sum + asNumber(transaction?.amount), 0),
    2
  );
  const estimatedUsageFromTransactionsKwh = solarEnergySpendINR > 0
    ? roundTo(solarEnergySpendINR / SOLAR_ESTIMATED_PRICE_PER_KWH_INR, 2)
    : 0;

  const generationKwh = roundTo(explicitGenerationKwh, 2);
  const usageKwh = roundTo(
    explicitUsageKwh > 0 ? explicitUsageKwh : estimatedUsageFromTransactionsKwh,
    2
  );

  const usageReductionPotentialKgCO2e = roundTo(
    usageKwh * SOLAR_USAGE_REDUCTION_KG_CO2_PER_KWH,
    2
  );
  const exportedSolarKwh = roundTo(Math.max(0, generationKwh - usageKwh), 2);
  const generationExportReductionPotentialKgCO2e = roundTo(
    exportedSolarKwh * GRID_EMISSION_FACTOR_KG_CO2_PER_KWH,
    2
  );
  const totalReductionPotentialKgCO2e = roundTo(
    usageReductionPotentialKgCO2e + generationExportReductionPotentialKgCO2e,
    2
  );

  const estimatedCarbonCredits = roundTo(totalReductionPotentialKgCO2e * CARBON_CREDIT_PER_KG_CO2, 2);
  const primaryEnergySource = String(msme?.manufacturingProfile?.primaryEnergySource || '').toLowerCase();
  const hasSolarAdoption = (
    generationKwh > 0 ||
    usageKwh > 0 ||
    solarTransactions.length > 0 ||
    primaryEnergySource.includes('solar')
  );
  const eligibleForCarbonCreditBenefits = hasSolarAdoption && totalReductionPotentialKgCO2e > 0;
  const eligibilityStatus = eligibleForCarbonCreditBenefits
    ? 'eligible'
    : hasSolarAdoption
      ? 'data_required'
      : 'not_eligible';

  return {
    installedCapacityKw,
    generationKwh,
    usageKwh,
    solarTransactionCount: solarTransactions.length,
    solarEnergySpendINR,
    estimation: {
      estimatedUsageFromTransactionsKwh,
      assumedSolarTariffINRPerKwh: SOLAR_ESTIMATED_PRICE_PER_KWH_INR
    },
    emissionReductionPotential: {
      unit: 'kgCO2e',
      fromUsageKgCO2e: usageReductionPotentialKgCO2e,
      fromExportedGenerationKgCO2e: generationExportReductionPotentialKgCO2e,
      totalKgCO2e: totalReductionPotentialKgCO2e
    },
    carbonCreditBenefits: {
      eligibleForCarbonCreditBenefits,
      eligibilityStatus,
      estimatedCarbonCredits,
      conversionBasis: {
        kgCO2ePerCredit: roundTo(KG_CO2_PER_CARBON_CREDIT, 2),
        creditsPerKgCO2e: CARBON_CREDIT_PER_KG_CO2
      },
      potentialBenefits: eligibleForCarbonCreditBenefits
        ? ['carbon_credits', 'renewable_energy_certificates', 'green_finance_priority']
        : []
    },
    brsrHighlight:
      'Solar power generation and usage are reported as emission-reduction potential and assessed for carbon-credit-linked benefits.'
  };
};

const buildTopEmissionDrivers = (categoryBreakdown = [], scopeBreakdowns = {}) => {
  const drivers = [];

  categoryBreakdown.forEach((category) => {
    if (category.value <= 0) return;
    drivers.push({
      sourceType: 'category',
      source: category.label,
      emissions: category.value
    });
  });

  ['scope1', 'scope2', 'scope3'].forEach((scopeKey) => {
    const rows = scopeBreakdowns[scopeKey] || [];
    rows.slice(0, 2).forEach((row) => {
      drivers.push({
        sourceType: scopeKey,
        source: `${scopeKey.toUpperCase()} - ${row.label}`,
        emissions: row.emissions
      });
    });
  });

  return drivers
    .sort((left, right) => right.emissions - left.emissions)
    .slice(0, 8)
    .map((item) => ({
      ...item,
      emissions: roundTo(item.emissions, 2)
    }));
};

const HOTSPOT_CATEGORY_SCOPE_MAP = {
  energy: 'scope2',
  materials: 'scope3',
  transportation: 'scope3',
  waste: 'scope3',
  water: 'scope3',
  manufacturing: 'scope1'
};

const getHotspotMitigationTemplate = (categoryKey = '') => {
  const templates = {
    energy: {
      mitigation: 'Shift grid electricity demand to renewable PPAs/onsite solar and optimize equipment runtime.',
      implementationTrack: 'energy_transition',
      expectedReductionBandPercent: '15-30'
    },
    materials: {
      mitigation: 'Prioritize low-carbon suppliers, recycled inputs, and material yield improvement.',
      implementationTrack: 'sustainable_procurement',
      expectedReductionBandPercent: '8-20'
    },
    transportation: {
      mitigation: 'Consolidate dispatches, optimize routes, and transition fleet to lower-carbon fuels.',
      implementationTrack: 'green_logistics',
      expectedReductionBandPercent: '10-25'
    },
    waste: {
      mitigation: 'Segregate at source, maximize recycling/recovery, and reduce landfill disposal.',
      implementationTrack: 'waste_circularity',
      expectedReductionBandPercent: '12-28'
    },
    water: {
      mitigation: 'Deploy water reuse, process recirculation, and low-energy treatment systems.',
      implementationTrack: 'water_efficiency',
      expectedReductionBandPercent: '6-15'
    },
    manufacturing: {
      mitigation: 'Improve process control, preventive maintenance, and combustion efficiency.',
      implementationTrack: 'process_efficiency',
      expectedReductionBandPercent: '10-22'
    }
  };
  return templates[categoryKey] || {
    mitigation: 'Run a focused process audit and replace high-emission activities with lower-carbon alternatives.',
    implementationTrack: 'targeted_abatement',
    expectedReductionBandPercent: '5-12'
  };
};

const buildHotspotMitigationPlan = ({
  categoryBreakdown = [],
  transactions = [],
  totalCO2Emissions = 0
}) => {
  const denominator = totalCO2Emissions > 0
    ? totalCO2Emissions
    : categoryBreakdown.reduce((sum, item) => sum + asNumber(item.value), 0);

  const enrichedHotspots = categoryBreakdown
    .filter(item => asNumber(item.value) > 0)
    .sort((left, right) => asNumber(right.value) - asNumber(left.value))
    .slice(0, 5)
    .map((item, index) => {
      const categoryKey = String(item.key || '').toLowerCase();
      const evidenceTransactions = (Array.isArray(transactions) ? transactions : []).filter((transaction) => {
        const normalizedCategory = String(transaction?.category || '').toLowerCase();
        if (categoryKey === 'materials') {
          return normalizedCategory === 'raw_materials';
        }
        if (categoryKey === 'waste') {
          return normalizedCategory === 'waste_management';
        }
        return normalizedCategory === categoryKey;
      });
      const highValueEvidenceCount = evidenceTransactions.filter((transaction) => {
        const workflow = String(transaction?.metadata?.extractedData?.sourceWorkflow || '').toLowerCase();
        return workflow === 'high_value_sms' || workflow === 'high_value_accounting';
      }).length;
      const template = getHotspotMitigationTemplate(categoryKey);
      const emissions = roundTo(asNumber(item.value), 2);
      const hotspotSharePercent = denominator > 0
        ? roundTo((emissions / denominator) * 100, 2)
        : 0;
      const severity = hotspotSharePercent >= 30 ? 'critical' : (hotspotSharePercent >= 15 ? 'high' : 'moderate');

      return {
        rank: index + 1,
        hotspot: item.label,
        category: categoryKey,
        ghgScope: HOTSPOT_CATEGORY_SCOPE_MAP[categoryKey] || 'scope3',
        emissionsKgCO2e: emissions,
        sharePercent: hotspotSharePercent,
        severity,
        evidence: {
          transactionCount: evidenceTransactions.length,
          highValueBillEvidenceCount: highValueEvidenceCount
        },
        recommendation: {
          mitigation: template.mitigation,
          implementationTrack: template.implementationTrack,
          expectedReductionBandPercent: template.expectedReductionBandPercent
        }
      };
    });

  return {
    policyGuideline:
      'BRSR Principle 6 aligned recommendations generated from emission hotspots with mitigation tracks under GHG Protocol scopes.',
    hotspots: enrichedHotspots,
    prioritizedMitigations: enrichedHotspots.map((hotspot) => ({
      priority: hotspot.rank,
      hotspot: hotspot.hotspot,
      ghgScope: hotspot.ghgScope,
      mitigation: hotspot.recommendation.mitigation,
      expectedReductionBandPercent: hotspot.recommendation.expectedReductionBandPercent
    }))
  };
};

const buildCarbonEmissionDetails = ({
  msme = {},
  assessment = {},
  assessmentHistory = [],
  scopeTotals,
  totalCO2Emissions
}) => {
  const categoryBreakdown = buildCategoryEmissionBreakdown(assessment, totalCO2Emissions);
  const scopeBreakdowns = buildScopeBreakdowns(assessment, scopeTotals);
  const directEmissions = roundTo(scopeTotals.scope1, 2);
  const indirectEmissions = roundTo(scopeTotals.scope2 + scopeTotals.scope3, 2);
  const assessmentTrend = buildAssessmentTrend({
    assessment,
    assessmentHistory,
    scopeTotals
  });
  const workflowDetails = buildWorkflowEmissionDetails(msme, totalCO2Emissions);

  return {
    directVsIndirect: {
      directEmissions,
      indirectEmissions,
      directSharePercent: totalCO2Emissions > 0 ? roundTo((directEmissions / totalCO2Emissions) * 100, 2) : 0,
      indirectSharePercent: totalCO2Emissions > 0 ? roundTo((indirectEmissions / totalCO2Emissions) * 100, 2) : 0
    },
    categoryBreakdown,
    scopeBreakdowns,
    topEmissionDrivers: buildTopEmissionDrivers(categoryBreakdown, scopeBreakdowns),
    assessmentTrend,
    manufacturingWorkflow: workflowDetails
  };
};

const pickSectorPersona = (msme = {}) => {
  const hay = `${String(msme?.industry || '').toLowerCase()} ${String(msme?.businessDomain || '').toLowerCase()} ${
    String(msme?.manufacturingProfile?.industrySector || '').toLowerCase()
  }`;

  if (/(manufactur|fabricat|industrial|production|factory|plant|machin|oem)/.test(hay)) {
    return {
      sectorId: 'manufacturing',
      sectorLabel: 'Manufacturing and industrial',
      focusCategoryKeys: ['energy', 'materials', 'manufacturing', 'waste'],
      brsrPrinciple6Highlights: [
        'Stationary combustion, process heat, and electricity (Scope 1 and 2) typically dominate.',
        'Materials and packaging (upstream Scope 3) often rank next for disclosure under Principle 6.'
      ],
      sectorBenchmarkNote:
        'For manufacturing MSMEs, BRSR Principle 6 expects transparent GHG totals, intensity metrics, and mitigation actions tied to energy and process hotspots.'
    };
  }

  if (/(it|software|consult|service|bank|finance|insur|hospital|health|educat|retail|logistics|transport|hospitality|hotel)/.test(hay)) {
    return {
      sectorId: 'services_commerce',
      sectorLabel: 'Services, commerce, and logistics',
      focusCategoryKeys: ['energy', 'transportation', 'water', 'materials'],
      brsrPrinciple6Highlights: [
        'Scope 2 from purchased electricity and Scope 3 from mobility and logistics are common focal points.',
        'Office energy, cloud or data-related spend, and fleet or courier services should be evidenced for BRSR narratives.'
      ],
      sectorBenchmarkNote:
        'Service-sector BRSR disclosures emphasise purchased energy, value-chain transport, and credible intensity denominators (revenue or FTE).'
    };
  }

  if (/(agri|farm|crop|dairy|food process|beverage)/.test(hay)) {
    return {
      sectorId: 'agrifood',
      sectorLabel: 'Agriculture and food systems',
      focusCategoryKeys: ['materials', 'energy', 'water', 'waste'],
      brsrPrinciple6Highlights: [
        'Water-stressed operations and cold-chain energy are material for many agri-food MSMEs.',
        'Organic waste, packaging, and agricultural inputs contribute to Scope 3 and should be traceable in annexures.'
      ],
      sectorBenchmarkNote:
        'BRSR Principle 6 for agri-food often pairs GHG totals with water-related indicators and waste diversion where material.'
    };
  }

  return {
    sectorId: 'general',
    sectorLabel: 'General MSME operations',
    focusCategoryKeys: ['energy', 'materials', 'transportation', 'waste', 'water', 'manufacturing'],
    brsrPrinciple6Highlights: [
      'Use category-level splits to show where emissions concentrate before expanding to full value-chain inventory.',
      'Align hotspot mitigation with Principle 6 indicators and keep supporting bills or meters in the annexure.'
    ],
    sectorBenchmarkNote:
      'BRSR Core expects clear GHG scope disclosure, intensity where applicable, and consistent methodology notes across the reporting period.'
  };
};

const buildSectorCarbonAnalytics = ({
  msme = {},
  assessment = {},
  categoryBreakdown = [],
  totalCO2Emissions = 0,
  transactions = []
}) => {
  const persona = pickSectorPersona(msme);
  const byKey = categoryBreakdown.reduce((acc, row) => {
    acc[row.key] = row;
    return acc;
  }, {});

  const categoryTotal = categoryBreakdown.reduce((sum, row) => sum + asNumber(row.value), 0);
  const denom = categoryTotal > 0 ? categoryTotal : Math.max(asNumber(totalCO2Emissions), 1);

  const keysToTrack = [...persona.focusCategoryKeys];
  if (byKey['uncategorized'] && byKey['uncategorized'].value > 0) {
    keysToTrack.push('uncategorized');
  }

  const focusCategories = keysToTrack.map((key) => {
    const row = byKey[key];
    const value = roundTo(asNumber(row?.value), 2);
    return {
      categoryKey: key,
      label: row?.label || toDisplayLabel(key),
      emissionsKgCO2e: value,
      shareOfCategoryTotalPercent: denom > 0 ? roundTo((value / denom) * 100, 2) : 0
    };
  });

  focusCategories.sort((a, b) => b.emissionsKgCO2e - a.emissionsKgCO2e);

  const topDriver = focusCategories[0];
  const suggestedActions = [];
  if (topDriver && topDriver.emissionsKgCO2e > 0) {
    suggestedActions.push(
      `Prioritise data quality and metering for "${topDriver.label}" (${topDriver.shareOfCategoryTotalPercent}% of category-level tracked emissions).`
    );
  }
  if (persona.sectorId === 'manufacturing') {
    suggestedActions.push('Document fuel grades, process temperatures, and renewable electricity contracts for BRSR assurance readiness.');
  } else if (persona.sectorId === 'services_commerce') {
    suggestedActions.push('Capture landlord or RE100-style renewable procurement evidence and commuter or logistics surveys for Scope 3.');
  } else {
    suggestedActions.push('Maintain period-stamped bills and activity data in the annexure to support third-party review.');
  }

  const txCount = Array.isArray(transactions) ? transactions.length : 0;
  const assessmentStatus = String(assessment?.status || 'draft').toLowerCase();

  return {
    sectorId: persona.sectorId,
    sectorLabel: persona.sectorLabel,
    industryContext: {
      industry: msme?.industry || null,
      businessDomain: msme?.businessDomain || null,
      industrySector: msme?.manufacturingProfile?.industrySector || null
    },
    brsrPrinciple6Highlights: persona.brsrPrinciple6Highlights,
    sectorBenchmarkNote: persona.sectorBenchmarkNote,
    focusCategories,
    suggestedActions: suggestedActions.slice(0, 3),
    dataSignals: {
      transactionCount: txCount,
      assessmentStatus,
      categoryDataCompletenessPercent: roundTo(
        (categoryBreakdown.filter((c) => asNumber(c.value) > 0).length / Math.max(categoryBreakdown.length, 1)) * 100,
        1
      )
    }
  };
};

const buildBrsrComplianceSummary = (compliance = {}, principleWisePerformance = []) => {
  const gaps = Object.entries(compliance?.mandatoryFields || {})
    .filter(([, ok]) => !ok)
    .map(([key]) => key);

  const principle6 = Array.isArray(principleWisePerformance)
    ? principleWisePerformance.find((p) => p.principle === 6)
    : null;

  const disclosureReadinessPercent = asNumber(compliance?.completenessScore);
  const disclosurePrepReady = Boolean(
    compliance?.disclosurePrepReady ?? compliance?.isBRSRCompliant
  );

  return {
    framework: 'SEBI BRSR Core (MSME-aligned)',
    reportScope: 'BRSR Principle 6 Environmental Pack (Section C partial)',
    disclosureReadinessPercent,
    readinessScore: disclosureReadinessPercent,
    disclosurePrepReady,
    /** @deprecated Use disclosurePrepReady */
    isBRSRCompliant: disclosurePrepReady,
    overallStatus: disclosurePrepReady ? 'aligned' : 'needs_improvement',
    templateAlignment: compliance?.templateAlignment || null,
    environmentalComplianceScore: asNumber(compliance?.environmentalComplianceScore),
    mandatoryFieldGaps: gaps,
    openGaps: gaps.map((gap) => ({ field: gap, title: toDisplayLabel(gap) })),
    principle6EnvironmentalStatus: principle6?.status || null,
    carbonCreditsDisclosure: compliance?.carbonCreditsDisclosure || null
  };
};

const buildCarbonCreditsDetails = ({
  carbonCreditsSummary = {},
  carbonSavingsDetails = {},
  solarPowerGenerationAndUsage = {}
}) => {
  const marketReferencePriceINRPerCredit = 50;
  const estimatedEligibleCreditsFromSavings = roundTo(
    asNumber(carbonSavingsDetails?.potentialTotalSavingsKgCO2e) * CARBON_CREDIT_PER_KG_CO2,
    2
  );
  const estimatedSolarCredits = roundTo(
    asNumber(solarPowerGenerationAndUsage?.carbonCreditBenefits?.estimatedCarbonCredits),
    2
  );
  const availableCredits = roundTo(asNumber(carbonCreditsSummary?.availableCredits), 2);
  const usedCredits = roundTo(asNumber(carbonCreditsSummary?.usedCredits), 2);
  const retiredCredits = roundTo(asNumber(carbonCreditsSummary?.retiredCredits), 2);
  const transferredInCredits = roundTo(asNumber(carbonCreditsSummary?.transferredInCredits), 2);
  const transferredOutCredits = roundTo(asNumber(carbonCreditsSummary?.transferredOutCredits), 2);
  const earnedCredits = roundTo(asNumber(carbonCreditsSummary?.earnedCredits), 2);

  return {
    marketReferencePriceINRPerCredit,
    earnedCredits,
    estimatedEligibleCreditsFromSavings,
    estimatedSolarCredits,
    availableCredits,
    usedCredits,
    retiredCredits,
    transferredInCredits,
    transferredOutCredits,
    netTransferredCredits: roundTo(transferredInCredits - transferredOutCredits, 2),
    estimatedMonetaryValueINR: roundTo(availableCredits * marketReferencePriceINRPerCredit, 2),
    conversionBasis: {
      kgCO2ePerCredit: roundTo(KG_CO2_PER_CARBON_CREDIT, 2),
      creditsPerKgCO2e: CARBON_CREDIT_PER_KG_CO2
    }
  };
};

const buildBillAnnexure = (billAnnexure = []) => {
  const normalizedBills = (Array.isArray(billAnnexure) ? billAnnexure : []).map((bill, index) => {
    const uploadedAt = ensureDate(bill?.createdAt || bill?.uploadedAt);
    const amountINR = asOptionalNumber(
      bill?.extractedData?.amount ?? bill?.amount ?? bill?.amountINR
    );
    const ocrConfidence = asOptionalNumber(bill?.processingResults?.confidence);
    const processingWarnings = Array.isArray(bill?.processingResults?.warnings)
      ? bill.processingResults.warnings
      : [];
    const processingErrors = Array.isArray(bill?.processingResults?.errors)
      ? bill.processingResults.errors
      : [];
    const includedInEmissions = bill?.includedInEmissionsCalculation !== false
      && String(bill?.status || '').toLowerCase() !== 'rejected';

    return {
      serialNumber: index + 1,
      documentId: bill?._id ? String(bill._id) : null,
      fileName: bill?.originalName || bill?.fileName || `Bill ${index + 1}`,
      documentType: bill?.documentType || 'bill',
      status: bill?.status || null,
      uploadedAt: uploadedAt ? uploadedAt.toISOString() : null,
      amountINR: amountINR === null ? null : roundTo(amountINR, 2),
      ocrConfidencePercent: ocrConfidence === null ? null : roundTo(ocrConfidence * 100, 1),
      processingWarningCount: processingWarnings.length,
      processingErrorCount: processingErrors.length,
      dataQualityFlag: ocrConfidence === null
        ? 'not_assessed'
        : (ocrConfidence >= 0.75 ? 'high' : (ocrConfidence >= 0.5 ? 'medium' : 'low')),
      includedInEmissionsCalculation: includedInEmissions
    };
  });

  const totalBillAmountINR = roundTo(
    normalizedBills.reduce((sum, bill) => sum + asNumber(bill?.amountINR), 0),
    2
  );

  return {
    title: 'Annexure - Bills Attached for Reference',
    totalBillsAttached: normalizedBills.length,
    totalBillAmountINR,
    bills: normalizedBills
  };
};

const buildBRSRReport = ({
  msme = {},
  assessment = {},
  assessmentHistory = [],
  transactions = [],
  billAnnexure = [],
  carbonCreditsSummary = {},
  carbonCreditsAccount = null,
  requestedPeriod = 'annual',
  generatedAt = new Date()
}) => {
  const periodStart = ensureDate(assessment?.period?.startDate);
  const periodEnd = ensureDate(assessment?.period?.endDate);

  const totalCO2Emissions = asNumber(assessment?.totalCO2Emissions);
  const scopeTotals = normalizeScopeTotals(assessment);

  const annualTurnover = asNumber(msme?.business?.annualTurnover);
  const employeeCount = asNumber(msme?.business?.numberOfEmployees);

  const emissionsPerINRMillionTurnover = annualTurnover > 0
    ? roundTo(totalCO2Emissions / (annualTurnover / 1000000), 2)
    : null;
  const emissionsPerEmployee = employeeCount > 0
    ? roundTo(totalCO2Emissions / employeeCount, 2)
    : null;
  const solarPowerGenerationAndUsage = buildSolarPowerGenerationAndUsage({
    msme,
    assessment,
    transactions
  });
  const carbonEmissionDetails = buildCarbonEmissionDetails({
    msme,
    assessment,
    assessmentHistory,
    scopeTotals,
    totalCO2Emissions
  });
  const hotspotMitigationPlan = buildHotspotMitigationPlan({
    categoryBreakdown: carbonEmissionDetails.categoryBreakdown,
    transactions,
    totalCO2Emissions
  });
  const carbonSavings = buildCarbonSavingsDetails({
    assessment,
    assessmentHistory,
    totalCO2Emissions,
    solarPowerGenerationAndUsage
  });
  const normalizedCarbonCreditsSummary = Object.keys(carbonCreditsSummary || {}).length > 0
    ? carbonCreditsSummary
    : buildCarbonCreditsSummary({
      carbonCredits: carbonCreditsAccount,
      solarPowerGenerationAndUsage,
      carbonSavingsDetails: carbonSavings
    });
  const carbonCredits = buildCarbonCreditsDetails({
    carbonCreditsSummary: normalizedCarbonCreditsSummary,
    carbonSavingsDetails: carbonSavings,
    solarPowerGenerationAndUsage
  });
  const compliance = getComplianceChecklist({
    msme,
    scopeTotals,
    assessment,
    annualTurnover,
    employeeCount,
    carbonCreditsSummary: normalizedCarbonCreditsSummary
  });
  const assuranceAndCompliance = buildAssuranceAndComplianceNarrative({
    msme,
    assessment,
    compliance,
    carbonSavingsDetails: carbonSavings,
    carbonCreditsSummary: normalizedCarbonCreditsSummary
  });

  const principleWisePerformance = buildPrincipleWisePerformance({
    scopeTotals,
    assessment,
    transactions,
    totalCO2Emissions,
    solarPowerGenerationAndUsage
  });
  const sectorCarbonAnalytics = buildSectorCarbonAnalytics({
    msme,
    assessment,
    categoryBreakdown: carbonEmissionDetails.categoryBreakdown,
    totalCO2Emissions,
    transactions
  });
  const brsrComplianceSummary = buildBrsrComplianceSummary(compliance, principleWisePerformance);
  const scope3Quality = assessScope3Quality({ scopeTotals, assessment });
  const reportReadiness = buildReportReadinessMeta({
    reportType: 'BRSR',
    brsrReport: {
      compliance,
      organization: {
        companyName: msme?.companyName,
        industry: msme?.industry,
        registrations: {
          udyamRegistrationNumber: msme?.udyamRegistrationNumber,
          gstNumber: msme?.gstNumber,
          panNumber: msme?.panNumber
        },
        country: msme?.contact?.address?.country || 'India'
      },
      environmental: {
        greenhouseGasEmissions: {
          scope1: scopeTotals.scope1,
          scope2: scopeTotals.scope2,
          scope3: scopeTotals.scope3,
          total: roundTo(totalCO2Emissions, 2)
        }
      },
      reportingPeriod: {
        financialYear: getFinancialYear(periodEnd || generatedAt),
        startDate: periodStart ? periodStart.toISOString() : null,
        endDate: periodEnd ? periodEnd.toISOString() : null
      },
      sectionA: { generalDisclosures: {} },
      sectionB: {},
      sectionC: { principleWisePerformance },
      methodologyAndAssumptions: {},
      scope3Quality,
      reportScope: brsrComplianceSummary.reportScope
    },
    scope3Quality
  });
  const valueChain = buildValueChainReport({
    msme,
    transactions,
    generatedAt
  });
  const billsAttachedForReference = buildBillAnnexure(billAnnexure);

  const ghgInventoryBoundaries = withCompletenessFlag(buildBrsrGhgInventoryBoundaries(msme));

  const methodologyAndAssumptions = {
    gwpBasis: 'IPCC AR5 GWP-100 (CO2e)',
    ghgProtocolReference: 'GHG Protocol Corporate Standard',
    gridEmissionFactorKgCO2PerKwh: GRID_EMISSION_FACTOR_KG_CO2_PER_KWH,
    renewableEmissionFactorKgCO2PerKwh: RENEWABLE_EMISSION_FACTOR_KG_CO2_PER_KWH,
    solarEstimatedPricePerKwhINR: SOLAR_ESTIMATED_PRICE_PER_KWH_INR,
    carbonCreditConversion: {
      kgCO2ePerCredit: roundTo(KG_CO2_PER_CARBON_CREDIT, 2),
      creditsPerKgCO2e: CARBON_CREDIT_PER_KG_CO2
    },
    scopeAllocationSource: scopeTotals.scopeAllocationSource,
    scopesExplicitlyMeasured: scopeTotals.scopesExplicitlyMeasured,
    periodChangePercent: carbonEmissionDetails.assessmentTrend?.emissionChangePercent ?? null,
    ghgInventoryBoundaries
  };

  const disclosurePrepReady = Boolean(
    compliance.disclosurePrepReady ?? compliance.isBRSRCompliant
  );
  const summary = [
    `BRSR Principle 6 ${disclosurePrepReady ? 'prep ready' : 'needs improvement'}`,
    `${brsrComplianceSummary.disclosureReadinessPercent}% disclosure readiness`,
    `${roundTo(totalCO2Emissions / 1000, 2)} tCO2e total emissions`
  ].join(' · ');

  return {
    reportType: 'BRSR',
    framework: 'SEBI_BRSR',
    standardVersion: 'BRSR Core',
    reportScope: brsrComplianceSummary.reportScope,
    reportReadiness,
    scope3Quality,
    summary,
    generatedAt: new Date(generatedAt).toISOString(),
    reportingPeriod: {
      requestedPeriod,
      startDate: periodStart ? periodStart.toISOString() : null,
      endDate: periodEnd ? periodEnd.toISOString() : null,
      financialYear: getFinancialYear(periodEnd || generatedAt)
    },
    templateMetadata: {
      authority: 'Securities and Exchange Board of India (SEBI)',
      templateFamily: 'Business Responsibility and Sustainability Report',
      templateVariant: 'BRSR Core Principle 6 Environmental Pack (MSME)',
      country: 'India',
      principlesCovered: [6],
      principlesOutOfScope: [1, 2, 3, 4, 5, 7, 8, 9]
    },
    organization: {
      companyName: msme?.companyName || 'MSME',
      companyType: msme?.companyType || 'small',
      industry: msme?.industry || 'General',
      businessDomain: msme?.businessDomain || 'other',
      state: msme?.contact?.address?.state || msme?.manufacturingProfile?.locationState || null,
      country: msme?.contact?.address?.country || 'India',
      primaryProducts: msme?.business?.primaryProducts || null,
      registrations: {
        udyamRegistrationNumber: msme?.udyamRegistrationNumber || null,
        gstNumber: msme?.gstNumber || null,
        panNumber: msme?.panNumber || null
      }
    },
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
      annualTurnoverINR: annualTurnover,
      employeeCount,
      manufacturingUnits: asNumber(msme?.business?.manufacturingUnits),
      primaryProducts: msme?.business?.primaryProducts || null,
      primaryEnergySource: msme?.manufacturingProfile?.primaryEnergySource || null,
      wasteManagementPractice: msme?.manufacturingProfile?.wasteManagementPractice || null
    },
    msmeProfileDetailed: buildMsmeProfileDetails(msme),
    sectionA: {
      generalDisclosures: {
        listedEntity: false,
        legalIdentity: {
          establishmentYear: msme?.establishmentYear || null,
          udyamRegistrationNumber: msme?.udyamRegistrationNumber || null,
          gstNumber: msme?.gstNumber || null,
          panNumber: msme?.panNumber || null
        },
        turnoverINR: annualTurnover,
        employeeCount,
        manufacturingUnits: asNumber(msme?.business?.manufacturingUnits),
        environmentalCompliance: {
          hasEnvironmentalClearance: Boolean(msme?.environmentalCompliance?.hasEnvironmentalClearance),
          hasPollutionControlBoard: Boolean(msme?.environmentalCompliance?.hasPollutionControlBoard),
          hasWasteManagement: Boolean(msme?.environmentalCompliance?.hasWasteManagement)
        }
      }
    },
    sectionB: {
      managementAndProcessDisclosures: {
        policyCommitments: PRINCIPLE_TITLES.map((title, index) => ({
          principle: index + 1,
          title,
          policyAvailable: Boolean(
            index + 1 === 6
              ? totalCO2Emissions > 0
              : (msme?.manufacturingProfile?.esgMaturityLevel || msme?.manufacturingProfile?.carbonAccountingPractice)
          ),
          approvedByBoard: Boolean(msme?.manufacturingProfile?.certifications?.length)
        })),
        governance: {
          carbonScore: asNumber(assessment?.carbonScore),
          recommendationsCount: Array.isArray(assessment?.recommendations)
            ? assessment.recommendations.length
            : 0,
          carbonAccountingPractice: msme?.manufacturingProfile?.carbonAccountingPractice || null,
          esgMaturityLevel: msme?.manufacturingProfile?.esgMaturityLevel || null
        }
      }
    },
    sectionC: {
      principleWisePerformance,
      environmentalPerformanceKpis: {
        totalCO2EmissionsKgCO2e: roundTo(totalCO2Emissions, 2),
        carbonSavingsKgCO2e: carbonSavings.potentialTotalSavingsKgCO2e,
        carbonCreditsAvailable: carbonCredits.availableCredits,
        complianceScorePercent: compliance.completenessScore,
        hotspotCount: hotspotMitigationPlan.hotspots.length
      }
    },
    environmental: {
      greenhouseGasEmissions: {
        unit: 'kgCO2e',
        scope1: scopeTotals.scope1,
        scope2: scopeTotals.scope2,
        scope3: scopeTotals.scope3,
        total: roundTo(totalCO2Emissions, 2),
        scopeAllocationSource: scopeTotals.scopeAllocationSource,
        scopesExplicitlyMeasured: scopeTotals.scopesExplicitlyMeasured,
        residualScope3Used: scopeTotals.residualScope3Used,
        methodologicalWarning: scopeTotals.methodologicalWarning || null,
        scope3Quality,
        scopeContributionPercent: scopeTotals.percentages,
        intensity: {
          perINRMillionTurnover: emissionsPerINRMillionTurnover,
          perEmployee: emissionsPerEmployee
        }
      },
      carbonEmissionDetails,
      hotspotMitigationPlan,
      carbonSavings,
      carbonCredits: {
        ...carbonCredits,
        account: carbonCreditsAccount
          ? {
              lastContributionDate: carbonCreditsAccount.lastContributionDate || null,
              performanceMetrics: {
                carbonEfficiency: roundTo(asNumber(carbonCreditsAccount?.performanceMetrics?.carbonEfficiency), 3),
                participationScore: roundTo(asNumber(carbonCreditsAccount?.performanceMetrics?.participationScore), 2),
                lastUpdated: carbonCreditsAccount?.performanceMetrics?.lastUpdated || null
              }
            }
          : null
      },
      energy: {
        electricityEmissions: roundTo(extractEmissionValue(assessment?.breakdown?.energy?.electricity), 2),
        fuelEmissions: roundTo(extractEmissionValue(assessment?.breakdown?.energy?.fuel), 2),
        totalEnergyEmissions: roundTo(extractEmissionValue(assessment?.breakdown?.energy?.total), 2)
      },
      solarPowerGenerationAndUsage,
      water: {
        consumption: roundTo(asNumber(assessment?.breakdown?.water?.consumption), 2),
        emissions: roundTo(extractEmissionValue(assessment?.breakdown?.water?.co2Emissions), 2)
      },
      waste: {
        totalEmissions: roundTo(extractEmissionValue(assessment?.breakdown?.waste?.total), 2),
        hazardousEmissions: roundTo(extractEmissionValue(assessment?.breakdown?.waste?.hazardous), 2),
        solidEmissions: roundTo(extractEmissionValue(assessment?.breakdown?.waste?.solid), 2)
      }
    },
    valueChain,
    annexure: {
      billsAttachedForReference
    },
    compliance,
    assuranceAndCompliance,
    sectorCarbonAnalytics,
    brsrComplianceSummary,
    methodologyAndAssumptions,
    ghgInventoryBoundaries,
    reportAgents: {
      reportType: 'BRSR',
      orchestrationPattern: 'multi_agent_orchestration',
      generatedAt: new Date(generatedAt).toISOString(),
      agents: [
        {
          agent: 'report_generator',
          role: 'Builds BRSR narrative and structured sections',
          status: 'active'
        },
        {
          agent: 'compliance_monitor',
          role: 'Validates mandatory fields and BRSR compliance readiness',
          status: 'active'
        },
        {
          agent: 'carbon_analyzer',
          role: 'Maps and summarizes GHG Protocol scope emissions',
          status: 'active'
        }
      ]
    }
  };
};

module.exports = {
  buildBRSRReport,
  normalizeScopeTotals
};
