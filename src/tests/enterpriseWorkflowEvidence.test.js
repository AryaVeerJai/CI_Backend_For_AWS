const {
  evaluateEnterpriseSectionEvidence,
  buildEvidenceContext
} = require('../../../shared/enterpriseWorkflowEvidence');

describe('shared enterpriseWorkflowEvidence', () => {
  test('organization_listing requires core fields', () => {
    const result = evaluateEnterpriseSectionEvidence('organization_listing', {});
    expect(result.canComplete).toBe(false);
    expect(result.missing).toContain('Legal company name');
  });

  test('brsr_principle6 requires data evidence', () => {
    const empty = evaluateEnterpriseSectionEvidence('brsr_principle6', {});
    expect(empty.canComplete).toBe(false);

    const withDocs = evaluateEnterpriseSectionEvidence('brsr_principle6', { documentCount: 2 });
    expect(withDocs.canComplete).toBe(true);
  });

  test('buildEvidenceContext maps enterprise profile and stats', () => {
    const ctx = buildEvidenceContext(
      {
        companyName: 'Acme Ltd',
        complianceWorkflow: {
          sections: [{ key: 'organization_listing', status: 'completed' }]
        }
      },
      { documentCount: 3 }
    );

    expect(ctx.companyName).toBe('Acme Ltd');
    expect(ctx.documentCount).toBe(3);
    expect(ctx.completedSectionKeys).toEqual(['organization_listing']);
  });
});
