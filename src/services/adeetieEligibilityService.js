const CarbonAssessment = require('../models/CarbonAssessment');
const Recommendation = require('../models/Recommendation');
const {
  ADEETIE_SCHEME_CODE,
  ADEETIE_PORTAL_URL,
  ADEETIE_PIB_URL,
  LOAN_AMOUNT_MIN_INR,
  LOAN_AMOUNT_MAX_INR,
  MIN_ENERGY_SAVINGS_PERCENT,
  MAX_DEBT_FUNDING_PERCENT,
  SCHEME_FY_START,
  SCHEME_FY_END,
  SUBVENTION_RATES,
  BEE_SECTORS,
  PHASE1_CLUSTERS,
  JOURNEY_STAGES,
  BUSINESS_DOMAIN_TO_BEE_SECTOR,
  INDUSTRY_KEYWORD_TO_BEE_SECTOR
} = require('../config/adeetie');

const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const inferBeeSector = (msme) => {
  const profile = msme.manufacturingProfile || {};
  if (profile.beeSector) {
    return profile.beeSector;
  }
  const fromDomain = BUSINESS_DOMAIN_TO_BEE_SECTOR[msme.businessDomain];
  if (fromDomain) {
    return fromDomain;
  }
  const industryText = `${msme.industry || ''} ${profile.industrySector || ''} ${profile.clusterAssociation || ''}`;
  for (const { pattern, sectorId } of INDUSTRY_KEYWORD_TO_BEE_SECTOR) {
    if (pattern.test(industryText)) {
      return sectorId;
    }
  }
  return null;
};

const getClusterRecord = (msme) => {
  const profile = msme.manufacturingProfile || {};
  const clusterId = profile.adeetieClusterId;
  if (clusterId) {
    return PHASE1_CLUSTERS.find((c) => c.id === clusterId) || null;
  }
  const association = (profile.clusterAssociation || '').toLowerCase();
  if (!association) {
    return null;
  }
  return PHASE1_CLUSTERS.find(
    (c) => association.includes(c.name.toLowerCase()) || association.includes(c.id.replace(/-/g, ' '))
  ) || null;
};

const getEnergyShareFromAssessment = (assessment) => {
  if (!assessment) {
    return 0;
  }
  const breakdown = assessment.breakdown || {};
  const energyTotal = Number(breakdown.energy?.total || 0);
  const total = Number(assessment.totalCO2Emissions || 0);
  if (total <= 0) {
    return energyTotal > 0 ? 0.35 : 0;
  }
  return energyTotal / total;
};

const estimateEnergySavingsPercent = (msme, assessment, recommendations = []) => {
  const profile = msme.manufacturingProfile || {};
  let estimate = 0;

  if (profile.solarInstallationKw > 0) {
    estimate += 5;
  }
  if (profile.solarGenerationKwhPerMonth > 0 && profile.powerConsumptionKwhPerMonth > 0) {
    const solarShare = Math.min(
      1,
      profile.solarGenerationKwhPerMonth / profile.powerConsumptionKwhPerMonth
    );
    estimate += Math.round(solarShare * 15);
  }

  const energyRecs = recommendations.filter(
    (r) => /energy|solar|efficien|electric/i.test(`${r.title || ''} ${r.description || ''} ${r.category || ''}`)
  );
  const implementedEnergy = energyRecs.filter((r) => r.status === 'implemented').length;
  estimate += Math.min(12, implementedEnergy * 4);

  if (assessment?.carbonSavings?.savingsPercentage) {
    estimate = Math.max(estimate, Number(assessment.carbonSavings.savingsPercentage) * 0.6);
  }

  const energyShare = getEnergyShareFromAssessment(assessment);
  if (energyShare > 0.35) {
    estimate += 8;
  } else if (energyShare > 0.2) {
    estimate += 4;
  }

  return Math.min(50, Math.round(estimate));
};

const buildCriterion = (id, label, passed, required, current, hint = null) => ({
  id,
  label,
  passed: Boolean(passed),
  required,
  current,
  hint: passed ? null : hint
});

const evaluateEligibility = (msme, options = {}) => {
  const loanAmount = options.loanAmount != null ? Number(options.loanAmount) : null;
  const profile = msme.manufacturingProfile || {};
  const beeSector = inferBeeSector(msme);
  const cluster = getClusterRecord(msme);
  const subventionRate = SUBVENTION_RATES[msme.companyType] ?? null;

  const criteria = [
    buildCriterion(
      'udyam',
      'Valid Udyam registration',
      UDYAM_REGEX.test(String(msme.udyamRegistrationNumber || '').trim()),
      true,
      msme.udyamRegistrationNumber || null,
      'Register on the Udyam portal and add your UDYAM number to your profile.'
    ),
    buildCriterion(
      'gst',
      'Valid GST registration',
      GST_REGEX.test(String(msme.gstNumber || '').trim()),
      true,
      msme.gstNumber ? `${String(msme.gstNumber).slice(0, 4)}…` : null,
      'GST registration is required under ADEETIE guidelines.'
    ),
    buildCriterion(
      'company_type',
      'MSME classification (Micro / Small / Medium)',
      ['micro', 'small', 'medium'].includes(msme.companyType),
      true,
      msme.companyType,
      null
    ),
    buildCriterion(
      'bee_sector',
      'Energy-intensive sector (BEE Phase-1 list)',
      Boolean(beeSector && BEE_SECTORS.some((s) => s.id === beeSector)),
      true,
      beeSector,
      'Set your BEE sector in manufacturing profile or choose a matching industry.'
    ),
    buildCriterion(
      'phase1_cluster',
      'Located in a Phase-1 industrial cluster',
      Boolean(cluster),
      true,
      cluster ? cluster.name : profile.clusterAssociation || null,
      'Select your ADEETIE cluster from the Phase-1 list in your profile.'
    ),
    buildCriterion(
      'sector_cluster_match',
      'Cluster aligns with sector',
      !cluster || !beeSector || cluster.sectorId === beeSector,
      true,
      cluster && beeSector ? `${cluster.sectorId} / ${beeSector}` : null,
      'Pick a cluster that matches your BEE sector.'
    )
  ];

  if (loanAmount != null && Number.isFinite(loanAmount)) {
    criteria.push(
      buildCriterion(
        'loan_amount',
        `Loan between ₹10 lakh and ₹15 crore`,
        loanAmount >= LOAN_AMOUNT_MIN_INR && loanAmount <= LOAN_AMOUNT_MAX_INR,
        true,
        loanAmount,
        `Eligible loan band is ₹${(LOAN_AMOUNT_MIN_INR / 1e5).toFixed(0)} lakh – ₹${(LOAN_AMOUNT_MAX_INR / 1e7).toFixed(0)} crore.`
      )
    );
  }

  const isEligible = criteria.every((c) => c.passed);

  return {
    schemeCode: ADEETIE_SCHEME_CODE,
    isEligible,
    subventionRatePercent: subventionRate,
    beeSector,
    cluster,
    criteria,
    missingFields: criteria.filter((c) => !c.passed).map((c) => c.id),
    links: {
      portal: ADEETIE_PORTAL_URL,
      pib: ADEETIE_PIB_URL
    },
    schemePeriod: `${SCHEME_FY_START} to ${SCHEME_FY_END}`
  };
};

const computeReadinessScore = async (msme) => {
  const latestAssessment = await CarbonAssessment.findOne({ msmeId: msme._id })
    .sort({ createdAt: -1 })
    .lean();

  const recommendations = await Recommendation.find({ msmeId: msme._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const profile = msme.manufacturingProfile || {};
  const eligibility = evaluateEligibility(msme);
  const estimatedSavingsPercent = estimateEnergySavingsPercent(msme, latestAssessment, recommendations);
  const gapToTarget = Math.max(0, MIN_ENERGY_SAVINGS_PERCENT - estimatedSavingsPercent);

  let score = 0;
  const factors = [];

  if (eligibility.criteria.find((c) => c.id === 'udyam')?.passed) {
    score += 15;
    factors.push({ id: 'udyam', label: 'Udyam registered', points: 15 });
  }
  if (eligibility.criteria.find((c) => c.id === 'gst')?.passed) {
    score += 10;
    factors.push({ id: 'gst', label: 'GST on file', points: 10 });
  }
  if (eligibility.beeSector) {
    score += 15;
    factors.push({ id: 'sector', label: 'BEE sector identified', points: 15 });
  }
  if (eligibility.cluster) {
    score += 15;
    factors.push({ id: 'cluster', label: 'Phase-1 cluster selected', points: 15 });
  }
  if (latestAssessment) {
    score += 20;
    factors.push({ id: 'assessment', label: 'Carbon assessment completed', points: 20 });
  }
  if (profile.powerConsumptionKwhPerMonth > 0) {
    score += 10;
    factors.push({ id: 'energy_data', label: 'Monthly power consumption recorded', points: 10 });
  }
  if (estimatedSavingsPercent >= MIN_ENERGY_SAVINGS_PERCENT) {
    score += 15;
    factors.push({ id: 'savings_target', label: '≥10% energy savings pathway', points: 15 });
  } else if (estimatedSavingsPercent >= 5) {
    score += 8;
    factors.push({ id: 'savings_partial', label: 'Partial savings pathway', points: 8 });
  }

  const energyRecommendations = recommendations
    .filter((r) => /energy|solar|efficien/i.test(`${r.title} ${r.description}`))
    .slice(0, 5)
    .map((r) => ({
      id: r._id,
      title: r.title,
      status: r.status,
      potentialCO2Reduction: r.potentialCO2Reduction
    }));

  return {
    readinessScore: Math.min(100, score),
    estimatedEnergySavingsPercent: estimatedSavingsPercent,
    minRequiredSavingsPercent: MIN_ENERGY_SAVINGS_PERCENT,
    gapToTargetPercent: gapToTarget,
    eligibility,
    latestAssessmentId: latestAssessment?._id || null,
    energyRecommendations,
    factors
  };
};

const calculateSubvention = ({
  loanAmount,
  companyType,
  nominalInterestRatePercent = 12,
  tenureYears = 3
}) => {
  const principal = Number(loanAmount);
  const nominalRate = Number(nominalInterestRatePercent);
  const years = Number(tenureYears);
  const subventionRate = SUBVENTION_RATES[companyType];

  if (!subventionRate || !Number.isFinite(principal) || principal <= 0) {
    return {
      eligible: false,
      message: 'Invalid loan amount or company type for ADEETIE subvention.'
    };
  }

  const loanCheck = principal >= LOAN_AMOUNT_MIN_INR && principal <= LOAN_AMOUNT_MAX_INR;
  const effectiveRate = Math.max(0, nominalRate - subventionRate);
  const annualSubventionInr = Math.round((principal * subventionRate) / 100);
  const totalSubventionInr = annualSubventionInr * years;
  const maxDebtEligibleInr = Math.round(principal * (MAX_DEBT_FUNDING_PERCENT / 100));

  const monthlyNominal = (principal * (nominalRate / 100)) / 12;
  const monthlyEffective = (principal * (effectiveRate / 100)) / 12;
  const monthlySavingsInr = Math.round(monthlyNominal - monthlyEffective);

  return {
    eligible: loanCheck,
    loanAmountInr: principal,
    companyType,
    subventionRatePercent: subventionRate,
    nominalInterestRatePercent: nominalRate,
    effectiveInterestRatePercent: effectiveRate,
    tenureYears: years,
    annualSubventionInr,
    totalSubventionInr,
    monthlyInterestSavingsInr: monthlySavingsInr,
    maxDebtFundingPercent: MAX_DEBT_FUNDING_PERCENT,
    maxDebtEligibleInr,
    disclaimer:
      'Indicative estimate only. Final subvention is subject to BEE/lender approval and verified ≥10% energy savings.'
  };
};

const buildDprBrief = async (msme) => {
  const readiness = await computeReadinessScore(msme);
  const profile = msme.manufacturingProfile || {};
  const latestAssessment = readiness.latestAssessmentId
    ? await CarbonAssessment.findById(readiness.latestAssessmentId).lean()
    : null;

  return {
    generatedAt: new Date().toISOString(),
    companyName: msme.companyName,
    companyType: msme.companyType,
    udyamRegistrationNumber: msme.udyamRegistrationNumber,
    beeSector: readiness.eligibility.beeSector,
    cluster: readiness.eligibility.cluster,
    operationalSnapshot: {
      powerConsumptionKwhPerMonth: profile.powerConsumptionKwhPerMonth,
      solarInstallationKw: profile.solarInstallationKw,
      solarGenerationKwhPerMonth: profile.solarGenerationKwhPerMonth,
      primaryEnergySource: profile.primaryEnergySource,
      location: {
        city: profile.locationCity || msme.contact?.address?.city,
        state: profile.locationState || msme.contact?.address?.state
      }
    },
    carbonAssessment: latestAssessment
      ? {
          assessmentId: latestAssessment._id,
          totalCO2Emissions: latestAssessment.totalCO2Emissions,
          carbonScore: latestAssessment.carbonScore,
          energyShare: getEnergyShareFromAssessment(latestAssessment)
        }
      : null,
    readiness: {
      score: readiness.readinessScore,
      estimatedEnergySavingsPercent: readiness.estimatedEnergySavingsPercent,
      gapToTargetPercent: readiness.gapToTargetPercent
    },
    recommendedMeasures: readiness.energyRecommendations,
    officialPortal: ADEETIE_PORTAL_URL
  };
};

const getSchemeMetadata = () => ({
  schemeCode: ADEETIE_SCHEME_CODE,
  schemeName: 'ADEETIE — Energy Efficient Technologies for MSMEs',
  ministry: 'Ministry of Power',
  implementer: 'Bureau of Energy Efficiency (BEE)',
  budgetOutlayCr: 1000,
  schemePeriod: `${SCHEME_FY_START} to ${SCHEME_FY_END}`,
  subventionRates: SUBVENTION_RATES,
  loanBand: { minInr: LOAN_AMOUNT_MIN_INR, maxInr: LOAN_AMOUNT_MAX_INR },
  minEnergySavingsPercent: MIN_ENERGY_SAVINGS_PERCENT,
  sectors: BEE_SECTORS,
  clusters: PHASE1_CLUSTERS,
  journeyStages: JOURNEY_STAGES,
  links: { portal: ADEETIE_PORTAL_URL, pib: ADEETIE_PIB_URL }
});

module.exports = {
  ADEETIE_SCHEME_CODE,
  inferBeeSector,
  evaluateEligibility,
  computeReadinessScore,
  calculateSubvention,
  buildDprBrief,
  getSchemeMetadata,
  estimateEnergySavingsPercent
};
