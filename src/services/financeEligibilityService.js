const CarbonAssessment = require('../models/CarbonAssessment');
const Recommendation = require('../models/Recommendation');
const GIFTScheme = require('../models/GIFTScheme');
const Bank = require('../models/Bank');
const UserIncentiveProfile = require('../models/UserIncentiveProfile');
const adeetieService = require('./adeetieEligibilityService');
const { ADEETIE_SCHEME_CODE } = require('../config/adeetie');

const GREEN_LOAN_MIN_CARBON_SAVINGS_PERCENT = 10;

const readinessStatus = (eligible, partial = false) => {
  if (eligible) {
    return 'ready';
  }
  if (partial) {
    return 'in_progress';
  }
  return 'not_started';
};

const buildEmissionsAchievements = async (msme) => {
  const assessments = await CarbonAssessment.find({ msmeId: msme._id })
    .sort({ createdAt: -1 })
    .limit(12)
    .lean();

  const latestAssessment = assessments[0] || null;
  const baselineAssessment = assessments.length > 1 ? assessments[assessments.length - 1] : null;

  const implementedRecommendations = await Recommendation.countDocuments({
    msmeId: msme._id,
    status: 'implemented'
  });

  const energyRecommendations = await Recommendation.countDocuments({
    msmeId: msme._id,
    status: 'implemented',
    $or: [
      { title: /energy|solar|efficien|electric/i },
      { description: /energy|solar|efficien|electric/i },
      { category: /energy|solar|efficien|electric/i }
    ]
  });

  const latestEmissions = Number(latestAssessment?.totalCO2Emissions || 0);
  const baselineEmissions = Number(baselineAssessment?.totalCO2Emissions || latestEmissions);
  const absoluteReductionKg =
    baselineEmissions > 0 && latestEmissions >= 0
      ? Math.max(0, baselineEmissions - latestEmissions)
      : 0;
  const reductionPercent =
    baselineEmissions > 0
      ? Math.round((absoluteReductionKg / baselineEmissions) * 1000) / 10
      : Number(latestAssessment?.carbonSavings?.savingsPercentage || 0);

  const carbonSavedKg = Number(latestAssessment?.carbonSavings?.totalSavings || absoluteReductionKg);
  const savingsPercent = Number(latestAssessment?.carbonSavings?.savingsPercentage || reductionPercent);
  const reductionTargetPct = Number(msme.sustainabilitySettings?.reductionTargetPct);
  const targetProgressPercent =
    Number.isFinite(reductionTargetPct) && reductionTargetPct > 0
      ? Math.min(100, Math.round((savingsPercent / reductionTargetPct) * 100))
      : null;

  return {
    assessmentCount: assessments.length,
    implementedRecommendations,
    energyRecommendationsImplemented: energyRecommendations,
    latestCarbonScore: latestAssessment?.carbonScore ?? null,
    latestEmissionsKg: latestEmissions,
    baselineEmissionsKg: baselineEmissions,
    absoluteReductionKg: Math.round(absoluteReductionKg),
    reductionPercent,
    carbonSavedKg: Math.round(carbonSavedKg),
    savingsPercent,
    reductionTargetPct: Number.isFinite(reductionTargetPct) ? reductionTargetPct : null,
    targetProgressPercent,
    hasAssessment: Boolean(latestAssessment),
    hasReductionHistory: savingsPercent >= GREEN_LOAN_MIN_CARBON_SAVINGS_PERCENT || reductionPercent >= 5
  };
};

const buildGreenLoanOption = async (msme, achievements) => {
  const banks = await Bank.find({ isActive: { $ne: false } }).limit(20).lean();
  const minCarbonScore = banks.length
    ? Math.min(...banks.map((bank) => bank.greenLoanPolicy?.minCarbonScore || 50))
    : 50;
  const carbonScore = achievements.latestCarbonScore ?? msme.carbonScore ?? 0;
  const scoreMet = carbonScore >= minCarbonScore;
  const savingsMet = achievements.savingsPercent >= GREEN_LOAN_MIN_CARBON_SAVINGS_PERCENT;
  const verified = Boolean(msme.isVerified);
  const isEligible = scoreMet && savingsMet && verified && achievements.hasAssessment;

  const criteria = [
    {
      id: 'carbon_score',
      label: `Carbon score at least ${minCarbonScore}`,
      passed: scoreMet,
      current: carbonScore,
      hint: 'Complete a carbon assessment and improve your score through reduction actions.'
    },
    {
      id: 'reduction_history',
      label: `Demonstrated ≥${GREEN_LOAN_MIN_CARBON_SAVINGS_PERCENT}% emissions reduction`,
      passed: savingsMet,
      current: `${achievements.savingsPercent}%`,
      hint: 'Implement recommendations and track progress on your emissions reduction target.'
    },
    {
      id: 'verified_profile',
      label: 'Verified MSME profile',
      passed: verified,
      current: verified ? 'Verified' : 'Pending',
      hint: 'Complete company profile verification under My company.'
    },
    {
      id: 'carbon_assessment',
      label: 'At least one carbon assessment on file',
      passed: achievements.hasAssessment,
      current: achievements.assessmentCount,
      hint: 'Run a carbon footprint assessment to unlock lender-ready summaries.'
    }
  ];

  return {
    id: 'green_loans',
    title: 'Green loans',
    description: 'Bank-backed finance for solar, efficiency, and other green projects.',
    path: '/green-loans',
    category: 'finance',
    isEligible,
    status: readinessStatus(isEligible, scoreMet || achievements.hasReductionHistory),
    criteria,
    highlights: banks.slice(0, 3).map((bank) => bank.bankName),
    ctaLabel: isEligible ? 'Apply for loan' : 'Check eligibility'
  };
};

const buildGiftSchemesOption = async (msme, achievements) => {
  const schemes = await GIFTScheme.find({ status: 'active' }).limit(50).lean();
  let eligibleCount = 0;
  const partialCount = schemes.filter((scheme) => {
    const carbonScore = achievements.latestCarbonScore ?? msme.carbonScore ?? 0;
    const carbonPassed = carbonScore >= (scheme.eligibilityCriteria?.minCarbonScore || 0);
    const typePassed = (scheme.eligibilityCriteria?.companyTypes || []).includes(msme.companyType);
    const turnover = Number(msme.business?.annualTurnover || 0);
    const turnoverPassed =
      turnover >= (scheme.eligibilityCriteria?.minAnnualTurnover || 0) &&
      turnover <= (scheme.eligibilityCriteria?.maxAnnualTurnover || Number.MAX_SAFE_INTEGER);
    const employees = Number(msme.business?.numberOfEmployees || 0);
    const employeesPassed =
      employees >= (scheme.eligibilityCriteria?.minEmployees || 0) &&
      employees <= (scheme.eligibilityCriteria?.maxEmployees || Number.MAX_SAFE_INTEGER);
    const passed = carbonPassed && typePassed && turnoverPassed && employeesPassed;
    if (passed) {
      eligibleCount += 1;
    }
    return carbonPassed || typePassed;
  }).length;

  const isEligible = eligibleCount > 0;
  const criteria = [
    {
      id: 'carbon_score',
      label: 'Carbon score meets scheme thresholds',
      passed: (achievements.latestCarbonScore ?? msme.carbonScore ?? 0) > 0,
      current: achievements.latestCarbonScore ?? msme.carbonScore ?? 0,
      hint: 'Higher carbon performance unlocks more government and industry schemes.'
    },
    {
      id: 'profile_complete',
      label: 'Company profile with turnover and employee count',
      passed: Boolean(msme.business?.annualTurnover && msme.business?.numberOfEmployees),
      current: msme.companyType,
      hint: 'Update turnover and headcount under My company profile.'
    },
    {
      id: 'reduction_actions',
      label: 'Documented emissions reduction actions',
      passed: achievements.implementedRecommendations >= 1 || achievements.hasReductionHistory,
      current: achievements.implementedRecommendations,
      hint: 'Implement recommendations to strengthen scheme applications.'
    }
  ];

  return {
    id: 'gift_schemes',
    title: 'GIFT schemes',
    description: 'Government and industry incentives matched to your sector and carbon profile.',
    path: '/gift-schemes',
    category: 'incentive',
    isEligible,
    status: readinessStatus(isEligible, partialCount > 0),
    eligibleSchemeCount: eligibleCount,
    totalSchemeCount: schemes.length,
    criteria,
    ctaLabel: isEligible ? 'Browse eligible schemes' : 'Explore catalogue'
  };
};

const buildAdeetieOption = async (msme, achievements) => {
  const adeetieEligibility = adeetieService.evaluateEligibility(msme);
  const adeetieReadiness = await adeetieService.computeReadinessScore(msme);
  const savingsMet =
    adeetieReadiness.estimatedEnergySavingsPercent >= adeetieReadiness.minRequiredSavingsPercent;

  const isEligible = adeetieEligibility.isEligible && savingsMet;
  const partial =
    adeetieEligibility.isEligible ||
    adeetieReadiness.readinessScore >= 40 ||
    achievements.energyRecommendationsImplemented > 0;

  return {
    id: 'adeetie',
    title: 'ADEETIE (BEE)',
    description: 'Interest subvention and technical handholding for MSME energy-efficiency projects.',
    path: '/adeetie',
    category: 'finance',
    isEligible,
    status: readinessStatus(isEligible, partial),
    readinessScore: adeetieReadiness.readinessScore,
    estimatedEnergySavingsPercent: adeetieReadiness.estimatedEnergySavingsPercent,
    minRequiredSavingsPercent: adeetieReadiness.minRequiredSavingsPercent,
    subventionRatePercent: adeetieEligibility.subventionRatePercent,
    criteria: adeetieEligibility.criteria.map((item) => ({
      id: item.id,
      label: item.label,
      passed: item.passed,
      current: item.current,
      hint: item.hint
    })),
    ctaLabel: isEligible ? 'Open ADEETIE hub' : 'Review eligibility'
  };
};

const buildPointsRewardsOption = async (userId, achievements) => {
  const profile = await UserIncentiveProfile.findOne({ userId }).lean();
  const totalPoints = profile?.totalPoints || 0;
  const level = profile?.level || 1;
  const redeemableRewards = (profile?.rewards || []).filter(
    (reward) => reward.available !== false && reward.cost <= totalPoints
  ).length;

  const isEligible = totalPoints >= 200 || achievements.implementedRecommendations >= 3;
  const criteria = [
    {
      id: 'points_balance',
      label: 'Earn points through assessments and daily tasks',
      passed: totalPoints >= 200,
      current: totalPoints,
      hint: 'Complete daily tasks and unlock achievements to earn redeemable points.'
    },
    {
      id: 'reduction_actions',
      label: 'Implement sustainability recommendations',
      passed: achievements.implementedRecommendations >= 3,
      current: achievements.implementedRecommendations,
      hint: 'Each implemented recommendation contributes to both points and finance readiness.'
    }
  ];

  return {
    id: 'points_rewards',
    title: 'Points & rewards',
    description: 'Gamified recognition for assessments, tasks, and reduction milestones.',
    path: '/incentives',
    category: 'recognition',
    isEligible,
    status: readinessStatus(isEligible, totalPoints > 0),
    totalPoints,
    level,
    redeemableRewardCount: redeemableRewards,
    criteria,
    ctaLabel: redeemableRewards > 0 ? 'Redeem rewards' : 'View achievements'
  };
};

const buildFinanceOverview = async (userId, msme) => {
  const achievements = await buildEmissionsAchievements(msme);
  const [adeetie, greenLoans, giftSchemes, pointsRewards] = await Promise.all([
    buildAdeetieOption(msme, achievements),
    buildGreenLoanOption(msme, achievements),
    buildGiftSchemesOption(msme, achievements),
    buildPointsRewardsOption(userId, achievements)
  ]);

  const options = [adeetie, greenLoans, giftSchemes, pointsRewards];
  const applicationsOption = {
    id: 'gift_applications',
    title: 'My applications',
    description: 'Track submitted GIFT and ADEETIE-linked applications.',
    path: '/gift-applications',
    category: 'workflow',
    isEligible: true,
    status: 'in_progress',
    criteria: [],
    ctaLabel: 'View applications'
  };

  const eligibleOptions = options.filter((option) => option.isEligible);
  const inProgressOptions = options.filter(
    (option) => !option.isEligible && option.status === 'in_progress'
  );

  const nextSteps = [];
  if (!achievements.hasAssessment) {
    nextSteps.push({
      id: 'run_assessment',
      label: 'Run a carbon assessment',
      description: 'Required for green loan and scheme eligibility checks.',
      path: '/carbon-footprint?section=start-assessment'
    });
  }
  if (achievements.implementedRecommendations < 3) {
    nextSteps.push({
      id: 'implement_reco',
      label: 'Implement energy or efficiency recommendations',
      description: 'Past reduction actions strengthen ADEETIE and green loan applications.',
      path: '/carbon-footprint?section=recommendations'
    });
  }
  if (!adeetie.isEligible && adeetie.status !== 'not_started') {
    nextSteps.push({
      id: 'adeetie_profile',
      label: 'Complete ADEETIE profile fields',
      description: 'Add Udyam, GST, BEE sector, and Phase-1 cluster details.',
      path: '/adeetie'
    });
  }
  if (eligibleOptions.length > 0) {
    nextSteps.unshift({
      id: 'apply_now',
      label: `Apply via ${eligibleOptions[0].title}`,
      description: 'Your emissions achievements meet the minimum bar for this option.',
      path: eligibleOptions[0].path
    });
  }

  return {
    companyName: msme.companyName,
    generatedAt: new Date().toISOString(),
    emissionsAchievements: achievements,
    summary: {
      eligibleCount: eligibleOptions.length,
      inProgressCount: inProgressOptions.length,
      totalOptions: options.length,
      headline:
        eligibleOptions.length > 0
          ? `${eligibleOptions.length} finance option${eligibleOptions.length === 1 ? '' : 's'} ready based on your emissions track record`
          : 'Complete reduction actions to unlock finance and incentive options'
    },
    options: [...options, applicationsOption],
    nextSteps: nextSteps.slice(0, 4)
  };
};

module.exports = {
  GREEN_LOAN_MIN_CARBON_SAVINGS_PERCENT,
  buildEmissionsAchievements,
  buildFinanceOverview
};
