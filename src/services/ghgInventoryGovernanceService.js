const crypto = require('crypto');
const ghgGovernance = require('../../../shared/ghgInventoryGovernance');
const carbonEmissionAnalytics = require('../../../shared/carbonEmissionAnalytics');
const CARBON_DEFAULTS = require('../../../shared/carbonEmissionDefaults.json');
const { normalizeGhgOperationalBoundary, normalizeGhgOrganizationalBoundary } = require('../utils/ghgBoundaryFields');
const { buildInventoryOrganizationalBoundary } = require('../../../shared/ghgBoundaryCalculation');
const GhgInventoryAuditLog = require('../models/GhgInventoryAuditLog');
const GhgInventoryVersion = require('../models/GhgInventoryVersion');
const EmissionFactorRegistryEntry = require('../models/EmissionFactorRegistryEntry');
const logger = require('../utils/logger');

const hashPayload = (payload) => crypto
  .createHash('sha256')
  .update(JSON.stringify(payload || {}))
  .digest('hex')
  .slice(0, 24);

const appendAuditLog = async ({
  msmeId,
  organizationId,
  inventoryVersionId,
  eventType,
  summary,
  agentType,
  orchestrationId,
  beforeSnapshot,
  afterSnapshot,
  metadata,
  actorType = 'agent'
}) => {
  try {
    return await GhgInventoryAuditLog.create({
      msmeId,
      organizationId,
      inventoryVersionId,
      eventType,
      actorType,
      agentType,
      orchestrationId,
      payloadHash: hashPayload({ beforeSnapshot, afterSnapshot, metadata }),
      summary,
      beforeSnapshot,
      afterSnapshot,
      metadata
    });
  } catch (error) {
    logger.warn('GHG audit log write failed:', error.message);
    return null;
  }
};

const { listRegistryFactorIds } = require('../../../shared/emissionFactorRegistry');

const seedDefaultFactorRegistry = async () => {
  const registry = carbonEmissionAnalytics.DEFAULT_FACTOR_REGISTRY || {};
  const configVersion = CARBON_DEFAULTS.configVersion || '2026-05-13';
  const effectiveFrom = new Date(`${configVersion}T00:00:00.000Z`);
  const entries = Object.values(registry);
  let seeded = 0;

  for (const row of entries) {
    if (!row?.id) continue;
    const existing = await EmissionFactorRegistryEntry.findOne({
      factorId: row.id,
      version: row.sourceVersion || configVersion
    });
    if (existing) continue;
    await EmissionFactorRegistryEntry.create({
      factorId: row.id,
      version: row.sourceVersion || configVersion,
      effectiveFrom,
      factor: row.factor,
      unit: row.unit,
      gas: 'CO2e',
      source: row.source,
      relativeUncertainty: row.relativeUncertainty,
      isActive: true,
      metadata: { seededFrom: 'DEFAULT_FACTOR_REGISTRY' }
    });
    seeded += 1;
  }
  return { seeded, configVersion };
};

const getActiveFactor = async (factorId) => {
  const active = await EmissionFactorRegistryEntry.findOne({
    factorId,
    isActive: true
  }).sort({ effectiveFrom: -1 });
  if (active) {
    return {
      id: active.factorId,
      factor: active.factor,
      unit: active.unit,
      source: active.source,
      sourceVersion: active.version,
      relativeUncertainty: active.relativeUncertainty,
      registryBacked: true
    };
  }
  const fallback = carbonEmissionAnalytics.DEFAULT_FACTOR_REGISTRY[factorId];
  return fallback ? { ...fallback, registryBacked: false } : null;
};

const prepareTransactionsForInventory = (transactions = [], msmeData = {}) => {
  const boundary = normalizeGhgOperationalBoundary(
    msmeData.operations?.ghgOperationalBoundary || {},
    {}
  );
  const organizationalBoundary = normalizeGhgOrganizationalBoundary(
    msmeData.manufacturingProfile?.ghgOrganizationalBoundary || {},
    {}
  );
  const enriched = transactions.map((txn) => ghgGovernance.enrichTransactionForInventory(txn, boundary));
  const { included, excluded } = ghgGovernance.applyBoundaryToTransactions(enriched, boundary);
  return {
    included,
    excluded,
    boundary,
    organizationalBoundary,
    enriched
  };
};

const applyGovernanceToAssessment = (assessment, context = {}) => {
  const boundary = context.boundary || {};
  const assuranceEvaluation = ghgGovernance.evaluateAssuranceReadiness({
    inventoryMetadata: assessment.inventoryMetadata,
    boundary,
    transactions: context.includedTransactions || [],
    options: context.assuranceOptions
  });

  const brsrScopes = ghgGovernance.reconcileBrsrScopeTotals(assessment, {
    allowResidualScope3: context.allowResidualScope3 === true
  });

  const organizationalBoundary = context.organizationalBoundary
    || normalizeGhgOrganizationalBoundary({}, {});

  const msmeData = context.msmeData || {};
  const iso14064Governance = {
    methodologyDeclaration: msmeData.methodologyDeclaration
      || assessment.methodologyDeclaration
      || CARBON_DEFAULTS.reportingLabel,
    inventoryManager: msmeData.inventoryManager
      || msmeData.manufacturingProfile?.inventoryManager
      || null,
    baseYear: msmeData.baseYear
      || msmeData.manufacturingProfile?.baseYear
      || null,
    recalculationPolicy: msmeData.recalculationPolicy
      || msmeData.manufacturingProfile?.recalculationPolicy
      || null,
    verificationStatus: msmeData.verificationStatus
      || assessment.verificationStatus
      || 'not_verified',
    evidenceRetentionYears: msmeData.evidenceRetentionYears
      || CARBON_DEFAULTS.evidenceRetentionYears
      || 7,
    reportingMode: CARBON_DEFAULTS.defaultReportingMode || 'compliance'
  };

  return {
    ...assessment,
    governance: {
      operationalBoundary: boundary,
      organizationalBoundary,
      excludedTransactionCount: context.excludedCount || 0,
      assuranceEvaluation,
      brsrScopeReconciliation: brsrScopes,
      methodologyLabel: CARBON_DEFAULTS.reportingLabel,
      factorRegistryVersion: CARBON_DEFAULTS.configVersion,
      iso14064Governance
    }
  };
};

const createInventoryVersion = async ({
  msmeId,
  organizationId,
  assessment,
  boundary,
  organizationalBoundary,
  governanceResult,
  reportingPeriod,
  orchestrationId,
  lock = false
}) => {
  const versionLabel = `INV-${Date.now()}`;
  const doc = await GhgInventoryVersion.create({
    msmeId,
    organizationId,
    versionLabel,
    status: lock ? 'locked' : 'draft',
    reportingPeriod,
    methodologyVersion: CARBON_DEFAULTS.configVersion,
    factorRegistryVersion: CARBON_DEFAULTS.configVersion,
    operationalBoundarySnapshot: boundary,
    organizationalBoundarySnapshot: organizationalBoundary
      ? normalizeGhgOrganizationalBoundary(organizationalBoundary, {})
      : undefined,
    assessmentSnapshot: {
      totalCO2Emissions: assessment.totalCO2Emissions,
      esgScopes: assessment.esgScopes,
      breakdown: assessment.breakdown
    },
    inventoryMetadata: assessment.inventoryMetadata,
    assuranceEvaluation: governanceResult?.assuranceEvaluation || assessment.governance?.assuranceEvaluation,
    governanceOrchestration: governanceResult,
    transactionCount: governanceResult?.includedCount || 0,
    excludedTransactionCount: governanceResult?.excludedCount || 0,
    lockedAt: lock ? new Date() : undefined,
    lockedBy: lock ? 'ghg_inventory_governance_orchestrator' : undefined
  });

  await appendAuditLog({
    msmeId,
    organizationId,
    inventoryVersionId: doc._id,
    eventType: lock ? 'inventory_locked' : 'inventory_calculated',
    summary: lock
      ? `Locked GHG inventory version ${versionLabel}`
      : `Created draft GHG inventory version ${versionLabel}`,
    agentType: 'ghg_inventory_governance_orchestrator',
    orchestrationId,
    afterSnapshot: {
      versionLabel,
      totalCO2Emissions: assessment.totalCO2Emissions,
      assuranceReady: doc.assuranceEvaluation?.assuranceReady
    },
    metadata: { reportingPeriod }
  });

  return doc;
};

const listAuditLogs = async ({ msmeId, organizationId, limit = 50 }) => {
  const filter = {};
  if (msmeId) filter.msmeId = msmeId;
  if (organizationId) filter.organizationId = organizationId;
  return GhgInventoryAuditLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 200))
    .lean();
};

module.exports = {
  hashPayload,
  appendAuditLog,
  seedDefaultFactorRegistry,
  getActiveFactor,
  prepareTransactionsForInventory,
  applyGovernanceToAssessment,
  createInventoryVersion,
  listAuditLogs,
  ghgGovernance
};
