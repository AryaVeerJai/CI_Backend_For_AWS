/**
 * Regulatory export formats, readiness levels, and validation gates for disclosure reports.
 * Outputs are preparation artifacts — not statutory filings unless reportReadinessLevel is filing_ready.
 */

const REPORT_READINESS_LEVELS = {
  PREP_DRAFT: 'prep_draft',
  READINESS_ASSESSMENT: 'readiness_assessment',
  FILING_READY: 'filing_ready'
};

const CBAM_DATA_QUALITY_TIER_MAP = {
  primary: 'tier1',
  supplier: 'tier1',
  estimated: 'tier2',
  default: 'tier3'
};

const CBAM_TIER_LABELS = {
  tier1: 'Tier 1 — installation-level actual emissions',
  tier2: 'Tier 2 — country/regional default values',
  tier3: 'Tier 3 — conservative estimates'
};

const roundTo = (value, decimals = 2) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
};

const escapeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const escapeCsv = (value) => {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const mapCbamDataQualityToTier = (dataQuality = 'estimated') => (
  CBAM_DATA_QUALITY_TIER_MAP[String(dataQuality).toLowerCase()] || CBAM_DATA_QUALITY_TIER_MAP.default
);

const assessScope3Quality = ({ scopeTotals = {}, assessment = {} }) => {
  const residualUsed = Boolean(scopeTotals.residualScope3Used);
  const explicitlyMeasured = Boolean(scopeTotals.scopesExplicitlyMeasured?.scope3);
  const breakdown = assessment?.breakdown || {};
  const categoryKeys = ['materials', 'transportation', 'waste', 'water', 'manufacturing'];
  const categoriesWithData = categoryKeys.filter((key) => {
    const node = breakdown[key];
    const value = node?.co2Emissions ?? node?.total ?? node?.value ?? 0;
    return Number(value) > 0;
  });

  const assuranceReady = explicitlyMeasured && !residualUsed && categoriesWithData.length >= 2;
  const warnings = [];
  if (residualUsed) {
    warnings.push('Scope 3 includes residual allocation — not assurance-grade under GHG Protocol completeness.');
  }
  if (!explicitlyMeasured && Number(scopeTotals.scope3) > 0) {
    warnings.push('Scope 3 was not explicitly measured; verify category-level activity data.');
  }
  if (scopeTotals.methodologicalWarning) {
    warnings.push(String(scopeTotals.methodologicalWarning));
  }

  return {
    residualScope3Used: residualUsed,
    scope3ExplicitlyMeasured: explicitlyMeasured,
    categoriesWithActivityData: categoriesWithData,
    categoryCoverageCount: categoriesWithData.length,
    assuranceGradeReady: assuranceReady,
    dataQualityTier: residualUsed ? 'spend_based_or_residual' : explicitlyMeasured ? 'primary_or_secondary' : 'incomplete',
    warnings
  };
};

const validateSebiBrsrMandatoryIndicators = (brsrReport = {}) => {
  const missing = [];
  const org = brsrReport.organization || brsrReport.companyProfile || {};
  const env = brsrReport.environmental?.greenhouseGasEmissions || {};
  const compliance = brsrReport.compliance?.mandatoryFields || {};

  if (!org.companyName) missing.push('companyName');
  if (!org.industry) missing.push('industry');
  if (!compliance.registrationsDisclosed) missing.push('registrationsDisclosed');
  if (!compliance.reportingPeriod) missing.push('reportingPeriod');
  if (!compliance.organizationalBoundaryDocumented) missing.push('organizationalBoundaryDocumented');
  if (!compliance.operationalBoundaryDocumented) missing.push('operationalBoundaryDocumented');
  if (Number(env.scope1) < 0 || env.scope1 === undefined) missing.push('scope1');
  if (Number(env.scope2) < 0 || env.scope2 === undefined) missing.push('scope2');
  if (Number(env.scope3) < 0 || env.scope3 === undefined) missing.push('scope3');

  return {
    valid: missing.length === 0,
    missingIndicators: missing
  };
};

const resolveBrsrReportReadinessLevel = (brsrReport = {}) => {
  const disclosurePrepReady = Boolean(
    brsrReport.compliance?.disclosurePrepReady ?? brsrReport.compliance?.isBRSRCompliant
  );
  const scope3Quality = brsrReport.scope3Quality
    || assessScope3Quality({
      scopeTotals: brsrReport.environmental?.greenhouseGasEmissions || {},
      assessment: brsrReport._assessmentRef || {}
    });
  const sebiValidation = validateSebiBrsrMandatoryIndicators(brsrReport);

  if (disclosurePrepReady && sebiValidation.valid && scope3Quality.assuranceGradeReady) {
    return REPORT_READINESS_LEVELS.FILING_READY;
  }
  if (disclosurePrepReady) {
    return REPORT_READINESS_LEVELS.READINESS_ASSESSMENT;
  }
  return REPORT_READINESS_LEVELS.PREP_DRAFT;
};

const buildReportReadinessMeta = ({
  reportType,
  brsrReport,
  cbamReport,
  isoReport,
  scope3Quality
}) => {
  if (reportType === 'BRSR' && brsrReport) {
    const level = resolveBrsrReportReadinessLevel({ ...brsrReport, scope3Quality });
    const sebiValidation = validateSebiBrsrMandatoryIndicators(brsrReport);
    return {
      reportReadinessLevel: level,
      reportReadinessLabel: level === REPORT_READINESS_LEVELS.FILING_READY
        ? 'Filing-ready (schema validated)'
        : level === REPORT_READINESS_LEVELS.READINESS_ASSESSMENT
          ? 'Readiness assessment'
          : 'Prep draft',
      filingDisclaimer: level !== REPORT_READINESS_LEVELS.FILING_READY
        ? 'Not validated for statutory SEBI filing. Complete missing indicators and resolve Scope 3 quality gates.'
        : null,
      sebiValidation,
      scope3Quality
    };
  }

  if (reportType === 'CBAM' && cbamReport) {
    const cbamReadiness = assessCbamSubmissionReadiness(cbamReport);
    return {
      reportReadinessLevel: cbamReadiness.filingReady
        ? REPORT_READINESS_LEVELS.FILING_READY
        : cbamReadiness.submissionReady
          ? REPORT_READINESS_LEVELS.READINESS_ASSESSMENT
          : REPORT_READINESS_LEVELS.PREP_DRAFT,
      reportReadinessLabel: cbamReadiness.statusLabel,
      filingDisclaimer: cbamReadiness.filingDisclaimer,
      cbamSubmissionReadiness: cbamReadiness
    };
  }

  if ((reportType === 'ISO14064' || reportType === 'ISO14067') && isoReport) {
    const score = Number(isoReport.overview?.readinessScore || 0);
    const level = score >= 85
      ? REPORT_READINESS_LEVELS.READINESS_ASSESSMENT
      : REPORT_READINESS_LEVELS.PREP_DRAFT;
    return {
      reportReadinessLevel: level,
      reportReadinessLabel: level === REPORT_READINESS_LEVELS.READINESS_ASSESSMENT
        ? 'Assurance prep ready'
        : 'Gap-closure draft',
      filingDisclaimer: 'ISO certification requires independent third-party verification — not generated by this system.'
    };
  }

  return {
    reportReadinessLevel: REPORT_READINESS_LEVELS.PREP_DRAFT,
    reportReadinessLabel: 'Prep draft',
    filingDisclaimer: null
  };
};

const assessCbamSubmissionReadiness = (cbamReport = {}) => {
  const goods = Array.isArray(cbamReport.goods) ? cbamReport.goods : [];
  const isExporter = goods.length > 0 || cbamReport.overview?.complianceStatus !== 'Not Required';

  if (!isExporter) {
    return {
      submissionReady: false,
      filingReady: false,
      statusLabel: 'Not applicable',
      filingDisclaimer: null,
      tierSummary: { tier1Count: 0, tier2Count: 0, tier3Count: 0 },
      blockedReasons: []
    };
  }

  const tierSummary = { tier1Count: 0, tier2Count: 0, tier3Count: 0 };
  goods.forEach((good) => {
    const tier = good.dataQualityTier || mapCbamDataQualityToTier(good.dataQuality);
    if (tier === 'tier1') tierSummary.tier1Count += 1;
    else if (tier === 'tier2') tierSummary.tier2Count += 1;
    else tierSummary.tier3Count += 1;
  });

  const blockedReasons = [];
  if (tierSummary.tier1Count === 0) {
    blockedReasons.push('No Tier 1 (installation-level) data for any covered good.');
  }
  if (tierSummary.tier3Count > 0 && tierSummary.tier1Count === 0) {
    blockedReasons.push('Only Tier 3 conservative estimates — cannot mark registry submission ready.');
  }
  const docComplete = (cbamReport.documentation || []).filter((d) => d.status === 'complete').length;
  const docTotal = (cbamReport.documentation || []).length;
  if (docTotal > 0 && docComplete / docTotal < 0.5) {
    blockedReasons.push('Documentation checklist less than 50% complete.');
  }

  const submissionReady = blockedReasons.length === 0 && tierSummary.tier1Count > 0;
  const filingReady = submissionReady
    && tierSummary.tier3Count === 0
    && Number(cbamReport.overview?.readinessScore || 0) >= 80;

  let statusLabel = 'Prep draft';
  if (filingReady) statusLabel = 'Registry submission ready';
  else if (submissionReady) statusLabel = 'Readiness assessment';
  else if (tierSummary.tier2Count > 0 && tierSummary.tier1Count === 0) statusLabel = 'Tier 2/3 only — upgrade data';

  return {
    submissionReady,
    filingReady,
    statusLabel,
    tierSummary,
    blockedReasons,
    filingDisclaimer: filingReady
      ? null
      : 'EU CBAM Transitional Registry submission requires Tier 1 installation-level emissions for covered goods.'
  };
};

const enrichCbamGoodsWithTiers = (goods = []) => goods.map((good) => {
  const dataQualityTier = mapCbamDataQualityToTier(good.dataQuality);
  const tierLabel = CBAM_TIER_LABELS[dataQualityTier];
  let reportingStatus = good.reportingStatus || 'pending';
  if (dataQualityTier === 'tier3' && reportingStatus === 'complete') {
    reportingStatus = 'pending';
  }
  if (dataQualityTier !== 'tier1' && reportingStatus === 'in_progress' && good.dataQuality === 'estimated') {
    reportingStatus = 'pending';
  }
  return {
    ...good,
    dataQualityTier,
    dataQualityTierLabel: tierLabel,
    cnCode: good.cnCode || good.hsCode,
    countryOfOrigin: good.countryOfOrigin || 'IN',
    reportingStatus
  };
});

const resolveCbamComplianceStatus = ({
  isExporter,
  readinessScore,
  submissionReadiness
}) => {
  if (!isExporter) return 'Not Required';
  if (submissionReadiness?.filingReady) return 'Registry Ready';
  if (submissionReadiness?.submissionReady) {
    return readinessScore >= 80 ? 'On Track (Tier 1 verified)' : 'Needs Attention';
  }
  if (submissionReadiness?.tierSummary?.tier1Count === 0) {
    return 'At Risk — Tier 2/3 data only';
  }
  if (readinessScore >= 50) return 'Needs Attention';
  return 'At Risk';
};

const buildSebiBrsrExport = (brsrReport = {}) => {
  const org = brsrReport.organization || {};
  const env = brsrReport.environmental?.greenhouseGasEmissions || {};
  const period = brsrReport.reportingPeriod || {};
  const principle6 = (brsrReport.sectionC?.principleWisePerformance || [])
    .find((p) => p.principle === 6);

  return {
    exportFormat: 'SEBI_BRSR_CORE_JSON',
    exportVersion: '2026.1',
    generatedAt: brsrReport.generatedAt || new Date().toISOString(),
    disclaimer: 'SEBI-aligned structured export for disclosure preparation. Validate against current SEBI BRSR Core circular before filing.',
    reportingEntity: {
      name: org.companyName,
      cin: null,
      listed: false,
      udyamRegistrationNumber: org.registrations?.udyamRegistrationNumber || null,
      gstin: org.registrations?.gstNumber || null,
      pan: org.registrations?.panNumber || null,
      industry: org.industry,
      country: org.country || 'India'
    },
    reportingPeriod: {
      financialYear: period.financialYear,
      startDate: period.startDate,
      endDate: period.endDate
    },
    sectionA: {
      generalDisclosures: brsrReport.sectionA?.generalDisclosures || {}
    },
    sectionB: {
      managementAndProcessDisclosures: brsrReport.sectionB?.managementAndProcessDisclosures || {}
    },
    sectionC: {
      principle6Environmental: {
        principle: 6,
        title: principle6?.title || null,
        status: principle6?.status || null,
        ghgEmissions: {
          scope1KgCo2e: env.scope1,
          scope2KgCo2e: env.scope2,
          scope3KgCo2e: env.scope3,
          totalKgCo2e: env.total,
          unit: env.unit || 'kgCO2e',
          intensityPerInrMillion: env.intensity?.perINRMillionTurnover || null,
          intensityPerEmployee: env.intensity?.perEmployee || null
        },
        environmentalIndicators: principle6?.indicators || {}
      },
      principlesOutOfScope: [1, 2, 3, 4, 5, 7, 8, 9],
      scopeNote: brsrReport.reportScope || 'BRSR Principle 6 Environmental Pack (Section C partial)'
    },
    methodology: brsrReport.methodologyAndAssumptions || {},
    validation: validateSebiBrsrMandatoryIndicators(brsrReport),
    readiness: buildReportReadinessMeta({
      reportType: 'BRSR',
      brsrReport,
      scope3Quality: brsrReport.scope3Quality
    })
  };
};

const buildBrsrXbrlSkeleton = (brsrReport = {}) => {
  const sebi = buildSebiBrsrExport(brsrReport);
  const entity = sebi.reportingEntity;
  const ghg = sebi.sectionC.principle6Environmental.ghgEmissions;

  const elements = [
    ['brsr:EntityName', entity.name],
    ['brsr:FinancialYear', sebi.reportingPeriod.financialYear],
    ['brsr:Scope1GHGEmissions', ghg.scope1KgCo2e],
    ['brsr:Scope2GHGEmissions', ghg.scope2KgCo2e],
    ['brsr:Scope3GHGEmissions', ghg.scope3KgCo2e],
    ['brsr:TotalGHGEmissions', ghg.totalKgCo2e],
    ['brsr:ReportingPeriodStart', sebi.reportingPeriod.startDate],
    ['brsr:ReportingPeriodEnd', sebi.reportingPeriod.endDate],
    ['brsr:UDYAMRegistrationNumber', entity.udyamRegistrationNumber],
    ['brsr:GSTIN', entity.gstin]
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');

  const contextId = 'ReportingPeriod';
  const unitId = 'U_KGCO2e';

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:brsr="http://sustainow.local/brsr/core/2026">',
    `  <context id="${contextId}">`,
    `    <entity><identifier scheme="http://sustainow.local/entity">${escapeXml(entity.name)}</identifier></entity>`,
    `    <period><startDate>${escapeXml(String(sebi.reportingPeriod.startDate || '').slice(0, 10))}</startDate>`,
    `<endDate>${escapeXml(String(sebi.reportingPeriod.endDate || '').slice(0, 10))}</endDate></period>`,
    '  </context>',
    `  <unit id="${unitId}"><measure>brsr:kgCO2e</measure></unit>`,
    ...elements.map(([tag, value]) => (
      `  <${tag} contextRef="${contextId}" unitRef="${unitId}" decimals="2">${escapeXml(value)}</${tag}>`
    )),
    '  <!-- Skeleton only: map to official SEBI BRSR taxonomy before filing -->',
    '</xbrl>'
  ].join('\n');

  return {
    contentType: 'application/xml',
    filename: `BRSR_${String(entity.name || 'MSME').replace(/[^a-z0-9]/gi, '_')}_skeleton.xbrl`,
    xml,
    validation: sebi.validation,
    disclaimer: 'XBRL skeleton for BRSR Core Principle 6 indicators. Replace namespace and element names with official SEBI taxonomy before statutory filing.'
  };
};

const buildCbamRegistryRows = (cbamReport = {}) => {
  const period = cbamReport.overview?.reportingPeriod || cbamReport.overview?.reportingQuarter || '';
  const installationId = cbamReport.msmeProfile?.gstNumber
    || cbamReport.companyProfile?.gstNumber
    || cbamReport.msmeProfile?.companyName
    || 'UNKNOWN';

  return (cbamReport.goods || []).map((good) => ({
    reporting_period: period,
    installation_id: installationId,
    cn_code: good.cnCode || good.hsCode,
    goods_description: good.name,
    country_of_origin: good.countryOfOrigin || 'IN',
    export_volume_tonnes: good.exportVolumeTonnes,
    direct_emissions_tco2e: good.directEmbeddedEmissions,
    indirect_emissions_tco2e: good.indirectEmbeddedEmissions,
    total_embedded_emissions_tco2e: good.embeddedEmissions,
    emission_intensity_tco2e_per_tonne: good.emissionIntensity,
    data_quality_tier: good.dataQualityTier || mapCbamDataQualityToTier(good.dataQuality),
    data_quality_tier_label: good.dataQualityTierLabel || CBAM_TIER_LABELS[mapCbamDataQualityToTier(good.dataQuality)],
    reporting_status: good.reportingStatus,
    methodology: cbamReport.overview?.methodology || 'GHG Protocol embedded emissions'
  }));
};

const buildCbamRegistryCsv = (cbamReport = {}) => {
  const rows = buildCbamRegistryRows(cbamReport);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [
    'reporting_period', 'installation_id', 'cn_code', 'goods_description',
    'country_of_origin', 'export_volume_tonnes', 'direct_emissions_tco2e',
    'indirect_emissions_tco2e', 'total_embedded_emissions_tco2e',
    'emission_intensity_tco2e_per_tonne', 'data_quality_tier', 'reporting_status'
  ];

  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(','))
  ];

  const company = cbamReport.msmeProfile?.companyName || cbamReport.companyProfile?.companyName || 'MSME';
  return {
    contentType: 'text/csv',
    filename: `CBAM_Registry_${String(company).replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0, 10)}.csv`,
    csv: lines.join('\n'),
    rowCount: rows.length,
    submissionReadiness: assessCbamSubmissionReadiness(cbamReport),
    disclaimer: 'EU CBAM Transitional Registry import format (embedded emissions). Verify against current EU Implementing Regulation before submission.'
  };
};

const buildIso14064AuditPack = ({ isoReport = {}, gapChecklist = {}, msme = {} }) => ({
  exportFormat: 'ISO_14064_3_AUDIT_PACK',
  generatedAt: new Date().toISOString(),
  standard: 'ISO 14064-1 / ISO 14064-3 (verification preparation)',
  organization: {
    name: msme.companyName || isoReport.companyProfile?.companyName,
    boundary: isoReport.boundaryDefinition || null
  },
  inventorySummary: {
    totalTco2e: isoReport.overview?.totalCO2Emissions,
    readinessScore: isoReport.overview?.readinessScore,
    status: isoReport.overview?.status
  },
  evidenceIndex: {
    factorRegistry: gapChecklist.factorRegistry || [],
    governanceControls: gapChecklist.sections?.governanceVerificationControls?.items || [],
    boundaryDefinitions: gapChecklist.sections?.boundaryDefinitions?.items || []
  },
  gapClosure: {
    overallReadinessScore: gapChecklist.overallReadinessScore,
    openGaps: gapChecklist.openGaps || [],
    priorityActions: gapChecklist.priorityActions || []
  },
  verificationReadiness: {
    checks: isoReport.evaluation?.checks || [],
    issues: isoReport.evaluation?.issues || [],
    recommendations: isoReport.evaluation?.recommendations || []
  },
  disclaimer: 'Audit preparation pack only. Independent ISO 14064 verification by an accredited body is required for certification.'
});

const validateIso14067ReportGate = ({ evaluation = {}, frameworkConfig = {}, productLci = {} }) => {
  const blockedReasons = [];
  if (!frameworkConfig.functionalUnit) {
    blockedReasons.push('Functional unit not declared (ISO 14067 requirement).');
  }
  if (!frameworkConfig.allocationMethod) {
    blockedReasons.push('Allocation method not declared.');
  }
  const lifecycleStages = frameworkConfig.lifecycleStages || {};
  if (Object.keys(lifecycleStages).length < 2) {
    blockedReasons.push('Lifecycle stage coverage incomplete (minimum 2 stages required).');
  }
  if (Number(evaluation.readinessScore || 0) < 50) {
    blockedReasons.push('ISO 14067 readiness score below minimum threshold (50%).');
  }
  const granularity = Number(productLci?.lciCoverage?.granularityScore || 0);
  if (granularity < 30) {
    blockedReasons.push('LCI granularity too low for product CFP disclosure.');
  }

  return {
    exportAllowed: blockedReasons.length === 0,
    blockedReasons,
    readinessScore: evaluation.readinessScore
  };
};

const COMPLIANCE_PACK_RULES = {
  cdp: {
    requiredFields: ['c0.companyName', 'c6.scope1', 'c6.scope2', 'c6.scope3'],
    label: 'CDP Climate Change'
  },
  csrd: {
    requiredFields: ['supplierIdentification.legalName', 'emissions.scope1KgCo2e', 'emissions.scope2KgCo2e'],
    label: 'ESRS supplier datapoints'
  },
  tcfd: {
    requiredFields: ['governance.inventoryOwner', 'metrics.scopes'],
    label: 'TCFD / IFRS S2'
  },
  eudr: {
    requiredFields: ['framework', 'dueDiligenceStatement'],
    label: 'EU Deforestation Regulation'
  },
  ecovadis: {
    requiredFields: ['framework', 'environment.ghgEmissionsKgCo2e'],
    label: 'EcoVadis-aligned assessment'
  }
};

const getNestedValue = (obj, path) => path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);

const validateCompliancePack = (pack = {}, packType = '') => {
  const rules = COMPLIANCE_PACK_RULES[packType];
  if (!rules) {
    return { valid: true, packType, missingFields: [], warnings: ['No validation rules defined for this pack type.'] };
  }

  const missingFields = rules.requiredFields.filter((field) => {
    const value = getNestedValue(pack, field);
    return value === null || value === undefined || value === '';
  });

  const warnings = [];
  if (packType === 'eudr' && pack.dueDiligenceStatement?.polygonVerification === 'pending') {
    warnings.push('EUDR geolocation polygon verification pending — pack is not submission-ready.');
  }
  if (packType === 'ecovadis') {
    warnings.push('EcoVadis pack is a template skeleton — not an EcoVadis certification output.');
  }

  return {
    valid: missingFields.length === 0 && warnings.length === 0,
    packType,
    framework: rules.label,
    missingFields,
    warnings,
    reportReadinessLevel: missingFields.length === 0 && warnings.length === 0
      ? REPORT_READINESS_LEVELS.READINESS_ASSESSMENT
      : REPORT_READINESS_LEVELS.PREP_DRAFT
  };
};

module.exports = {
  REPORT_READINESS_LEVELS,
  CBAM_DATA_QUALITY_TIER_MAP,
  CBAM_TIER_LABELS,
  assessScope3Quality,
  validateSebiBrsrMandatoryIndicators,
  resolveBrsrReportReadinessLevel,
  buildReportReadinessMeta,
  assessCbamSubmissionReadiness,
  enrichCbamGoodsWithTiers,
  resolveCbamComplianceStatus,
  buildSebiBrsrExport,
  buildBrsrXbrlSkeleton,
  buildCbamRegistryRows,
  buildCbamRegistryCsv,
  buildIso14064AuditPack,
  validateIso14067ReportGate,
  validateCompliancePack,
  mapCbamDataQualityToTier
};
