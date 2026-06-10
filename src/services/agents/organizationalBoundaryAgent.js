/**
 * Organizational boundary agent (GHG Protocol Corporate Standard).
 * Deterministic policy agent: proposes consolidation framing from company profile.
 */

const analyzeOrganizationalBoundary = ({ msmeData = {} }) => {
  const domain = String(msmeData.businessDomain || '').toLowerCase();
  const units = Number(msmeData.business?.manufacturingUnits || 0);
  const subsidiariesConfigured = Array.isArray(msmeData.operations?.subsidiaries)
    ? msmeData.operations.subsidiaries.length
    : 0;

  const recommendations = [];
  if (units > 1) {
    recommendations.push(
      'Multiple manufacturing units detected: declare whether inventory covers all sites under the same operational control.'
    );
  }
  if (subsidiariesConfigured > 0) {
    recommendations.push(
      'Subsidiaries are listed: confirm each is consolidated using the same approach (operational, financial, or equity share) as the parent.'
    );
  }
  if (['export_import', 'trading', 'logistics'].includes(domain)) {
    recommendations.push(
      'Trading or logistics-heavy profiles often include leased fleets or third-party warehouses; state whether those assets sit inside operational control.'
    );
  }
  recommendations.push(
    'Default for MSME inventories is operational control: include emissions from operations you control, even if legal ownership is shared.'
  );

  const suggestedConsolidationApproach = 'operational_control';
  const reportingEntityDescription = String(msmeData.companyName || '').trim()
    ? `Primary reporting entity: ${String(msmeData.companyName).trim()}.`
    : 'Name the legal entity that signs the GHG report.';

  return {
    agent: 'organizational_boundary_agent',
    confidence: 0.72,
    suggestedConsolidationApproach,
    reportingEntityDescription,
    checklist: [
      'Identify all legal entities and joint ventures that perform activities for the company.',
      'Choose one consolidation approach (operational control is typical for MSME operational footprints).',
      'List facilities and sites included, aligned with UDYAM / GST registrations where applicable.',
      'Document exclusions (e.g. purely financial investments without operational control).'
    ],
    recommendations,
    references: ['GHG Protocol Corporate Standard — Setting Organizational Boundaries']
  };
};

module.exports = {
  analyzeOrganizationalBoundary
};
