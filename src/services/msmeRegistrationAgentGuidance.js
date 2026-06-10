/**
 * Post-registration guidance from profile-registration agents: granular checks
 * and user-facing prompts where the profile leaves emissions-relevant ambiguity.
 */

const GRANULAR_REGISTRATION_STEPS = [
  { id: 'company_identity', label: 'Company identity and legal identifiers' },
  { id: 'classification', label: 'MSME classification and scale' },
  { id: 'sector_profile', label: 'Sector and business domain for agent routing' },
  { id: 'operations_snapshot', label: 'Operations snapshot for process and machinery agents' },
  { id: 'environmental_baseline', label: 'Environmental and compliance baseline' }
];

function hasPrimaryProductDetail(body) {
  const raw = body?.business?.primaryProducts;
  if (!raw || !String(raw).trim()) return false;
  const parts = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length >= 1 && parts.some((p) => p.length > 2);
}

function buildRegistrationAgentGuidance(normalizedBody = {}) {
  const steps = GRANULAR_REGISTRATION_STEPS.map((step, index) => ({
    order: index + 1,
    ...step,
    status: 'recorded'
  }));

  const clarifications = [];

  const domain = normalizedBody.businessDomain;
  if (!domain || domain === 'other') {
    clarifications.push({
      id: 'confirm_business_domain',
      scope: 'profile_registration',
      severity: 'important',
      agentStep: 'sector_profile',
      prompt:
        'Your business domain is generic or set to “other”. Which sector best describes your main activity so emissions agents can pick the right factors?',
      detail: 'Accurate domain routing improves carbon factor selection and process templates.',
      suggestedFields: ['businessDomain', 'industry']
    });
  }

  if (!hasPrimaryProductDetail(normalizedBody)) {
    clarifications.push({
      id: 'primary_products_detail',
      scope: 'profile_registration',
      severity: 'recommended',
      agentStep: 'operations_snapshot',
      prompt:
        'Please list your main products or services (comma-separated). This helps map processes and machinery for footprint estimates.',
      detail: 'Without product hints, process/machinery profilers rely only on sector defaults.',
      suggestedFields: ['business.primaryProducts']
    });
  }

  const mfgUnits = Number(normalizedBody.business?.manufacturingUnits);
  if (Number.isFinite(mfgUnits) && mfgUnits > 0) {
    clarifications.push({
      id: 'manufacturing_workflow_followup',
      scope: 'profile_registration',
      severity: 'recommended',
      agentStep: 'operations_snapshot',
      prompt:
        'You indicated manufacturing units. Complete the manufacturing workflow (processes, equipment, energy) when ready so lifecycle agents can use activity data instead of defaults.',
      detail: 'Workflow data reduces reliance on placeholder intensities.',
      suggestedFields: ['business.manufacturingWorkflow']
    });
  }

  const nic = normalizedBody.manufacturingProfile?.nicCode;
  if (!nic || !String(nic).trim()) {
    clarifications.push({
      id: 'nic_code_optional',
      scope: 'profile_registration',
      severity: 'recommended',
      agentStep: 'sector_profile',
      prompt:
        'If you have an NIC code for your main activity, adding it improves sector alignment for reporting templates.',
      suggestedFields: ['manufacturingProfile.nicCode']
    });
  }

  return {
    granularSteps: steps,
    userClarificationRequests: clarifications,
    summary: {
      pendingClarifications: clarifications.length,
      importantCount: clarifications.filter((c) => c.severity === 'important').length
    }
  };
}

module.exports = {
  buildRegistrationAgentGuidance,
  GRANULAR_REGISTRATION_STEPS
};
