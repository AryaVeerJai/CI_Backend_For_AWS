const logger = require('../utils/logger');
const sectorProfilerAgent = require('./agents/sectorProfilerAgent');
const processMachineryProfilerAgent = require('./agents/processMachineryProfilerAgent');
const recommendationEngineAgent = require('./agents/recommendationEngineAgent');
const verifiedKnowledgeRagService = require('./verifiedKnowledgeRagService');
const ghgBoundaryAgentOrchestrator = require('./ghgBoundaryAgentOrchestrator');
const { normalizeGhgOperationalBoundary } = require('../utils/ghgBoundaryFields');

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundTo = (value, decimals = 3) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const base = 10 ** decimals;
  return Math.round(numeric * base) / base;
};

const summarizeSupplyChain = (supplyChain = []) => {
  const partnerTypeMix = {};
  const transportModeMix = {};
  let totalDistanceKm = 0;
  let totalWeightKgPerMonth = 0;

  supplyChain.forEach((entry) => {
    const partnerType = String(entry.partnerType || 'supplier').toLowerCase();
    const transportMode = String(entry.transportMode || 'road_diesel').toLowerCase();
    partnerTypeMix[partnerType] = (partnerTypeMix[partnerType] || 0) + 1;
    transportModeMix[transportMode] = (transportModeMix[transportMode] || 0) + 1;
    totalDistanceKm += toNumber(entry.distanceKm, 0);
    totalWeightKgPerMonth += toNumber(entry.shipmentWeightKgPerMonth, 0);
  });

  return {
    partners: supplyChain.length,
    partnerTypeMix,
    transportModeMix,
    totalDistanceKm: roundTo(totalDistanceKm, 2),
    totalWeightKgPerMonth: roundTo(totalWeightKgPerMonth, 2)
  };
};

const buildCarbonDataFromWorkflowEstimate = (estimate = {}) => {
  const total = toNumber(estimate.totalCO2Emissions, 0);
  const processEmissions = toNumber(estimate.processEmissions, 0);
  const machinery = toNumber(estimate.machineryEmissions, 0);
  const processAuxiliary = toNumber(estimate.processAuxiliaryEmissions, 0);
  const rawMaterials = toNumber(estimate.rawMaterialEmissions, 0);
  const packaging = toNumber(estimate.packagingMaterialEmissions, 0);
  const commute = toNumber(estimate.commuteEmissions, 0);
  const supplyChain = toNumber(estimate.supplyChainEmissions, 0);

  return {
    totalCO2Emissions: total,
    breakdown: {
      energy: {
        total: machinery + processAuxiliary
      },
      materials: {
        co2Emissions: rawMaterials + packaging
      },
      transportation: {
        co2Emissions: commute + supplyChain
      },
      waste: {
        total: 0
      },
      water: {
        co2Emissions: 0
      }
    },
    metadata: {
      processEmissions,
      scope3Emissions: toNumber(estimate.scope3Emissions, 0),
      commuteEmissions: commute,
      supplyChainEmissions: supplyChain
    }
  };
};

const buildWorkflowInsights = (estimate = {}, supplyChainSummary = {}) => {
  const total = toNumber(estimate.totalCO2Emissions, 0);
  const scope3 = toNumber(estimate.scope3Emissions, 0);
  const supplyChain = toNumber(estimate.supplyChainEmissions, 0);
  const commute = toNumber(estimate.commuteEmissions, 0);
  const machinery = toNumber(estimate.machineryEmissions, 0);
  const valueChain = estimate.valueChainEmissions || {};

  const insights = [];
  if (total > 0) {
    const scope3Share = (scope3 / total) * 100;
    insights.push(`Scope 3 contributes ${roundTo(scope3Share, 1)}% of workflow emissions.`);
  }
  if (scope3 > 0) {
    const supplyShare = (supplyChain / scope3) * 100;
    insights.push(`Supply chain contributes ${roundTo(supplyShare, 1)}% of Scope 3 emissions.`);
  }
  if (supplyChainSummary.partners > 0) {
    insights.push(`Supply chain model covers ${supplyChainSummary.partners} partner links.`);
  }
  if (commute > machinery) {
    insights.push('Employee commute emissions exceed machinery emissions; prioritize mobility interventions.');
  }
  const valueChainPairs = [
    { stage: 'upstream', value: toNumber(valueChain.upstream, 0) },
    { stage: 'operations', value: toNumber(valueChain.operations, 0) },
    { stage: 'downstream', value: toNumber(valueChain.downstream, 0) },
    { stage: 'support', value: toNumber(valueChain.support, 0) }
  ];
  const dominantStage = valueChainPairs.sort((left, right) => right.value - left.value)[0];
  if (dominantStage && dominantStage.value > 0) {
    insights.push(`Value-chain hotspot is ${dominantStage.stage} at ${roundTo(dominantStage.value, 2)} kg CO2.`);
  }
  return insights;
};

const extractTopRecommendations = (recommendationPayload = {}, limit = 6) => {
  const list = Array.isArray(recommendationPayload.recommendations)
    ? recommendationPayload.recommendations
    : [];
  return list.slice(0, limit).map((recommendation) => ({
    id: recommendation.id,
    category: recommendation.category,
    title: recommendation.title,
    priority: recommendation.priority,
    potentialCO2Reduction: roundTo(toNumber(recommendation.potentialCO2Reduction, 0), 2),
    timeline: recommendation.timeline || null
  }));
};

const generateWorkflowInsights = async ({
  msmeData = {},
  units = [],
  employees = [],
  supplyChain = [],
  estimate = {},
  context = {}
}) => {
  try {
    const [sectorProfile, processProfile, boundaryPlan] = await Promise.all([
      sectorProfilerAgent.analyzeProfile({
        msmeData,
        transactions: [],
        context
      }),
      processMachineryProfilerAgent.analyzeProfile({
        msmeData,
        transactions: [],
        context
      }),
      ghgBoundaryAgentOrchestrator.runGhgBoundaryAgentOrchestration({
        msmeData,
        workflowSummary: {
          employees: employees.length,
          supplyChainLinks: supplyChain.length,
          units: units.length
        }
      })
    ]);

    const supplyChainSummary = summarizeSupplyChain(supplyChain);
    const recommendationPayload = await recommendationEngineAgent.generateRecommendations({
      msmeData,
      transactions: [],
      carbonData: buildCarbonDataFromWorkflowEstimate(estimate),
      trends: {
        transport: {
          scope3Share: toNumber(estimate.scope3Emissions, 0)
        }
      }
    });

    const confidenceValues = [
      toNumber(sectorProfile?.confidence, 0),
      toNumber(processProfile?.confidence, 0)
    ].filter((value) => value > 0);
    const confidence = confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : 0;

    const unknownCandidates = [];
    (processProfile?.processes || []).forEach((processName) => {
      const normalized = String(processName || '').toLowerCase();
      if (normalized.startsWith('other_') || normalized === 'other') {
        unknownCandidates.push({
          text: processName,
          parameterType: 'process',
          transactionType: 'expense'
        });
      }
    });
    (processProfile?.machinery || []).forEach((machineryName) => {
      const normalized = String(machineryName || '').toLowerCase();
      if (normalized.startsWith('other_') || normalized === 'other') {
        unknownCandidates.push({
          text: machineryName,
          parameterType: 'machinery',
          transactionType: 'maintenance'
        });
      }
    });
    const ragResolutions = verifiedKnowledgeRagService.classifyBatch(unknownCandidates, {
      businessDomain: msmeData?.businessDomain || 'other',
      location: msmeData?.contact?.address?.state || ''
    });

    const unresolvedRag = Math.max(0, unknownCandidates.length - ragResolutions.length);
    const userClarificationRequests = [];
    if (unresolvedRag > 0) {
      userClarificationRequests.push({
        id: 'workflow_rag_unresolved',
        scope: 'workflow_insights',
        severity: 'recommended',
        agentStep: 'verified_source_rag',
        prompt:
          'Some workflow process or machinery entries use generic labels. Please map them to specific equipment or process names so footprint agents can pick correct factors.',
        detail: `${unresolvedRag} label(s) could not be matched automatically.`,
        context: { unresolvedRag, candidates: unknownCandidates.slice(0, 8) }
      });
    }
    if (confidence > 0 && confidence < 0.55) {
      userClarificationRequests.push({
        id: 'workflow_profile_confidence',
        scope: 'workflow_insights',
        severity: 'recommended',
        agentStep: 'sector_profiler',
        prompt:
          'Profile-based emissions estimates are uncertain. Add manufacturing workflow detail (units, processes, energy) or confirm your sector and main products.',
        detail: `Blended profiler confidence is about ${(confidence * 100).toFixed(0)}%.`,
        context: { confidence }
      });
    }
    if ((msmeData?.businessDomain || '').toLowerCase() === 'other') {
      userClarificationRequests.push({
        id: 'workflow_business_domain',
        scope: 'workflow_insights',
        severity: 'recommended',
        agentStep: 'sector_profiler',
        prompt:
          'Business domain is “other”. Which sector should workflow and emissions agents assume when you have not yet filled the manufacturing wizard?',
        context: {}
      });
    }

    const granularStageAgents = [
      'raw_material_emissions_agent',
      'process_emissions_agent',
      'machinery_emissions_agent',
      'packaging_emissions_agent',
      'transport_shipment_emissions_agent',
      'energy_emissions_agent',
      'chemicals_emissions_agent',
      'water_emissions_agent',
      'fuel_combustion_emissions_agent',
      'transport_fleet_emissions_agent',
      'power_consumption_intelligence_agent',
      'wastewater_treatment_emissions_agent'
    ];
    const resourceUnderstandingAgents = [
      'operations_intake_agent',
      'resource_baseline_agent',
      'utilities_mapping_agent',
      'materials_and_chemicals_agent',
      'fleet_operations_agent',
      'treatment_and_compliance_agent'
    ];

    return {
      orchestration: {
        mode: 'parallel_multi_agent',
        agentsUsed: [
          'sector_profiler',
          'process_machinery_profiler',
          'organizational_boundary_agent',
          'operational_boundary_agent',
          'ghg_boundary_orchestrator',
          'verified_source_rag',
          'recommendation_engine'
        ],
        resourceUnderstandingAgents,
        granularStageAgents,
        architecture: {
          frameworkAlignment: ['ISO 14064', 'ISO 14067', 'GHG Protocol'],
          strategy: 'agentic_pipeline_with_stage_specific_agents',
          principle: 'use_profile_registration_and_workflow_data_for_activity_level_emissions',
          ghgBoundaries: {
            pattern: boundaryPlan?.architecture?.pattern || 'parallel_specialists_with_merge',
            agents: boundaryPlan?.architecture?.agents || []
          }
        },
        generatedAt: new Date().toISOString()
      },
      confidence: roundTo(confidence, 4),
      sectorProfile: {
        sector: sectorProfile?.sector || msmeData?.businessDomain || 'other',
        label: sectorProfile?.label || 'Other',
        focusAreas: sectorProfile?.focusAreas || [],
        behaviorWeights: sectorProfile?.behaviorWeights || {},
        orchestrationPlan: sectorProfile?.orchestrationPlan || {}
      },
      processProfile: {
        processes: processProfile?.processes || [],
        machinery: processProfile?.machinery || [],
        notes: processProfile?.notes || []
      },
      boundaryPlan,
      mergedOperationalBoundaryDraft: boundaryPlan?.mergedOperationalDraft
        ? normalizeGhgOperationalBoundary(boundaryPlan.mergedOperationalDraft, {})
        : null,
      supplyChainSummary,
      recommendationProfile: {
        totalGenerated: toNumber(recommendationPayload?.totalGenerated, 0),
        priorityDistribution: recommendationPayload?.priorityDistribution || {},
        recommendations: extractTopRecommendations(recommendationPayload)
      },
      ragResolution: {
        totalCandidates: unknownCandidates.length,
        resolvedCandidates: ragResolutions.length,
        unresolvedCandidates: Math.max(0, unknownCandidates.length - ragResolutions.length),
        resolutions: ragResolutions.map(entry => ({
          candidate: entry.item,
          classification: entry.result
        })),
        verifiedSources: verifiedKnowledgeRagService.getVerifiedSources()
      },
      granularAgentNetwork: {
        lifecycleGranularity: [
          'raw_materials',
          'processes',
          'machinery',
          'packaging',
          'goods_transportation_and_shipment',
          'energy_consumption',
          'chemicals_consumption',
          'water_consumption'
        ],
        estimatedCoverage: {
          rawMaterials: units.reduce((sum, unit) => sum + (Array.isArray(unit?.processes) ? unit.processes.reduce((inner, process) => inner + (Array.isArray(process?.rawMaterials) ? process.rawMaterials.length : 0), 0) : 0), 0),
          processes: units.reduce((sum, unit) => sum + (Array.isArray(unit?.processes) ? unit.processes.length : 0), 0),
          machinery: units.reduce((sum, unit) => sum + (Array.isArray(unit?.processes) ? unit.processes.reduce((inner, process) => inner + (Array.isArray(process?.machineries) ? process.machineries.length : 0), 0) : 0), 0),
          packaging: units.reduce((sum, unit) => sum + (Array.isArray(unit?.processes) ? unit.processes.reduce((inner, process) => inner + (Array.isArray(process?.rawMaterials) ? process.rawMaterials.filter((material) => Boolean(material?.isPackagingMaterial)).length : 0), 0) : 0), 0),
          transportationAndShipmentLinks: supplyChain.length,
          energyProfiles: units.length,
          chemicalsProfiles: units.length,
          waterProfiles: units.length
        }
      },
      workflowInsights: buildWorkflowInsights(estimate, supplyChainSummary),
      statistics: {
        units: units.length,
        employees: employees.length,
        supplyChainLinks: supplyChain.length
      },
      userClarificationRequests,
      userClarificationSummary: {
        total: userClarificationRequests.length,
        important: userClarificationRequests.filter(item => item.severity === 'important').length,
        recommended: userClarificationRequests.filter(item => item.severity === 'recommended').length
      }
    };
  } catch (error) {
    logger.error('Workflow multi-agent insights generation failed', {
      message: error.message
    });
    return {
      orchestration: {
        mode: 'parallel_multi_agent',
        agentsUsed: [
          'sector_profiler',
          'process_machinery_profiler',
          'organizational_boundary_agent',
          'operational_boundary_agent',
          'ghg_boundary_orchestrator',
          'verified_source_rag',
          'recommendation_engine'
        ],
        generatedAt: new Date().toISOString()
      },
      confidence: 0,
      error: error.message,
      workflowInsights: []
    };
  }
};

module.exports = {
  generateWorkflowInsights
};
