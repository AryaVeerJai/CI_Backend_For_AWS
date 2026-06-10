const ENTERPRISE_WORKFLOW_SECTIONS = [
  { key: 'organization_listing', label: 'Organization & listing (CIN, exchanges)' },
  { key: 'consolidation_boundaries', label: 'Consolidation & GHG boundaries' },
  { key: 'scope12_inventory', label: 'Scope 1–2 facility inventory' },
  { key: 'scope3_materiality', label: 'Scope 3 materiality (15 categories)' },
  { key: 'brsr_principle6', label: 'BRSR Principle 6 disclosure pack' },
  { key: 'pat_energy_intensity', label: 'PAT / energy intensity (if applicable)' },
  { key: 'review_orchestration', label: 'Review & multi-agent orchestration' }
];

const SECTION_AGENT_MAP = {
  organization_listing: 'enterprise_compliance',
  consolidation_boundaries: 'ghg_boundary',
  scope12_inventory: 'carbon_analyzer',
  scope3_materiality: 'carbon_analyzer',
  brsr_principle6: 'brsr_mandate',
  pat_energy_intensity: 'pat_intensity',
  review_orchestration: 'orchestration_agent'
};

const ENTERPRISE_SECTION_KEYS = ENTERPRISE_WORKFLOW_SECTIONS.map((section) => section.key);

const buildInitialEnterpriseWorkflow = () => ENTERPRISE_WORKFLOW_SECTIONS.map((section) => ({
  ...section,
  status: 'pending',
  agentGuidance: null,
  completedAt: null
}));

module.exports = {
  ENTERPRISE_WORKFLOW_SECTIONS,
  ENTERPRISE_SECTION_KEYS,
  SECTION_AGENT_MAP,
  buildInitialEnterpriseWorkflow
};
