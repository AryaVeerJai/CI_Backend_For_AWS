const MSME = require('../models/MSME');
const Transaction = require('../models/Transaction');
const { getOperationalProfile } = require('./organizationProfileService');
const Document = require('../models/Document');
const CarbonAssessment = require('../models/CarbonAssessment');
const ComplianceHubRecord = require('../models/ComplianceHubRecord');
const carbonCalculationService = require('./carbonCalculationService');
const carbonCreditsService = require('./carbonCreditsService');
const indianCarbonMarketIntegration = require('./indianCarbonMarketIntegrationService');
const accountingSyncService = require('./accountingSyncService');
const { listConnectors } = require('./connectors/accountingConnectorRegistry');
const { buildBRSRReport } = require('./brsrReportingService');
const { buildValueChainReport } = require('./valueChainReportingService');
const { buildIsoGapClosureChecklist } = require('./isoGapClosureService');
const { buildZedReadinessPack } = require('./zedAssessmentService');
const { validateCompliancePack } = require('./reportStandardsExportService');

const { getDateRangeFromPeriod } = require('../utils/reportingPeriod');

const safeRound = (value, decimals = 2) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
};

const sumScopeFromBreakdown = (breakdown = {}) => {
  const scopes = breakdown.scopes || breakdown;
  return {
    scope1: safeRound(scopes.scope1 ?? breakdown.scope1 ?? 0),
    scope2: safeRound(scopes.scope2 ?? breakdown.scope2 ?? 0),
    scope3: safeRound(scopes.scope3 ?? breakdown.scope3 ?? 0)
  };
};

const loadMsmeReportingContext = async (msmeId, period = 'annual') => {
  const msme = await MSME.findById(msmeId).lean();
  if (!msme) {
    return null;
  }

  const { startDate, endDate } = getDateRangeFromPeriod(period);
  const [assessments, transactions, bills] = await Promise.all([
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
    }).lean(),
    Document.find({
      msmeId,
      documentType: 'bill',
      createdAt: { $gte: startDate, $lte: endDate }
    })
      .select('_id fileName originalName documentType status createdAt extractedData')
      .lean()
  ]);

  let latestAssessment = assessments[0] || null;
  if (!latestAssessment && transactions.length > 0) {
    const calculated = await carbonCalculationService.calculateMSMECarbonFootprintAsync(
      msme,
      transactions
    );
    latestAssessment = { ...calculated, period: { startDate, endDate } };
  }

  let carbonCreditsSummary = {};
  try {
    const account = await carbonCreditsService.getMSMECredits(msmeId);
    carbonCreditsSummary = carbonCreditsService.getCreditSummary(account);
  } catch {
    carbonCreditsSummary = {};
  }

  const brsrReport = buildBRSRReport({
    msme,
    assessment: latestAssessment || {
      period: { startDate, endDate },
      totalCO2Emissions: 0,
      breakdown: {}
    },
    assessmentHistory: assessments.slice(1, 8),
    transactions,
    billAnnexure: bills,
    carbonCreditsSummary,
    carbonCreditsAccount: null,
    requestedPeriod: period
  });

  const valueChain = buildValueChainReport({ msme, transactions });
  const scopes = sumScopeFromBreakdown(latestAssessment?.breakdown || brsrReport?.emissions || {});
  const totalKg = safeRound(
    latestAssessment?.totalCO2Emissions ?? brsrReport?.emissions?.totalGHG ?? 0
  );

  return {
    msme,
    period,
    startDate,
    endDate,
    transactions,
    bills,
    latestAssessment,
    brsrReport,
    valueChain,
    scopes,
    totalKg,
    carbonCreditsSummary
  };
};

const { computePatEnergyMetrics, isDesignatedConsumer } = require('../../../shared/patEnergyMetrics');

const buildPatStyleIntensity = (msme, transactions, totalKg) => {
  const patEnergy = computePatEnergyMetrics({
    transactions,
    enterpriseProfile: {
      sector: msme.industry,
      industry: msme.industry,
      regulatoryMandates: msme.regulatoryMandates,
      annualProduction: msme.annualProduction,
      productionVolume: msme.productionVolume,
      productionUnit: msme.productionUnit,
      functionalUnit: msme.functionalUnit
    }
  });

  const turnoverCr = Number(msme.annualTurnover) || 0;
  const employees = Number(msme.numberOfEmployees) || 0;
  const turnoverInr = turnoverCr > 0 ? turnoverCr * 10_000_000 : 0;

  return {
    energyEmissionsKgCo2e: patEnergy.energyEmissionsKgCo2e,
    totalEmissionsKgCo2e: safeRound(totalKg),
    energySharePercent: totalKg > 0
      ? safeRound((patEnergy.energyEmissionsKgCo2e / totalKg) * 100)
      : 0,
    intensityPerCrInrTurnover:
      turnoverInr > 0 ? safeRound((totalKg / turnoverCr) * 1000) : null,
    intensityPerEmployee: employees > 0 ? safeRound(totalKg / employees) : null,
    designatedConsumer: isDesignatedConsumer({
      sector: msme.industry,
      industry: msme.industry,
      regulatoryMandates: msme.regulatoryMandates
    }),
    totalEnergyToe: patEnergy.totalEnergyToe,
    electricityToe: patEnergy.electricityToe,
    fuelToe: patEnergy.fuelToe,
    specificEnergyConsumption: patEnergy.specificEnergyConsumption,
    secUnit: patEnergy.secUnit,
    productionOutput: patEnergy.productionOutput,
    productionUnit: patEnergy.productionUnit,
    patRelevanceNote:
      'Designated consumers under PAT must meet sector-specific SEC norms in toe per production unit. GHG energy emissions and PAT toe should be reconciled from metered activity data.',
    recommendedActions: [
      'Map facility-level electricity and fuel meters to activity data.',
      'Reconcile PAT-equivalent energy consumption (toe) with GHG energy emissions.',
      'Document baseline year and normalization factor (production units or turnover).'
    ]
  };
};

const buildBrsrCoreSupplierPack = (context, hubRecord) => {
  const { msme, brsrReport, scopes, totalKg, valueChain, bills } = context;
  return {
    packType: 'brsr_core_supplier',
    generatedAt: new Date().toISOString(),
    supplier: {
      companyName: msme.companyName,
      gstNumber: msme.gstNumber,
      udyamRegistrationNumber: msme.udyamRegistrationNumber,
      industry: msme.industry,
      businessDomain: msme.businessDomain,
      msmeCategory: msme.companyType
    },
    reportingPeriod: context.period,
    ghgInventory: {
      totalKgCo2e: totalKg,
      scopes,
      methodology: 'GHG Protocol Corporate Standard; India grid factors (CEA) where applicable',
      dataQuality: brsrReport?.dataQuality || 'mixed_activity_and_spend'
    },
    intensity: brsrReport?.intensityMetrics || {},
    valueChainSummary: valueChain?.summary || {},
    topSuppliers: valueChain?.suppliers?.slice(0, 5) || [],
    evidenceIndex: (bills || []).slice(0, 25).map((doc) => ({
      documentId: doc._id,
      fileName: doc.originalName || doc.fileName,
      status: doc.status && doc.status !== 'unknown' ? doc.status : 'not_assessed',
      uploadedAt: doc.createdAt
    })),
    brsrPrinciple6Highlights: brsrReport?.principle6 || brsrReport?.compliance || {},
    questionnaireStatus: hubRecord?.supplierQuestionnaires?.length
      ? hubRecord.supplierQuestionnaires
      : []
  };
};

const buildAssuranceWorkflow = async (context, hubRecord) => {
  const checklist = buildIsoGapClosureChecklist({
    msme: context.msme,
    transactions: context.transactions,
    documents: context.bills,
    frameworks: { iso14064: {}, iso14067: {} }
  });

  const govEvaluation = context.inventoryGovernance?.assuranceGate?.evaluation
    || context.assessment?.governance?.assuranceEvaluation;

  const defaultCheckpoints = [
    { id: 'boundary', label: 'Organizational & operational boundaries documented' },
    { id: 'factors', label: 'Emission factor registry versioned and cited' },
    { id: 'evidence', label: 'Primary evidence linked to scope totals' },
    { id: 'uncertainty', label: 'Uncertainty assessment completed' },
    { id: 'review', label: 'Internal review sign-off recorded' },
    {
      id: 'data_quality_gates',
      label: 'Assurance data-quality gates passed (activity vs spend-proxy mix)'
    }
  ];

  const stored = hubRecord?.assurance?.checkpoints || [];
  const checkpoints = defaultCheckpoints.map((cp) => {
    const match = stored.find((s) => s.id === cp.id);
    let completed = Boolean(match?.completed);
    if (cp.id === 'boundary') {
      const {
        assessOrganizationalBoundaryComplete,
        assessOperationalBoundaryComplete
      } = require('../../../shared/ghgBoundaryBrsr');
      const org = context.msme?.manufacturingProfile?.ghgOrganizationalBoundary || {};
      const op = context.msme?.operations?.ghgOperationalBoundary || {};
      completed = assessOrganizationalBoundaryComplete(org) && assessOperationalBoundaryComplete(op);
    }
    if (cp.id === 'data_quality_gates' && govEvaluation?.assuranceReady) {
      completed = true;
    }
    return { ...cp, completed, completedAt: match?.completedAt || null };
  });

  const agenticReadiness = govEvaluation?.readinessStatus
    || (govEvaluation?.assuranceReady ? 'assurance_ready' : null);

  return {
    readinessStatus: agenticReadiness
      || hubRecord?.assurance?.readinessStatus
      || 'in_progress',
    intendedAssuranceLevel: hubRecord?.assurance?.intendedAssuranceLevel || 'limited',
    leadReviewer: hubRecord?.assurance?.leadReviewer || '',
    lastReviewAt: hubRecord?.assurance?.lastReviewAt || null,
    isoGapClosure: checklist,
    checkpoints,
    overallReadinessScore: checklist.overallReadinessScore,
    inventoryGovernance: govEvaluation
      ? {
        assuranceReady: govEvaluation.assuranceReady,
        tier1Share: govEvaluation.tier1Share,
        blockers: govEvaluation.blockers,
        warnings: govEvaluation.warnings
      }
      : null
  };
};

const buildAccountingSyncStatus = async (context = {}) => {
  const connectors = listConnectors({ includeConfiguration: false });
  const apiStatuses = await accountingSyncService.listConnectorStatuses(context);
  return connectors.map((connector) => {
    const api = apiStatuses.find((entry) => entry.id === connector.id);
    const syncReady = Boolean(
      (api?.api?.configured || api?.api?.selfServeConnected) && api?.supportsApiSync
    );
    return {
      id: connector.id,
      name: connector.name,
      supportsImport: connector.integrationTypes.includes('import'),
      supportsApiSync: connector.integrationTypes.includes('api'),
      apiConfigured: Boolean(api?.api?.configured || api?.api?.selfServeConnected),
      selfServeConnected: Boolean(api?.api?.selfServeConnected),
      syncReady,
      recommendation: syncReady
        ? 'Connector ready for API sync or file import'
        : connector.integrationTypes.includes('api')
          ? 'Connect Tally, Zoho, or QuickBooks under Data connectors (self-serve)'
          : 'Use file import from Data connectors'
    };
  });
};

const buildZedCertificationPack = (context, hubRecord) => {
  const hubZed = hubRecord?.zedCertification?.toObject?.()
    || hubRecord?.zedCertification
    || {};
  return buildZedReadinessPack({
    msme: context.msme,
    documents: context.bills,
    hubZed,
    totalEmissionsKg: context.totalKg
  });
};

const resolveZedReadinessStatus = (zedPack) => {
  if (zedPack.certifiedLevel) {
    return 'aligned';
  }
  if (zedPack.journeyStatus === 'ready_for_assessment') {
    return 'ready';
  }
  if (zedPack.journeyStatus === 'in_progress' || zedPack.pledgeTaken) {
    return 'in_progress';
  }
  if (zedPack.eligibility?.eligible) {
    return 'not_started';
  }
  return 'review_required';
};

const buildIndianCarbonMarketPack = async (context, msmeId) => {
  let msmeCredits = null;
  if (msmeId) {
    try {
      msmeCredits = await carbonCreditsService.getMSMECredits(msmeId);
    } catch {
      msmeCredits = null;
    }
  }
  return indianCarbonMarketIntegration.buildCompliancePack(context, msmeCredits);
};

const buildCdpPack = (context) => ({
  framework: 'CDP Climate Change',
  organization: context.msme.companyName,
  reportingYear: new Date().getFullYear(),
  c0: { companyName: context.msme.companyName },
  c6: {
    scope1: context.scopes.scope1,
    scope2: context.scopes.scope2,
    scope3: context.scopes.scope3,
    unit: 'kg CO2e'
  },
  c7: {
    baseYear: context.hubSbti?.baseYear || null,
    targetYear: context.hubSbti?.nearTermTargetYear || null
  },
  methodologyStatement: 'GHG Protocol; activity and spend-based hybrid inventory from Sustainow Carbon Intelligence.'
});

const buildCsrdSupplierPack = (context) => ({
  framework: 'ESRS value chain (supplier datapoints)',
  supplierIdentification: {
    legalName: context.msme.companyName,
    country: 'IN',
    vatOrGst: context.msme.gstNumber
  },
  emissions: {
    scope1KgCo2e: context.scopes.scope1,
    scope2KgCo2e: context.scopes.scope2,
    scope3KgCo2e: context.scopes.scope3,
    reportingPeriod: context.period
  },
  energyAndWater: {
    note: 'Attach facility-level energy (MWh) and water (m3) from utility bills where material.'
  },
  dueDiligence: {
    valueChainStages: context.valueChain?.stages || []
  }
});

const buildTcfdIssbPack = (context) => ({
  framework: 'TCFD / IFRS S2 (climate-related disclosures)',
  governance: {
    inventoryOwner: context.msme.companyName,
    boardOversightNote: 'Document board or proprietor oversight of climate risks in Settings.'
  },
  strategy: {
    physicalRisks: ['Heat stress on operations', 'Water scarcity in production'],
    transitionRisks: ['Grid emission factor changes', 'CBAM cost pass-through for EU exports'],
    opportunities: ['Renewable energy adoption', 'Green loan eligibility']
  },
  metrics: {
    scopes: context.scopes,
    totalKgCo2e: context.totalKg,
    targets: context.hubSbti || {}
  },
  riskManagement: {
    dataQualityProcess: 'Document ingestion, SMS/email signals, accounting import reconciliation'
  }
});

const buildEcovadisPack = (context, hubRecord) => ({
  framework: 'EcoVadis-aligned sustainability assessment',
  environment: {
    ghgEmissionsKgCo2e: context.totalKg,
    energyIntensity: context.patIntensity?.intensityPerCrInrTurnover
  },
  laborAndHumanRights: { note: 'Complete HR policies module externally; link ISO social gaps if applicable.' },
  ethics: { note: 'Document anti-corruption and data privacy controls from Data Privacy module.' },
  sustainableProcurement: {
    topSuppliers: context.valueChain?.suppliers?.slice(0, 10) || []
  },
  lastScore: hubRecord?.exportProfile?.ecovadisLastScore ?? null
});

const buildEudrPack = (context, hubRecord) => ({
  framework: 'EU Deforestation Regulation (EUDR)',
  applicable: Boolean(hubRecord?.exportProfile?.eudrApplicable),
  commodities: ['cocoa', 'coffee', 'palm', 'rubber', 'soy', 'wood', 'cattle'],
  dueDiligenceStatement: {
    geolocationRequired: true,
    polygonVerification: 'pending',
    ddsReference: null
  },
  supplierPlots: [],
  recommendation: context.msme.businessDomain === 'agriculture'
    ? 'Enable EUDR module and map plot-level geolocation for EU-bound commodities.'
    : 'Mark EUDR not applicable unless exporting covered commodities to the EU.'
});

const buildCbamExporterPack = (context, hubRecord) => ({
  framework: 'EU CBAM',
  reportingPeriod: context.period,
  embeddedEmissionsTco2e: safeRound(context.totalKg / 1000, 4),
  goodsCategories: hubRecord?.exportProfile?.cbamGoodsCategories || [],
  dataQualityTiers: {
    tier1: 'Installation-level actual emissions (preferred)',
    tier2: 'Country default values',
    tier3: 'Conservative estimates'
  },
  importerReadyFields: [
    'cn_code',
    'country_of_origin',
    'direct_emissions_tco2e',
    'indirect_emissions_tco2e',
    'installation_id'
  ],
  linkToReporting: '/reporting?tab=cbam'
});

const ensureHubRecord = async (msmeId) => {
  let record = await ComplianceHubRecord.findOne({ msmeId });
  if (!record) {
    record = await ComplianceHubRecord.create({ msmeId });
  }
  return record;
};

const ensureOrgHubRecord = async (userContext) => {
  if (userContext.organizationId) {
    let record = await ComplianceHubRecord.findOne({ organizationId: userContext.organizationId });
    if (!record) {
      record = await ComplianceHubRecord.create({
        organizationId: userContext.organizationId,
        ...(userContext.msmeId ? { msmeId: userContext.msmeId } : {})
      });
    }
    return record;
  }
  if (userContext.msmeId) {
    return ensureHubRecord(userContext.msmeId);
  }
  throw new Error('No organization or MSME profile for compliance hub');
};

const buildTransactionFilterForUser = (userContext, startDate, endDate) => {
  const base = {
    date: { $gte: startDate, $lte: endDate },
    isSpam: { $ne: true },
    isDuplicate: { $ne: true }
  };
  if (userContext.organizationId) {
    const orConditions = [{ organizationId: userContext.organizationId }];
    if (userContext.msmeId) {
      orConditions.push({
        msmeId: userContext.msmeId,
        $or: [{ organizationId: { $exists: false } }, { organizationId: null }]
      });
    }
    return { ...base, $or: orConditions };
  }
  if (userContext.msmeId) {
    return { ...base, msmeId: userContext.msmeId };
  }
  return { ...base, _id: null };
};

const buildAssessmentFilterForUser = (userContext, startDate, endDate) => {
  const periodClause = {
    $or: [
      { 'period.endDate': { $gte: startDate, $lte: endDate } },
      { createdAt: { $gte: startDate, $lte: endDate } }
    ]
  };
  if (userContext.organizationId) {
    const orConditions = [{ organizationId: userContext.organizationId }];
    if (userContext.msmeId) {
      orConditions.push({ msmeId: userContext.msmeId });
    }
    return { $and: [{ $or: orConditions }, periodClause] };
  }
  if (userContext.msmeId) {
    return { msmeId: userContext.msmeId, ...periodClause };
  }
  return { _id: null };
};

const loadOrgReportingContext = async (userContext, period = 'annual') => {
  const operational = await getOperationalProfile(userContext);
  if (!operational) {
    return null;
  }

  const profile = operational.profile;
  const msmeAlias = operational.segment === 'enterprise'
    ? {
      ...profile,
      companyName: profile.companyName,
      industry: profile.industry,
      businessDomain: profile.businessDomain || profile.sector || 'manufacturing',
      gstNumber: profile.enterpriseProfile?.gstNumber,
      companyType: 'medium',
      contact: profile.contact,
      enterpriseProfile: profile.enterpriseProfile || operational.profile?.enterpriseProfile
    }
    : profile;

  const { startDate, endDate } = getDateRangeFromPeriod(period);
  const [assessments, transactions, bills] = await Promise.all([
    CarbonAssessment.find(buildAssessmentFilterForUser(userContext, startDate, endDate))
      .sort({ 'period.endDate': -1, createdAt: -1 })
      .lean(),
    Transaction.find(buildTransactionFilterForUser(userContext, startDate, endDate)).lean(),
    Document.find({
      ...(userContext.organizationId
        ? { $or: [{ organizationId: userContext.organizationId }, ...(userContext.msmeId ? [{ msmeId: userContext.msmeId }] : [])] }
        : { msmeId: userContext.msmeId }),
      documentType: 'bill',
      createdAt: { $gte: startDate, $lte: endDate }
    })
      .select('_id fileName originalName documentType status createdAt extractedData')
      .lean()
  ]);

  let latestAssessment = assessments[0] || null;
  if (!latestAssessment && transactions.length > 0) {
    const calculated = await carbonCalculationService.calculateMSMECarbonFootprintAsync(
      msmeAlias,
      transactions
    );
    latestAssessment = { ...calculated, period: { startDate, endDate } };
  }

  let carbonCreditsSummary = {};
  if (userContext.msmeId) {
    try {
      const account = await carbonCreditsService.getMSMECredits(userContext.msmeId);
      carbonCreditsSummary = carbonCreditsService.getCreditSummary(account);
    } catch {
      carbonCreditsSummary = {};
    }
  }

  const brsrReport = buildBRSRReport({
    msme: msmeAlias,
    assessment: latestAssessment || {
      period: { startDate, endDate },
      totalCO2Emissions: 0,
      breakdown: {}
    },
    assessmentHistory: assessments.slice(1, 8),
    transactions,
    billAnnexure: bills,
    carbonCreditsSummary,
    carbonCreditsAccount: null,
    requestedPeriod: period
  });

  const valueChain = buildValueChainReport({ msme: msmeAlias, transactions });
  const scopes = sumScopeFromBreakdown(latestAssessment?.breakdown || brsrReport?.emissions || {});
  const totalKg = safeRound(
    latestAssessment?.totalCO2Emissions ?? brsrReport?.emissions?.totalGHG ?? 0
  );

  return {
    msme: msmeAlias,
    segment: operational.segment,
    period,
    startDate,
    endDate,
    transactions,
    bills,
    latestAssessment,
    brsrReport,
    valueChain,
    scopes,
    totalKg,
    carbonCreditsSummary
  };
};

const getIndiaTrackForUser = async (userContext, period = 'annual') => {
  const context = await loadOrgReportingContext(userContext, period);
  if (!context) {
    return null;
  }
  const hubRecord = await ensureOrgHubRecord(userContext);
  const patIntensity = buildPatStyleIntensity(context.msme, context.transactions, context.totalKg);
  const assurance = await buildAssuranceWorkflow(context, hubRecord);
  const zedCertification = buildZedCertificationPack(context, hubRecord);

  return {
    track: 'india',
    segment: context.segment,
    period,
    generatedAt: new Date().toISOString(),
    readiness: {
      brsrCore: (context.brsrReport?.compliance?.disclosurePrepReady
        ?? context.brsrReport?.compliance?.isBRSRCompliant) ? 'aligned' : 'needs_improvement',
      isoAssurance: assurance.overallReadinessScore >= 75 ? 'ready' : 'in_progress',
      patIntensity: patIntensity.energySharePercent > 0 ? 'data_available' : 'needs_activity_data',
      sbti: hubRecord.sbtiTargets?.status || 'not_started',
      zedCertification: resolveZedReadinessStatus(zedCertification),
      accountingSync: (await buildAccountingSyncStatus({
        msmeId: context.msme?._id,
        organizationId: context.organizationId,
        legalName: context.msme?.companyName
      })).some((c) => c.syncReady) ? 'connected' : 'import_only'
    },
    modules: {
      brsrCoreSupplierPack: buildBrsrCoreSupplierPack(context, hubRecord),
      iso14064Assurance: assurance,
      patEnergyIntensity: patIntensity,
      sbtiTargets: hubRecord.sbtiTargets,
      actionPlans: hubRecord.actionPlans,
      productFootprints: hubRecord.productFootprints,
      zedCertification,
      zedCertificationProfile: hubRecord.zedCertification,
      indianCarbonMarket: await buildIndianCarbonMarketPack(
        context,
        context.msme?._id?.toString?.() || context.msme?.id
      ),
      accountingSync: await buildAccountingSyncStatus({
        msmeId: context.msme?._id,
        organizationId: context.organizationId,
        legalName: context.msme?.companyName
      })
    },
    hubRecordId: hubRecord._id
  };
};

const getExportTrackForUser = async (userContext, period = 'annual') => {
  const context = await loadOrgReportingContext(userContext, period);
  if (!context) {
    return null;
  }
  const hubRecord = await ensureOrgHubRecord(userContext);
  const patIntensity = buildPatStyleIntensity(context.msme, context.transactions, context.totalKg);
  context.patIntensity = patIntensity;
  context.hubSbti = hubRecord.sbtiTargets;

  const eudr = buildEudrPack(context, hubRecord);
  const csrdSupplier = buildCsrdSupplierPack(context);
  const cdpClimate = buildCdpPack(context);
  const tcfdIssb = buildTcfdIssbPack(context);
  const ecovadis = buildEcovadisPack(context, hubRecord);

  return {
    track: 'export',
    segment: context.segment,
    period,
    generatedAt: new Date().toISOString(),
    exportProfile: hubRecord.exportProfile,
    readiness: {
      cbam: hubRecord.exportProfile?.cbamGoodsCategories?.length ? 'configured' : 'review_required',
      productPcf: hubRecord.productFootprints?.length ? 'products_registered' : 'needs_products',
      csrd: context.totalKg > 0 ? 'datapoints_available' : 'needs_inventory',
      cdp: context.totalKg > 0 ? 'datapoints_available' : 'needs_inventory',
      tcfd: 'template_ready',
      supplierPortal: hubRecord.supplierQuestionnaires?.length ? 'active' : 'empty',
      eudr: eudr.applicable ? 'applicable' : 'not_applicable',
      ecovadis: 'template_ready'
    },
    modules: {
      cbamExporter: buildCbamExporterPack(context, hubRecord),
      productFootprints: hubRecord.productFootprints,
      csrdSupplier,
      cdpClimate,
      tcfdIssb,
      supplierQuestionnaires: hubRecord.supplierQuestionnaires,
      eudr,
      ecovadis
    },
    packValidation: {
      csrdSupplier: validateCompliancePack(csrdSupplier, 'csrd'),
      cdpClimate: validateCompliancePack(cdpClimate, 'cdp'),
      tcfdIssb: validateCompliancePack(tcfdIssb, 'tcfd'),
      eudr: validateCompliancePack(eudr, 'eudr'),
      ecovadis: validateCompliancePack(ecovadis, 'ecovadis')
    },
    hubRecordId: hubRecord._id
  };
};

const getHubOverviewForUser = async (userContext, period = 'annual') => {
  const [india, exportTrack] = await Promise.all([
    getIndiaTrackForUser(userContext, period),
    getExportTrackForUser(userContext, period)
  ]);
  if (!india || !exportTrack) {
    return null;
  }

  return {
    period,
    segment: india.segment,
    generatedAt: new Date().toISOString(),
    companyName: india.modules.brsrCoreSupplierPack.supplier.companyName,
    indiaReadiness: india.readiness,
    exportReadiness: exportTrack.readiness,
    totalEmissionsKgCo2e: india.modules.brsrCoreSupplierPack.ghgInventory.totalKgCo2e
  };
};

const getIndiaTrack = async (msmeId, period = 'annual') => {
  const context = await loadMsmeReportingContext(msmeId, period);
  if (!context) {
    return null;
  }
  const hubRecord = await ensureHubRecord(msmeId);
  const patIntensity = buildPatStyleIntensity(context.msme, context.transactions, context.totalKg);
  const assurance = await buildAssuranceWorkflow(context, hubRecord);
  const zedCertification = buildZedCertificationPack(context, hubRecord);

  return {
    track: 'india',
    period,
    generatedAt: new Date().toISOString(),
    readiness: {
      brsrCore: (context.brsrReport?.compliance?.disclosurePrepReady
        ?? context.brsrReport?.compliance?.isBRSRCompliant) ? 'aligned' : 'needs_improvement',
      isoAssurance: assurance.overallReadinessScore >= 75 ? 'ready' : 'in_progress',
      patIntensity: patIntensity.energySharePercent > 0 ? 'data_available' : 'needs_activity_data',
      sbti: hubRecord.sbtiTargets?.status || 'not_started',
      zedCertification: resolveZedReadinessStatus(zedCertification),
      accountingSync: (await buildAccountingSyncStatus({ msmeId: context.msme?._id || msmeId, organizationId: context.organizationId, legalName: context.msme?.companyName })).some((c) => c.syncReady) ? 'connected' : 'import_only'
    },
    modules: {
      brsrCoreSupplierPack: buildBrsrCoreSupplierPack(context, hubRecord),
      iso14064Assurance: assurance,
      patEnergyIntensity: patIntensity,
      sbtiTargets: hubRecord.sbtiTargets,
      actionPlans: hubRecord.actionPlans,
      productFootprints: hubRecord.productFootprints,
      zedCertification,
      zedCertificationProfile: hubRecord.zedCertification,
      indianCarbonMarket: await buildIndianCarbonMarketPack(context, msmeId),
      accountingSync: await buildAccountingSyncStatus({ msmeId: context.msme?._id || msmeId, organizationId: context.organizationId, legalName: context.msme?.companyName })
    },
    hubRecordId: hubRecord._id
  };
};

const getExportTrack = async (msmeId, period = 'annual') => {
  const context = await loadMsmeReportingContext(msmeId, period);
  if (!context) {
    return null;
  }
  const hubRecord = await ensureHubRecord(msmeId);
  const patIntensity = buildPatStyleIntensity(context.msme, context.transactions, context.totalKg);
  context.patIntensity = patIntensity;
  context.hubSbti = hubRecord.sbtiTargets;

  const eudr = buildEudrPack(context, hubRecord);
  const csrdSupplier = buildCsrdSupplierPack(context);
  const cdpClimate = buildCdpPack(context);
  const tcfdIssb = buildTcfdIssbPack(context);
  const ecovadis = buildEcovadisPack(context, hubRecord);

  return {
    track: 'export',
    period,
    generatedAt: new Date().toISOString(),
    exportProfile: hubRecord.exportProfile,
    readiness: {
      cbam: hubRecord.exportProfile?.cbamGoodsCategories?.length ? 'configured' : 'review_required',
      productPcf: hubRecord.productFootprints?.length ? 'products_registered' : 'needs_products',
      csrd: context.totalKg > 0 ? 'datapoints_available' : 'needs_inventory',
      cdp: context.totalKg > 0 ? 'datapoints_available' : 'needs_inventory',
      tcfd: 'template_ready',
      supplierPortal: hubRecord.supplierQuestionnaires?.length ? 'active' : 'empty',
      eudr: eudr.applicable ? 'applicable' : 'not_applicable',
      ecovadis: 'template_ready'
    },
    modules: {
      cbamExporter: buildCbamExporterPack(context, hubRecord),
      productFootprints: hubRecord.productFootprints,
      csrdSupplier,
      cdpClimate,
      tcfdIssb,
      supplierQuestionnaires: hubRecord.supplierQuestionnaires,
      eudr,
      ecovadis
    },
    packValidation: {
      csrdSupplier: validateCompliancePack(csrdSupplier, 'csrd'),
      cdpClimate: validateCompliancePack(cdpClimate, 'cdp'),
      tcfdIssb: validateCompliancePack(tcfdIssb, 'tcfd'),
      eudr: validateCompliancePack(eudr, 'eudr'),
      ecovadis: validateCompliancePack(ecovadis, 'ecovadis')
    },
    hubRecordId: hubRecord._id
  };
};

const getHubOverview = async (msmeId, period = 'annual') => {
  const [india, exportTrack] = await Promise.all([
    getIndiaTrack(msmeId, period),
    getExportTrack(msmeId, period)
  ]);
  if (!india || !exportTrack) {
    return null;
  }

  return {
    period,
    generatedAt: new Date().toISOString(),
    companyName: india.modules.brsrCoreSupplierPack.supplier.companyName,
    indiaReadiness: india.readiness,
    exportReadiness: exportTrack.readiness,
    totalEmissionsKgCo2e: india.modules.brsrCoreSupplierPack.ghgInventory.totalKgCo2e
  };
};

module.exports = {
  ensureHubRecord,
  ensureOrgHubRecord,
  getHubOverview,
  getHubOverviewForUser,
  getIndiaTrack,
  getIndiaTrackForUser,
  getExportTrack,
  getExportTrackForUser,
  loadMsmeReportingContext,
  loadOrgReportingContext,
  buildAssessmentFilterForUser,
  buildTransactionFilterForUser,
  buildAccountingSyncStatus
};
