const {
  ZED_PARAMETERS,
  ZED_PARAMETER_PILLARS,
  ZED_CERTIFICATION_LEVELS,
  ZED_MATURITY_STAGES,
  resolveZedCertificationLevel,
  calculateZedSubsidy
} = require('../../../shared/zedCertification');

const asArray = (value) => (Array.isArray(value) ? value : []);

const safeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const hasCertification = (certifications, keywords) => {
  const certs = asArray(certifications).map(normalizeText);
  return keywords.some((keyword) => certs.some((cert) => cert.includes(keyword)));
};

const buildParameterItem = ({
  parameter,
  maturityStage = 'not_defined',
  autoDetected = false,
  evidence = [],
  notes = ''
}) => {
  const stage = ZED_MATURITY_STAGES.find((entry) => entry.id === maturityStage)
    || ZED_MATURITY_STAGES[0];
  return {
    id: parameter.id,
    code: parameter.code,
    title: parameter.title,
    pillar: parameter.pillar,
    description: parameter.description,
    evidenceHints: parameter.evidenceHints,
    maturityStage: stage.id,
    maturityLabel: stage.label,
    maturityScore: stage.score,
    status: stage.score >= 75 ? 'complete' : stage.score >= 25 ? 'in_progress' : 'gap',
    autoDetected,
    evidence,
    notes
  };
};

const detectParameterMaturity = (parameterId, context = {}) => {
  const {
    msme = {},
    manufacturingProfile = {},
    environmentalCompliance = {},
    documents = [],
    hubZed = {},
    workflow = {}
  } = context;

  const certifications = [
    ...asArray(manufacturingProfile.certifications),
    ...asArray(manufacturingProfile.complianceCertifications),
    ...asArray(msme.certifications)
  ];
  const stored = (hubZed.parameterScores || []).find((entry) => entry.id === parameterId);
  if (stored?.maturityStage && stored.maturityStage !== 'not_defined') {
    return {
      maturityStage: stored.maturityStage,
      autoDetected: false,
      evidence: asArray(stored.evidence),
      notes: stored.notes || ''
    };
  }

  const hasWorkflow = asArray(workflow.units).length > 0
    || asArray(workflow.processes).length > 0;
  const hasDocuments = documents.length > 0;
  const hasUdyam = Boolean(msme.udyamRegistrationNumber);
  const hasEnergyData = safeNumber(manufacturingProfile.powerConsumptionKwhPerMonth) > 0;
  const hasWaterData = safeNumber(manufacturingProfile.waterConsumptionKlPerMonth) > 0
    || Boolean(manufacturingProfile.waterSource);
  const hasWastePractice = Boolean(manufacturingProfile.wasteManagementPractice);
  const hasProducts = asArray(manufacturingProfile.keyProducts).length > 0;
  const hasDigitalization = Boolean(manufacturingProfile.digitalizationLevel);
  const hasEsgMaturity = Boolean(manufacturingProfile.esgMaturityLevel);
  const hasEnvClearance = environmentalCompliance.hasEnvironmentalClearance === true;
  const hasPcb = environmentalCompliance.hasPollutionControlBoard === true;
  const hasWasteMgmt = environmentalCompliance.hasWasteManagement === true;
  const hasSolar = safeNumber(manufacturingProfile.solarInstallationKw) > 0;
  const hasIso9001 = hasCertification(certifications, ['iso 9001', 'iso9001']);
  const hasIso14001 = hasCertification(certifications, ['iso 14001', 'iso14001']);
  const hasIso50001 = hasCertification(certifications, ['iso 50001', 'iso50001']);
  const hasZed = Boolean(resolveZedCertificationLevel(certifications)) || hubZed.pledgeTaken === true;

  const detectors = {
    '1': () => (hasZed || hasEsgMaturity ? 'implemented' : hasUdyam ? 'defined' : 'not_defined'),
    '2': () => (hasIso9001 ? 'monitored' : hasWorkflow ? 'implemented' : hasProducts ? 'defined' : 'not_defined'),
    '3': () => (hasCertification(certifications, ['ohsas', 'iso 45001']) ? 'monitored' : hasWorkflow ? 'defined' : 'not_defined'),
    '4': () => (hasProducts ? 'implemented' : 'not_defined'),
    '5': () => (hasWorkflow ? 'implemented' : 'not_defined'),
    '6': () => {
      if (hasIso50001 || hasSolar) return 'monitored';
      if (hasEnergyData) return 'implemented';
      return 'not_defined';
    },
    '7': () => {
      if (hasIso14001 && hasPcb) return 'monitored';
      if (hasEnvClearance || hasPcb) return 'implemented';
      return 'not_defined';
    },
    '8': () => (hasProducts || safeNumber(manufacturingProfile.importedRawMaterialsKgPerMonth) > 0
      ? 'implemented'
      : 'not_defined'),
    '9': () => (hasProducts ? 'defined' : 'not_defined'),
    '10': () => (hasWorkflow ? 'implemented' : hasProducts ? 'defined' : 'not_defined'),
    '11': () => (hasWorkflow ? 'implemented' : 'not_defined'),
    '12': () => (hasIso9001 ? 'monitored' : hasWorkflow ? 'defined' : 'not_defined'),
    '13': () => {
      if (hasWasteMgmt && hasWastePractice) return 'monitored';
      if (hasWastePractice || safeNumber(manufacturingProfile.wasteRecycledKgPerMonth) > 0) return 'implemented';
      return 'not_defined';
    },
    '14': () => (hasWaterData ? 'implemented' : 'not_defined'),
    '15': () => (hasEsgMaturity ? 'defined' : 'not_defined'),
    '16': () => (safeNumber(manufacturingProfile.outputProductsKgPerMonth) > 0 ? 'defined' : 'not_defined'),
    '17': () => {
      const level = normalizeText(manufacturingProfile.digitalizationLevel);
      if (level.includes('advanced') || level.includes('high')) return 'monitored';
      if (hasDigitalization) return 'implemented';
      return 'not_defined';
    },
    '18': () => (safeNumber(msme.numberOfEmployees) > 0 ? 'defined' : 'not_defined'),
    '19': () => (hasEsgMaturity ? 'defined' : 'not_defined'),
    '20': () => (hasIso9001 || hasIso14001 ? 'implemented' : hasDocuments ? 'defined' : 'not_defined')
  };

  const maturityStage = (detectors[parameterId] || (() => 'not_defined'))();
  const evidence = [];
  if (hasDocuments) evidence.push('platform_documents');
  if (hasWorkflow) evidence.push('manufacturing_workflow');
  if (hasUdyam) evidence.push('udyam_registration');

  return {
    maturityStage,
    autoDetected: true,
    evidence,
    notes: ''
  };
};

const resolveTargetLevel = (readinessPercent, currentLevel) => {
  if (currentLevel) return currentLevel;
  const sorted = [...ZED_CERTIFICATION_LEVELS].sort(
    (a, b) => b.minReadinessPercent - a.minReadinessPercent
  );
  const match = sorted.find((level) => readinessPercent >= level.minReadinessPercent);
  return match?.id || 'bronze';
};

const buildZedReadinessPack = (input = {}) => {
  const msme = input.msme || input.msmeData || {};
  const manufacturingProfile = msme.manufacturingProfile || input.manufacturingProfile || {};
  const environmentalCompliance = msme.environmentalCompliance || input.environmentalCompliance || {};
  const hubZed = input.hubZed || input.zedCertification || {};
  const workflow = msme.business?.manufacturingWorkflow || input.workflow || {};
  const documents = asArray(input.documents);

  const certifications = [
    ...asArray(manufacturingProfile.certifications),
    ...asArray(manufacturingProfile.complianceCertifications),
    ...asArray(msme.certifications)
  ];
  const certifiedLevel = hubZed.certifiedLevel || resolveZedCertificationLevel(certifications);
  const targetLevel = hubZed.targetLevel || certifiedLevel || 'bronze';

  const parameters = ZED_PARAMETERS.map((parameter) => {
    const detection = detectParameterMaturity(parameter.id, {
      msme,
      manufacturingProfile,
      environmentalCompliance,
      documents,
      hubZed,
      workflow
    });
    return buildParameterItem({
      parameter,
      ...detection
    });
  });

  const pillarScores = ZED_PARAMETER_PILLARS.map((pillar) => {
    const pillarParams = parameters.filter((param) => param.pillar === pillar.id);
    const avgScore = pillarParams.length > 0
      ? pillarParams.reduce((sum, param) => sum + param.maturityScore, 0) / pillarParams.length
      : 0;
    return {
      id: pillar.id,
      label: pillar.label,
      parameterCount: pillarParams.length,
      readinessScore: Math.round(avgScore),
      gaps: pillarParams.filter((param) => param.status === 'gap').length
    };
  });

  const overallReadinessScore = Math.round(
    parameters.reduce((sum, param) => sum + param.maturityScore, 0) / Math.max(parameters.length, 1)
  );

  const openGaps = parameters
    .filter((param) => param.status !== 'complete')
    .map((param) => ({
      id: param.id,
      code: param.code,
      title: param.title,
      pillar: param.pillar,
      maturityStage: param.maturityStage,
      evidenceHints: param.evidenceHints
    }));

  const recommendedTargetLevel = resolveTargetLevel(overallReadinessScore, certifiedLevel);
  const nextLevel = ZED_CERTIFICATION_LEVELS.find(
    (level) => level.minReadinessPercent > overallReadinessScore
  );

  const companyType = normalizeText(msme.companyType || manufacturingProfile.msmeType || 'micro');
  const subsidyEstimate = calculateZedSubsidy({
    companyType: ['micro', 'small', 'medium'].includes(companyType) ? companyType : 'micro',
    targetLevel,
    isWomenOrScStOwned: hubZed.isWomenOrScStOwned === true,
    isInPriorityRegion: hubZed.isInPriorityRegion === true,
    isInClusterProgramme: Boolean(manufacturingProfile.clusterAssociation || manufacturingProfile.adeetieClusterId)
  });

  const journeyStatus = certifiedLevel
    ? 'certified'
    : hubZed.pledgeTaken
      ? overallReadinessScore >= (ZED_CERTIFICATION_LEVELS.find((l) => l.id === targetLevel)?.minReadinessPercent || 40)
        ? 'ready_for_assessment'
        : 'in_progress'
      : hubZed.journeyStatus || 'not_started';

  const priorityActions = openGaps.slice(0, 8).map((gap, index) => ({
    priority: index < 3 ? 'high' : index < 6 ? 'medium' : 'low',
    parameterCode: gap.code,
    action: `Strengthen parameter ${gap.code}: ${gap.title}`,
    detail: `Move from ${gap.maturityStage.replace(/_/g, ' ')} toward reviewed & improved. Evidence: ${gap.evidenceHints.slice(0, 2).join(', ')}.`
  }));

  const eligibility = {
    eligible: Boolean(msme.udyamRegistrationNumber)
      && normalizeText(msme.businessDomain).includes('manufactur'),
    udyamRegistered: Boolean(msme.udyamRegistrationNumber),
    manufacturingSector: normalizeText(msme.businessDomain).includes('manufactur')
      || normalizeText(msme.industry).includes('manufactur'),
    portalUrl: 'https://zed.msme.gov.in/',
    registrationNote: 'ZED registration is free and paperless on the official MoMSME portal. Certification fees apply only through authorised assessment agencies.'
  };

  return {
    generatedAt: new Date().toISOString(),
    scheme: 'MSME Sustainable (ZED)',
    eligibility,
    journeyStatus,
    pledgeTaken: hubZed.pledgeTaken === true,
    certifiedLevel,
    targetLevel,
    recommendedTargetLevel,
    nextLevelTarget: nextLevel
      ? { id: nextLevel.id, label: nextLevel.label, minReadinessPercent: nextLevel.minReadinessPercent }
      : null,
    overallReadinessScore,
    pillarScores,
    parameters,
    openGaps,
    priorityActions,
    subsidyEstimate,
    certificationLevels: ZED_CERTIFICATION_LEVELS,
    assessmentAgencyNote: 'Desktop and/or on-site assessment by NABCB-accredited agency required for certification.',
    zeroEffectAlignment: {
      energyManagementScore: parameters.find((p) => p.id === '6')?.maturityScore || 0,
      environmentManagementScore: parameters.find((p) => p.id === '7')?.maturityScore || 0,
      wasteManagementScore: parameters.find((p) => p.id === '13')?.maturityScore || 0,
      waterConservationScore: parameters.find((p) => p.id === '14')?.maturityScore || 0,
      platformCarbonDataAvailable: safeNumber(input.totalEmissionsKg) > 0
    },
    zeroDefectAlignment: {
      qmsScore: parameters.find((p) => p.id === '2')?.maturityScore || 0,
      processControlScore: parameters.find((p) => p.id === '11')?.maturityScore || 0,
      qualityInspectionScore: parameters.find((p) => p.id === '12')?.maturityScore || 0,
      manufacturingWorkflowConfigured: asArray(workflow.units).length > 0
    }
  };
};

module.exports = {
  buildZedReadinessPack,
  detectParameterMaturity,
  buildParameterItem
};
