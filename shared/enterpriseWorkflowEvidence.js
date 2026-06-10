/**
 * Canonical enterprise workflow section evidence rules (web + backend).
 */

const hasText = (v) => typeof v === 'string' && v.trim().length > 0;

const evaluateEnterpriseSectionEvidence = (sectionKey, ctx = {}) => {
  const missing = [];
  let actionPath = '/enterprise/profile';
  let actionLabel = 'Open organization profile';

  switch (sectionKey) {
    case 'organization_listing':
      if (!hasText(ctx.companyName)) missing.push('Legal company name');
      if (!hasText(ctx.cinNumber)) missing.push('CIN number');
      if (!hasText(ctx.industry)) missing.push('Industry sector');
      if (!hasText(ctx.listingStatus)) missing.push('Listing status');
      actionPath = '/enterprise/profile';
      actionLabel = 'Complete organization tab';
      break;

    case 'consolidation_boundaries':
      if (!hasText(ctx.consolidationApproach)) missing.push('Consolidation approach');
      if (!hasText(ctx.reportingEntityType)) missing.push('Reporting entity type');
      actionPath = '/enterprise/profile';
      actionLabel = 'Set GHG boundaries';
      break;

    case 'scope12_inventory': {
      const validFacilities = (ctx.facilities || []).filter(
        (f) => hasText(f.name) && hasText(f.state)
      );
      if (validFacilities.length < 1) {
        missing.push('At least one facility with name and state');
      }
      actionPath = '/enterprise/profile';
      actionLabel = 'Add facilities';
      break;
    }

    case 'scope3_materiality': {
      const assessed = (ctx.scope3Materiality?.categories || []).filter(
        (c) => c.material === true || (Number(c.coveragePercent) || 0) > 0
      );
      if (assessed.length < 5) {
        missing.push('Materiality or coverage for at least 5 Scope 3 categories');
      }
      actionPath = '/enterprise/profile';
      actionLabel = 'Configure Scope 3';
      break;
    }

    case 'brsr_principle6': {
      const hasData =
        (ctx.documentCount ?? 0) > 0
        || (ctx.transactionCount ?? 0) > 0
        || (ctx.assessmentCount ?? 0) > 0
        || (Number(ctx.carbonScore) || 0) > 0;
      if (!hasData) {
        missing.push('Upload documents, sync connectors, or run a carbon assessment');
      }
      actionPath = '/enterprise/data';
      actionLabel = 'Add evidence';
      break;
    }

    case 'pat_energy_intensity':
      if (ctx.regulatoryMandates?.patScheme) {
        const hasFacilityEnergy = (ctx.facilities || []).some(
          (f) => hasText(f.name) && Array.isArray(f.scope2Sources) && f.scope2Sources.length > 0
        );
        if (!hasFacilityEnergy) {
          missing.push('Facility Scope 2 sources for PAT energy intensity');
        }
        actionPath = '/enterprise/profile';
        actionLabel = 'Configure facility energy';
      }
      break;

    case 'review_orchestration': {
      const required = [
        'organization_listing',
        'consolidation_boundaries',
        'scope12_inventory',
        'scope3_materiality',
        'brsr_principle6'
      ];
      if (ctx.regulatoryMandates?.patScheme) {
        required.push('pat_energy_intensity');
      }
      const done = new Set(ctx.completedSectionKeys || []);
      required.forEach((key) => {
        if (!done.has(key)) {
          missing.push(`Complete section: ${key.replace(/_/g, ' ')}`);
        }
      });
      actionPath = '/enterprise/workflow';
      actionLabel = 'Review workflow';
      break;
    }

    default:
      missing.push('Unknown workflow section');
  }

  return {
    canComplete: missing.length === 0,
    missing,
    actionPath,
    actionLabel
  };
};

const buildEvidenceContext = (enterprise, stats = {}) => {
  const completedSectionKeys = (enterprise.complianceWorkflow?.sections || [])
    .filter((s) => s.status === 'completed')
    .map((s) => s.key);

  return {
    companyName: enterprise.companyName,
    cinNumber: enterprise.cinNumber,
    industry: enterprise.industry,
    listingStatus: enterprise.listingStatus,
    consolidationApproach: enterprise.consolidationApproach,
    reportingEntityType: enterprise.reportingEntityType,
    regulatoryMandates: enterprise.regulatoryMandates,
    facilities: enterprise.facilities,
    scope3Materiality: enterprise.scope3Materiality,
    carbonScore: enterprise.carbonScore,
    documentCount: stats.documentCount ?? 0,
    transactionCount: stats.transactionCount ?? 0,
    assessmentCount: stats.assessmentCount ?? 0,
    completedSectionKeys
  };
};

module.exports = {
  evaluateEnterpriseSectionEvidence,
  buildEvidenceContext
};
