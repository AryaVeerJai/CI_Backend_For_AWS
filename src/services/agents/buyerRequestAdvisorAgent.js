/**
 * Advises MSMEs on buyer audits, supplier questionnaires, and evidence packs.
 */
const FRAMEWORK_LABELS = {
  brsr_core: 'BRSR Core supplier pack',
  cdp: 'CDP climate questionnaire',
  csrd: 'CSRD supplier datapoints',
  ecovadis: 'EcoVadis assessment',
  custom: 'Custom buyer request'
};

const buildEvidencePackChecklist = (context = {}) => {
  const items = [
    { id: 'boundary', label: 'Organizational boundary statement', required: true },
    { id: 'scope12', label: 'Scope 1 & 2 inventory with sources', required: true },
    { id: 'scope3_material', label: 'Material Scope 3 categories', required: false },
    { id: 'factors', label: 'Emission factor registry snapshot', required: true },
    { id: 'documents', label: 'Supporting utility bills and invoices', required: true },
    { id: 'methodology', label: 'Quantification methodology note', required: true }
  ];

  return items.map((item) => ({
    ...item,
    status: item.id === 'documents' && (context.documentCount || 0) > 0
      ? 'ready'
      : item.id === 'scope12' && (context.totalEmissionsKg || 0) > 0
        ? 'ready'
        : 'pending'
  }));
};

const buildBuyerRequestAdvisory = ({
  supplierQuestionnaires = [],
  documentCount = 0,
  totalEmissionsKg = 0,
  inventoryQuality = {},
  auditPackaging = null
}) => {
  const openRequests = (supplierQuestionnaires || []).filter(
    (q) => q.status !== 'accepted' && q.status !== 'responded'
  );
  const overdue = openRequests.filter((q) => q.dueDate && new Date(q.dueDate) < new Date());

  const inbox = openRequests.map((q) => {
    const framework = q.framework || 'custom';
    const daysToDue = q.dueDate
      ? Math.ceil((new Date(q.dueDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : null;
    return {
      id: q._id?.toString() || q.id,
      buyerName: q.buyerName,
      buyerContactEmail: q.buyerContactEmail || null,
      framework,
      frameworkLabel: FRAMEWORK_LABELS[framework] || FRAMEWORK_LABELS.custom,
      status: q.status,
      dueDate: q.dueDate || null,
      daysToDue,
      urgency: daysToDue != null && daysToDue <= 7 ? 'high' : daysToDue != null && daysToDue <= 21 ? 'medium' : 'normal',
      suggestedActions: [
        'Attach utility bills covering the reporting period',
        'Export BRSR or ISO 14064 summary from Reporting',
        inventoryQuality.inventoryQualityScore >= 60
          ? 'Share inventory quality summary with uncertainty note'
          : 'Improve activity-based data before sharing externally'
      ],
      evidenceDocumentCount: Array.isArray(q.evidenceDocumentIds) ? q.evidenceDocumentIds.length : 0
    };
  });

  const evidencePack = auditPackaging?.auditPackage || {
    generatedAt: new Date().toISOString(),
    sections: buildEvidencePackChecklist({ documentCount, totalEmissionsKg })
  };

  const recommendations = [];
  if (openRequests.length === 0) {
    recommendations.push({
      priority: 'medium',
      title: 'Register buyer requests',
      action: 'Add supplier questionnaires in Compliance hub when buyers send audit templates.',
      path: '/compliance/india?section=overview'
    });
  }
  if (overdue.length > 0) {
    recommendations.push({
      priority: 'high',
      title: `${overdue.length} overdue buyer request(s)`,
      action: 'Run MSME advisory orchestration and export an audit-ready evidence pack.',
      path: '/compliance'
    });
  }
  if ((documentCount || 0) < 3 && openRequests.length > 0) {
    recommendations.push({
      priority: 'high',
      title: 'Strengthen document evidence',
      action: 'Upload at least three utility or fuel bills for the reporting period.',
      path: '/data?tab=0'
    });
  }

  return {
    openRequestCount: openRequests.length,
    overdueCount: overdue.length,
    inbox,
    evidencePackReady: Boolean(auditPackaging?.certificationStatus === 'audit_ready')
      || inventoryQuality.inventoryQualityScore >= 65,
    evidencePackChecklist: buildEvidencePackChecklist({ documentCount, totalEmissionsKg }),
    auditPackageSummary: auditPackaging
      ? {
        certificationStatus: auditPackaging.certificationStatus,
        overallReadinessScore: auditPackaging.auditPackage?.overallReadinessScore
      }
      : null,
    recommendations
  };
};

module.exports = {
  buildBuyerRequestAdvisory,
  buildEvidencePackChecklist,
  async execute(task = {}) {
    const { input = {} } = task;
    return buildBuyerRequestAdvisory(input);
  }
};
