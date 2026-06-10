/**
 * MSME Sustainable (ZED) Certification — Zero Defect Zero Effect scheme constants.
 * Aligned with MoMSME ZED 2.0 guidelines (Bronze / Silver / Gold levels).
 * @see https://zed.msme.gov.in/
 */

const ZED_CERTIFICATION_LEVELS = [
  {
    id: 'bronze',
    label: 'Bronze',
    costInr: 10000,
    minReadinessPercent: 40,
    description: 'Entry-level ZED certification for foundational quality and environmental systems.'
  },
  {
    id: 'silver',
    label: 'Silver',
    costInr: 40000,
    minReadinessPercent: 65,
    description: 'Intermediate certification with stronger process control and sustainability practices.'
  },
  {
    id: 'gold',
    label: 'Gold',
    costInr: 90000,
    minReadinessPercent: 85,
    description: 'Advanced certification demonstrating mature Zero Defect Zero Effect systems.'
  }
];

const ZED_SUBSIDY_RATES = {
  micro: 0.8,
  small: 0.6,
  medium: 0.5
};

const ZED_JOINING_REWARD_INR = 10000;
const ZED_ADDITIONAL_SUBSIDY_PERCENT = 0.1;
const ZED_CLUSTER_SUBSIDY_PERCENT = 0.05;

const ZED_JOURNEY_STATUSES = [
  'not_started',
  'pledge_taken',
  'in_progress',
  'ready_for_assessment',
  'certified',
  'expired'
];

const ZED_PARAMETER_PILLARS = [
  { id: 'zero_defect', label: 'Zero Defect (Quality)' },
  { id: 'zero_effect', label: 'Zero Effect (Environment)' },
  { id: 'operations', label: 'Operations & Productivity' },
  { id: 'people', label: 'People & Governance' }
];

/**
 * 20 ZED assessment parameters (1–20) grouped by pillar.
 * Each parameter is assessed on system definition, implementation, monitoring,
 * corrective action, and management review.
 */
const ZED_PARAMETERS = [
  {
    id: '1',
    code: '1',
    title: 'Management commitment and leadership',
    pillar: 'people',
    description: 'Top management commitment to ZED principles, policy communication, and resource allocation.',
    evidenceHints: ['Quality policy document', 'Management review minutes', 'ZED pledge confirmation']
  },
  {
    id: '2',
    code: '2',
    title: 'Quality management system',
    pillar: 'zero_defect',
    description: 'Documented QMS covering processes, work instructions, and quality records.',
    evidenceHints: ['Process flow charts', 'Work instructions', 'ISO 9001 certificate if applicable']
  },
  {
    id: '3',
    code: '3',
    title: 'Occupational health and safety',
    pillar: 'people',
    description: 'Safety policy, hazard identification, PPE, incident reporting, and emergency preparedness.',
    evidenceHints: ['Safety policy', 'Hazard register', 'Incident/near-miss logs']
  },
  {
    id: '4',
    code: '4',
    title: 'Customer focus and delivery performance',
    pillar: 'zero_defect',
    description: 'Customer requirements capture, on-time delivery tracking, and complaint handling.',
    evidenceHints: ['Customer complaint register', 'OTD metrics', 'Customer feedback records']
  },
  {
    id: '5',
    code: '5',
    title: 'Maintenance management',
    pillar: 'operations',
    description: 'Preventive maintenance schedules, breakdown records, and spare parts control.',
    evidenceHints: ['PM schedule', 'Breakdown log', 'Maintenance SOPs']
  },
  {
    id: '6',
    code: '6',
    title: 'Energy management',
    pillar: 'zero_effect',
    description: 'Energy consumption monitoring, conservation measures, and renewable adoption.',
    evidenceHints: ['Energy bills', 'Meter readings', 'Solar/renewable installation records']
  },
  {
    id: '7',
    code: '7',
    title: 'Environment management',
    pillar: 'zero_effect',
    description: 'Environmental policy, pollution prevention, and regulatory compliance (SPCB/CTE/CTO).',
    evidenceHints: ['Environmental clearance', 'Pollution control consent', 'Environmental policy']
  },
  {
    id: '8',
    code: '8',
    title: 'Material management',
    pillar: 'operations',
    description: 'Raw material receipt inspection, storage, traceability, and inventory control.',
    evidenceHints: ['GRN records', 'Material inspection reports', 'Inventory registers']
  },
  {
    id: '9',
    code: '9',
    title: 'Design and development',
    pillar: 'zero_defect',
    description: 'Product design controls, specification management, and change control.',
    evidenceHints: ['Product specifications', 'Design change records', 'Drawing revision log']
  },
  {
    id: '10',
    code: '10',
    title: 'Production planning and control',
    pillar: 'operations',
    description: 'Production schedules, capacity planning, and shop-floor control.',
    evidenceHints: ['Production plan', 'Manufacturing workflow', 'Capacity utilization records']
  },
  {
    id: '11',
    code: '11',
    title: 'Process control',
    pillar: 'zero_defect',
    description: 'Process parameters, SOPs, in-process checks, and process capability.',
    evidenceHints: ['Process SOPs', 'In-process inspection records', 'Process parameter sheets']
  },
  {
    id: '12',
    code: '12',
    title: 'Quality control and inspection',
    pillar: 'zero_defect',
    description: 'Incoming, in-process, and final inspection with calibrated measuring equipment.',
    evidenceHints: ['Inspection reports', 'Calibration certificates', 'Rejection/rework records']
  },
  {
    id: '13',
    code: '13',
    title: 'Waste management',
    pillar: 'zero_effect',
    description: 'Waste segregation, recycling, authorized disposal, and waste reduction targets.',
    evidenceHints: ['Waste management practice', 'Disposal manifests', 'Recycling records']
  },
  {
    id: '14',
    code: '14',
    title: 'Water conservation',
    pillar: 'zero_effect',
    description: 'Water consumption monitoring, recycling, rainwater harvesting, and conservation measures.',
    evidenceHints: ['Water bills', 'Water source documentation', 'Recycling/treatment records']
  },
  {
    id: '15',
    code: '15',
    title: 'Risk management',
    pillar: 'people',
    description: 'Risk identification, mitigation plans, business continuity, and contingency planning.',
    evidenceHints: ['Risk register', 'Mitigation action plans', 'Business continuity plan']
  },
  {
    id: '16',
    code: '16',
    title: 'Lean manufacturing and productivity',
    pillar: 'operations',
    description: '5S, kaizen, waste reduction (muda), and productivity improvement initiatives.',
    evidenceHints: ['5S audit records', 'Kaizen logs', 'Productivity metrics']
  },
  {
    id: '17',
    code: '17',
    title: 'Technology adoption',
    pillar: 'operations',
    description: 'Digitalization, automation, and technology upgrades for quality and efficiency.',
    evidenceHints: ['Digitalization assessment', 'Automation records', 'ERP/MES adoption']
  },
  {
    id: '18',
    code: '18',
    title: 'Training and skill development',
    pillar: 'people',
    description: 'Training needs analysis, skill matrices, and competency records for operators.',
    evidenceHints: ['Training calendar', 'Skill matrix', 'Training attendance records']
  },
  {
    id: '19',
    code: '19',
    title: 'Corporate social responsibility',
    pillar: 'people',
    description: 'Community engagement, worker welfare, and ethical business practices.',
    evidenceHints: ['CSR activities log', 'Worker welfare records', 'Ethics policy']
  },
  {
    id: '20',
    code: '20',
    title: 'Continuous improvement',
    pillar: 'zero_defect',
    description: 'PDCA cycle, corrective/preventive actions, and management review of improvements.',
    evidenceHints: ['CAPA register', 'PDCA records', 'Improvement project tracker']
  }
];

const ZED_MATURITY_STAGES = [
  { id: 'not_defined', label: 'Not defined', score: 0 },
  { id: 'defined', label: 'System defined', score: 25 },
  { id: 'implemented', label: 'Implemented', score: 50 },
  { id: 'monitored', label: 'Monitored', score: 75 },
  { id: 'reviewed', label: 'Reviewed & improved', score: 100 }
];

const normalizeZedLevel = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('gold')) return 'gold';
  if (normalized.includes('silver')) return 'silver';
  if (normalized.includes('bronze')) return 'bronze';
  if (normalized.includes('zed')) return 'bronze';
  return null;
};

const resolveZedCertificationLevel = (certifications = []) => {
  const levels = (Array.isArray(certifications) ? certifications : [])
    .map(normalizeZedLevel)
    .filter(Boolean);
  if (levels.includes('gold')) return 'gold';
  if (levels.includes('silver')) return 'silver';
  if (levels.includes('bronze')) return 'bronze';
  return null;
};

const getZedLevelDefinition = (levelId) =>
  ZED_CERTIFICATION_LEVELS.find((level) => level.id === levelId) || null;

const calculateZedSubsidy = ({
  companyType = 'micro',
  targetLevel = 'bronze',
  isWomenOrScStOwned = false,
  isInPriorityRegion = false,
  isInClusterProgramme = false
} = {}) => {
  const level = getZedLevelDefinition(targetLevel) || ZED_CERTIFICATION_LEVELS[0];
  const baseRate = ZED_SUBSIDY_RATES[String(companyType).toLowerCase()] ?? ZED_SUBSIDY_RATES.micro;
  let subsidyRate = baseRate;
  if (isWomenOrScStOwned || isInPriorityRegion) {
    subsidyRate += ZED_ADDITIONAL_SUBSIDY_PERCENT;
  }
  if (isInClusterProgramme) {
    subsidyRate += ZED_CLUSTER_SUBSIDY_PERCENT;
  }
  subsidyRate = Math.min(subsidyRate, 0.95);

  const grossCost = level.costInr;
  const joiningReward = ZED_JOINING_REWARD_INR;
  const schemeSubsidy = Math.round(grossCost * subsidyRate);
  const netPayable = Math.max(0, grossCost - schemeSubsidy - (targetLevel === 'bronze' ? joiningReward : 0));

  return {
    targetLevel: level.id,
    grossCostInr: grossCost,
    baseSubsidyRate: baseRate,
    effectiveSubsidyRate: subsidyRate,
    schemeSubsidyInr: schemeSubsidy,
    joiningRewardInr: targetLevel === 'bronze' ? joiningReward : 0,
    estimatedNetPayableInr: netPayable,
    note: targetLevel === 'bronze' && netPayable === 0
      ? 'Bronze may be free after joining reward and standard subsidy for eligible micro enterprises.'
      : 'Subsidy estimates per MoMSME ZED scheme guidelines; final amount confirmed on zed.msme.gov.in.'
  };
};

module.exports = {
  ZED_CERTIFICATION_LEVELS,
  ZED_SUBSIDY_RATES,
  ZED_JOINING_REWARD_INR,
  ZED_ADDITIONAL_SUBSIDY_PERCENT,
  ZED_CLUSTER_SUBSIDY_PERCENT,
  ZED_JOURNEY_STATUSES,
  ZED_PARAMETER_PILLARS,
  ZED_PARAMETERS,
  ZED_MATURITY_STAGES,
  normalizeZedLevel,
  resolveZedCertificationLevel,
  getZedLevelDefinition,
  calculateZedSubsidy
};
