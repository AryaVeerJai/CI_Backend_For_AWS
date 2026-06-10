const { CarbonCredits, MSMECarbonCredits, CarbonCreditTransaction } = require('../models/CarbonCredits');
const CarbonAssessment = require('../models/CarbonAssessment');
const MSME = require('../models/MSME');
const IndianCarbonMarketRegistryClient = require('./indianCarbonMarketRegistryClient');
const indianCarbonMarketIntegration = require('./indianCarbonMarketIntegrationService');
const logger = require('../utils/logger');

class CarbonCreditsService {
  constructor() {
    this.poolId = 'indian_carbon_market_pool';
    this.minimumCreditsThreshold = 100; // Minimum credits to be eligible for allocation
    this.creditPerKgCO2 = 0.1; // 1 credit per 10kg CO2 reduced
    this.registryClient = new IndianCarbonMarketRegistryClient();
    this.defaultICMWorkflow = 'icm_platform_workflow';
    this.icmWorkflowMap = new Map([
      ['platform', this.defaultICMWorkflow],
      ['platform_workflow', this.defaultICMWorkflow],
      ['icm_platform', this.defaultICMWorkflow],
      ['icm_platform_workflow', this.defaultICMWorkflow]
    ]);
  }

  getSafeNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : 0;
  }

  getRegistryIntegrationStatus() {
    return indianCarbonMarketIntegration.getRegistryStatus();
  }

  async getIndianCarbonMarketIntegration(msmeId) {
    const msme = await MSME.findById(msmeId).lean();
    let msmeCredits = null;
    try {
      msmeCredits = await this.getMSMECredits(msmeId);
    } catch {
      msmeCredits = null;
    }
    return indianCarbonMarketIntegration.buildAccountIntegration(msmeId, msme, msmeCredits);
  }

  enrichMsmeCreditsWithIcm(msmeCredits, msme = null) {
    if (!msmeCredits) {
      return msmeCredits;
    }
    const plain = typeof msmeCredits.toObject === 'function' ? msmeCredits.toObject() : msmeCredits;
    return {
      ...plain,
      icmIntegration: indianCarbonMarketIntegration.buildAccountIntegration(
        this.getMSMEIdValue(msmeCredits),
        msme,
        msmeCredits
      )
    };
  }

  getMSMEIdValue(msmeCredits) {
    const msmeValue = msmeCredits?.msmeId;
    if (!msmeValue) return null;
    if (typeof msmeValue === 'string') return msmeValue;
    if (msmeValue?._id) return msmeValue._id.toString();
    if (typeof msmeValue.toString === 'function') return msmeValue.toString();
    return null;
  }

  normalizeWorkflowIdentifier(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  resolveICMWorkflowIdentifier(value) {
    const normalized = this.normalizeWorkflowIdentifier(value);
    if (!normalized) return null;

    if (this.icmWorkflowMap.has(normalized)) {
      return this.icmWorkflowMap.get(normalized);
    }

    return null;
  }

  roundTo(value, decimals = 4) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;
    const base = 10 ** decimals;
    return Math.round(numericValue * base) / base;
  }

  ensureICMWorkflowState(msmeCredits, workflowHint = 'Platform') {
    msmeCredits.registryIntegration = msmeCredits.registryIntegration || {};

    const existingState = msmeCredits.registryIntegration.icmWorkflow || {};
    const resolvedWorkflow = this.resolveICMWorkflowIdentifier(
      workflowHint
      || existingState.workflowId
      || this.defaultICMWorkflow
    ) || this.defaultICMWorkflow;

    const baseline = existingState.baseline || {};
    const reductionTracking = existingState.reductionTracking || {};
    const creditQuantification = existingState.creditQuantification || {};

    msmeCredits.registryIntegration.icmWorkflow = {
      ...existingState,
      workflowId: resolvedWorkflow,
      baseline: {
        co2Emissions: this.getSafeNumber(baseline.co2Emissions),
        setAt: baseline.setAt || null,
        assessmentId: baseline.assessmentId || null,
        source: baseline.source || 'platform',
        notes: baseline.notes || ''
      },
      reductionTracking: {
        latestCo2Emissions: this.getSafeNumber(reductionTracking.latestCo2Emissions),
        latestReductionKgCO2: this.getSafeNumber(reductionTracking.latestReductionKgCO2),
        latestReductionPercent: this.getSafeNumber(reductionTracking.latestReductionPercent),
        lastEvaluatedAt: reductionTracking.lastEvaluatedAt || null,
        history: Array.isArray(reductionTracking.history) ? reductionTracking.history : []
      },
      creditQuantification: {
        creditPerKgCO2: this.getSafeNumber(creditQuantification.creditPerKgCO2) || this.creditPerKgCO2,
        latestQuantifiedCredits: this.getSafeNumber(creditQuantification.latestQuantifiedCredits),
        totalQuantifiedCredits: this.getSafeNumber(creditQuantification.totalQuantifiedCredits),
        lastQuantifiedAt: creditQuantification.lastQuantifiedAt || null,
        history: Array.isArray(creditQuantification.history) ? creditQuantification.history : []
      }
    };

    return msmeCredits.registryIntegration.icmWorkflow;
  }

  async resolveAssessmentById(assessmentId) {
    if (!assessmentId) return null;
    const assessment = await CarbonAssessment.findById(assessmentId);
    if (!assessment) {
      throw new Error('Carbon assessment not found');
    }

    return assessment;
  }

  async setICMWorkflowBaseline(msmeId, options = {}) {
    const {
      assessmentId,
      baselineCO2Emissions,
      setAt,
      notes = '',
      source = 'platform',
      syncRegistry = false,
      metadata = {}
    } = options;

    const msmeCredits = await this.getMSMECredits(msmeId);
    const workflowState = this.ensureICMWorkflowState(msmeCredits, metadata.workflow || 'Platform');

    let resolvedAssessmentId = null;
    let baselineEmissions = this.getSafeNumber(baselineCO2Emissions);

    if (assessmentId) {
      const assessment = await this.resolveAssessmentById(assessmentId);
      baselineEmissions = this.getSafeNumber(assessment.totalCO2Emissions);
      resolvedAssessmentId = assessment._id;
    }

    if (baselineEmissions <= 0) {
      throw new Error('Baseline CO2 emissions must be greater than zero');
    }

    workflowState.baseline = {
      co2Emissions: baselineEmissions,
      setAt: setAt ? new Date(setAt) : new Date(),
      assessmentId: resolvedAssessmentId,
      source: source || 'platform',
      notes: notes || ''
    };

    msmeCredits.markModified('registryIntegration');
    await msmeCredits.save();

    const syncMetadata = this.buildRegistryMetadata({
      ...metadata,
      workflow: workflowState.workflowId,
      workflowStage: 'baseline_setting',
      baselineCO2Emissions: baselineEmissions
    }, { operation: 'icm_workflow' });

    if (syncRegistry) {
      try {
        await this.syncMSMECreditsWithRegistry(msmeId, syncMetadata);
      } catch (error) {
        logger.warn(`Failed to sync ICM baseline state for MSME ${msmeId}`, {
          error: error.message
        });
      }
    }

    return {
      workflowId: workflowState.workflowId,
      baseline: {
        co2Emissions: baselineEmissions,
        setAt: workflowState.baseline.setAt,
        assessmentId: resolvedAssessmentId,
        source: workflowState.baseline.source,
        notes: workflowState.baseline.notes
      }
    };
  }

  async trackICMEmissionReduction(msmeId, options = {}) {
    const {
      assessmentId,
      currentCO2Emissions,
      measuredAt,
      note = '',
      source = 'platform',
      syncRegistry = false,
      metadata = {}
    } = options;

    const msmeCredits = await this.getMSMECredits(msmeId);
    const workflowState = this.ensureICMWorkflowState(msmeCredits, metadata.workflow || 'Platform');
    const baselineEmissions = this.getSafeNumber(workflowState.baseline?.co2Emissions);

    if (baselineEmissions <= 0) {
      throw new Error('ICM workflow baseline is not set');
    }

    let resolvedAssessmentId = null;
    let latestCo2Emissions = this.getSafeNumber(currentCO2Emissions);

    if (assessmentId) {
      const assessment = await this.resolveAssessmentById(assessmentId);
      latestCo2Emissions = this.getSafeNumber(assessment.totalCO2Emissions);
      resolvedAssessmentId = assessment._id;
    }

    if (latestCo2Emissions < 0) {
      throw new Error('Current CO2 emissions must be zero or greater');
    }

    const reductionKgCO2 = Math.max(0, baselineEmissions - latestCo2Emissions);
    const reductionPercent = baselineEmissions > 0
      ? (reductionKgCO2 / baselineEmissions) * 100
      : 0;

    const reductionEntry = {
      measuredAt: measuredAt ? new Date(measuredAt) : new Date(),
      co2Emissions: latestCo2Emissions,
      reductionKgCO2: this.roundTo(reductionKgCO2, 4),
      reductionPercent: this.roundTo(reductionPercent, 2),
      source: source || 'platform',
      note: note || '',
      metadata: {
        assessmentId: resolvedAssessmentId
      }
    };

    workflowState.reductionTracking.latestCo2Emissions = reductionEntry.co2Emissions;
    workflowState.reductionTracking.latestReductionKgCO2 = reductionEntry.reductionKgCO2;
    workflowState.reductionTracking.latestReductionPercent = reductionEntry.reductionPercent;
    workflowState.reductionTracking.lastEvaluatedAt = reductionEntry.measuredAt;
    workflowState.reductionTracking.history.push(reductionEntry);

    msmeCredits.markModified('registryIntegration');
    await msmeCredits.save();

    const syncMetadata = this.buildRegistryMetadata({
      ...metadata,
      workflow: workflowState.workflowId,
      workflowStage: 'emission_reduction_tracking',
      baselineCO2Emissions: baselineEmissions,
      currentCO2Emissions: latestCo2Emissions,
      reductionKgCO2: reductionEntry.reductionKgCO2,
      reductionPercent: reductionEntry.reductionPercent
    }, { operation: 'icm_workflow' });

    if (syncRegistry) {
      try {
        await this.syncMSMECreditsWithRegistry(msmeId, syncMetadata);
      } catch (error) {
        logger.warn(`Failed to sync ICM reduction tracking for MSME ${msmeId}`, {
          error: error.message
        });
      }
    }

    return {
      workflowId: workflowState.workflowId,
      baselineCO2Emissions: baselineEmissions,
      currentCO2Emissions: latestCo2Emissions,
      reductionKgCO2: reductionEntry.reductionKgCO2,
      reductionPercent: reductionEntry.reductionPercent,
      trackedAt: reductionEntry.measuredAt,
      assessmentId: resolvedAssessmentId
    };
  }

  async quantifyICMCredits(msmeId, options = {}) {
    const {
      reductionKgCO2,
      creditPerKgCO2,
      method = 'baseline_delta',
      quantifiedAt,
      source = 'platform',
      applyToAccount = false,
      syncRegistry = false,
      metadata = {}
    } = options;

    const msmeCredits = await this.getMSMECredits(msmeId);
    const workflowState = this.ensureICMWorkflowState(msmeCredits, metadata.workflow || 'Platform');

    const resolvedReduction = this.getSafeNumber(
      reductionKgCO2 !== undefined
        ? reductionKgCO2
        : workflowState.reductionTracking?.latestReductionKgCO2
    );
    if (resolvedReduction <= 0) {
      throw new Error('Reduction amount must be greater than zero to quantify credits');
    }

    const quantificationFactor = this.getSafeNumber(creditPerKgCO2)
      || this.getSafeNumber(workflowState.creditQuantification.creditPerKgCO2)
      || this.creditPerKgCO2;
    if (quantificationFactor <= 0) {
      throw new Error('Credit quantification factor must be greater than zero');
    }

    const quantifiedCredits = this.roundTo(resolvedReduction * quantificationFactor, 4);
    const quantificationEntry = {
      quantifiedAt: quantifiedAt ? new Date(quantifiedAt) : new Date(),
      method: method || 'baseline_delta',
      reductionKgCO2: this.roundTo(resolvedReduction, 4),
      credits: quantifiedCredits,
      source: source || 'platform'
    };

    workflowState.creditQuantification.creditPerKgCO2 = quantificationFactor;
    workflowState.creditQuantification.latestQuantifiedCredits = quantifiedCredits;
    workflowState.creditQuantification.totalQuantifiedCredits = this.roundTo(
      this.getSafeNumber(workflowState.creditQuantification.totalQuantifiedCredits) + quantifiedCredits,
      4
    );
    workflowState.creditQuantification.lastQuantifiedAt = quantificationEntry.quantifiedAt;
    workflowState.creditQuantification.history.push(quantificationEntry);

    if (applyToAccount && quantifiedCredits > 0) {
      const allocationReferenceId = `ICM_QUANT_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      msmeCredits.allocatedCredits += quantifiedCredits;
      msmeCredits.availableCredits += quantifiedCredits;
      msmeCredits.totalCO2Reduced += quantificationEntry.reductionKgCO2;

      msmeCredits.allocationHistory.push({
        date: quantificationEntry.quantifiedAt,
        creditsAllocated: quantifiedCredits,
        co2Reduced: quantificationEntry.reductionKgCO2,
        allocationMethod: 'hybrid',
        assessmentId: workflowState.baseline?.assessmentId || null
      });

      msmeCredits.transactions.push({
        type: 'allocation',
        amount: quantifiedCredits,
        description: `ICM workflow quantified credits via ${quantificationEntry.method}`,
        referenceId: allocationReferenceId,
        status: 'completed',
        metadata: {
          workflow: workflowState.workflowId,
          quantificationMethod: quantificationEntry.method,
          reductionKgCO2: quantificationEntry.reductionKgCO2
        }
      });
    }

    msmeCredits.markModified('registryIntegration');
    await msmeCredits.save();

    const syncMetadata = this.buildRegistryMetadata({
      ...metadata,
      workflow: workflowState.workflowId,
      workflowStage: 'credit_quantification',
      creditPerKgCO2: quantificationFactor,
      reductionKgCO2: quantificationEntry.reductionKgCO2,
      quantifiedCredits,
      method: quantificationEntry.method
    }, { operation: 'icm_workflow' });

    if (syncRegistry) {
      try {
        await this.syncMSMECreditsWithRegistry(msmeId, syncMetadata);
      } catch (error) {
        logger.warn(`Failed to sync ICM credit quantification for MSME ${msmeId}`, {
          error: error.message
        });
      }
    }

    return {
      workflowId: workflowState.workflowId,
      reductionKgCO2: quantificationEntry.reductionKgCO2,
      creditPerKgCO2: quantificationFactor,
      quantifiedCredits,
      totalQuantifiedCredits: workflowState.creditQuantification.totalQuantifiedCredits,
      appliedToAccount: Boolean(applyToAccount),
      quantifiedAt: quantificationEntry.quantifiedAt,
      method: quantificationEntry.method
    };
  }

  async getICMWorkflowState(msmeId) {
    const msmeCredits = await this.getMSMECredits(msmeId);
    const workflowState = this.ensureICMWorkflowState(msmeCredits, 'Platform');
    const summary = this.getCreditSummary(msmeCredits);

    return {
      workflowId: workflowState.workflowId,
      baseline: workflowState.baseline,
      reductionTracking: workflowState.reductionTracking,
      creditQuantification: workflowState.creditQuantification,
      accountSummary: summary
    };
  }

  buildRegistryMetadata(metadata = {}, options = {}) {
    const safeMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...metadata }
      : {};

    const workflowHint = (
      safeMetadata.icmWorkflow
      || safeMetadata.workflow
      || safeMetadata.workflowType
      || safeMetadata.sourceWorkflow
    );
    const resolvedWorkflow = this.resolveICMWorkflowIdentifier(workflowHint);

    if (resolvedWorkflow) {
      if (workflowHint && workflowHint !== resolvedWorkflow) {
        safeMetadata.workflowInput = workflowHint;
      }
      safeMetadata.icmWorkflow = resolvedWorkflow;
      safeMetadata.workflow = resolvedWorkflow;
    }

    if (options.operation && !safeMetadata.operation) {
      safeMetadata.operation = options.operation;
    }

    return safeMetadata;
  }

  buildRegistrySyncPayload(msmeCredits, metadata = {}) {
    return {
      poolId: this.poolId,
      msmeId: this.getMSMEIdValue(msmeCredits),
      localBalances: {
        allocatedCredits: this.getSafeNumber(msmeCredits.allocatedCredits),
        availableCredits: this.getSafeNumber(msmeCredits.availableCredits),
        usedCredits: this.getSafeNumber(msmeCredits.usedCredits),
        retiredCredits: this.getSafeNumber(msmeCredits.retiredCredits),
        totalCO2Reduced: this.getSafeNumber(msmeCredits.totalCO2Reduced)
      },
      summary: this.getCreditSummary(msmeCredits),
      metadata: this.buildRegistryMetadata(metadata, { operation: 'sync' })
    };
  }

  extractRegistrySnapshot(registryResponse) {
    const registryPayload = registryResponse?.data || registryResponse || {};
    return {
      externalAccountId: registryPayload.externalAccountId || registryPayload.accountId || null,
      availableCredits: this.getSafeNumber(
        registryPayload.availableCredits ?? registryPayload.creditBalance ?? registryPayload.balance?.available
      ),
      retiredCredits: this.getSafeNumber(registryPayload.retiredCredits ?? registryPayload.balance?.retired),
      totalCredits: this.getSafeNumber(registryPayload.totalCredits ?? registryPayload.balance?.total),
      lastUpdatedAt: registryPayload.lastUpdatedAt || registryPayload.updatedAt || null,
      raw: registryPayload
    };
  }

  async updateRegistrySyncState(msmeCredits, options = {}) {
    const snapshot = options.snapshot || {};
    msmeCredits.registryIntegration = msmeCredits.registryIntegration || {};
    msmeCredits.registryIntegration.enabled = this.registryClient.isConfigured();
    msmeCredits.registryIntegration.lastSyncedAt = new Date();
    msmeCredits.registryIntegration.lastSyncStatus = options.status || 'success';
    msmeCredits.registryIntegration.lastSyncError = options.error || '';

    if (snapshot.externalAccountId) {
      msmeCredits.registryIntegration.externalAccountId = snapshot.externalAccountId;
    }

    const hasRemoteBalanceData = (
      snapshot.availableCredits !== undefined ||
      snapshot.retiredCredits !== undefined ||
      snapshot.totalCredits !== undefined ||
      snapshot.lastUpdatedAt !== undefined
    );
    if (hasRemoteBalanceData) {
      msmeCredits.registryIntegration.remoteBalances = {
        availableCredits: this.getSafeNumber(snapshot.availableCredits),
        retiredCredits: this.getSafeNumber(snapshot.retiredCredits),
        totalCredits: this.getSafeNumber(snapshot.totalCredits),
        lastUpdatedAt: snapshot.lastUpdatedAt ? new Date(snapshot.lastUpdatedAt) : null
      };
    }

    if (options.payload) {
      msmeCredits.registryIntegration.lastSyncPayload = options.payload;
    }

    if (snapshot.raw) {
      msmeCredits.registryIntegration.lastSyncResponse = snapshot.raw;
    }

    msmeCredits.markModified('registryIntegration');
    await msmeCredits.save();
  }

  async getRegistryHealthStatus() {
    const status = this.getRegistryIntegrationStatus();
    if (!status.configured) {
      const error = new Error('Indian carbon market registry integration is not configured');
      error.statusCode = 503;
      throw error;
    }

    return this.registryClient.getHealthStatus();
  }

  async getMSMECreditsFromRegistry(msmeId) {
    const msmeCredits = await this.getMSMECredits(msmeId);
    try {
      const registryResponse = await this.registryClient.getMSMECredits(msmeId);
      const snapshot = this.extractRegistrySnapshot(registryResponse);
      await this.updateRegistrySyncState(msmeCredits, {
        status: 'success',
        snapshot
      });

      return {
        local: this.getCreditSummary(msmeCredits),
        registry: snapshot
      };
    } catch (error) {
      await this.updateRegistrySyncState(msmeCredits, {
        status: 'failed',
        error: error.message
      });
      throw error;
    }
  }

  async syncMSMECreditsWithRegistry(msmeId, metadata = {}) {
    const msmeCredits = await this.getMSMECredits(msmeId);
    const payload = this.buildRegistrySyncPayload(msmeCredits, metadata);

    try {
      const registryResponse = await this.registryClient.syncMSMECredits(msmeId, payload);
      const snapshot = this.extractRegistrySnapshot(registryResponse);
      await this.updateRegistrySyncState(msmeCredits, {
        status: 'success',
        payload,
        snapshot
      });

      return {
        local: this.getCreditSummary(msmeCredits),
        registry: snapshot,
        syncedAt: new Date().toISOString()
      };
    } catch (error) {
      await this.updateRegistrySyncState(msmeCredits, {
        status: 'failed',
        payload,
        error: error.message
      });
      throw error;
    }
  }

  async recordRetirementInRegistry(msmeId, amount, reason, msmeCredits) {
    if (!this.registryClient.isConfigured()) {
      return null;
    }

    const payload = {
      poolId: this.poolId,
      amount: this.getSafeNumber(amount),
      reason,
      retiredAt: new Date().toISOString(),
      localBalances: {
        availableCredits: this.getSafeNumber(msmeCredits.availableCredits),
        retiredCredits: this.getSafeNumber(msmeCredits.retiredCredits)
      },
      metadata: this.buildRegistryMetadata(
        { workflow: 'Platform', reason },
        { operation: 'retirement' }
      )
    };

    try {
      const registryResponse = await this.registryClient.recordRetirement(msmeId, payload);
      const snapshot = this.extractRegistrySnapshot(registryResponse);
      await indianCarbonMarketIntegration.persistRetirementProof(msmeCredits, registryResponse);
      await this.updateRegistrySyncState(msmeCredits, {
        status: 'success',
        payload,
        snapshot
      });
      return snapshot;
    } catch (error) {
      await this.updateRegistrySyncState(msmeCredits, {
        status: 'failed',
        payload,
        error: error.message
      });
      logger.warn(`Failed to push retirement to Indian carbon market registry for MSME ${msmeId}`, {
        error: error.message
      });
      return null;
    }
  }

  // Build a dashboard-friendly summary of green credits activity.
  getCreditSummary(msmeCredits) {
    if (!msmeCredits) {
      return {
        earnedCredits: 0,
        transferredInCredits: 0,
        transferredOutCredits: 0,
        netTransferredCredits: 0,
        availableCredits: 0,
        usedCredits: 0,
        retiredCredits: 0,
        totalCreditsInAccount: 0
      };
    }

    const allocationHistory = Array.isArray(msmeCredits.allocationHistory)
      ? msmeCredits.allocationHistory
      : [];
    const transactions = Array.isArray(msmeCredits.transactions)
      ? msmeCredits.transactions
      : [];

    const earnedCredits = allocationHistory.reduce((sum, entry) => {
      if (entry?.allocationMethod === 'transfer') return sum;
      return sum + this.getSafeNumber(entry?.creditsAllocated);
    }, 0);

    // Legacy support: older transfers were captured as usage entries.
    const legacyTransferredOutCredits = transactions.reduce((sum, entry) => {
      if (
        entry?.type === 'usage' &&
        typeof entry?.referenceId === 'string' &&
        entry.referenceId.startsWith('TRANSFER_')
      ) {
        return sum + this.getSafeNumber(entry?.amount);
      }
      return sum;
    }, 0);

    const transferredInCreditsFromTransactions = transactions.reduce((sum, entry) => {
      if (entry?.type === 'transfer' && entry?.metadata?.direction === 'in') {
        return sum + this.getSafeNumber(entry?.amount);
      }
      return sum;
    }, 0);

    const transferredOutCreditsFromTransactions = transactions.reduce((sum, entry) => {
      if (entry?.type === 'transfer' && entry?.metadata?.direction === 'out') {
        return sum + this.getSafeNumber(entry?.amount);
      }
      return sum;
    }, 0);

    // Legacy support: older transfers-in were saved as allocation entries.
    const legacyTransferredInCredits = allocationHistory.reduce((sum, entry) => {
      if (entry?.allocationMethod === 'transfer') {
        return sum + this.getSafeNumber(entry?.creditsAllocated);
      }
      return sum;
    }, 0);

    const transferredInCredits = transferredInCreditsFromTransactions + legacyTransferredInCredits;
    const transferredOutCredits = transferredOutCreditsFromTransactions + legacyTransferredOutCredits;
    const netTransferredCredits = transferredInCredits - transferredOutCredits;
    const availableCredits = this.getSafeNumber(msmeCredits.availableCredits);
    const usedCredits = this.getSafeNumber(msmeCredits.usedCredits);
    const retiredCredits = this.getSafeNumber(msmeCredits.retiredCredits);

    return {
      earnedCredits,
      transferredInCredits,
      transferredOutCredits,
      netTransferredCredits,
      availableCredits,
      usedCredits,
      retiredCredits,
      totalCreditsInAccount: availableCredits + usedCredits + retiredCredits
    };
  }

  // Initialize the carbon credits pool
  async initializePool() {
    try {
      let pool = await CarbonCredits.findOne({ poolId: this.poolId });
      
      if (!pool) {
        pool = new CarbonCredits({
          poolId: this.poolId,
          currentPricePerCredit: 50, // ₹50 per credit
          verificationStatus: 'pending'
        });
        await pool.save();
        logger.info('Carbon credits pool initialized');
      }
      
      return pool;
    } catch (error) {
      logger.error('Error initializing carbon credits pool:', error);
      throw error;
    }
  }

  // Aggregate carbon savings from all MSMEs and allocate credits
  async aggregateAndAllocateCredits(period = 'monthly') {
    try {
      const pool = await this.initializePool();
      
      // Calculate period date range
      const now = new Date();
      let startDate, endDate;
      
      if (period === 'monthly') {
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0);
      } else if (period === 'quarterly') {
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
        endDate = new Date(now.getFullYear(), (quarter + 1) * 3, 0);
      } else { // yearly
        startDate = new Date(now.getFullYear() - 1, 0, 1);
        endDate = new Date(now.getFullYear() - 1, 11, 31);
      }

      // Get all MSMEs with carbon assessments in the period
      const assessments = await CarbonAssessment.find({
        'period.startDate': { $gte: startDate },
        'period.endDate': { $lte: endDate },
        status: { $in: ['completed', 'reviewed', 'approved'] },
        msmeId: { $exists: true, $ne: null },
        source: { $ne: 'mobile' }
      }).populate('msmeId');

      if (assessments.length === 0) {
        logger.warn('No carbon assessments found for the period');
        return { success: false, message: 'No assessments found for the period' };
      }

      const msmeObjectIds = [
        ...new Set(
          assessments
            .filter((a) => a.msmeId && a.msmeId._id)
            .map((a) => a.msmeId._id)
        )
      ];

      const creditRows = await MSMECarbonCredits.find({ msmeId: { $in: msmeObjectIds } })
        .select('msmeId registryIntegration.icmWorkflow.baseline')
        .lean();

      const baselineByMsme = new Map();
      for (const row of creditRows) {
        const idStr = row.msmeId ? row.msmeId.toString() : '';
        if (!idStr) continue;
        const baselineEmissions = this.getSafeNumber(row.registryIntegration?.icmWorkflow?.baseline?.co2Emissions);
        const setAt = row.registryIntegration?.icmWorkflow?.baseline?.setAt;
        baselineByMsme.set(idStr, baselineEmissions > 0 && setAt ? baselineEmissions : null);
      }

      // Calculate total CO2 reduced and group by MSME
      const msmeSavings = {};
      let totalCO2Reduced = 0;

      for (const assessment of assessments) {
        if (!assessment.msmeId || !assessment.msmeId._id) {
          continue;
        }
        const msmeId = assessment.msmeId._id.toString();

        if (!msmeSavings[msmeId]) {
          msmeSavings[msmeId] = {
            msme: assessment.msmeId,
            totalCO2Reduced: 0,
            assessments: []
          };
        }

        const baselineCo2 = baselineByMsme.get(msmeId) ?? null;
        const co2Reduced = this.calculateCO2Reduction(assessment, baselineCo2);
        msmeSavings[msmeId].totalCO2Reduced += co2Reduced;
        msmeSavings[msmeId].assessments.push(assessment);
        totalCO2Reduced += co2Reduced;
      }

      // Calculate total credits to be allocated
      const totalCreditsToAllocate = Math.floor(totalCO2Reduced * this.creditPerKgCO2);
      
      if (totalCreditsToAllocate < this.minimumCreditsThreshold) {
        logger.warn(`Total credits to allocate (${totalCreditsToAllocate}) below threshold (${this.minimumCreditsThreshold})`);
        return { success: false, message: 'Insufficient carbon savings for credit allocation' };
      }

      // Allocate credits to each MSME
      const allocationResults = [];
      
      for (const [msmeId, data] of Object.entries(msmeSavings)) {
        try {
          const creditsToAllocate = Math.floor(data.totalCO2Reduced * this.creditPerKgCO2);
          
          if (creditsToAllocate > 0) {
            const result = await this.allocateCreditsToMSME(
              msmeId,
              creditsToAllocate,
              data.totalCO2Reduced,
              'proportional',
              data.assessments[0]._id
            );
            
            allocationResults.push({
              msmeId,
              companyName: data.msme.companyName,
              creditsAllocated: creditsToAllocate,
              co2Reduced: data.totalCO2Reduced,
              success: true
            });
          }
        } catch (error) {
          logger.error(`Error allocating credits to MSME ${msmeId}:`, error);
          allocationResults.push({
            msmeId,
            companyName: data.msme.companyName,
            creditsAllocated: 0,
            co2Reduced: data.totalCO2Reduced,
            success: false,
            error: error.message
          });
        }
      }

      // Update pool statistics
      pool.totalCreditsAvailable += totalCreditsToAllocate;
      pool.totalCreditsIssued += totalCreditsToAllocate;
      pool.totalCO2Reduced += totalCO2Reduced;
      pool.totalMSMEParticipants = Object.keys(msmeSavings).length;
      pool.lastAggregationDate = new Date();
      
      await pool.save();

      logger.info(`Carbon credits aggregated and allocated`, {
        period,
        totalCO2Reduced,
        totalCreditsAllocated: totalCreditsToAllocate,
        msmeCount: Object.keys(msmeSavings).length,
        successfulAllocations: allocationResults.filter(r => r.success).length
      });

      return {
        success: true,
        data: {
          period,
          totalCO2Reduced,
          totalCreditsAllocated: totalCreditsToAllocate,
          msmeCount: Object.keys(msmeSavings).length,
          allocations: allocationResults,
          poolStats: {
            totalCreditsAvailable: pool.totalCreditsAvailable,
            totalCreditsIssued: pool.totalCreditsIssued,
            totalCO2Reduced: pool.totalCO2Reduced,
            totalMSMEParticipants: pool.totalMSMEParticipants
          }
        }
      };

    } catch (error) {
      logger.error('Error in aggregateAndAllocateCredits:', error);
      throw error;
    }
  }

  // Allocate credits to a specific MSME
  async allocateCreditsToMSME(msmeId, creditsAmount, co2Reduced, method, assessmentId) {
    try {
      let msmeCredits = await MSMECarbonCredits.findOne({ msmeId });
      
      if (!msmeCredits) {
        msmeCredits = new MSMECarbonCredits({
          msmeId,
          poolId: this.poolId
        });
      }

      await msmeCredits.allocateCredits(creditsAmount, co2Reduced, method, assessmentId);
      await msmeCredits.updatePerformanceMetrics();

      logger.info(`Credits allocated to MSME ${msmeId}`, {
        creditsAmount,
        co2Reduced,
        method
      });

      return msmeCredits;
    } catch (error) {
      logger.error(`Error allocating credits to MSME ${msmeId}:`, error);
      throw error;
    }
  }

  // Get MSME carbon credits
  async getMSMECredits(msmeId) {
    try {
      let msmeCredits = await MSMECarbonCredits.findOne({ msmeId })
        .populate('msmeId', 'companyName companyType industry');
      
      if (!msmeCredits) {
        // Create new record if doesn't exist
        msmeCredits = new MSMECarbonCredits({
          msmeId,
          poolId: this.poolId
        });
        await msmeCredits.save();
      }

      return msmeCredits;
    } catch (error) {
      logger.error(`Error getting MSME credits for ${msmeId}:`, error);
      throw error;
    }
  }

  // Use credits for a specific purpose
  async useCredits(msmeId, amount, purpose, referenceId) {
    try {
      const msmeCredits = await this.getMSMECredits(msmeId);
      
      if (msmeCredits.availableCredits < amount) {
        throw new Error('Insufficient credits available');
      }

      await msmeCredits.useCredits(amount, purpose, referenceId);

      logger.info(`Credits used by MSME ${msmeId}`, {
        amount,
        purpose,
        remainingCredits: msmeCredits.availableCredits
      });

      return msmeCredits;
    } catch (error) {
      logger.error(`Error using credits for MSME ${msmeId}:`, error);
      throw error;
    }
  }

  // Transfer credits between MSMEs while preserving transfer-specific audit trails.
  async transferCredits(fromMSMEId, toMSMEId, amount, description) {
    try {
      const normalizedAmount = this.getSafeNumber(amount);
      if (normalizedAmount <= 0) {
        throw new Error('Valid transfer amount is required');
      }

      const sourceId = fromMSMEId?.toString();
      const destinationId = toMSMEId?.toString();

      if (!sourceId || !destinationId) {
        throw new Error('Valid sender and recipient MSME IDs are required');
      }

      if (sourceId === destinationId) {
        throw new Error('Cannot transfer credits to yourself');
      }

      await this.getMSMECredits(sourceId);
      await this.getMSMECredits(destinationId);

      const transferReferenceId = `TRANSFER_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      const senderTransaction = {
        type: 'transfer',
        amount: normalizedAmount,
        description: description || `Credits transferred to MSME ${destinationId}`,
        referenceId: transferReferenceId,
        status: 'completed',
        metadata: {
          direction: 'out',
          counterpartyMSMEId: destinationId
        }
      };

      const recipientTransaction = {
        type: 'transfer',
        amount: normalizedAmount,
        description: description || `Credits received from MSME ${sourceId}`,
        referenceId: transferReferenceId,
        status: 'completed',
        metadata: {
          direction: 'in',
          counterpartyMSMEId: sourceId
        }
      };

      const fromCredits = await MSMECarbonCredits.findOneAndUpdate(
        {
          msmeId: sourceId,
          availableCredits: { $gte: normalizedAmount }
        },
        {
          $inc: { availableCredits: -normalizedAmount },
          $push: { transactions: senderTransaction }
        },
        { new: true }
      );

      if (!fromCredits) {
        throw new Error('Insufficient credits available');
      }

      try {
        const toCredits = await MSMECarbonCredits.findOneAndUpdate(
          { msmeId: destinationId },
          {
            $inc: { availableCredits: normalizedAmount },
            $push: { transactions: recipientTransaction }
          },
          { new: true }
        );

        if (!toCredits) {
          throw new Error('Recipient carbon credits record not found');
        }

        logger.info(`Credits transferred from MSME ${sourceId} to ${destinationId}`, {
          amount: normalizedAmount,
          referenceId: transferReferenceId,
          remainingSenderCredits: fromCredits.availableCredits,
          recipientCredits: toCredits.availableCredits
        });

        return {
          referenceId: transferReferenceId,
          fromCredits,
          toCredits
        };
      } catch (creditError) {
        await MSMECarbonCredits.updateOne(
          { msmeId: sourceId },
          {
            $inc: { availableCredits: normalizedAmount },
            $pull: { transactions: { referenceId: transferReferenceId } }
          }
        );
        throw creditError;
      }
    } catch (error) {
      logger.error(`Error transferring credits from MSME ${fromMSMEId} to ${toMSMEId}:`, error);
      throw error;
    }
  }

  // Retire credits (permanent removal from circulation)
  async retireCredits(msmeId, amount, reason) {
    try {
      const normalizedAmount = this.getSafeNumber(amount);
      if (normalizedAmount <= 0) {
        throw new Error('Valid retirement amount is required');
      }

      const msmeKey = msmeId?.toString();
      if (!msmeKey) {
        throw new Error('Valid MSME id is required');
      }

      const referenceId = `RETIRE_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const retirementEntry = {
        type: 'retirement',
        amount: normalizedAmount,
        description: reason || 'Credits retired',
        referenceId,
        status: 'completed'
      };

      const msmeCredits = await MSMECarbonCredits.findOneAndUpdate(
        {
          msmeId: msmeKey,
          availableCredits: { $gte: normalizedAmount }
        },
        {
          $inc: {
            availableCredits: -normalizedAmount,
            retiredCredits: normalizedAmount
          },
          $push: { transactions: retirementEntry }
        },
        { new: true }
      );

      if (!msmeCredits) {
        throw new Error('Insufficient credits available');
      }

      try {
        const pool = await CarbonCredits.findOneAndUpdate(
          { poolId: this.poolId },
          { $inc: { totalCreditsRetired: normalizedAmount } },
          { new: true }
        );

        if (!pool) {
          logger.warn(`Carbon credits pool ${this.poolId} not found during retirement; MSME balance updated only`);
        }
      } catch (poolError) {
        await MSMECarbonCredits.updateOne(
          { msmeId: msmeKey },
          {
            $inc: {
              availableCredits: normalizedAmount,
              retiredCredits: -normalizedAmount
            },
            $pull: { transactions: { referenceId } }
          }
        );
        throw poolError;
      }

      logger.info(`Credits retired by MSME ${msmeKey}`, {
        amount: normalizedAmount,
        reason,
        remainingCredits: msmeCredits.availableCredits
      });

      await this.recordRetirementInRegistry(msmeKey, normalizedAmount, reason, msmeCredits);

      return msmeCredits;
    } catch (error) {
      logger.error(`Error retiring credits for MSME ${msmeId}:`, error);
      throw error;
    }
  }

  // Get carbon credits market data
  async getMarketData() {
    try {
      const pool = await CarbonCredits.findOne({ poolId: this.poolId });
      
      if (!pool) {
        await this.initializePool();
        return await this.getMarketData();
      }

      // Get recent transactions
      const recentTransactions = await CarbonCreditTransaction.find({
        poolId: this.poolId,
        status: 'completed'
      })
      .populate('fromMSME', 'companyName')
      .populate('toMSME', 'companyName')
      .sort({ createdAt: -1 })
      .limit(10);

      // Get MSME participation stats
      const msmeStats = await MSMECarbonCredits.aggregate([
        {
          $group: {
            _id: null,
            totalMSMEs: { $sum: 1 },
            totalAllocatedCredits: { $sum: '$allocatedCredits' },
            totalAvailableCredits: { $sum: '$availableCredits' },
            totalUsedCredits: { $sum: '$usedCredits' },
            totalRetiredCredits: { $sum: '$retiredCredits' },
            totalCO2Reduced: { $sum: '$totalCO2Reduced' }
          }
        }
      ]);

      return {
        pool: pool,
        recentTransactions,
        msmeStats: msmeStats[0] || {},
        marketMetrics: {
          averagePrice: pool.currentPricePerCredit,
          totalVolume: recentTransactions.reduce((sum, t) => sum + t.creditsAmount, 0),
          activeMSMEs: msmeStats[0]?.totalMSMEs || 0
        }
      };
    } catch (error) {
      logger.error('Error getting market data:', error);
      throw error;
    }
  }

  // CO2 reduction vs ICM baseline (no baseline => no phantom credits)
  calculateCO2Reduction(assessment, baselineCo2Emissions = null) {
    const baseline = this.getSafeNumber(baselineCo2Emissions);
    if (baseline <= 0) {
      return 0;
    }
    const current = this.getSafeNumber(assessment.totalCO2Emissions);
    if (!Number.isFinite(current)) {
      return 0;
    }
    return Math.max(0, baseline - current);
  }

  // Get MSME leaderboard based on carbon credits
  async getMSMELeaderboard(limit = 10, period = 'all') {
    try {
      let matchStage = {};
      
      if (period !== 'all') {
        const days = period === 'monthly' ? 30 : period === 'quarterly' ? 90 : 365;
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        matchStage = {
          'allocationHistory.date': { $gte: cutoffDate }
        };
      }

      const leaderboard = await MSMECarbonCredits.aggregate([
        { $match: matchStage },
        {
          $lookup: {
            from: 'msmes',
            localField: 'msmeId',
            foreignField: '_id',
            as: 'msme'
          }
        },
        { $unwind: '$msme' },
        {
          $project: {
            msmeId: 1,
            companyName: '$msme.companyName',
            companyType: '$msme.companyType',
            industry: '$msme.industry',
            allocatedCredits: 1,
            availableCredits: 1,
            usedCredits: 1,
            totalCO2Reduced: 1,
            performanceMetrics: 1,
            recentAllocations: {
              $slice: ['$allocationHistory', -3] // Last 3 allocations
            }
          }
        },
        { $sort: { 'performanceMetrics.participationScore': -1 } },
        { $limit: parseInt(limit) }
      ]);

      return leaderboard;
    } catch (error) {
      logger.error('Error getting MSME leaderboard:', error);
      throw error;
    }
  }

  // Create carbon credit transaction
  async createTransaction(transactionData) {
    try {
      const transaction = new CarbonCreditTransaction({
        ...transactionData,
        transactionId: `CCT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        poolId: this.poolId
      });

      await transaction.save();

      logger.info(`Carbon credit transaction created: ${transaction.transactionId}`);
      return transaction;
    } catch (error) {
      logger.error('Error creating carbon credit transaction:', error);
      throw error;
    }
  }

  // Verify carbon credits pool
  async verifyPool(verifiedBy, notes) {
    try {
      const pool = await CarbonCredits.findOne({ poolId: this.poolId });
      
      if (!pool) {
        throw new Error('Carbon credits pool not found');
      }

      pool.verificationStatus = 'verified';
      pool.verifiedBy = verifiedBy;
      pool.verifiedAt = new Date();
      pool.verificationNotes = notes;
      pool.indianCarbonMarketCompliance.isCompliant = true;
      pool.indianCarbonMarketCompliance.complianceDate = new Date();

      await pool.save();

      logger.info(`Carbon credits pool verified by ${verifiedBy}`);
      return pool;
    } catch (error) {
      logger.error('Error verifying carbon credits pool:', error);
      throw error;
    }
  }
}

module.exports = new CarbonCreditsService();