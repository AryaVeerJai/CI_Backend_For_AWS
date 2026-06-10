/**
 * Enterprise workflow evidence — delegates to shared/enterpriseWorkflowEvidence.js.
 */

const {
  evaluateEnterpriseSectionEvidence,
  buildEvidenceContext
} = require('../../../shared/enterpriseWorkflowEvidence');

module.exports = {
  evaluateEnterpriseSectionEvidence,
  buildEvidenceContext
};
