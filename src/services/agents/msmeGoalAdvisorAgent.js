/**
 * Goal-driven prioritization aligned with MSME signup intents.
 */
const GOAL_PRIORITIES = {
  buyer_audit: {
    title: 'Buyer audit readiness',
    focusAreas: ['buyer_inbox', 'evidence_pack', 'documents'],
    primaryPath: '/compliance',
    ctaLabel: 'Open compliance hub'
  },
  brsr_compliance: {
    title: 'BRSR disclosure',
    focusAreas: ['brsr', 'boundaries', 'scope3'],
    primaryPath: '/reporting?tab=1',
    ctaLabel: 'Open BRSR report'
  },
  baseline_footprint: {
    title: 'Carbon baseline',
    focusAreas: ['assessment', 'inventory_quality'],
    primaryPath: '/carbon-footprint?section=start-assessment',
    ctaLabel: 'Run assessment'
  },
  green_finance: {
    title: 'Green finance',
    focusAreas: ['evidence', 'reduction_plan', 'loans'],
    primaryPath: '/green-loans',
    ctaLabel: 'Check loan eligibility'
  },
  pat_icm: {
    title: 'PAT / Indian Carbon Market',
    focusAreas: ['energy_intensity', 'pat', 'icm'],
    primaryPath: '/compliance/india?section=pat-intensity',
    ctaLabel: 'India compliance track'
  },
  cost_reduction: {
    title: 'Cost and emissions reduction',
    focusAreas: ['recommendations', 'roi'],
    primaryPath: '/emissions-reduction-targets?tab=2',
    ctaLabel: 'View recommendations'
  }
};

const buildGoalAdvisory = ({
  signupGoal = 'baseline_footprint',
  inventoryQuality = {},
  buyerAdvisory = {},
  environmentalKpi = {},
  dpdpAdvisory = {},
  dataCompletenessScore = 0
}) => {
  const goalConfig = GOAL_PRIORITIES[signupGoal] || GOAL_PRIORITIES.baseline_footprint;
  const prioritizedActions = [];

  const pushAction = (action) => {
    if (!prioritizedActions.some((a) => a.id === action.id)) {
      prioritizedActions.push(action);
    }
  };

  if (signupGoal === 'buyer_audit') {
    if ((buyerAdvisory.openRequestCount || 0) > 0) {
      pushAction({
        id: 'respond_buyer',
        title: 'Respond to open buyer requests',
        description: `${buyerAdvisory.openRequestCount} questionnaire(s) need evidence.`,
        path: '/compliance',
        priority: buyerAdvisory.overdueCount > 0 ? 'high' : 'medium'
      });
    }
    pushAction({
      id: 'audit_pack',
      title: 'Generate audit evidence pack',
      description: 'Use ISO audit packager output or export from Reporting.',
      path: '/reporting?tab=2',
      priority: 'high'
    });
  }

  if (signupGoal === 'brsr_compliance') {
    pushAction({
      id: 'brsr_water_waste',
      title: 'Complete water and waste KPIs',
      description: environmentalKpi.summary || 'Map environmental metrics for BRSR Principle 6.',
      path: '/msme-profile',
      priority: environmentalKpi.readinessScore < 50 ? 'high' : 'medium'
    });
    if (inventoryQuality.inventoryQualityScore < 60) {
      pushAction({
        id: 'inventory_rigor',
        title: 'Raise inventory quality before filing',
        description: inventoryQuality.hints?.[0] || 'Improve boundaries and factor documentation.',
        path: '/carbon-footprint?section=assessment-results',
        priority: 'high'
      });
    }
  }

  if (signupGoal === 'green_finance') {
    pushAction({
      id: 'green_loans',
      title: 'Check green loan eligibility',
      description: 'Lenders use verified activity data and reduction plans.',
      path: '/green-loans',
      priority: dataCompletenessScore >= 50 ? 'high' : 'medium'
    });
    pushAction({
      id: 'gift_schemes',
      title: 'Explore government incentives',
      description: 'Link reduction projects to GIFT scheme eligibility.',
      path: '/gift-schemes',
      priority: 'medium'
    });
  }

  if (signupGoal === 'cost_reduction') {
    pushAction({
      id: 'roi_actions',
      title: 'Review ROI-ranked reductions',
      description: 'Prioritize quick wins with payback under 24 months.',
      path: '/emissions-reduction-targets?tab=2',
      priority: 'high'
    });
  }

  if (signupGoal === 'pat_icm') {
    pushAction({
      id: 'pat_track',
      title: 'Review PAT / energy intensity guidance',
      description: 'Align facility energy data with sector norms.',
      path: '/compliance/india?section=pat-intensity',
      priority: 'high'
    });
  }

  if (dpdpAdvisory.openIssues?.length) {
    pushAction({
      id: 'dpdp_consent',
      title: 'Review data privacy settings',
      description: dpdpAdvisory.openIssues[0],
      path: '/data-privacy',
      priority: 'medium'
    });
  }

  if (prioritizedActions.length === 0) {
    pushAction({
      id: 'default_assessment',
      title: 'Complete your carbon baseline',
      description: 'Run assessment and upload bills to unlock tailored guidance.',
      path: '/carbon-footprint?section=start-assessment',
      priority: 'medium'
    });
  }

  return {
    signupGoal,
    goalTitle: goalConfig.title,
    focusAreas: goalConfig.focusAreas,
    primaryPath: goalConfig.primaryPath,
    ctaLabel: goalConfig.ctaLabel,
    prioritizedActions: prioritizedActions.slice(0, 5),
    dashboardCardOrder: goalConfig.focusAreas
  };
};

module.exports = {
  GOAL_PRIORITIES,
  buildGoalAdvisory,
  async execute(task = {}) {
    const { input = {} } = task;
    return buildGoalAdvisory(input);
  }
};
