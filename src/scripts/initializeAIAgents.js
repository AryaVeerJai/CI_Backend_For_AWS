const mongoose = require('mongoose');
const AIAgent = require('../models/AIAgent');
const logger = require('../utils/logger');
require('dotenv').config();

const defaultAgents = [
  {
    name: 'Carbon Analyzer Agent',
    type: 'carbon_analyzer',
    description: 'Specialized agent for carbon footprint analysis and sustainability assessment',
    capabilities: [
      'transaction_analysis',
      'emission_calculation',
      'carbon_scoring',
      'sustainability_assessment',
      'esg_scope_analysis'
    ],
    configuration: {
      model: 'carbon_analysis_v1',
      parameters: {
        emissionFactors: 'default',
        calculationMethod: 'transaction_based',
        includeScope3: true
      },
      thresholds: {
        highEmissionThreshold: 100,
        anomalyThreshold: 3.0,
        confidenceThreshold: 0.7
      }
    }
  },
  {
    name: 'Recommendation Engine Agent',
    type: 'recommendation_engine',
    description: 'Generates personalized sustainability recommendations and optimization suggestions',
    capabilities: [
      'sustainability_recommendations',
      'cost_optimization',
      'efficiency_improvements',
      'compliance_guidance',
      'technology_adoption'
    ],
    configuration: {
      model: 'recommendation_v1',
      parameters: {
        maxRecommendations: 10,
        priorityWeights: {
          high: 3,
          medium: 2,
          low: 1
        },
        includeCostBenefit: true
      },
      thresholds: {
        minConfidence: 0.6,
        minImpact: 0.1
      }
    }
  },
  {
    name: 'Data Processor Agent',
    type: 'data_processor',
    description: 'Processes, cleans, and classifies transaction data for carbon calculations',
    capabilities: [
      'data_cleaning',
      'transaction_classification',
      'text_analysis',
      'data_enrichment',
      'quality_validation'
    ],
    configuration: {
      model: 'data_processing_v1',
      parameters: {
        enableNLP: true,
        autoClassification: true,
        dataEnrichment: true,
        validationStrict: true
      },
      thresholds: {
        classificationConfidence: 0.7,
        validationStrictness: 0.8
      }
    }
  },
  {
    name: 'Verified Source RAG Agent',
    type: 'verified_source_rag',
    description: 'Classifies unknown MSME parameters using verified-source retrieval signals',
    capabilities: [
      'verified_source_retrieval',
      'unknown_parameter_resolution',
      'rag_classification',
      'emission_factor_mapping',
      'reference_traceability'
    ],
    configuration: {
      model: 'verified_source_rag_v1',
      parameters: {
        retrievalMode: 'verified_registry',
        allowedSources: ['BEE', 'CEA', 'PNGRB', 'PPAC', 'CPCB', 'MoEFCC', 'ISRO Bhuvan'],
        confidenceThreshold: 0.55
      },
      thresholds: {
        minimumConfidence: 0.55,
        unresolvedAlertThreshold: 0.3
      }
    }
  },
  {
    name: 'Data Privacy Agent',
    type: 'data_privacy',
    description: 'Applies privacy controls, redaction, and policy-aligned data handling',
    capabilities: [
      'pii_redaction',
      'data_minimization',
      'policy_context',
      'privacy_audit_trail',
      'retention_guidance'
    ],
    configuration: {
      model: 'privacy_guard_v1',
      parameters: {
        redactionLevel: 'standard',
        enabledRules: ['email', 'phone', 'pan', 'gst', 'udyam'],
        applyToFields: ['description', 'vendor', 'referenceId', 'counterparty']
      },
      thresholds: {
        minimumConfidence: 0.7,
        escalationThreshold: 0.9
      }
    }
  },
  {
    name: 'Document Analyzer Agent',
    type: 'document_analyzer',
    description: 'Analyzes uploaded documents and derives transaction context',
    capabilities: [
      'document_summary',
      'transaction_derivation',
      'category_enrichment',
      'vendor_insights',
      'metadata_validation'
    ],
    configuration: {
      model: 'document_analysis_v1',
      parameters: {
        includeDerivedTransactions: true,
        includeVendorBreakdown: true
      },
      thresholds: {
        minimumConfidence: 0.6
      }
    }
  },
  {
    name: 'Orchestration Agent',
    type: 'orchestration_agent',
    description: 'Coordinates multi-agent workflows and shared context exchange',
    capabilities: [
      'agent_coordination',
      'context_synchronization',
      'workflow_guardrails',
      'communication_hub',
      'orchestration_planning'
    ],
    configuration: {
      model: 'orchestration_coordinator_v1',
      parameters: {
        summaryDetail: 'standard',
        maxMessages: 200,
        includeBriefings: true
      },
      thresholds: {
        lowDataQuality: 0.6,
        unknownParameterWeight: 0.35
      }
    }
  },
  {
    name: 'Anomaly Detector Agent',
    type: 'anomaly_detector',
    description: 'Detects unusual patterns and anomalies in transaction and emission data',
    capabilities: [
      'pattern_analysis',
      'anomaly_detection',
      'outlier_identification',
      'trend_analysis',
      'risk_assessment'
    ],
    configuration: {
      model: 'anomaly_detection_v1',
      parameters: {
        sensitivity: 'medium',
        lookbackPeriod: 30,
        enableML: true
      },
      thresholds: {
        anomalyThreshold: 2.5,
        riskThreshold: 0.8
      }
    }
  },
  {
    name: 'Trend Analyzer Agent',
    type: 'trend_analyzer',
    description: 'Analyzes trends and patterns in carbon emissions and sustainability metrics',
    capabilities: [
      'trend_analysis',
      'pattern_recognition',
      'forecasting',
      'seasonal_analysis',
      'performance_tracking'
    ],
    configuration: {
      model: 'trend_analysis_v1',
      parameters: {
        forecastPeriod: 12,
        seasonalAnalysis: true,
        enablePredictions: true
      },
      thresholds: {
        trendSignificance: 0.05,
        forecastConfidence: 0.7
      }
    }
  },
  {
    name: 'Compliance Monitor Agent',
    type: 'compliance_monitor',
    description: 'Monitors environmental compliance and regulatory requirements',
    capabilities: [
      'compliance_checking',
      'regulatory_monitoring',
      'audit_preparation',
      'gap_analysis',
      'reporting'
    ],
    configuration: {
      model: 'compliance_v1',
      parameters: {
        regulations: ['ISO 14001', 'ISO 14064', 'ISO 14067', 'EPA', 'Local Environmental'],
        checkFrequency: 'weekly',
        autoReporting: true
      },
      thresholds: {
        complianceThreshold: 0.9,
        riskThreshold: 0.7
      }
    }
  },
  {
    name: 'Optimization Advisor Agent',
    type: 'optimization_advisor',
    description: 'Provides optimization suggestions for processes and resource utilization',
    capabilities: [
      'process_optimization',
      'resource_efficiency',
      'cost_reduction',
      'energy_optimization',
      'waste_reduction'
    ],
    configuration: {
      model: 'optimization_v1',
      parameters: {
        optimizationAreas: ['energy', 'waste', 'transportation', 'materials'],
        includeROI: true,
        implementationGuidance: true
      },
      thresholds: {
        minSavings: 0.1,
        maxPaybackPeriod: 36
      }
    }
  },
  {
    name: 'Report Generator Agent',
    type: 'report_generator',
    description: 'Generates comprehensive reports and visualizations for carbon intelligence',
    capabilities: [
      'report_generation',
      'data_visualization',
      'chart_creation',
      'summary_analysis',
      'export_formats'
    ],
    configuration: {
      model: 'report_generation_v1',
      parameters: {
        formats: ['PDF', 'Excel', 'JSON'],
        includeCharts: true,
        autoScheduling: true
      },
      thresholds: {
        dataCompleteness: 0.8,
        reportQuality: 0.9
      }
    }
  },
  {
    name: 'ISO Evidence Collector Agent',
    type: 'iso_evidence_collector',
    description: 'Collects and structures ISO evidence for boundary, factors, uncertainty, and product CFP records',
    capabilities: [
      'iso_evidence_collection',
      'boundary_evidence_mapping',
      'factor_registry_traceability',
      'uncertainty_evidence_tracking',
      'cfp_evidence_mapping'
    ],
    configuration: {
      model: 'iso_evidence_v1',
      parameters: {
        includeFactorRegistry: true,
        includeGapChecklist: true,
        includeEvidenceCounts: true
      },
      thresholds: {
        minimumEvidenceCoverage: 0.7
      }
    }
  },
  {
    name: 'ISO Gap Closure Planner Agent',
    type: 'iso_gap_closure_planner',
    description: 'Builds prioritized gap-closure actions for ISO certification readiness',
    capabilities: [
      'iso_gap_prioritization',
      'action_plan_generation',
      'owner_assignment',
      'deadline_scheduling',
      'readiness_improvement_planning'
    ],
    configuration: {
      model: 'iso_gap_planner_v1',
      parameters: {
        includePriorityActions: true,
        autoAssignOwners: true,
        defaultTimelineDays: [14, 30, 45]
      },
      thresholds: {
        highPriorityGapLimit: 3
      }
    }
  },
  {
    name: 'ISO Audit Packager Agent',
    type: 'iso_audit_packager',
    description: 'Packages ISO evidence and action plans into audit-ready certification bundles',
    capabilities: [
      'audit_packaging',
      'certification_readiness_summary',
      'evidence_bundle_compilation',
      'closure_tracking',
      'verification_preparation'
    ],
    configuration: {
      model: 'iso_audit_packager_v1',
      parameters: {
        includeSectionChecklist: true,
        includeReadinessScore: true,
        includeOpenActions: true
      },
      thresholds: {
        readyForVerificationScore: 85
      }
    }
  },
  {
    name: 'Inventory Quality Advisor Agent',
    type: 'inventory_quality_advisor',
    description: 'Separates GHG inventory rigor from data completeness for assurance-ready footprints',
    capabilities: [
      'inventory_quality_scoring',
      'activity_share_analysis',
      'uncertainty_readiness',
      'boundary_factor_assessment'
    ],
    configuration: {
      model: 'inventory_quality_v1',
      parameters: { includeIsoChecklist: true },
      thresholds: { highQualityScore: 75, mediumQualityScore: 45 }
    }
  },
  {
    name: 'Buyer Request Advisor Agent',
    type: 'buyer_request_advisor',
    description: 'Prioritizes buyer audits, supplier questionnaires, and evidence pack readiness',
    capabilities: [
      'buyer_inbox_triage',
      'evidence_pack_checklist',
      'audit_export_guidance',
      'questionnaire_deadline_tracking'
    ],
    configuration: {
      model: 'buyer_request_v1',
      parameters: { frameworks: ['brsr_core', 'cdp', 'csrd', 'ecovadis', 'custom'] },
      thresholds: { urgentDays: 7 }
    }
  },
  {
    name: 'MSME Goal Advisor Agent',
    type: 'msme_goal_advisor',
    description: 'Goal-driven dashboard prioritization from signup intent (BRSR, finance, PAT, etc.)',
    capabilities: [
      'signup_goal_routing',
      'prioritized_action_plan',
      'dashboard_card_ordering'
    ],
    configuration: {
      model: 'msme_goal_v1',
      parameters: {
        supportedGoals: [
          'buyer_audit',
          'brsr_compliance',
          'baseline_footprint',
          'green_finance',
          'pat_icm',
          'cost_reduction'
        ]
      },
      thresholds: {}
    }
  },
  {
    name: 'DPDP Privacy Advisor Agent',
    type: 'dpdp_privacy_advisor',
    description: 'India DPDP-aligned consent, retention, and data principal rights guidance',
    capabilities: [
      'consent_matrix',
      'retention_guidance',
      'privacy_gap_detection',
      'sms_consent_alignment'
    ],
    configuration: {
      model: 'dpdp_privacy_v1',
      parameters: { framework: 'DPDP_2023' },
      thresholds: { minimumReadiness: 70 }
    }
  },
  {
    name: 'Environmental KPI Advisor Agent',
    type: 'environmental_kpi_advisor',
    description: 'Water, waste, and BRSR Principle 6 environmental KPI guidance for MSMEs',
    capabilities: [
      'water_kpi_guidance',
      'waste_kpi_guidance',
      'brsr_principle6_mapping'
    ],
    configuration: {
      model: 'environmental_kpi_v1',
      parameters: { brsrPrinciple: 6 },
      thresholds: { partialReadiness: 40 }
    }
  }
];

const sectorProfiles = [
  { key: 'manufacturing', label: 'Manufacturing', focusAreas: ['energy', 'materials', 'waste'] },
  { key: 'trading', label: 'Trading', focusAreas: ['transportation', 'materials'] },
  { key: 'services', label: 'Services', focusAreas: ['energy', 'other'] },
  { key: 'export_import', label: 'Export/Import', focusAreas: ['transportation', 'energy'] },
  { key: 'retail', label: 'Retail', focusAreas: ['transportation', 'materials'] },
  { key: 'wholesale', label: 'Wholesale', focusAreas: ['transportation', 'materials'] },
  { key: 'e_commerce', label: 'E-Commerce', focusAreas: ['transportation', 'energy'] },
  { key: 'consulting', label: 'Consulting', focusAreas: ['transportation', 'other'] },
  { key: 'logistics', label: 'Logistics', focusAreas: ['transportation', 'energy'] },
  { key: 'agriculture', label: 'Agriculture', focusAreas: ['water', 'energy'] },
  { key: 'handicrafts', label: 'Handicrafts', focusAreas: ['materials', 'energy'] },
  { key: 'food_processing', label: 'Food Processing', focusAreas: ['energy', 'water'] },
  { key: 'textiles', label: 'Textiles', focusAreas: ['energy', 'water'] },
  { key: 'electronics', label: 'Electronics', focusAreas: ['energy', 'materials'] },
  { key: 'automotive', label: 'Automotive', focusAreas: ['energy', 'materials'] },
  { key: 'construction', label: 'Construction', focusAreas: ['materials', 'waste'] },
  { key: 'healthcare', label: 'Healthcare', focusAreas: ['energy', 'waste'] },
  { key: 'education', label: 'Education', focusAreas: ['energy', 'other'] },
  { key: 'tourism', label: 'Tourism', focusAreas: ['transportation', 'energy'] },
  { key: 'other', label: 'Other', focusAreas: ['energy', 'transportation'] }
];

const sectorProfilerAgent = {
  name: 'Unified Sector Profiler Agent',
  type: 'sector_profiler',
  description: 'Profiles MSME operations and emission drivers across all MSME sectors',
  capabilities: [
    'sector_profile',
    'behavior_weighting',
    'orchestration_planning',
    'msme_context_enrichment'
  ],
  configuration: {
    model: 'sector_profiler_v2',
    parameters: {
      supportedSectors: sectorProfiles.map(profile => profile.key),
      focusAreas: sectorProfiles.reduce((acc, profile) => {
        acc[profile.key] = profile.focusAreas;
        return acc;
      }, {}),
      outputFormat: 'behavioral_profile'
    },
    thresholds: {
      minimumTransactions: 5,
      confidenceThreshold: 0.6
    }
  }
};

const processMachineryProfilerAgent = {
  name: 'Unified Process & Machinery Profiler Agent',
  type: 'process_machinery_profiler',
  description: 'Profiles processes, machinery, and emissions drivers for all MSME sectors',
  capabilities: [
    'process_mapping',
    'machinery_inventory',
    'emission_factor_mapping',
    'product_signal_analysis'
  ],
  configuration: {
    model: 'process_machinery_profiler_v2',
    parameters: {
      supportedSectors: sectorProfiles.map(profile => profile.key),
      focusAreas: sectorProfiles.reduce((acc, profile) => {
        acc[profile.key] = profile.focusAreas;
        return acc;
      }, {}),
      outputFormat: 'process_machinery_profile'
    },
    thresholds: {
      minimumTransactions: 5,
      confidenceThreshold: 0.6
    }
  }
};

defaultAgents.push(
  sectorProfilerAgent,
  processMachineryProfilerAgent,
  {
    name: 'GHG Organizational Boundary Agent',
    type: 'organizational_boundary_agent',
    description: 'Defines which legal entities and operations sit inside the GHG inventory organizational boundary',
    capabilities: [
      'consolidation_approach_selection',
      'related_party_mapping',
      'ghg_protocol_corporate_standard_alignment'
    ],
    configuration: {
      model: 'ghg_org_boundary_v1',
      parameters: { defaultApproach: 'operational_control' },
      thresholds: { minimumConfidence: 0.65 }
    }
  },
  {
    name: 'GHG Operational Boundary Agent',
    type: 'operational_boundary_agent',
    description: 'Selects Scope 1/2 source classes and Scope 3 categories aligned to activity data',
    capabilities: [
      'scope1_scope2_coverage',
      'scope3_category_screening',
      'materiality_threshold_guidance'
    ],
    configuration: {
      model: 'ghg_op_boundary_v1',
      parameters: { defaultMaterialityPercent: 5 },
      thresholds: { minimumConfidence: 0.65 }
    }
  },
  {
    name: 'GHG Boundary Orchestrator',
    type: 'ghg_boundary_orchestrator',
    description: 'Coordinates organizational and operational boundary agents for a single signed boundary narrative',
    capabilities: ['parallel_agent_execution', 'boundary_merge', 'inventory_design_guidance'],
    configuration: {
      model: 'ghg_boundary_orchestrator_v1',
      parameters: { mergeStrategy: 'prefer_operational_control' },
      thresholds: {}
    }
  }
);

async function initializeAIAgents() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/carbon-intelligence');
    logger.info('Connected to MongoDB');

    // Clear existing agents (for development)
    if (process.env.NODE_ENV === 'development') {
      await AIAgent.deleteMany({});
      logger.info('Cleared existing AI agents');
    }

    // Create default agents
    const createdAgents = [];
    for (const agentData of defaultAgents) {
      try {
        // Check if agent already exists
        let agent = await AIAgent.findOne({ name: agentData.name });
        
        if (!agent) {
          agent = new AIAgent({
            ...agentData,
            status: 'active',
            isActive: true,
            performance: {
              tasksCompleted: 0,
              successRate: 100,
              averageResponseTime: 0,
              lastActivity: new Date(),
              errorCount: 0
            }
          });
          
          await agent.save();
          createdAgents.push(agent);
          logger.info(`Created AI Agent: ${agent.name}`);
        } else {
          logger.info(`AI Agent already exists: ${agent.name}`);
        }
      } catch (error) {
        logger.error(`Failed to create agent ${agentData.name}:`, error);
      }
    }

    logger.info(`AI Agents initialization completed. Created: ${createdAgents.length} agents`);
    
    // Close database connection
    await mongoose.connection.close();
    logger.info('Database connection closed');

  } catch (error) {
    logger.error('Failed to initialize AI agents:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  initializeAIAgents();
}

module.exports = { initializeAIAgents, defaultAgents };