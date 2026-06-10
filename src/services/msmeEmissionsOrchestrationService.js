const aiAgentService = require('./aiAgentService');
const agentOrchestrationCuratorService = require('./agentOrchestrationCuratorService');
const msmeEmissionsCuratedExecutor = require('./msmeEmissionsCuratedExecutor');
const carbonCalculationService = require('./carbonCalculationService');
const { buildValueChainReport } = require('./valueChainReportingService');
const Document = require('../models/Document');
const { extractDynamicParameters } = require('./dynamicParameterExtractionService');
const { normalizeManufacturingProfile } = require('../utils/manufacturingProfile');
const AIAgent = require('../models/AIAgent');
const MSME = require('../models/MSME');
const logger = require('../utils/logger');
const { runGhgInventoryGovernanceOrchestration } = require('./ghgInventoryGovernanceOrchestrator');
const { resolveRegionFromState } = require('../constants/indianRegions');
const { ORCHESTRATION_ISO_FRAMEWORK_DEFAULTS } = require('../constants/isoFrameworkDefaults');

const BEHAVIOR_DEFINITIONS = {
  energy: {
    label: 'Energy Use',
    categories: ['energy', 'electricity', 'fuel', 'diesel', 'petrol', 'gas', 'lpg', 'natural_gas', 'coal', 'biomass']
  },
  water: {
    label: 'Water Use',
    categories: ['water', 'water_supply', 'water_treatment', 'wastewater']
  },
  waste: {
    label: 'Waste Generation',
    categories: ['waste_management', 'waste', 'hazardous_waste', 'recycling', 'scrap']
  },
  transportation: {
    label: 'Transportation',
    categories: ['transportation']
  },
  materials: {
    label: 'Material Inputs',
    categories: ['raw_materials', 'materials', 'chemicals', 'packaging', 'consumables']
  },
  manufacturing: {
    label: 'Operations and Equipment',
    categories: ['equipment', 'maintenance', 'machinery', 'process']
  },
  other: {
    label: 'Other Activities',
    categories: ['utilities', 'services', 'other', 'misc', 'air_pollution', 'air_emissions']
  }
};

const ORCHESTRATION_DEFAULTS = {
  thresholds: {
    minTransactionsForAnomaly: 20,
    minTransactionsForTrends: 12,
    energyShareHigh: 0.2,
    wasteShareHigh: 0.1,
    transportShareHigh: 0.15,
    materialsShareHigh: 0.15,
    manufacturingShareHigh: 0.12,
    highValueAmount: 250000
  },
  weights: {
    completeness: 0.4,
    consistency: 0.3,
    coverage: 0.3
  },
  orchestration: {
    preferParallel: true,
    continueOnPartialFailures: true,
    emitRecommendations: true,
    emitReport: true,
    onDemandAgents: true,
    maxParallelAgents: null,
    skipDocumentAnalysisWhenEmpty: true
  },
  tuning: {
    anomalySensitivity: 'medium',
    trendHorizonMonths: 6,
    optimizationDepth: 'standard',
    complianceStrictness: 'standard'
  },
  frameworks: JSON.parse(JSON.stringify(ORCHESTRATION_ISO_FRAMEWORK_DEFAULTS))
};

class OrchestrationManagerService {
  async orchestrateEmissions({
    msmeId,
    msmeData,
    transactions = [],
    documents = [],
    behaviorOverrides = {},
    contextOverrides = {}
  }) {
    if (!Array.isArray(transactions) || transactions.length === 0) {
      throw new Error('Transactions data is required for emissions orchestration');
    }

    const msmeProfile = msmeData || await MSME.findById(msmeId).lean();
    if (!msmeProfile) {
      throw new Error('MSME profile not found for orchestration');
    }

    const orchestrationId = `orch_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const normalizedTransactions = transactions.map(transaction =>
      this.normalizeTransaction(transaction, msmeProfile)
    );
    const initialOrchestrationOptions = this.getOrchestrationOptions(contextOverrides?.orchestrationOptions);
    const profileSignals = this.buildManufacturingProfileSignals(
      contextOverrides?.manufacturingProfile || msmeProfile?.manufacturingProfile || {}
    );
    const orchestrationOptions = this.applyManufacturingProfileOrchestrationTuning(
      initialOrchestrationOptions,
      profileSignals
    );
    const baseContext = this.buildBaseContext(msmeProfile, contextOverrides, orchestrationOptions);
    const coordinationContext = {
      orchestrationId,
      startedAt: new Date(),
      interactions: [],
      previousResults: {},
      warnings: [],
      orchestrationOptions,
      communication: this.initializeCommunicationContext(orchestrationId)
    };

    const sectorAgentType = this.getSectorAgentType(msmeProfile.businessDomain);
    const processMachineryAgentType = this.getProcessMachineryAgentType(msmeProfile.businessDomain);
    const agentAvailability = await this.resolveAgentAvailability([
      'document_analyzer',
      sectorAgentType,
      processMachineryAgentType
    ]);

    await this.runOrchestrationAgent({
      stage: 'bootstrap',
      msmeProfile,
      context: baseContext,
      coordinationContext,
      agentAvailability,
      transactions: normalizedTransactions
    });

    const resolvedDocuments = await this.resolveDocuments(
      msmeProfile._id || msmeId,
      documents
    );

    const documentAnalysis = msmeEmissionsCuratedExecutor.shouldRunDocumentAnalyzer(
      resolvedDocuments,
      orchestrationOptions
    )
      ? await this.executeAgent(
        'document_analyzer',
        () => aiAgentService.documentAnalyzerAgent(
          msmeEmissionsCuratedExecutor.buildDocumentAnalyzerTask({
            documents: resolvedDocuments,
            msmeProfile,
            baseContext,
            coordinationPayload: this.buildCoordinationPayload(coordinationContext, 'document_analyzer')
          })
        ),
        coordinationContext,
        {
          stage: 'document_analysis',
          allowFailure: true,
          executionMode: this.getExecutionMode(agentAvailability, 'document_analyzer')
        }
      )
      : msmeEmissionsCuratedExecutor.buildSkippedDocumentAnalysis(resolvedDocuments);

    const mergedTransactions = this.mergeDocumentTransactions(
      normalizedTransactions,
      this.selectDocumentTransactions(documentAnalysis)
    );

    const privacyReview = msmeEmissionsCuratedExecutor.shouldRunDataPrivacy(mergedTransactions)
      ? await this.executeAgent(
        'data_privacy',
        () => aiAgentService.dataPrivacyAgent(
          msmeEmissionsCuratedExecutor.buildDataPrivacyTask({
            transactions: mergedTransactions,
            msmeProfile,
            baseContext,
            coordinationPayload: this.buildCoordinationPayload(coordinationContext, 'data_privacy')
          })
        ),
        coordinationContext,
        {
          stage: msmeEmissionsCuratedExecutor.getPreProcessingStage('data_privacy'),
          allowFailure: true,
          executionMode: this.getExecutionMode(agentAvailability, 'data_privacy')
        }
      )
      : null;

    const privacySafeTransactions = this.selectPrivacySafeTransactions(
      privacyReview,
      mergedTransactions
    );

    const dynamicParameters = extractDynamicParameters(privacySafeTransactions);

    const transactionStats = this.computeTransactionStats(privacySafeTransactions);
    const dataQuality = this.assessDataQuality(transactionStats, privacySafeTransactions, orchestrationOptions.weights);

    baseContext.transactionStats = transactionStats;
    baseContext.dataQuality = dataQuality;
    baseContext.orchestrationOptions = orchestrationOptions;
    baseContext.dynamicParameters = dynamicParameters;
    baseContext.documentSummary = documentAnalysis?.summary || null;

    await this.runOrchestrationAgent({
      stage: 'context_enrichment',
      msmeProfile,
      context: baseContext,
      coordinationContext,
      agentAvailability,
      agentOutputs: {
        documentAnalysis,
        dataPrivacy: privacyReview
      },
      transactions: privacySafeTransactions
    });

    const sectorProfile = await this.executeAgent(
      sectorAgentType,
      () => aiAgentService.sectorProfilerAgent({
        input: {
          msmeData: msmeProfile,
          transactions: privacySafeTransactions,
          context: baseContext,
          ...this.buildCoordinationPayload(coordinationContext, sectorAgentType)
        }
      }),
      coordinationContext,
      {
        stage: 'sector_profile',
        allowFailure: true,
        executionMode: this.getExecutionMode(agentAvailability, sectorAgentType)
      }
    );

    const processMachineryProfile = await this.executeAgent(
      processMachineryAgentType,
      () => aiAgentService.processMachineryProfilerAgent({
        input: {
          msmeData: msmeProfile,
          transactions: privacySafeTransactions,
          context: baseContext,
          sectorProfile,
          ...this.buildCoordinationPayload(coordinationContext, processMachineryAgentType)
        }
      }),
      coordinationContext,
      {
        stage: 'process_machinery_profile',
        allowFailure: true,
        executionMode: this.getExecutionMode(agentAvailability, processMachineryAgentType)
      }
    );

    const context = this.buildContext(
      baseContext,
      sectorProfile,
      processMachineryProfile,
      contextOverrides
    );
    const behaviorProfiles = await this.buildBehaviorProfiles(
      privacySafeTransactions,
      { ...context, msmeData: msmeProfile },
      behaviorOverrides
    );
    context.behaviorSignals = this.buildBehaviorSignals(behaviorProfiles);
    context.unknownParameters = this.buildUnknownParameterPlaceholders(
      privacySafeTransactions,
      behaviorProfiles,
      context.dynamicParameters
    );

    if (dataQuality.confidence < 0.5) {
      coordinationContext.warnings.push({
        message: 'Low data quality may affect orchestration accuracy.',
        dataQuality
      });
    }

    await this.runOrchestrationAgent({
      stage: 'profiling_complete',
      msmeProfile,
      context,
      coordinationContext,
      agentAvailability,
      agentOutputs: {
        sectorProfile,
        processMachineryProfile
      },
      transactions: privacySafeTransactions
    });

    const verifiedSourceGate = agentOrchestrationCuratorService.shouldRunVerifiedSourceRag({
      unknownParameters: context.unknownParameters,
      dataQuality,
      orchestrationOptions
    });

    let verifiedSourceResolution = null;
    if (verifiedSourceGate.run) {
      verifiedSourceResolution = await this.executeAgent(
        'verified_source_rag',
        () => aiAgentService.verifiedSourceRagAgent({
          input: agentOrchestrationCuratorService.buildVerifiedSourceRagInput({
            items: verifiedSourceGate.items,
            msmeProfile,
            context
          })
        }),
        coordinationContext,
        {
          stage: 'verified_source_resolution',
          allowFailure: true,
          executionMode: this.getExecutionMode(agentAvailability, 'verified_source_rag')
        }
      );

      if (verifiedSourceResolution?.matches?.length) {
        context.verifiedSourceMatches = verifiedSourceResolution.matches;
        coordinationContext.previousResults.verified_source_rag = verifiedSourceResolution;
      }
    }

    const dataProcessing = await this.executeAgent(
      'data_processor',
      () => aiAgentService.dataProcessorAgent({
        input: {
          transactions: privacySafeTransactions,
          documents: resolvedDocuments,
          documentSummary: documentAnalysis?.summary,
          context,
          behaviorProfiles,
          orchestrationOptions,
          ...this.buildCoordinationPayload(coordinationContext, 'data_processor')
        }
      }),
      coordinationContext,
      {
        stage: 'data_processing',
        executionMode: this.getExecutionMode(agentAvailability, 'data_processor')
      }
    );

    if (dataProcessing?.documentRequests?.length) {
      coordinationContext.warnings.push({
        message: 'Additional documents required to classify some transactions.',
        documentRequests: dataProcessing.documentRequests
      });
    }

    const processedTransactions = this.selectProcessedTransactions(
      dataProcessing,
      privacySafeTransactions
    );

    const carbonAnalysis = await this.executeAgent(
      'carbon_analyzer',
      () => aiAgentService.carbonAnalyzerAgent({
        input: {
          transactions: processedTransactions,
          msmeData: msmeProfile,
          context,
          behaviorProfiles,
          orchestrationOptions,
          ...this.buildCoordinationPayload(coordinationContext, 'carbon_analyzer')
        }
      }),
      coordinationContext,
      {
        stage: 'carbon_analysis',
        executionMode: this.getExecutionMode(agentAvailability, 'carbon_analyzer')
      }
    );

    let inventoryGovernance = null;
    if (orchestrationOptions.orchestration?.runInventoryGovernance !== false) {
      try {
        inventoryGovernance = await this.executeAgent(
          'inventory_governance',
          () => runGhgInventoryGovernanceOrchestration({
            msmeData: msmeProfile,
            transactions: processedTransactions,
            reportingPeriod: context.period || {},
            orchestrationId,
            options: {
              useAsyncCalculation: true,
              frameworks: context.frameworks,
              assuranceOptions: orchestrationOptions.frameworks?.iso14064,
              lockInventory: orchestrationOptions.orchestration?.lockInventoryOnComplete === true
            }
          }),
          coordinationContext,
          {
            stage: 'inventory_governance',
            allowFailure: true,
            executionMode: 'sequential'
          }
        );
      } catch (govError) {
        logger.warn('Inventory governance orchestration failed', { error: govError.message, orchestrationId });
        coordinationContext.warnings.push({
          message: 'GHG inventory governance pass did not complete; boundary enforcement may be partial.',
          severity: 'warning'
        });
      }
    }

    const analysisContext = {
      carbonData: carbonAnalysis,
      inventoryGovernance,
      behaviorProfiles,
      transactions: processedTransactions,
      msmeData: msmeProfile,
      context,
      coordinationContext,
      processMachineryProfile,
      transactionStats,
      dataQuality,
      orchestrationOptions,
      knownParameters: context.knownParameters,
      policyUpdates: context.policyUpdates,
      dynamicParameters: context.dynamicParameters,
      unknownParameters: context.unknownParameters,
      transactionTypeContext: context.transactionTypeContext,
      documentSummary: context.documentSummary,
      documentAnalysis,
      privacyReview
    };

    const orchestrationPlan = this.buildOrchestrationPlan({
      sectorProfile,
      analysisContext,
      msmeProfile,
      orchestrationOptions
    });

    let esgAnalysis = null;
    if (msmeEmissionsCuratedExecutor.shouldRunAgent(orchestrationPlan, 'esg_analyzer', { orchestrationOptions })) {
      esgAnalysis = await this.executeAgent(
        'esg_analyzer',
        () => aiAgentService.esgAnalyzerAgent(
          msmeEmissionsCuratedExecutor.buildEsgAnalyzerTask(analysisContext)
        ),
        coordinationContext,
        {
          stage: 'esg_analysis',
          allowFailure: true,
          executionMode: this.getExecutionMode(agentAvailability, 'esg_analyzer')
        }
      );
      analysisContext.esgAnalysis = esgAnalysis;
      if (carbonAnalysis && esgAnalysis) {
        carbonAnalysis.esgMetrics = esgAnalysis;
      }
    }

    await this.runOrchestrationAgent({
      stage: 'core_analysis_complete',
      msmeProfile,
      context,
      coordinationContext,
      agentAvailability,
      orchestrationPlan,
      agentOutputs: {
        dataProcessing,
        carbonAnalysis
      },
      processedTransactions
    });

    const parallelAgents = this.buildParallelAgentDefinitions(
      analysisContext,
      orchestrationPlan,
      coordinationContext
    );

    const parallelResults = parallelAgents.length > 0
      ? await this.executeParallelAgents(
        parallelAgents,
        coordinationContext,
        agentAvailability,
        orchestrationPlan.coordinationMode
      )
      : {};

    await this.runOrchestrationAgent({
      stage: 'parallel_insights',
      msmeProfile,
      context,
      coordinationContext,
      agentAvailability,
      orchestrationPlan,
      agentOutputs: {
        anomalies: parallelResults.anomaly_detector,
        trends: parallelResults.trend_analyzer,
        compliance: parallelResults.compliance_monitor,
        optimization: parallelResults.optimization_advisor
      },
      processedTransactions
    });

    let recommendations = null;
    if (msmeEmissionsCuratedExecutor.shouldRunRecommendationEngine(orchestrationPlan)) {
      recommendations = await this.executeAgent(
        'recommendation_engine',
        () => aiAgentService.recommendationEngineAgent(
          msmeEmissionsCuratedExecutor.buildRecommendationEngineTask({
            analysisContext,
            parallelResults,
            processMachineryProfile,
            coordinationPayload: this.buildCoordinationPayload(coordinationContext, 'recommendation_engine')
          })
        ),
        coordinationContext,
        {
          stage: msmeEmissionsCuratedExecutor.getPostProcessingStage('recommendation_engine'),
          allowFailure: true,
          executionMode: this.getExecutionMode(agentAvailability, 'recommendation_engine')
        }
      );
    }

    let report = null;
    if (msmeEmissionsCuratedExecutor.shouldRunReportGenerator(orchestrationPlan)) {
      report = await this.executeAgent(
        'report_generator',
        () => aiAgentService.reportGeneratorAgent(
          msmeEmissionsCuratedExecutor.buildReportGeneratorTask({
            analysisContext,
            parallelResults,
            recommendations,
            processMachineryProfile,
            coordinationPayload: this.buildCoordinationPayload(coordinationContext, 'report_generator')
          })
        ),
        coordinationContext,
        {
          stage: msmeEmissionsCuratedExecutor.getPostProcessingStage('report_generator'),
          allowFailure: true,
          executionMode: this.getExecutionMode(agentAvailability, 'report_generator')
        }
      );
    }

    await this.runOrchestrationAgent({
      stage: 'outputs_compiled',
      msmeProfile,
      context,
      coordinationContext,
      agentAvailability,
      orchestrationPlan,
      agentOutputs: {
        recommendations,
        report
      },
      processedTransactions
    });

    const emissionsSummary = this.buildEmissionsSummary(
      behaviorProfiles,
      carbonAnalysis
    );
    const valueChainReport = buildValueChainReport({
      msme: msmeProfile,
      transactions: processedTransactions,
      generatedAt: coordinationContext?.startedAt || new Date()
    });

    const granularAgentPipeline = this.buildGranularAgentPipeline(coordinationContext.interactions);
    const userClarificationRequests = this.buildUserClarificationRequests({
      orchestrationId,
      msmeProfile,
      context,
      dataQuality,
      dataProcessing,
      unknownParameters: context.unknownParameters,
      frameworks: context.frameworks,
      orchestrationOptions,
      sectorProfile,
      processMachineryProfile,
      documentAnalysis
    });

    return {
      orchestrationId,
      msmeId: msmeProfile._id?.toString() || msmeId,
      msmeSnapshot: this.buildMSMESnapshot(msmeProfile),
      context,
      sectorProfile,
      processMachineryProfile,
      behaviorProfiles,
      orchestrationPlan,
      emissionsSummary,
      valueChainReport,
      agentAvailability,
      granularAgentPipeline,
      userClarificationRequests,
      userClarificationSummary: {
        total: userClarificationRequests.length,
        important: userClarificationRequests.filter(item => item.severity === 'important').length,
        recommended: userClarificationRequests.filter(item => item.severity === 'recommended').length
      },
      agentOutputs: {
        dataPrivacy: privacyReview,
        documentAnalysis,
        sectorProfile,
        processMachineryProfile,
        dataProcessing,
        carbonAnalysis,
        esgAnalysis,
        inventoryGovernance,
        anomalies: parallelResults.anomaly_detector,
        trends: parallelResults.trend_analyzer,
        compliance: parallelResults.compliance_monitor,
        optimization: parallelResults.optimization_advisor,
        orchestrationAgent: coordinationContext.previousResults?.orchestration_agent || null,
        recommendations,
        report
      },
      interactions: coordinationContext.interactions,
      warnings: coordinationContext.warnings,
      communication: coordinationContext.communication
    };
  }

  async resolveDocuments(msmeId, providedDocuments = []) {
    if (Array.isArray(providedDocuments) && providedDocuments.length > 0) {
      return providedDocuments;
    }
    if (!msmeId) {
      return [];
    }
    try {
      return await Document.find({
        msmeId,
        status: 'processed',
        'duplicateDetection.isDuplicate': { $ne: true }
      })
        .sort({ updatedAt: -1 })
        .limit(50)
        .select('documentType status extractedData processingResults fileName originalName createdAt updatedAt')
        .lean();
    } catch (error) {
      logger.warn('Failed to fetch documents for orchestration', { error: error.message, msmeId });
      return [];
    }
  }

  selectDocumentTransactions(documentAnalysis) {
    if (!documentAnalysis || !Array.isArray(documentAnalysis.derivedTransactions)) {
      return [];
    }
    return documentAnalysis.derivedTransactions;
  }

  mergeDocumentTransactions(transactions, documentTransactions) {
    const merged = Array.isArray(transactions) ? [...transactions] : [];
    const docTransactions = Array.isArray(documentTransactions) ? documentTransactions : [];

    const existingSourceIds = new Set(
      merged.map(txn => txn.sourceId).filter(Boolean)
    );
    const existingSignatures = new Set(
      merged.map(txn => this.buildTransactionSignature(txn))
    );

    docTransactions.forEach(docTxn => {
      const sourceId = docTxn.sourceId;
      const signature = this.buildTransactionSignature(docTxn);
      if ((sourceId && existingSourceIds.has(sourceId)) || existingSignatures.has(signature)) {
        return;
      }
      merged.push(docTxn);
      if (sourceId) {
        existingSourceIds.add(sourceId);
      }
      existingSignatures.add(signature);
    });

    return merged;
  }

  buildTransactionSignature(transaction) {
    const date = transaction?.date ? new Date(transaction.date) : null;
    const dateKey = date ? date.toISOString().slice(0, 10) : 'unknown';
    const amount = Number(transaction?.amount) || 0;
    const description = (transaction?.description || '').toLowerCase().slice(0, 60);
    return `${dateKey}|${amount}|${description}`;
  }

  normalizeTransaction(transaction, msmeProfile) {
    const locationState = transaction?.location?.state || msmeProfile?.contact?.address?.state;
    const region = this.resolveRegion(locationState);
    const normalized = {
      ...transaction,
      category: (transaction.category || 'other').toLowerCase(),
      subcategory: transaction.subcategory || 'general',
      description: transaction.description || '',
      amount: Number(transaction.amount) || 0,
      industry: transaction.industry || msmeProfile.industry,
      businessDomain: transaction.businessDomain || msmeProfile.businessDomain,
      region: transaction.region || region,
      location: {
        ...(transaction.location || {}),
        city: transaction?.location?.city || msmeProfile?.contact?.address?.city || null,
        state: transaction?.location?.state || msmeProfile?.contact?.address?.state || 'unknown',
        country: transaction?.location?.country || msmeProfile?.contact?.address?.country || 'India'
      },
      sustainability: transaction.sustainability || {
        isGreen: false,
        greenScore: 0
      }
    };

    return normalized;
  }

  getOrchestrationOptions(overrides = {}) {
    const frameworkOverrides = overrides.frameworks || overrides.isoFrameworks || {};
    return {
      thresholds: {
        ...ORCHESTRATION_DEFAULTS.thresholds,
        ...(overrides.thresholds || {})
      },
      weights: {
        ...ORCHESTRATION_DEFAULTS.weights,
        ...(overrides.weights || {})
      },
      orchestration: {
        ...ORCHESTRATION_DEFAULTS.orchestration,
        ...(overrides.orchestration || {})
      },
      tuning: {
        ...ORCHESTRATION_DEFAULTS.tuning,
        ...(overrides.tuning || {})
      },
      frameworks: {
        iso14064: this.normalizeFrameworkConfig(
          frameworkOverrides.iso14064,
          ORCHESTRATION_DEFAULTS.frameworks.iso14064
        ),
        iso14067: this.normalizeFrameworkConfig(
          frameworkOverrides.iso14067,
          ORCHESTRATION_DEFAULTS.frameworks.iso14067
        )
      }
    };
  }

  normalizeFrameworkConfig(value, defaults = {}) {
    if (value === false) {
      return { ...defaults, enabled: false };
    }
    if (value === true) {
      return { ...defaults, enabled: true };
    }
    if (value && typeof value === 'object') {
      return {
        ...defaults,
        ...value,
        enabled: value.enabled !== false
      };
    }
    return { ...defaults };
  }

  buildFrameworkContext(overrides = {}, optionsFrameworks = {}) {
    const normalizedOverrides = overrides && typeof overrides === 'object'
      ? overrides
      : {};

    return {
      iso14064: this.normalizeFrameworkConfig(
        normalizedOverrides.iso14064,
        optionsFrameworks.iso14064 || ORCHESTRATION_DEFAULTS.frameworks.iso14064
      ),
      iso14067: this.normalizeFrameworkConfig(
        normalizedOverrides.iso14067,
        optionsFrameworks.iso14067 || ORCHESTRATION_DEFAULTS.frameworks.iso14067
      )
    };
  }

  computeTransactionStats(transactions) {
    const stats = {
      totalCount: transactions.length,
      totalAmount: 0,
      averageAmount: 0,
      minAmount: null,
      maxAmount: null,
      categoryTotals: {},
      categoryCounts: {},
      missingCategoryCount: 0,
      missingAmountCount: 0,
      invalidAmountCount: 0
    };

    transactions.forEach(transaction => {
      const category = (transaction.category || '').toLowerCase();
      const rawAmount = transaction.amount;
      const amount = Number(rawAmount);
      const hasAmount = rawAmount !== null && rawAmount !== undefined && rawAmount !== '';
      if (!category) {
        stats.missingCategoryCount += 1;
      } else {
        stats.categoryCounts[category] = (stats.categoryCounts[category] || 0) + 1;
        stats.categoryTotals[category] = (stats.categoryTotals[category] || 0) + (Number.isFinite(amount) ? amount : 0);
      }

      if (!hasAmount) {
        stats.missingAmountCount += 1;
      } else if (!Number.isFinite(amount)) {
        stats.invalidAmountCount += 1;
      } else {
        stats.totalAmount += amount;
        stats.minAmount = stats.minAmount === null ? amount : Math.min(stats.minAmount, amount);
        stats.maxAmount = stats.maxAmount === null ? amount : Math.max(stats.maxAmount, amount);
      }
    });

    stats.averageAmount = transactions.length > 0 ? stats.totalAmount / transactions.length : 0;

    return stats;
  }

  assessDataQuality(stats, transactions, weights) {
    const total = stats.totalCount || 0;
    if (total === 0) {
      return {
        completeness: 0,
        consistency: 0,
        coverage: 0,
        confidence: 0,
        details: stats
      };
    }

    const missingCategoryRate = stats.missingCategoryCount / total;
    const invalidAmountRate = stats.invalidAmountCount / total;
    const completeness = this.clamp(1 - (missingCategoryRate + invalidAmountRate) / 2);

    const negativeAmountCount = transactions.filter(txn => Number(txn.amount) < 0).length;
    const consistency = this.clamp(1 - (negativeAmountCount + invalidAmountRate) / total);

    const uniqueBehaviors = new Set(
      Object.keys(stats.categoryTotals).map(category => this.mapCategoryToBehavior(category))
    );
    const coverage = this.clamp(uniqueBehaviors.size / Object.keys(BEHAVIOR_DEFINITIONS).length);

    const confidence = this.clamp(
      completeness * weights.completeness +
      consistency * weights.consistency +
      coverage * weights.coverage
    );

    return {
      completeness,
      consistency,
      coverage,
      confidence,
      details: stats
    };
  }

  buildBehaviorSignals(behaviorProfiles) {
    const signals = {};
    Object.values(behaviorProfiles).forEach(profile => {
      signals[profile.behavior] = {
        emissionsShare: profile.emissionsShare,
        emissionIntensity: profile.emissionIntensity,
        severity: profile.severity
      };
    });
    return signals;
  }

  clamp(value) {
    return Math.max(0, Math.min(1, value));
  }

  normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  calculateManufacturingProfileCompleteness(profile = {}) {
    const fields = [
      'msmeType',
      'industrySector',
      'nicCode',
      'yearOfEstablishment',
      'locationCity',
      'locationState',
      'locationCountry',
      'numberOfEmployees',
      'plantAreaSqft',
      'operationalDaysPerYear',
      'primaryEnergySource',
      'backupEnergySource',
      'mainFuelsUsed',
      'waterSource',
      'wasteManagementPractice',
      'keyProducts',
      'productionCapacityPerMonth',
      'productionCapacityUnit',
      'supplyChainType',
      'logisticsMode',
      'certifications',
      'esgMaturityLevel',
      'digitalizationLevel',
      'carbonAccountingPractice',
      'regulatoryExposure',
      'exportActivity',
      'clusterAssociation'
    ];

    const providedFields = fields.reduce((count, field) => {
      const value = profile[field];
      if (Array.isArray(value)) {
        return count + (value.length > 0 ? 1 : 0);
      }
      if (typeof value === 'boolean') {
        return count + 1;
      }
      if (value === undefined || value === null) {
        return count;
      }
      if (typeof value === 'string') {
        return count + (value.trim().length > 0 ? 1 : 0);
      }
      if (Number.isFinite(value)) {
        return count + 1;
      }
      return count;
    }, 0);

    const ratio = fields.length > 0 ? providedFields / fields.length : 0;
    return {
      providedFields,
      totalFields: fields.length,
      ratio: this.clamp(ratio)
    };
  }

  buildManufacturingProfileSignals(rawProfile = {}) {
    const manufacturingProfile = normalizeManufacturingProfile(rawProfile || {});
    const completeness = this.calculateManufacturingProfileCompleteness(manufacturingProfile);
    const certifications = Array.isArray(manufacturingProfile.certifications)
      ? manufacturingProfile.certifications.map(cert => this.normalizeText(cert)).filter(Boolean)
      : [];
    const regulatoryExposure = Array.isArray(manufacturingProfile.regulatoryExposure)
      ? manufacturingProfile.regulatoryExposure.map(entry => this.normalizeText(entry)).filter(Boolean)
      : [];
    const mainFuelsUsed = Array.isArray(manufacturingProfile.mainFuelsUsed)
      ? manufacturingProfile.mainFuelsUsed.map(fuel => this.normalizeText(fuel)).filter(Boolean)
      : [];
    const keyProducts = Array.isArray(manufacturingProfile.keyProducts)
      ? manufacturingProfile.keyProducts.map(product => this.normalizeText(product)).filter(Boolean)
      : [];

    const primaryEnergySource = this.normalizeText(manufacturingProfile.primaryEnergySource);
    const wasteManagementPractice = this.normalizeText(manufacturingProfile.wasteManagementPractice);
    const supplyChainType = this.normalizeText(manufacturingProfile.supplyChainType);
    const logisticsMode = this.normalizeText(manufacturingProfile.logisticsMode);
    const digitalizationLevel = this.normalizeText(manufacturingProfile.digitalizationLevel);
    const carbonAccountingPractice = this.normalizeText(manufacturingProfile.carbonAccountingPractice);

    const flags = {
      exportIntensive: manufacturingProfile.exportActivity === true ||
        supplyChainType.includes('export') ||
        supplyChainType.includes('import') ||
        supplyChainType.includes('global'),
      highRegulatoryExposure: regulatoryExposure.length >= 2,
      strongCertifications: certifications.some(cert =>
        cert.includes('iso 14001') ||
        cert.includes('iso14001') ||
        cert.includes('iso 50001') ||
        cert.includes('iso50001') ||
        cert.includes('zed')
      ),
      advancedDigitalization: digitalizationLevel.includes('high') || digitalizationLevel.includes('advanced'),
      carbonAccountingMature: carbonAccountingPractice.includes('advanced') || carbonAccountingPractice.includes('full'),
      clusterAssociationPresent: Boolean(manufacturingProfile.clusterAssociation),
      energyIntensive:
        primaryEnergySource.includes('grid') ||
        primaryEnergySource.includes('diesel') ||
        primaryEnergySource.includes('coal') ||
        mainFuelsUsed.some(fuel => fuel.includes('diesel') || fuel.includes('coal')),
      wasteIntensive:
        wasteManagementPractice.includes('none') ||
        wasteManagementPractice.includes('landfill') ||
        wasteManagementPractice.includes('dump')
    };

    const complexityScore = this.clamp(
      (mainFuelsUsed.length >= 2 ? 0.15 : 0) +
      (keyProducts.length >= 3 ? 0.1 : 0) +
      ((manufacturingProfile.numberOfEmployees || 0) >= 100 ? 0.1 : 0) +
      ((manufacturingProfile.plantAreaSqft || 0) >= 50000 ? 0.1 : 0) +
      ((manufacturingProfile.operationalDaysPerYear || 0) >= 320 ? 0.1 : 0) +
      (flags.exportIntensive ? 0.15 : 0) +
      (flags.highRegulatoryExposure ? 0.15 : 0) +
      (flags.strongCertifications ? 0.08 : 0) +
      (flags.advancedDigitalization ? 0.07 : 0)
    );

    return {
      completeness,
      complexityScore: Number(complexityScore.toFixed(4)),
      flags,
      summaries: {
        certifications,
        regulatoryExposure,
        mainFuelsUsed,
        keyProducts,
        supplyChainType: manufacturingProfile.supplyChainType || null,
        logisticsMode: manufacturingProfile.logisticsMode || null
      }
    };
  }

  applyManufacturingProfileOrchestrationTuning(orchestrationOptions = {}, profileSignals = {}) {
    const tuned = {
      ...orchestrationOptions,
      thresholds: { ...(orchestrationOptions.thresholds || {}) },
      tuning: { ...(orchestrationOptions.tuning || {}) },
      profileSignals
    };

    const completenessRatio = Number(profileSignals?.completeness?.ratio) || 0;
    const complexityScore = Number(profileSignals?.complexityScore) || 0;
    const flags = profileSignals?.flags || {};

    if (completenessRatio >= 0.75) {
      tuned.thresholds.minTransactionsForAnomaly = Math.max(
        8,
        Math.round((tuned.thresholds.minTransactionsForAnomaly || 20) * 0.8)
      );
      tuned.thresholds.minTransactionsForTrends = Math.max(
        6,
        Math.round((tuned.thresholds.minTransactionsForTrends || 12) * 0.8)
      );
      tuned.tuning.optimizationDepth = 'deep';
    } else if (completenessRatio <= 0.45) {
      tuned.thresholds.minTransactionsForAnomaly = Math.min(
        40,
        Math.round((tuned.thresholds.minTransactionsForAnomaly || 20) * 1.15)
      );
      tuned.thresholds.minTransactionsForTrends = Math.min(
        30,
        Math.round((tuned.thresholds.minTransactionsForTrends || 12) * 1.15)
      );
      tuned.tuning.anomalySensitivity = 'high';
    }

    if (complexityScore >= 0.65) {
      tuned.thresholds.energyShareHigh = (tuned.thresholds.energyShareHigh || 0.2) * 0.9;
      tuned.thresholds.materialsShareHigh = (tuned.thresholds.materialsShareHigh || 0.15) * 0.9;
      tuned.thresholds.transportShareHigh = (tuned.thresholds.transportShareHigh || 0.15) * 0.9;
      tuned.tuning.optimizationDepth = 'deep';
    }

    if (flags.energyIntensive) {
      tuned.thresholds.energyShareHigh = (tuned.thresholds.energyShareHigh || 0.2) * 0.9;
    }
    if (flags.wasteIntensive) {
      tuned.thresholds.wasteShareHigh = (tuned.thresholds.wasteShareHigh || 0.1) * 0.9;
    }
    if (flags.exportIntensive) {
      tuned.thresholds.transportShareHigh = (tuned.thresholds.transportShareHigh || 0.15) * 0.85;
      tuned.tuning.complianceStrictness = 'strict';
    }
    if (flags.highRegulatoryExposure) {
      tuned.tuning.complianceStrictness = 'strict';
    }
    if (flags.advancedDigitalization && completenessRatio >= 0.65) {
      tuned.thresholds.minTransactionsForTrends = Math.max(
        6,
        Math.round((tuned.thresholds.minTransactionsForTrends || 12) * 0.85)
      );
      tuned.tuning.trendHorizonMonths = Math.max(tuned.tuning.trendHorizonMonths || 6, 9);
    }
    if (flags.clusterAssociationPresent) {
      tuned.thresholds.transportShareHigh = (tuned.thresholds.transportShareHigh || 0.15) * 0.95;
      tuned.thresholds.materialsShareHigh = (tuned.thresholds.materialsShareHigh || 0.15) * 0.95;
    }

    tuned.thresholds.energyShareHigh = this.clamp(tuned.thresholds.energyShareHigh || 0.2);
    tuned.thresholds.wasteShareHigh = this.clamp(tuned.thresholds.wasteShareHigh || 0.1);
    tuned.thresholds.transportShareHigh = this.clamp(tuned.thresholds.transportShareHigh || 0.15);
    tuned.thresholds.materialsShareHigh = this.clamp(tuned.thresholds.materialsShareHigh || 0.15);
    tuned.thresholds.manufacturingShareHigh = this.clamp(tuned.thresholds.manufacturingShareHigh || 0.12);

    return tuned;
  }

  getSectorAgentType(businessDomain) {
    return 'sector_profiler';
  }

  getProcessMachineryAgentType(businessDomain) {
    return 'process_machinery_profiler';
  }

  buildBaseContext(msmeProfile, overrides = {}, orchestrationOptions = this.getOrchestrationOptions()) {
    const locationState = msmeProfile?.contact?.address?.state || 'unknown';
    const region = overrides.region || this.resolveRegion(locationState);
    const season = overrides.season || this.getSeason(new Date());
    const businessDomain = overrides.businessDomain || msmeProfile.businessDomain;
    const industry = overrides.industry || msmeProfile.industry;
    const companyType = overrides.companyType || msmeProfile.companyType;
    const policyUpdates = this.buildPolicyUpdates(
      overrides.policyUpdates || overrides.governmentPolicyUpdates
    );
    const manufacturingProfile = normalizeManufacturingProfile(
      overrides.manufacturingProfile || {},
      msmeProfile?.manufacturingProfile || {}
    );
    const profileSignals = overrides.profileSignals || this.buildManufacturingProfileSignals(manufacturingProfile);
    const knownParameters = this.buildKnownParameters(msmeProfile, {
      ...overrides,
      manufacturingProfile
    });
    const unknownParameters = overrides.unknownParameters || this.buildUnknownParameterPlaceholders([], {});
    const frameworks = this.buildFrameworkContext(
      overrides.frameworks || overrides.isoFrameworks,
      orchestrationOptions.frameworks
    );

    return {
      businessDomain,
      industry,
      companyType,
      location: {
        state: locationState,
        country: msmeProfile?.contact?.address?.country || 'India'
      },
      region,
      season,
      regulatoryContext: overrides.regulatoryContext || {
        region,
        industry,
        domain: businessDomain
      },
      processContext: overrides.processContext || {
        primaryProducts: msmeProfile?.business?.primaryProducts,
        manufacturingUnits: msmeProfile?.business?.manufacturingUnits
      },
      manufacturingProfile,
      profileSignals,
      knownParameters,
      unknownParameters,
      policyUpdates,
      frameworks
    };
  }

  buildContext(baseContext, sectorProfile, processMachineryProfile, overrides = {}) {
    const context = { ...baseContext };
    const derivedWeights = this.deriveBehaviorWeights(context);
    context.behaviorWeights = this.mergeBehaviorWeights(
      derivedWeights,
      sectorProfile?.behaviorWeights,
      overrides.behaviorWeights
    );
    context.sectorProfile = sectorProfile || null;
    context.processMachineryProfile = processMachineryProfile || null;
    context.transactionTypeContext = sectorProfile?.transactionContext?.transactionTypes ||
      sectorProfile?.sectorModel?.transactionTypes ||
      {};
    context.documentSummary = baseContext.documentSummary || null;
    context.transactionStats = baseContext.transactionStats || null;
    context.dataQuality = baseContext.dataQuality || null;
    context.orchestrationOptions = baseContext.orchestrationOptions || this.getOrchestrationOptions();
    context.frameworks = this.buildFrameworkContext(
      overrides.frameworks || overrides.isoFrameworks,
      baseContext.frameworks || context.orchestrationOptions.frameworks
    );
    context.profileSignals = baseContext.profileSignals ||
      this.buildManufacturingProfileSignals(context.manufacturingProfile || {});
    context.processContext = {
      ...(baseContext.processContext || {}),
      processes: processMachineryProfile?.processes || [],
      machinery: processMachineryProfile?.machinery || [],
      emissionFactors: processMachineryProfile?.emissionFactors || [],
      intensityProfile: processMachineryProfile?.intensityProfile || null
    };
    context.dynamicParameters = baseContext.dynamicParameters || this.buildDynamicParametersFallback();
    context.knownParameters = this.mergeKnownParameters(
      baseContext.knownParameters,
      context.processContext,
      overrides.knownParameters,
      context.dynamicParameters
    );
    context.policyUpdates = baseContext.policyUpdates || this.buildPolicyUpdates(
      overrides.policyUpdates || overrides.governmentPolicyUpdates
    );
    context.unknownParameters = baseContext.unknownParameters ||
      this.buildUnknownParameterPlaceholders([], {}, context.dynamicParameters);

    return context;
  }

  buildPolicyUpdates(overrides = {}) {
    const normalized = overrides && typeof overrides === 'object' ? overrides : {};
    return {
      status: normalized.status || 'placeholder',
      lastChecked: normalized.lastChecked || null,
      sources: Array.isArray(normalized.sources) ? normalized.sources : [],
      impactAreas: Array.isArray(normalized.impactAreas) ? normalized.impactAreas : [],
      notes: normalized.notes || 'Government policy updates pending ingestion.',
      region: normalized.region || null
    };
  }

  buildKnownParameters(msmeProfile, overrides = {}) {
    const knownOverrides = overrides.knownParameters || {};
    const manufacturingProfile = normalizeManufacturingProfile(
      overrides.manufacturingProfile || {},
      msmeProfile?.manufacturingProfile || {}
    );

    const profileResourceTypes = [
      manufacturingProfile.primaryEnergySource,
      ...(manufacturingProfile.mainFuelsUsed || []),
      manufacturingProfile.backupEnergySource,
      manufacturingProfile.waterSource
    ].filter(Boolean);

    const profileWasteTypes = [
      manufacturingProfile.wasteManagementPractice,
      ...(manufacturingProfile.regulatoryExposure || [])
    ].filter(Boolean);

    const profileMaterialTypes = [
      ...(manufacturingProfile.keyProducts || [])
    ].filter(Boolean);

    return {
      msmeProfile: {
        businessDomain: overrides.businessDomain || msmeProfile.businessDomain,
        industry: overrides.industry || msmeProfile.industry,
        companyType: overrides.companyType || msmeProfile.companyType,
        manufacturingProfile
      },
      businessDomain: overrides.businessDomain || msmeProfile.businessDomain,
      processes: knownOverrides.processes || overrides.processes || [],
      machinery: knownOverrides.machinery || overrides.machinery || [],
      environmentalResources: this.buildConsumptionBucket(
        {
          ...(knownOverrides.environmentalResources || overrides.environmentalResourcesConsumption || {}),
          types: Array.from(new Set([
            ...((knownOverrides.environmentalResources || overrides.environmentalResourcesConsumption || {}).types || []),
            ...profileResourceTypes
          ]))
        },
        'mixed'
      ),
      waterConsumption: this.buildConsumptionBucket({
        ...(knownOverrides.waterConsumption || {}),
        types: Array.from(new Set([
          ...((knownOverrides.waterConsumption || {}).types || []),
          ...(manufacturingProfile.waterSource ? [manufacturingProfile.waterSource] : [])
        ]))
      }, 'kl'),
      fuelConsumption: this.buildConsumptionBucket({
        ...(knownOverrides.fuelConsumption || {}),
        types: Array.from(new Set([
          ...((knownOverrides.fuelConsumption || {}).types || []),
          ...(manufacturingProfile.mainFuelsUsed || []),
          ...(manufacturingProfile.backupEnergySource ? [manufacturingProfile.backupEnergySource] : [])
        ]))
      }, 'liters'),
      wasteGeneration: this.buildWasteBucket({
        ...(knownOverrides.wasteGeneration || {}),
        types: Array.from(new Set([
          ...((knownOverrides.wasteGeneration || {}).types || []),
          ...profileWasteTypes
        ]))
      }),
      chemicalsConsumption: this.buildConsumptionBucket(knownOverrides.chemicalsConsumption, 'kg'),
      airPollution: this.buildAirPollutionBucket(knownOverrides.airPollution),
      materialsConsumption: this.buildConsumptionBucket({
        ...(knownOverrides.materialsConsumption || {}),
        total: Number.isFinite(knownOverrides.materialsConsumption?.total)
          ? knownOverrides.materialsConsumption.total
          : manufacturingProfile.productionCapacityPerMonth,
        unit: knownOverrides.materialsConsumption?.unit || manufacturingProfile.productionCapacityUnit || 'kg',
        types: Array.from(new Set([
          ...((knownOverrides.materialsConsumption || {}).types || []),
          ...profileMaterialTypes
        ]))
      }, 'kg'),
      metadata: {
        lastUpdated: knownOverrides.lastUpdated || null,
        source: knownOverrides.source || 'msme_profile',
        nicCode: manufacturingProfile.nicCode || null,
        supplyChainType: manufacturingProfile.supplyChainType || null,
        logisticsMode: manufacturingProfile.logisticsMode || null,
        certifications: manufacturingProfile.certifications || [],
        esgMaturityLevel: manufacturingProfile.esgMaturityLevel || null,
        digitalizationLevel: manufacturingProfile.digitalizationLevel || null,
        carbonAccountingPractice: manufacturingProfile.carbonAccountingPractice || null,
        clusterAssociation: manufacturingProfile.clusterAssociation || null
      }
    };
  }

  buildConsumptionBucket(overrides = {}, defaultUnit = 'unknown') {
    const normalized = overrides && typeof overrides === 'object' ? overrides : {};
    return {
      total: Number.isFinite(normalized.total) ? normalized.total : null,
      unit: normalized.unit || defaultUnit,
      types: Array.isArray(normalized.types) ? normalized.types : [],
      intensity: normalized.intensity || null,
      notes: normalized.notes || null,
      source: normalized.source || 'placeholder'
    };
  }

  buildWasteBucket(overrides = {}) {
    const normalized = overrides && typeof overrides === 'object' ? overrides : {};
    return {
      ...this.buildConsumptionBucket(normalized, normalized.unit || 'kg'),
      hazardousTypes: Array.isArray(normalized.hazardousTypes) ? normalized.hazardousTypes : [],
      treatmentMethods: Array.isArray(normalized.treatmentMethods) ? normalized.treatmentMethods : []
    };
  }

  buildAirPollutionBucket(overrides = {}) {
    const normalized = overrides && typeof overrides === 'object' ? overrides : {};
    return {
      pollutants: Array.isArray(normalized.pollutants) ? normalized.pollutants : [],
      monitoringFrequency: normalized.monitoringFrequency || 'unknown',
      total: Number.isFinite(normalized.total) ? normalized.total : null,
      unit: normalized.unit || 'unknown',
      notes: normalized.notes || null,
      source: normalized.source || 'placeholder'
    };
  }

  mergeKnownParameters(baseKnown = {}, processContext = {}, overrides = {}, dynamicParameters = {}) {
    const base = baseKnown || {};
    const updated = overrides && typeof overrides === 'object' ? overrides : {};
    const dynamicConsumption = dynamicParameters?.consumptionSignals || {};
    const dynamicProcesses = dynamicParameters?.processSignals || {};
    const dynamicMachinery = dynamicParameters?.machinerySignals || {};
    return {
      ...base,
      processes: Array.from(new Set([
        ...(updated.processes || []),
        ...(processContext.processes || []),
        ...(base.processes || []),
        ...Object.keys(dynamicProcesses || {})
      ])),
      machinery: Array.from(new Set([
        ...(updated.machinery || []),
        ...(processContext.machinery || []),
        ...(base.machinery || []),
        ...Object.keys(dynamicMachinery || {})
      ])),
      environmentalResources: {
        ...this.buildConsumptionBucket({
          ...(base.environmentalResources || {}),
          ...(updated.environmentalResources || updated.environmentalResourcesConsumption || {})
        }, base.environmentalResources?.unit || 'mixed'),
        emissionFactors: processContext.emissionFactors || base.environmentalResources?.emissionFactors || []
      },
      waterConsumption: this.buildConsumptionBucket({
        ...(base.waterConsumption || {}),
        ...(updated.waterConsumption || {}),
        total: Number.isFinite(updated.waterConsumption?.total)
          ? updated.waterConsumption.total
          : (Number.isFinite(base.waterConsumption?.total)
            ? base.waterConsumption.total
            : dynamicConsumption.waterConsumption?.totalAmount),
        types: Array.from(new Set([
          ...((base.waterConsumption || {}).types || []),
          ...((updated.waterConsumption || {}).types || []),
          ...Object.keys(dynamicConsumption.waterConsumption?.types || {})
        ]))
      }, base.waterConsumption?.unit || 'kl'),
      fuelConsumption: this.buildConsumptionBucket({
        ...(base.fuelConsumption || {}),
        ...(updated.fuelConsumption || {}),
        total: Number.isFinite(updated.fuelConsumption?.total)
          ? updated.fuelConsumption.total
          : (Number.isFinite(base.fuelConsumption?.total)
            ? base.fuelConsumption.total
            : dynamicConsumption.fuelConsumption?.totalAmount),
        types: Array.from(new Set([
          ...((base.fuelConsumption || {}).types || []),
          ...((updated.fuelConsumption || {}).types || []),
          ...Object.keys(dynamicConsumption.fuelConsumption?.types || {})
        ]))
      }, base.fuelConsumption?.unit || 'liters'),
      wasteGeneration: this.buildWasteBucket({
        ...(base.wasteGeneration || {}),
        ...(updated.wasteGeneration || {}),
        total: Number.isFinite(updated.wasteGeneration?.total)
          ? updated.wasteGeneration.total
          : (Number.isFinite(base.wasteGeneration?.total)
            ? base.wasteGeneration.total
            : dynamicConsumption.wasteGeneration?.totalAmount),
        types: Array.from(new Set([
          ...((base.wasteGeneration || {}).types || []),
          ...((updated.wasteGeneration || {}).types || []),
          ...Object.keys(dynamicConsumption.wasteGeneration?.types || {})
        ]))
      }),
      chemicalsConsumption: this.buildConsumptionBucket({
        ...(base.chemicalsConsumption || {}),
        ...(updated.chemicalsConsumption || {}),
        total: Number.isFinite(updated.chemicalsConsumption?.total)
          ? updated.chemicalsConsumption.total
          : (Number.isFinite(base.chemicalsConsumption?.total)
            ? base.chemicalsConsumption.total
            : dynamicConsumption.chemicalsConsumption?.totalAmount),
        types: Array.from(new Set([
          ...((base.chemicalsConsumption || {}).types || []),
          ...((updated.chemicalsConsumption || {}).types || []),
          ...Object.keys(dynamicConsumption.chemicalsConsumption?.types || {})
        ]))
      }, base.chemicalsConsumption?.unit || 'kg'),
      airPollution: this.buildAirPollutionBucket({
        ...(base.airPollution || {}),
        ...(updated.airPollution || {}),
        pollutants: Array.from(new Set([
          ...((base.airPollution || {}).pollutants || []),
          ...((updated.airPollution || {}).pollutants || []),
          ...Object.keys(dynamicConsumption.airPollution?.types || {})
        ]))
      }),
      materialsConsumption: this.buildConsumptionBucket({
        ...(base.materialsConsumption || {}),
        ...(updated.materialsConsumption || {}),
        total: Number.isFinite(updated.materialsConsumption?.total)
          ? updated.materialsConsumption.total
          : (Number.isFinite(base.materialsConsumption?.total)
            ? base.materialsConsumption.total
            : dynamicConsumption.materialsConsumption?.totalAmount),
        types: Array.from(new Set([
          ...((base.materialsConsumption || {}).types || []),
          ...((updated.materialsConsumption || {}).types || []),
          ...Object.keys(dynamicConsumption.materialsConsumption?.types || {})
        ]))
      }, base.materialsConsumption?.unit || 'kg'),
      metadata: {
        ...(base.metadata || {}),
        ...(updated.metadata || {}),
        lastUpdated: updated.lastUpdated || base.metadata?.lastUpdated || null
      }
    };
  }

  buildUnknownParameterPlaceholders(transactions = [], behaviorProfiles = {}, dynamicParameters = {}) {
    const knownCategories = new Set(
      Object.values(BEHAVIOR_DEFINITIONS).flatMap(definition => definition.categories)
    );
    const unknownCategories = new Set();
    const unknownCategoryStats = new Map();
    const totalAmount = transactions.reduce((sum, transaction) => sum + (Number(transaction.amount) || 0), 0);
    transactions.forEach(transaction => {
      const category = (transaction.category || '').toLowerCase();
      if (category && !knownCategories.has(category)) {
        unknownCategories.add(category);
        const stats = unknownCategoryStats.get(category) || { count: 0, totalAmount: 0 };
        stats.count += 1;
        stats.totalAmount += Number(transaction.amount) || 0;
        unknownCategoryStats.set(category, stats);
      }
    });

    const otherProfile = behaviorProfiles?.other || {};
    const needsReview = unknownCategories.size > 0 || (otherProfile.emissionsShare || 0) > 0.2;
    const dynamicUnknownParameters = dynamicParameters.unknownParameters || [];

    const weightedCategoryParameters = Array.from(unknownCategoryStats.entries()).map(([category, stats]) => {
      const amountShare = totalAmount > 0 ? stats.totalAmount / totalAmount : 0;
      const mentionRate = transactions.length > 0 ? stats.count / transactions.length : 0;
      const weight = Math.min(1, 0.6 * mentionRate + 0.4 * amountShare);
      return {
        name: category,
        count: stats.count,
        totalAmount: stats.totalAmount,
        amountShare,
        weight,
        source: 'category'
      };
    });

    const weightedParametersMap = new Map();
    [...dynamicUnknownParameters, ...weightedCategoryParameters].forEach(param => {
      if (!param?.name) return;
      const existing = weightedParametersMap.get(param.name) || { ...param };
      existing.count = (existing.count || 0) + (param.count || 0);
      existing.totalAmount = (existing.totalAmount || 0) + (param.totalAmount || 0);
      existing.weight = Math.max(existing.weight || 0, param.weight || 0);
      existing.amountShare = Math.max(existing.amountShare || 0, param.amountShare || 0);
      weightedParametersMap.set(param.name, existing);
    });

    return {
      detectedCategories: Array.from(unknownCategories),
      behaviorSignals: {
        otherEmissionsShare: otherProfile.emissionsShare || 0,
        otherTransactionCount: otherProfile.transactionCount || 0
      },
      weightedParameters: Array.from(weightedParametersMap.values()).sort((a, b) => (b.weight || 0) - (a.weight || 0)),
      dynamicUnknownParameters,
      unknownCategoryParameters: weightedCategoryParameters,
      placeholders: {
        resourceConsumption: [],
        processInputs: [],
        emissionTypes: [],
        measurements: dynamicParameters.measurements || []
      },
      needsReview,
      notes: needsReview
        ? 'Unknown categories detected; add parameters when available.'
        : 'No unknown categories detected.'
    };
  }

  buildDynamicParametersFallback() {
    return {
      consumptionSignals: {},
      processSignals: {},
      machinerySignals: {},
      measurements: [],
      unknownParameters: [],
      totals: {
        totalTransactions: 0,
        totalAmount: 0
      }
    };
  }

  mergeBehaviorWeights(baseWeights, sectorWeights, overrideWeights) {
    const merged = { ...baseWeights };
    Object.entries(sectorWeights || {}).forEach(([key, value]) => {
      if (Number.isFinite(value)) {
        merged[key] = (merged[key] || 1) * value;
      }
    });
    Object.entries(overrideWeights || {}).forEach(([key, value]) => {
      if (Number.isFinite(value)) {
        merged[key] = value;
      }
    });
    return merged;
  }

  resolveRegion(state) {
    return resolveRegionFromState(state, 'north-india');
  }

  getSeason(date) {
    const month = date.getMonth() + 1;
    if (month >= 3 && month <= 5) return 'summer';
    if (month >= 6 && month <= 9) return 'monsoon';
    if (month >= 12 || month <= 2) return 'winter';
    return 'dry';
  }

  deriveBehaviorWeights(context) {
    const weights = {
      energy: 1,
      water: 1,
      waste: 1,
      transportation: 1,
      materials: 1,
      manufacturing: 1,
      other: 1
    };

    const domainFactors = carbonCalculationService.domainFactors?.[context.businessDomain] || {};
    weights.energy *= domainFactors.energy || 1;
    weights.transportation *= domainFactors.transportation || 1;
    weights.materials *= domainFactors.materials || 1;
    weights.waste *= domainFactors.waste || 1;
    weights.manufacturing *= ((domainFactors.energy || 1) + (domainFactors.materials || 1)) / 2;

    const sizeFactors = carbonCalculationService.esgParameters?.sizeFactors?.[context.companyType];
    if (sizeFactors?.scale) {
      Object.keys(weights).forEach(key => {
        weights[key] *= sizeFactors.scale;
      });
    }

    const locationFactors = carbonCalculationService.esgParameters?.locationFactors?.[context.region];
    if (locationFactors?.electricity) {
      weights.energy *= locationFactors.electricity;
    }
    if (locationFactors?.transport) {
      weights.transportation *= locationFactors.transport;
    }

    const temporalFactors = carbonCalculationService.esgParameters?.temporalFactors?.[context.season];
    if (temporalFactors?.energy) {
      weights.energy *= temporalFactors.energy;
    }
    if (temporalFactors?.transport) {
      weights.transportation *= temporalFactors.transport;
    }

    return weights;
  }

  async buildBehaviorProfiles(transactions, context, behaviorOverrides) {
    const profiles = {};
    Object.entries(BEHAVIOR_DEFINITIONS).forEach(([behaviorKey, definition]) => {
      profiles[behaviorKey] = {
        behavior: behaviorKey,
        label: definition.label,
        categories: definition.categories,
        weight: context.behaviorWeights?.[behaviorKey] || 1,
        transactionCount: 0,
        totalAmount: 0,
        totalEmissions: 0,
        emissionIntensity: 0,
        weightedEmissions: 0,
        emissionsShare: 0,
        severity: 'low',
        confidence: 0,
        subcategoryBreakdown: {}
      };
    });

    for (const transaction of transactions) {
      const behaviorKey = this.mapCategoryToBehavior(transaction.category);
      const profile = profiles[behaviorKey];
      if (!profile) continue;

      const carbonData = await carbonCalculationService.calculateTransactionCarbonFootprintForAgent(
        transaction,
        context || {}
      );

      profile.transactionCount += 1;
      profile.totalAmount += transaction.amount;
      profile.totalEmissions += carbonData.co2Emissions;

      const subcategory = transaction.subcategory || 'general';
      profile.subcategoryBreakdown[subcategory] = (profile.subcategoryBreakdown[subcategory] || 0) + carbonData.co2Emissions;
    }

    Object.keys(profiles).forEach(behaviorKey => {
      const override = behaviorOverrides?.[behaviorKey];
      if (!override) return;
      if (Number.isFinite(override.totalEmissions)) {
        profiles[behaviorKey].totalEmissions = override.totalEmissions;
      }
      if (Number.isFinite(override.totalAmount)) {
        profiles[behaviorKey].totalAmount = override.totalAmount;
      }
      if (Number.isFinite(override.transactionCount)) {
        profiles[behaviorKey].transactionCount = override.transactionCount;
      }
    });

    const totalEmissions = Object.values(profiles)
      .reduce((sum, profile) => sum + profile.totalEmissions, 0);

    Object.values(profiles).forEach(profile => {
      profile.emissionIntensity = profile.totalAmount > 0
        ? profile.totalEmissions / profile.totalAmount
        : 0;
      profile.weightedEmissions = profile.totalEmissions * profile.weight;
      profile.emissionsShare = totalEmissions > 0 ? profile.totalEmissions / totalEmissions : 0;
      profile.severity = this.classifySeverity(profile.emissionsShare);
      profile.confidence = Math.min(1, profile.transactionCount / 10);
    });

    return profiles;
  }

  buildOrchestrationPlan({ sectorProfile, analysisContext, msmeProfile, orchestrationOptions }) {
    return agentOrchestrationCuratorService.buildEmissionsOrchestrationPlan({
      sectorProfile,
      analysisContext,
      msmeProfile,
      orchestrationOptions,
      sectorAgentType: this.getSectorAgentType(msmeProfile?.businessDomain),
      processMachineryAgentType: this.getProcessMachineryAgentType(msmeProfile?.businessDomain)
    });
  }

  buildParallelAgentDefinitions(analysisContext, orchestrationPlan, coordinationContext) {
    const requestedAgents = orchestrationPlan?.parallelAgents || [];
    const orchestrationOptions = analysisContext.orchestrationOptions || this.getOrchestrationOptions();
    const agentHandlers = {
      anomaly_detector: (task) => aiAgentService.anomalyDetectorAgent(task),
      trend_analyzer: (task) => aiAgentService.trendAnalyzerAgent(task),
      compliance_monitor: (task) => aiAgentService.complianceMonitorAgent(task),
      optimization_advisor: (task) => aiAgentService.optimizationAdvisorAgent(task)
    };

    return requestedAgents
      .map(agentType => {
        const stage = msmeEmissionsCuratedExecutor.getParallelAgentStage(agentType);
        const handler = agentHandlers[agentType];
        if (!stage || !handler) {
          return null;
        }
        const task = msmeEmissionsCuratedExecutor.buildParallelAgentTask(
          agentType,
          analysisContext,
          this.buildCoordinationPayload(coordinationContext, agentType)
        );
        if (!task) {
          return null;
        }
        return {
          type: agentType,
          stage,
          allowFailure: true,
          handler: () => handler(task)
        };
      })
      .filter(Boolean);
  }

  mapCategoryToBehavior(category) {
    const normalized = (category || 'other').toLowerCase();
    const match = Object.entries(BEHAVIOR_DEFINITIONS)
      .find(([, definition]) => definition.categories.includes(normalized));
    return match ? match[0] : 'other';
  }

  classifySeverity(share) {
    if (share >= 0.35) return 'high';
    if (share >= 0.2) return 'medium';
    return 'low';
  }

  selectProcessedTransactions(processedResult, fallbackTransactions) {
    if (!processedResult) return fallbackTransactions;
    if (Array.isArray(processedResult.validated) && processedResult.validated.length > 0) {
      return processedResult.validated;
    }
    if (Array.isArray(processedResult.enriched) && processedResult.enriched.length > 0) {
      return processedResult.enriched;
    }
    if (Array.isArray(processedResult.cleaned) && processedResult.cleaned.length > 0) {
      return processedResult.cleaned;
    }
    return fallbackTransactions;
  }

  selectPrivacySafeTransactions(privacyReview, fallbackTransactions) {
    if (privacyReview &&
        Array.isArray(privacyReview.redactedTransactions) &&
        privacyReview.redactedTransactions.length > 0) {
      return privacyReview.redactedTransactions;
    }
    return fallbackTransactions;
  }

  async executeAgent(agentType, executor, coordinationContext, metadata = {}) {
    const startTime = new Date();
    try {
      const output = await executor();
      this.recordInteraction(coordinationContext, {
        agentType,
        stage: metadata.stage,
        executionMode: metadata.executionMode || 'agent',
        startedAt: startTime,
        completedAt: new Date(),
        status: 'completed'
      });
      coordinationContext.previousResults[agentType] = output;
      return output;
    } catch (error) {
      this.recordInteraction(coordinationContext, {
        agentType,
        stage: metadata.stage,
        executionMode: metadata.executionMode || 'agent',
        startedAt: startTime,
        completedAt: new Date(),
        status: 'failed',
        error: error.message
      });
      if (metadata.allowFailure) {
        coordinationContext.warnings.push({
          agentType,
          stage: metadata.stage,
          message: error.message
        });
        return null;
      }
      logger.error(`Orchestration step failed for ${agentType}:`, error);
      throw error;
    }
  }

  async executeParallelAgents(agents, coordinationContext, agentAvailability, coordinationMode = 'parallel') {
    const executePlannedAgent = agent => this.executeAgent(
      agent.type,
      agent.handler,
      coordinationContext,
      {
        stage: agent.stage,
        allowFailure: agent.allowFailure,
        executionMode: this.getExecutionMode(agentAvailability, agent.type)
      }
    );

    if (coordinationMode === 'sequential') {
      const sequentialResults = {};
      for (const agent of agents) {
        sequentialResults[agent.type] = await executePlannedAgent(agent);
      }
      return sequentialResults;
    }

    const results = await Promise.all(agents.map(executePlannedAgent));
    return agents.reduce((acc, agent, index) => {
      acc[agent.type] = results[index];
      return acc;
    }, {});
  }

  recordInteraction(coordinationContext, interaction) {
    coordinationContext.interactions.push({
      ...interaction,
      timestamp: new Date()
    });
  }

  initializeCommunicationContext(orchestrationId) {
    return {
      orchestrationId: orchestrationId || null,
      sharedContext: {},
      agentBriefings: {},
      messages: [],
      stageSummaries: [],
      lastUpdated: null
    };
  }

  applyOrchestrationUpdate(coordinationContext, update) {
    if (!coordinationContext) return;
    if (!coordinationContext.communication) {
      coordinationContext.communication = this.initializeCommunicationContext(
        coordinationContext.orchestrationId
      );
    }
    if (!update) return;

    const communication = coordinationContext.communication;
    if (update.sharedContext) {
      communication.sharedContext = update.sharedContext;
    }
    if (update.agentBriefings) {
      communication.agentBriefings = {
        ...communication.agentBriefings,
        ...update.agentBriefings
      };
    }
    if (Array.isArray(update.messages) && update.messages.length > 0) {
      communication.messages.push(...update.messages);
    }
    if (update.summary || update.stage) {
      communication.stageSummaries.push({
        stage: update.stage || 'unknown',
        summary: update.summary || null,
        updatedAt: update.updatedAt || new Date().toISOString()
      });
    }
    communication.lastUpdated = new Date().toISOString();
  }

  getAgentBriefing(coordinationContext, agentType) {
    if (!coordinationContext?.communication?.agentBriefings || !agentType) {
      return null;
    }
    return coordinationContext.communication.agentBriefings[agentType] || null;
  }

  buildCoordinationPayload(coordinationContext, agentType) {
    return {
      coordinationContext,
      communication: coordinationContext?.communication || null,
      agentBriefing: this.getAgentBriefing(coordinationContext, agentType)
    };
  }

  async runOrchestrationAgent({
    stage,
    msmeProfile,
    context,
    coordinationContext,
    agentAvailability,
    orchestrationPlan,
    agentOutputs = {},
    transactions = [],
    processedTransactions = []
  }) {
    const output = await this.executeAgent(
      'orchestration_agent',
      () => aiAgentService.orchestrationAgent({
        input: {
          stage,
          orchestrationId: coordinationContext?.orchestrationId,
          msmeSnapshot: this.buildMSMESnapshot(msmeProfile),
          context,
          coordinationContext,
          communicationState: coordinationContext?.communication,
          orchestrationPlan,
          agentOutputs,
          transactions,
          processedTransactions
        }
      }),
      coordinationContext,
      {
        stage: `orchestration_${stage}`,
        allowFailure: true,
        executionMode: this.getExecutionMode(agentAvailability, 'orchestration_agent')
      }
    );

    this.applyOrchestrationUpdate(coordinationContext, output);
    return output;
  }

  async resolveAgentAvailability(additionalTypes = []) {
    try {
      const agentTypes = [
        'orchestration_agent',
        'document_analyzer',
        'data_privacy',
        'verified_source_rag',
        'data_processor',
        'carbon_analyzer',
        'anomaly_detector',
        'trend_analyzer',
        'compliance_monitor',
        'optimization_advisor',
        'recommendation_engine',
        'report_generator'
      ];
      const requestedTypes = [
        ...agentTypes,
        ...(additionalTypes || [])
      ].filter(Boolean);

      const agents = await AIAgent.find({
        type: { $in: requestedTypes },
        isActive: true,
        status: 'active'
      }).select('type name').lean();

      const availability = {};
      requestedTypes.forEach(type => {
        availability[type] = { available: false };
      });

      agents.forEach(agent => {
        availability[agent.type] = {
          available: true,
          name: agent.name
        };
      });

      return availability;
    } catch (error) {
      logger.error('Failed to resolve agent availability:', error);
      return {};
    }
  }

  getExecutionMode(agentAvailability, agentType) {
    const availability = agentAvailability?.[agentType];
    if (!availability) {
      return 'fallback';
    }
    return availability.available ? 'agent' : 'fallback';
  }

  buildEmissionsSummary(behaviorProfiles, carbonAnalysis) {
    const behaviors = Object.values(behaviorProfiles);
    const totalEmissions = behaviors.reduce((sum, behavior) => sum + behavior.totalEmissions, 0);
    const totalWeightedEmissions = behaviors.reduce((sum, behavior) => sum + behavior.weightedEmissions, 0);
    const primaryBehaviors = [...behaviors]
      .sort((a, b) => b.weightedEmissions - a.weightedEmissions)
      .slice(0, 3)
      .map(behavior => behavior.behavior);

    return {
      totalEmissions,
      totalWeightedEmissions,
      primaryBehaviors,
      behaviorBreakdown: behaviorProfiles,
      carbonInsights: carbonAnalysis?.insights || [],
      carbonRecommendations: carbonAnalysis?.recommendations || []
    };
  }

  buildGranularAgentPipeline(interactions = []) {
    const labels = {
      orchestration_agent: 'Orchestration coordinator',
      document_analyzer: 'Document ingestion and structured extraction',
      data_privacy: 'Privacy screening and redaction',
      sector_profiler: 'Sector profile agent',
      process_machinery_profiler: 'Process and machinery profile agent',
      data_processor: 'Transaction classification and validation',
      carbon_analyzer: 'Carbon footprint analysis',
      anomaly_detector: 'Anomaly detection',
      trend_analyzer: 'Emissions trends',
      compliance_monitor: 'Compliance monitoring',
      optimization_advisor: 'Optimization recommendations',
      recommendation_engine: 'Recommendation engine',
      report_generator: 'Report generation'
    };

    return (interactions || []).map((interaction, index) => ({
      order: index + 1,
      agentType: interaction.agentType,
      stage: interaction.stage,
      status: interaction.status,
      executionMode: interaction.executionMode,
      label: labels[interaction.agentType] || interaction.agentType,
      error: interaction.error || null,
      completedAt: interaction.completedAt
    }));
  }

  buildUserClarificationRequests({
    orchestrationId,
    msmeProfile,
    context,
    dataQuality,
    dataProcessing,
    unknownParameters,
    frameworks,
    orchestrationOptions,
    sectorProfile,
    processMachineryProfile,
    documentAnalysis
  }) {
    const items = [];
    const iso64 = frameworks?.iso14064 || {};
    const iso67 = frameworks?.iso14067 || {};
    const minDQ = Number(iso64.minDataQualityConfidence) || 0.65;
    const minSectorConf = Number(iso64.minDataQualityConfidence) || 0.65;
    const maxUnknown = Number(iso64.maxAllowedUnknownParameters) || 3;

    if (dataQuality && Number.isFinite(dataQuality.confidence) && dataQuality.confidence < minDQ) {
      items.push({
        id: 'clarify_data_quality',
        scope: 'emissions_orchestration',
        severity: 'important',
        agentStep: 'data_processor',
        prompt:
          'Overall transaction data quality is below the threshold used for reliable footprinting. Please confirm or correct categories, amounts, and dates, or add invoices and receipts.',
        detail: `Current estimated quality is ${(dataQuality.confidence * 100).toFixed(0)}%; target is about ${(minDQ * 100).toFixed(0)}%.`,
        context: { orchestrationId, confidence: dataQuality.confidence }
      });
    }

    const unknown = unknownParameters || {};
    const weighted = Array.isArray(unknown.weightedParameters) ? unknown.weightedParameters : [];
    if (unknown.needsReview && weighted.length > 0) {
      const top = weighted.slice(0, 5).map(p => p.name).filter(Boolean);
      items.push({
        id: 'clarify_unknown_categories',
        scope: 'emissions_orchestration',
        severity: weighted.length > maxUnknown ? 'important' : 'recommended',
        agentStep: 'carbon_analyzer',
        prompt:
          'Some spend categories are not mapped to standard emission behaviors. How should these activities be classified for reporting (e.g. energy, transport, materials)?',
        detail: top.length
          ? `Examples: ${top.join(', ')}.`
          : 'Review unknown category placeholders in the orchestration context.',
        context: { orchestrationId, weightedParameterCount: weighted.length, maxAllowed: maxUnknown }
      });
    }

    if (
      iso67.enabled !== false &&
      iso67.requireAllocationMethod &&
      !iso67.allocationMethod
    ) {
      items.push({
        id: 'clarify_iso14067_allocation',
        scope: 'emissions_orchestration',
        severity: 'important',
        agentStep: 'compliance_monitor',
        prompt:
          'ISO 14067-style product footprinting needs an allocation method for shared resources. Which approach do you use (e.g. mass, economic, physical causality)?',
        context: { orchestrationId, framework: 'iso14067' }
      });
    }

    if (iso67.enabled !== false && iso67.requireFunctionalUnit) {
      const fu = iso67.functionalUnit;
      const products = msmeProfile?.business?.primaryProducts;
      const genericFu = !fu || String(fu).toLowerCase().includes('unit of finished product');
      if (genericFu && (!products || !String(products).trim())) {
        items.push({
          id: 'clarify_functional_unit',
          scope: 'emissions_orchestration',
          severity: 'recommended',
          agentStep: 'compliance_monitor',
          prompt:
            'Please state the functional unit for your product carbon footprint (e.g. “1 kg of product X” or “1 service delivery”) and your main product names.',
          context: { orchestrationId, framework: 'iso14067' }
        });
      }
    }

    if (iso64.enabled !== false) {
      const bounds = iso64.boundaryDefinitions || {};
      const missingBoundary = ['organizationalBoundary', 'operationalBoundary', 'consolidationApproach'].filter(
        key => !bounds[key]
      );
      if (missingBoundary.length > 0) {
        items.push({
          id: 'clarify_iso14064_boundaries',
          scope: 'emissions_orchestration',
          severity: 'recommended',
          agentStep: 'compliance_monitor',
          prompt:
            'GHG inventory boundaries are incomplete. Please confirm organizational boundary, operational boundary, and consolidation approach for ISO 14064-aligned reporting.',
          detail: `Unset fields: ${missingBoundary.join(', ')}.`,
          context: { orchestrationId, framework: 'iso14064', missingBoundary }
        });
      }
    }

    if (
      sectorProfile &&
      Number.isFinite(sectorProfile.confidence) &&
      sectorProfile.confidence < minSectorConf
    ) {
      items.push({
        id: 'clarify_sector_confidence',
        scope: 'emissions_orchestration',
        severity: 'recommended',
        agentStep: 'sector_profiler',
        prompt:
          'Sector profiling confidence is limited (few transactions or sparse profile fields). Can you add more activity data or confirm your sector and main products?',
        detail: `Sector agent confidence is about ${(sectorProfile.confidence * 100).toFixed(0)}%.`,
        context: { orchestrationId, confidence: sectorProfile.confidence }
      });
    }

    const classifierConf = sectorProfile?.subAgents?.sectorClassifier?.confidence;
    if (Number.isFinite(classifierConf) && classifierConf < 0.75) {
      items.push({
        id: 'clarify_sector_mapping',
        scope: 'emissions_orchestration',
        severity: 'recommended',
        agentStep: 'sector_profiler',
        prompt:
          'The sector classifier is uncertain about how your company maps to a template sector. Please confirm your registered business domain and primary activity.',
        context: { orchestrationId, classifierConfidence: classifierConf }
      });
    }

    if ((msmeProfile?.businessDomain || '').toLowerCase() === 'other') {
      items.push({
        id: 'clarify_business_domain',
        scope: 'emissions_orchestration',
        severity: 'recommended',
        agentStep: 'sector_profiler',
        prompt:
          'Business domain is set to “other”. Which specific sector should emissions agents use for default processes and factors?',
        context: { orchestrationId }
      });
    }

    const ragMeta = processMachineryProfile?.subAgents?.verifiedSourceRag;
    if (
      ragMeta &&
      Number(ragMeta.totalCandidates) > Number(ragMeta.resolvedCandidates)
    ) {
      items.push({
        id: 'clarify_process_machinery_labels',
        scope: 'emissions_orchestration',
        severity: 'recommended',
        agentStep: 'process_machinery_profiler',
        prompt:
          'Some process or machinery labels did not match verified reference data. Please confirm the exact equipment and process steps used on site.',
        detail: `${ragMeta.resolvedCandidates || 0} of ${ragMeta.totalCandidates || 0} labels were auto-resolved.`,
        context: { orchestrationId, ragMeta }
      });
    }

    const docReqs = dataProcessing?.documentRequests;
    if (Array.isArray(docReqs) && docReqs.length > 0) {
      items.push({
        id: 'clarify_supporting_documents',
        scope: 'emissions_orchestration',
        severity: 'important',
        agentStep: 'data_processor',
        prompt:
          'Supporting documents are needed to verify one or more transactions before emissions can be fully trusted.',
        detail: `${docReqs.length} document request(s). Review agent output “documentRequests” for specifics.`,
        context: { orchestrationId, documentRequestCount: docReqs.length }
      });
    }

    const validated = Array.isArray(dataProcessing?.validated) ? dataProcessing.validated : [];
    const uncertain = validated.filter(
      row => row?.processingMetadata?.needsReview || (row?.processingMetadata?.reviewReasons || []).length > 0
    );
    const cap = 12;
    uncertain.slice(0, cap).forEach((row, index) => {
      const reasons = row.processingMetadata?.reviewReasons || [];
      const desc = (row.description || '').slice(0, 80);
      items.push({
        id: `clarify_transaction_${index}`,
        scope: 'emissions_orchestration',
        severity: 'recommended',
        agentStep: 'data_processor',
        prompt: `Please confirm the category and type of this activity: “${desc || 'transaction'}”.`,
        detail: reasons.length ? reasons.join('; ') : 'Classification or validation needs human confirmation.',
        context: {
          orchestrationId,
          transactionId: row._id || row.sourceId || null,
          category: row.category,
          transactionType: row.transactionType
        }
      });
    });
    if (uncertain.length > cap) {
      items.push({
        id: 'clarify_additional_transactions',
        scope: 'emissions_orchestration',
        severity: 'recommended',
        agentStep: 'data_processor',
        prompt: `${uncertain.length - cap} additional transactions also need review after the first ${cap}.`,
        context: { orchestrationId, remaining: uncertain.length - cap }
      });
    }

    const docConf = documentAnalysis?.summary?.averageConfidence ?? documentAnalysis?.summary?.confidence;
    if (documentAnalysis && Number.isFinite(docConf) && docConf < minDQ) {
      items.push({
        id: 'clarify_document_extraction',
        scope: 'emissions_orchestration',
        severity: 'recommended',
        agentStep: 'document_analyzer',
        prompt:
          'Extracted document fields have low confidence. Please verify amounts, dates, and vendor names from the source files.',
        context: { orchestrationId, documentConfidence: docConf }
      });
    }

    return items;
  }

  buildMSMESnapshot(msmeProfile) {
    const manufacturingProfile = normalizeManufacturingProfile(
      msmeProfile?.manufacturingProfile || {}
    );

    return {
      companyName: msmeProfile.companyName,
      industry: msmeProfile.industry,
      businessDomain: msmeProfile.businessDomain,
      companyType: msmeProfile.companyType,
      location: msmeProfile?.contact?.address?.state || 'unknown',
      manufacturingProfile
    };
  }
}

module.exports = new OrchestrationManagerService();
