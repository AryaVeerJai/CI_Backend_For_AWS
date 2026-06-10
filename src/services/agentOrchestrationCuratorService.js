const agentRegistry = require('./agents/registry');
const logger = require('../utils/logger');

const ORCHESTRATION_STAGES = {
  bootstrap: 'bootstrap',
  pre_processing: 'pre_processing',
  enrichment: 'enrichment',
  knowledge_resolution: 'knowledge_resolution',
  core: 'core',
  governance: 'governance',
  insights: 'insights',
  post_processing: 'post_processing',
  advisory: 'advisory',
  esg_analysis: 'esg_analysis',
  enterprise: 'enterprise',
  boundary: 'boundary'
};

const AGENT_CATALOG = {
  orchestration_agent: {
    label: 'Orchestration Coordinator',
    stage: ORCHESTRATION_STAGES.bootstrap,
    domain: 'coordination',
    description: 'Stage summaries, briefings, and coordination checkpoints across the pipeline.'
  },
  document_analyzer: {
    label: 'Document Analyzer',
    stage: ORCHESTRATION_STAGES.pre_processing,
    domain: 'emissions',
    description: 'Extracts transaction context from uploaded documents and bills.'
  },
  data_privacy: {
    label: 'Data Privacy Guard',
    stage: ORCHESTRATION_STAGES.pre_processing,
    domain: 'governance',
    description: 'Redacts PII and enforces privacy guardrails before downstream processing.'
  },
  sector_profiler: {
    label: 'Sector Profiler',
    stage: ORCHESTRATION_STAGES.enrichment,
    domain: 'emissions',
    description: 'Builds sector-specific MSME profile signals and behavior weights.'
  },
  process_machinery_profiler: {
    label: 'Process & Machinery Profiler',
    stage: ORCHESTRATION_STAGES.enrichment,
    domain: 'emissions',
    description: 'Maps processes, machinery, and emission-factor context for the MSME.'
  },
  verified_source_rag: {
    label: 'Verified Source RAG',
    stage: ORCHESTRATION_STAGES.knowledge_resolution,
    domain: 'knowledge',
    description: 'Resolves unknown parameters against curated verified-source registries (BEE, CEA, CPCB).',
    gate: 'unknown_parameters'
  },
  data_processor: {
    label: 'Data Processor',
    stage: ORCHESTRATION_STAGES.core,
    domain: 'emissions',
    description: 'Cleans, classifies, and enriches transaction data for carbon analysis.'
  },
  carbon_analyzer: {
    label: 'Carbon Analyzer',
    stage: ORCHESTRATION_STAGES.core,
    domain: 'emissions',
    description: 'Calculates carbon footprint and scope breakdown from classified transactions.'
  },
  esg_analyzer: {
    label: 'ESG Analyzer',
    stage: ORCHESTRATION_STAGES.esg_analysis,
    domain: 'esg',
    description: 'Environmental, social, and governance scoring with risk and stakeholder impact.'
  },
  inventory_governance: {
    label: 'Inventory Governance',
    stage: ORCHESTRATION_STAGES.governance,
    domain: 'governance',
    description: 'GHG inventory boundary enforcement, factor registry, assurance, and BRSR reconciliation.'
  },
  anomaly_detector: {
    label: 'Anomaly Detector',
    stage: ORCHESTRATION_STAGES.insights,
    domain: 'analytics',
    description: 'Detects outliers and unusual emission patterns.'
  },
  trend_analyzer: {
    label: 'Trend Analyzer',
    stage: ORCHESTRATION_STAGES.insights,
    domain: 'analytics',
    description: 'Analyzes emissions trends and forecasts.'
  },
  compliance_monitor: {
    label: 'Compliance Monitor',
    stage: ORCHESTRATION_STAGES.insights,
    domain: 'compliance',
    description: 'Checks regulatory and ISO compliance readiness.'
  },
  optimization_advisor: {
    label: 'Optimization Advisor',
    stage: ORCHESTRATION_STAGES.insights,
    domain: 'analytics',
    description: 'Identifies process and resource optimization opportunities.'
  },
  recommendation_engine: {
    label: 'Recommendation Engine',
    stage: ORCHESTRATION_STAGES.post_processing,
    domain: 'advisory',
    description: 'Generates prioritized sustainability recommendations.'
  },
  report_generator: {
    label: 'Report Generator',
    stage: ORCHESTRATION_STAGES.post_processing,
    domain: 'reporting',
    description: 'Assembles disclosure-ready reports and narratives.'
  },
  inventory_quality_advisor: {
    label: 'Inventory Quality Advisor',
    stage: ORCHESTRATION_STAGES.advisory,
    domain: 'advisory',
    description: 'Assesses GHG inventory rigor vs completeness.'
  },
  environmental_kpi_advisor: {
    label: 'Environmental KPI Advisor',
    stage: ORCHESTRATION_STAGES.advisory,
    domain: 'advisory',
    description: 'Water, waste, and BRSR Principle 6 KPI guidance.'
  },
  buyer_request_advisor: {
    label: 'Buyer Request Advisor',
    stage: ORCHESTRATION_STAGES.advisory,
    domain: 'advisory',
    description: 'Triages buyer audit and questionnaire requests.'
  },
  dpdp_privacy_advisor: {
    label: 'DPDP Privacy Advisor',
    stage: ORCHESTRATION_STAGES.advisory,
    domain: 'governance',
    description: 'India DPDP compliance guidance for MSME data handling.'
  },
  msme_goal_advisor: {
    label: 'MSME Goal Advisor',
    stage: ORCHESTRATION_STAGES.advisory,
    domain: 'advisory',
    description: 'Prioritizes actions based on signup goals and business context.'
  },
  organizational_boundary_agent: {
    label: 'Organizational Boundary Agent',
    stage: ORCHESTRATION_STAGES.boundary,
    domain: 'governance',
    description: 'Defines GHG organizational boundary per GHG Protocol.'
  },
  operational_boundary_agent: {
    label: 'Operational Boundary Agent',
    stage: ORCHESTRATION_STAGES.boundary,
    domain: 'governance',
    description: 'Defines Scope 1/2/3 operational boundary.'
  },
  ghg_boundary_orchestrator: {
    label: 'GHG Boundary Orchestrator',
    stage: ORCHESTRATION_STAGES.boundary,
    domain: 'governance',
    description: 'Merges organizational and operational boundary outputs.'
  },
  enterprise_compliance: {
    label: 'Enterprise Compliance',
    stage: ORCHESTRATION_STAGES.enterprise,
    domain: 'enterprise',
    description: 'Enterprise-level compliance checks and mandate alignment.'
  },
  brsr_mandate: {
    label: 'BRSR Mandate Agent',
    stage: ORCHESTRATION_STAGES.enterprise,
    domain: 'enterprise',
    description: 'BRSR mandatory disclosure readiness for large enterprises.'
  },
  pat_intensity: {
    label: 'PAT Intensity Agent',
    stage: ORCHESTRATION_STAGES.enterprise,
    domain: 'enterprise',
    description: 'Perform-Achieve-Trade energy intensity benchmarking.'
  },
  boundary_enforcer: {
    label: 'Boundary Enforcer',
    stage: ORCHESTRATION_STAGES.governance,
    domain: 'governance',
    description: 'Enforces organizational and operational boundary rules.'
  },
  assurance_gate: {
    label: 'Assurance Gate',
    stage: ORCHESTRATION_STAGES.governance,
    domain: 'governance',
    description: 'Validates inventory quality before assurance and lock.'
  },
  factor_registry: {
    label: 'Factor Registry Agent',
    stage: ORCHESTRATION_STAGES.governance,
    domain: 'governance',
    description: 'Manages and validates emission factor sources.'
  },
  brsr_scope_reconciliation: {
    label: 'BRSR Scope Reconciliation',
    stage: ORCHESTRATION_STAGES.governance,
    domain: 'governance',
    description: 'Reconciles scope totals for BRSR Principle 6 reporting.'
  },
  iso_evidence_collector: {
    label: 'ISO Evidence Collector',
    stage: ORCHESTRATION_STAGES.post_processing,
    domain: 'compliance',
    description: 'Collects ISO certification evidence packs.'
  },
  iso_gap_closure_planner: {
    label: 'ISO Gap Closure Planner',
    stage: ORCHESTRATION_STAGES.post_processing,
    domain: 'compliance',
    description: 'Plans gap-closure actions for ISO certification.'
  },
  iso_audit_packager: {
    label: 'ISO Audit Packager',
    stage: ORCHESTRATION_STAGES.post_processing,
    domain: 'compliance',
    description: 'Packages audit-ready ISO documentation bundles.'
  }
};

const PIPELINE_TEMPLATES = {
  msme_emissions: {
    id: 'msme_emissions',
    name: 'MSME Emissions Orchestration',
    description: 'End-to-end carbon emissions analysis with curated agent sequencing and on-demand insights.',
    stages: [
      { stage: ORCHESTRATION_STAGES.bootstrap, agents: ['orchestration_agent'], required: true },
      { stage: ORCHESTRATION_STAGES.pre_processing, agents: ['document_analyzer', 'data_privacy'], required: false },
      { stage: ORCHESTRATION_STAGES.enrichment, agents: ['sector_profiler', 'process_machinery_profiler'], required: false },
      { stage: ORCHESTRATION_STAGES.knowledge_resolution, agents: ['verified_source_rag'], required: false, gate: 'unknown_parameters' },
      { stage: ORCHESTRATION_STAGES.core, agents: ['data_processor', 'carbon_analyzer'], required: true },
      { stage: ORCHESTRATION_STAGES.governance, agents: ['inventory_governance'], required: false },
      { stage: ORCHESTRATION_STAGES.esg_analysis, agents: ['esg_analyzer'], required: false },
      { stage: ORCHESTRATION_STAGES.insights, agents: [], required: false, dynamic: true },
      { stage: ORCHESTRATION_STAGES.post_processing, agents: ['recommendation_engine', 'report_generator'], required: false }
    ]
  },
  msme_advisory: {
    id: 'msme_advisory',
    name: 'MSME Advisory Orchestration',
    description: 'Curated advisory pipeline for inventory quality, KPIs, buyer requests, DPDP, and goal prioritization.',
    stages: [
      { stage: ORCHESTRATION_STAGES.bootstrap, agents: ['orchestration_agent'], required: true },
      { stage: ORCHESTRATION_STAGES.advisory, agents: [
        'inventory_quality_advisor',
        'environmental_kpi_advisor',
        'buyer_request_advisor',
        'dpdp_privacy_advisor',
        'msme_goal_advisor'
      ], required: true, coordinationMode: 'sequential' }
    ]
  },
  ghg_boundary: {
    id: 'ghg_boundary',
    name: 'GHG Boundary Orchestration',
    description: 'Parallel organizational and operational boundary agents with merged narrative.',
    stages: [
      { stage: ORCHESTRATION_STAGES.boundary, agents: ['organizational_boundary_agent', 'operational_boundary_agent'], required: true, coordinationMode: 'parallel' },
      { stage: ORCHESTRATION_STAGES.post_processing, agents: ['ghg_boundary_orchestrator'], required: true, coordinationMode: 'sequential' }
    ]
  },
  inventory_governance: {
    id: 'inventory_governance',
    name: 'GHG Inventory Governance',
    description: 'Factor registry, boundary enforcement, calculation, assurance, and BRSR reconciliation.',
    stages: [
      { stage: ORCHESTRATION_STAGES.governance, agents: ['factor_registry', 'boundary_enforcer'], required: true, coordinationMode: 'parallel' },
      { stage: ORCHESTRATION_STAGES.core, agents: ['carbon_analyzer'], required: true },
      { stage: ORCHESTRATION_STAGES.governance, agents: ['assurance_gate', 'brsr_scope_reconciliation'], required: true, coordinationMode: 'parallel' }
    ]
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise Emissions Orchestration',
    description: 'Enterprise compliance, BRSR mandate, PAT intensity, boundary guidance, and insight agents.',
    stages: [
      { stage: ORCHESTRATION_STAGES.enterprise, agents: ['enterprise_compliance', 'brsr_mandate', 'pat_intensity'], required: true, coordinationMode: 'sequential' },
      { stage: ORCHESTRATION_STAGES.boundary, agents: ['organizational_boundary_agent', 'operational_boundary_agent'], required: true, coordinationMode: 'parallel' },
      { stage: ORCHESTRATION_STAGES.core, agents: ['carbon_analyzer'], required: true },
      {
        stage: ORCHESTRATION_STAGES.insights,
        agents: ['trend_analyzer', 'anomaly_detector', 'compliance_monitor', 'verified_source_rag'],
        required: false,
        coordinationMode: 'parallel'
      },
      {
        stage: ORCHESTRATION_STAGES.post_processing,
        agents: ['recommendation_engine', 'report_generator', 'data_privacy'],
        required: false,
        coordinationMode: 'sequential'
      }
    ]
  },
  reporting: {
    id: 'reporting',
    name: 'Carbon Emissions Reporting',
    description: 'Framework-aware reporting orchestration for BRSR, ISO, and CBAM.',
    stages: [
      { stage: ORCHESTRATION_STAGES.core, agents: ['carbon_analyzer'], required: true },
      { stage: ORCHESTRATION_STAGES.insights, agents: ['compliance_monitor'], required: true },
      { stage: ORCHESTRATION_STAGES.post_processing, agents: ['report_generator'], required: true }
    ]
  }
};

class AgentOrchestrationCuratorService {
  getAgentCatalog() {
  return {
      agents: Object.entries(AGENT_CATALOG).map(([type, meta]) => ({
        type,
        ...meta,
        supported: agentRegistry.getSupportedTypes().includes(type)
      })),
      supportedTypes: agentRegistry.getSupportedTypes()
    };
  }

  getPipelineTemplates() {
    return Object.values(PIPELINE_TEMPLATES).map((template) => ({
      ...template,
      agentCount: template.stages.reduce((sum, stage) => sum + stage.agents.length, 0)
    }));
  }

  getPipelineTemplate(pipelineId) {
    const template = PIPELINE_TEMPLATES[pipelineId];
    if (!template) {
      throw new Error(`Unknown orchestration pipeline: ${pipelineId}`);
    }
    return template;
  }

  buildCuratedPlan({
    pipelineId,
    context = {},
    orchestrationOptions = {},
    activeAgentTypes = null,
    sectorAgentType = null,
    processMachineryAgentType = null
  }) {
    const template = this.getPipelineTemplate(pipelineId);

    if (pipelineId === 'msme_emissions') {
      return this.buildEmissionsOrchestrationPlan({
        sectorProfile: context.sectorProfile,
        analysisContext: context.analysisContext || context,
        msmeProfile: context.msmeProfile,
        orchestrationOptions,
        activeAgentTypes,
        sectorAgentType,
        processMachineryAgentType
      });
    }

    const rationale = [`Curated plan for ${template.name}.`];
    const stages = template.stages.map((stageDef) => {
      const resolvedAgents = this.resolveStageAgents(stageDef, {
        sectorAgentType,
        processMachineryAgentType
      });

      return {
        stage: stageDef.stage,
        agents: resolvedAgents,
        coordinationMode: stageDef.coordinationMode || 'sequential',
        required: stageDef.required !== false,
        gate: stageDef.gate || null
      };
    });

    const filteredStages = this.applyAvailabilityFilter(stages, activeAgentTypes, rationale);

    return {
      pipelineId,
      pipelineName: template.name,
      description: template.description,
      stages: filteredStages,
      coordinationMode: this.inferPipelineCoordinationMode(filteredStages),
      rationale,
      curatedAt: new Date().toISOString()
    };
  }

  buildEmissionsOrchestrationPlan({
    sectorProfile,
    analysisContext = {},
    msmeProfile,
    orchestrationOptions = {},
    activeAgentTypes = null,
    sectorAgentType = null,
    processMachineryAgentType = null
  }) {
    const template = PIPELINE_TEMPLATES.msme_emissions;
    const rationale = [];
    const parallelSelection = this.selectParallelInsightAgents({
      sectorProfile,
      analysisContext,
      msmeProfile,
      orchestrationOptions
    });

    rationale.push(...parallelSelection.rationale);

    const verifiedSourceGate = this.shouldRunVerifiedSourceRag({
      unknownParameters: analysisContext.unknownParameters,
      dataQuality: analysisContext.dataQuality,
      orchestrationOptions
    });

    if (verifiedSourceGate.run) {
      rationale.push(`Verified-source RAG gate triggered: ${verifiedSourceGate.reason}.`);
    } else if (verifiedSourceGate.reason) {
      rationale.push(`Verified-source RAG skipped: ${verifiedSourceGate.reason}.`);
    }

    const stages = template.stages.map((stageDef) => {
      if (stageDef.dynamic) {
        return {
          stage: stageDef.stage,
          agents: parallelSelection.agents,
          coordinationMode: parallelSelection.coordinationMode,
          required: false,
          gate: null
        };
      }

      if (stageDef.gate === 'unknown_parameters' && !verifiedSourceGate.run) {
        return {
          stage: stageDef.stage,
          agents: [],
          coordinationMode: 'sequential',
          required: false,
          gate: stageDef.gate,
          skipped: true,
          skipReason: verifiedSourceGate.reason
        };
      }

      const resolvedAgents = this.resolveStageAgents(stageDef, {
        sectorAgentType,
        processMachineryAgentType
      });

      return {
        stage: stageDef.stage,
        agents: resolvedAgents,
        coordinationMode: stageDef.coordinationMode || 'sequential',
        required: stageDef.required !== false,
        gate: stageDef.gate || null
      };
    });

    const filteredStages = this.applyAvailabilityFilter(stages, activeAgentTypes, rationale);

    const scope = {
      preProcessingAgents: this.extractStageAgents(filteredStages, ORCHESTRATION_STAGES.pre_processing),
      enrichmentAgents: [
        ...this.extractStageAgents(filteredStages, ORCHESTRATION_STAGES.enrichment),
        ...this.extractStageAgents(filteredStages, ORCHESTRATION_STAGES.knowledge_resolution)
      ],
      coreAgents: this.extractStageAgents(filteredStages, ORCHESTRATION_STAGES.core),
      esgAgents: this.extractStageAgents(filteredStages, ORCHESTRATION_STAGES.esg_analysis),
      parallelAgents: parallelSelection.agents,
      postProcessingAgents: this.extractStageAgents(filteredStages, ORCHESTRATION_STAGES.post_processing)
    };

    return {
      pipelineId: 'msme_emissions',
      pipelineName: template.name,
      sector: sectorProfile?.sector || msmeProfile?.businessDomain || 'other',
      stages: filteredStages,
      scope,
      parallelAgents: parallelSelection.agents,
      coordinationMode: parallelSelection.coordinationMode,
      verifiedSourceGate,
      outputs: {
        recommendations: orchestrationOptions.orchestration?.emitRecommendations !== false,
        report: orchestrationOptions.orchestration?.emitReport !== false,
        ...(sectorProfile?.orchestrationPlan?.outputs || {})
      },
      thresholds: orchestrationOptions.thresholds || {},
      rationale,
      curatedAt: new Date().toISOString()
    };
  }

  selectParallelInsightAgents({
    sectorProfile,
    analysisContext = {},
    msmeProfile,
    orchestrationOptions = {}
  }) {
    const legacyParallelAgents = [
      'anomaly_detector',
      'trend_analyzer',
      'compliance_monitor',
      'optimization_advisor'
    ];

    const thresholds = orchestrationOptions.thresholds || {};
    const sectorPlan = sectorProfile?.orchestrationPlan || {};
    const configuredDefaults = Array.isArray(orchestrationOptions.orchestration?.defaultParallelAgents)
      ? orchestrationOptions.orchestration.defaultParallelAgents
      : [];
    const defaultParallelAgents = orchestrationOptions.orchestration?.onDemandAgents === false
      ? (configuredDefaults.length > 0 ? configuredDefaults : legacyParallelAgents)
      : configuredDefaults;
    const requestedParallelAgents = Array.isArray(sectorPlan.parallelAgents)
      ? sectorPlan.parallelAgents
      : defaultParallelAgents;
    const parallelAgents = new Set(requestedParallelAgents);
    const rationale = [];

    const transactionCount = analysisContext.transactions?.length || 0;
    const behaviorProfiles = analysisContext.behaviorProfiles || {};
    const knownParameters = analysisContext.knownParameters || {};
    const profileSignals = analysisContext.context?.profileSignals || {};

    const highSeverity = Object.values(behaviorProfiles).filter((profile) => profile.severity === 'high');
    if (highSeverity.length > 0) {
      parallelAgents.add('anomaly_detector');
      rationale.push('High severity behaviors trigger anomaly detection.');
    }

    if (transactionCount >= (thresholds.minTransactionsForAnomaly || 20)) {
      parallelAgents.add('anomaly_detector');
      rationale.push('Sufficient transaction volume supports anomaly detection.');
    }

    if (transactionCount >= (thresholds.minTransactionsForTrends || 12)) {
      parallelAgents.add('trend_analyzer');
      rationale.push('Transaction volume supports trend analysis.');
    }

    if ((behaviorProfiles.energy?.emissionsShare || 0) > (thresholds.energyShareHigh || 0.2)) {
      parallelAgents.add('optimization_advisor');
      rationale.push('Energy emissions indicate optimization opportunities.');
    }

    if ((behaviorProfiles.waste?.emissionsShare || 0) > (thresholds.wasteShareHigh || 0.1)) {
      parallelAgents.add('compliance_monitor');
      rationale.push('Waste emissions warrant compliance review.');
    }

    if ((behaviorProfiles.transportation?.emissionsShare || 0) > (thresholds.transportShareHigh || 0.15)) {
      parallelAgents.add('trend_analyzer');
      rationale.push('Transportation intensity adds trend monitoring.');
    }

    if ((behaviorProfiles.materials?.emissionsShare || 0) > (thresholds.materialsShareHigh || 0.15)) {
      parallelAgents.add('optimization_advisor');
      rationale.push('Material emissions indicate optimization opportunity.');
    }

    if ((behaviorProfiles.manufacturing?.emissionsShare || 0) > (thresholds.manufacturingShareHigh || 0.12)) {
      parallelAgents.add('compliance_monitor');
      rationale.push('Manufacturing emissions drive compliance review.');
    }

    if (msmeProfile?.environmentalCompliance &&
        (!msmeProfile.environmentalCompliance.hasPollutionControlBoard ||
         !msmeProfile.environmentalCompliance.hasEnvironmentalClearance)) {
      parallelAgents.add('compliance_monitor');
      rationale.push('Missing compliance signals add regulatory checks.');
    }

    if (analysisContext.dataQuality?.confidence < 0.6) {
      rationale.push('Data quality below target; interpret results cautiously.');
    }

    if ((profileSignals.completeness?.ratio || 0) < 0.55) {
      parallelAgents.add('anomaly_detector');
      rationale.push('Incomplete manufacturing profile triggers anomaly detection safeguards.');
    }

    if ((profileSignals.complexityScore || 0) >= 0.6) {
      parallelAgents.add('optimization_advisor');
      parallelAgents.add('trend_analyzer');
      rationale.push('Complex manufacturing profile enables deeper optimization and trend analysis.');
    }

    if (profileSignals.flags?.exportIntensive) {
      parallelAgents.add('compliance_monitor');
      parallelAgents.add('trend_analyzer');
      rationale.push('Export-intensive profile adds compliance and trend monitoring.');
    }

    if (profileSignals.flags?.highRegulatoryExposure) {
      parallelAgents.add('compliance_monitor');
      rationale.push('High regulatory exposure triggers enhanced compliance monitoring.');
    }

    if (profileSignals.flags?.energyIntensive) {
      parallelAgents.add('optimization_advisor');
      rationale.push('Energy-intensive profile triggers optimization advisor.');
    }

    if (profileSignals.flags?.wasteIntensive) {
      parallelAgents.add('compliance_monitor');
      rationale.push('Waste-intensive profile triggers compliance monitoring.');
    }

    const weightedUnknowns = analysisContext.unknownParameters?.weightedParameters || [];
    const highUnknowns = weightedUnknowns.filter((param) => (param.weight || 0) >= 0.35);
    if (highUnknowns.length > 0) {
      parallelAgents.add('anomaly_detector');
      parallelAgents.add('compliance_monitor');
      rationale.push('High-weight unknown parameters trigger anomaly and compliance review.');
    }

    if ((knownParameters.processes || []).length > 0 || (knownParameters.machinery || []).length > 0) {
      parallelAgents.add('optimization_advisor');
      rationale.push('Process and machinery signals add optimization review.');
    }

    if (knownParameters.wasteGeneration?.total || (knownParameters.wasteGeneration?.types || []).length > 0) {
      parallelAgents.add('compliance_monitor');
      rationale.push('Known waste generation triggers compliance review.');
    }

    if (knownParameters.fuelConsumption?.total || (knownParameters.fuelConsumption?.types || []).length > 0) {
      parallelAgents.add('optimization_advisor');
      rationale.push('Fuel consumption signals optimization opportunities.');
    }

    if ((knownParameters.airPollution?.pollutants || []).length > 0) {
      parallelAgents.add('compliance_monitor');
      rationale.push('Air pollution signals require compliance monitoring.');
    }

    const frameworks = analysisContext.context?.frameworks || {};
    if (frameworks.iso14064?.enabled || frameworks.iso14067?.enabled) {
      parallelAgents.add('compliance_monitor');
      rationale.push('ISO framework monitoring enabled for compliance checks.');
    }

    if (sectorProfile?.label) {
      rationale.push(`Sector orchestration aligned to ${sectorProfile.label}.`);
    }

    const plannedParallelAgents = this.applyParallelAgentDemandLimits(
      Array.from(parallelAgents),
      orchestrationOptions
    );

    if (plannedParallelAgents.length < parallelAgents.size) {
      rationale.push(`Parallel insight agents limited to ${plannedParallelAgents.length} by orchestration policy.`);
    }

    const coordinationMode = orchestrationOptions.orchestration?.preferParallel && plannedParallelAgents.length > 1
      ? 'parallel'
      : 'sequential';

    return {
      agents: plannedParallelAgents,
      coordinationMode,
      rationale
    };
  }

  applyParallelAgentDemandLimits(agentTypes = [], orchestrationOptions = {}) {
    const uniqueAgentTypes = [...new Set(agentTypes.filter(Boolean))];
    const rawLimit = orchestrationOptions.orchestration?.maxParallelAgents;
    if (rawLimit === null || rawLimit === undefined || rawLimit === '') {
      return uniqueAgentTypes;
    }
    const maxParallelAgents = Number(rawLimit);
    if (!Number.isFinite(maxParallelAgents) || maxParallelAgents < 0) {
      return uniqueAgentTypes;
    }
    return uniqueAgentTypes.slice(0, Math.floor(maxParallelAgents));
  }

  shouldRunVerifiedSourceRag({ unknownParameters = {}, dataQuality = {}, orchestrationOptions = {} }) {
    if (orchestrationOptions.orchestration?.skipVerifiedSourceRag === true) {
      return { run: false, reason: 'Verified-source RAG disabled by orchestration options.', items: [] };
    }

    const weightedParameters = unknownParameters.weightedParameters || [];
    const highWeightItems = weightedParameters.filter((param) => (param.weight || 0) >= 0.25);
    const unresolvedItems = (unknownParameters.unresolvedItems || weightedParameters)
      .filter((item) => item?.name || item?.description)
      .map((item) => ({
        name: item.name || item.description,
        weight: item.weight || 0,
        source: item.source || 'unknown'
      }));

    const items = unresolvedItems.length > 0 ? unresolvedItems : highWeightItems;

    if (items.length === 0) {
      return { run: false, reason: 'No high-weight unknown parameters detected.', items: [] };
    }

    if ((dataQuality.confidence || 1) >= 0.85 && highWeightItems.length === 0) {
      return { run: false, reason: 'Data quality is sufficient without verified-source resolution.', items: [] };
    }

    return {
      run: true,
      reason: `${items.length} unknown parameter(s) require verified-source resolution.`,
      items
    };
  }

  buildVerifiedSourceRagInput({ items = [], msmeProfile = {}, context = {} }) {
    return {
      items: items.map((item) => ({
        description: item.name || item.description,
        parameterType: item.source === 'category' ? 'transaction' : 'process',
        weight: item.weight
      })),
      businessDomain: msmeProfile.businessDomain || context.businessDomain || 'other',
      transactionType: context.transactionType || 'other',
      parameterType: 'transaction',
      location: context.location?.state || msmeProfile?.contact?.address?.state || ''
    };
  }

  resolveStageAgents(stageDef, { sectorAgentType, processMachineryAgentType } = {}) {
    return stageDef.agents.map((agentType) => {
      if (agentType === 'sector_profiler' && sectorAgentType) {
        return sectorAgentType;
      }
      if (agentType === 'process_machinery_profiler' && processMachineryAgentType) {
        return processMachineryAgentType;
      }
      return agentType;
    });
  }

  applyAvailabilityFilter(stages, activeAgentTypes, rationale = []) {
    if (!Array.isArray(activeAgentTypes) || activeAgentTypes.length === 0) {
      return stages;
    }

    const activeSet = new Set(activeAgentTypes);

    return stages.map((stage) => {
      const availableAgents = stage.agents.filter((agentType) => {
        const baseType = agentType.split('_').slice(0, 2).join('_');
        const isAvailable = activeSet.has(agentType)
          || activeSet.has(baseType)
          || agentType.startsWith('sector_profiler')
          || agentType.startsWith('process_machinery_profiler');

        if (!isAvailable && stage.agents.length > 0) {
          rationale.push(`Agent ${agentType} unavailable; excluded from ${stage.stage} stage.`);
        }
        return isAvailable;
      });

      return {
        ...stage,
        agents: availableAgents,
        excludedAgents: stage.agents.filter((agent) => !availableAgents.includes(agent))
      };
    });
  }

  extractStageAgents(stages, stageName) {
    return stages
      .filter((stage) => stage.stage === stageName && !stage.skipped)
      .flatMap((stage) => stage.agents);
  }

  planIncludesAgent(curatedPlan, agentType) {
    if (!curatedPlan || !agentType) return false;
    return (curatedPlan.stages || []).some(
      (stage) => !stage.skipped && (stage.agents || []).includes(agentType)
    );
  }

  inferPipelineCoordinationMode(stages) {
    const modes = stages.map((stage) => stage.coordinationMode).filter(Boolean);
    if (modes.includes('parallel')) {
      return 'hybrid';
    }
    return 'sequential';
  }

  toGraphSteps(curatedPlan, agentIdByType = {}) {
    const steps = [];
    let previousStageStepIds = [];

    curatedPlan.stages.forEach((stageDef, stageIndex) => {
      if (stageDef.skipped || stageDef.agents.length === 0) {
        return;
      }

      const stageStepIds = [];
      const dependencies = stageIndex === 0 ? [] : [...previousStageStepIds];

      stageDef.agents.forEach((agentType, agentIndex) => {
        const stepId = `${stageDef.stage}_${agentType}_${agentIndex}`;
        const agentId = agentIdByType[agentType];
        if (!agentId) {
          logger.warn('Skipping graph step without agentId mapping', { agentType, stage: stageDef.stage });
          return;
        }

        steps.push({
          stepId,
          agentId,
          taskType: agentType,
          dependencies: stageDef.coordinationMode === 'parallel' && agentIndex > 0
            ? []
            : [...dependencies],
          conditions: stageDef.gate ? { runIf: true } : {},
          executionMode: 'graph'
        });
        stageStepIds.push(stepId);
      });

      previousStageStepIds = stageStepIds.length > 0 ? stageStepIds : previousStageStepIds;
    });

    return steps;
  }
}

module.exports = new AgentOrchestrationCuratorService();
module.exports.AgentOrchestrationCuratorService = AgentOrchestrationCuratorService;
module.exports.PIPELINE_TEMPLATES = PIPELINE_TEMPLATES;
module.exports.AGENT_CATALOG = AGENT_CATALOG;
module.exports.ORCHESTRATION_STAGES = ORCHESTRATION_STAGES;
