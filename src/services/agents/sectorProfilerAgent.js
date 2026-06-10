const carbonCalculationService = require('../carbonCalculationService');
const { getSectorModel } = require('../sectorModelRegistry');
const verifiedKnowledgeRagService = require('../verifiedKnowledgeRagService');
const logger = require('../../utils/logger');

const SECTOR_PROFILES = {
  manufacturing: {
    label: 'Manufacturing',
    focusAreas: ['energy', 'materials', 'waste', 'manufacturing'],
    behaviorWeights: {
      energy: 1.4,
      materials: 1.5,
      waste: 1.3,
      manufacturing: 1.4
    },
    orchestration: {
      parallelAgents: ['anomaly_detector', 'trend_analyzer', 'compliance_monitor', 'optimization_advisor']
    }
  },
  trading: {
    label: 'Trading',
    focusAreas: ['transportation', 'materials'],
    behaviorWeights: {
      transportation: 1.3,
      materials: 1.1
    },
    orchestration: {
      parallelAgents: ['trend_analyzer', 'optimization_advisor']
    }
  },
  services: {
    label: 'Services',
    focusAreas: ['energy', 'transportation', 'other'],
    behaviorWeights: {
      energy: 0.9,
      transportation: 1.0,
      other: 1.1
    },
    orchestration: {
      parallelAgents: ['trend_analyzer']
    }
  },
  export_import: {
    label: 'Export/Import',
    focusAreas: ['transportation', 'materials', 'energy'],
    behaviorWeights: {
      transportation: 1.6,
      energy: 1.1,
      materials: 1.2
    },
    orchestration: {
      parallelAgents: ['anomaly_detector', 'trend_analyzer', 'compliance_monitor']
    }
  },
  retail: {
    label: 'Retail',
    focusAreas: ['transportation', 'materials', 'energy'],
    behaviorWeights: {
      transportation: 1.2,
      materials: 1.2,
      energy: 0.9
    },
    orchestration: {
      parallelAgents: ['trend_analyzer', 'optimization_advisor']
    }
  },
  wholesale: {
    label: 'Wholesale',
    focusAreas: ['transportation', 'materials'],
    behaviorWeights: {
      transportation: 1.4,
      materials: 1.0
    },
    orchestration: {
      parallelAgents: ['trend_analyzer', 'optimization_advisor']
    }
  },
  e_commerce: {
    label: 'E-Commerce',
    focusAreas: ['transportation', 'energy', 'materials'],
    behaviorWeights: {
      transportation: 1.5,
      energy: 1.1,
      materials: 1.3
    },
    orchestration: {
      parallelAgents: ['anomaly_detector', 'trend_analyzer', 'optimization_advisor']
    }
  },
  consulting: {
    label: 'Consulting',
    focusAreas: ['transportation', 'energy', 'other'],
    behaviorWeights: {
      transportation: 0.9,
      energy: 0.8,
      other: 1.2
    },
    orchestration: {
      parallelAgents: ['trend_analyzer']
    }
  },
  logistics: {
    label: 'Logistics',
    focusAreas: ['transportation', 'energy', 'maintenance'],
    behaviorWeights: {
      transportation: 1.8,
      energy: 1.2,
      manufacturing: 1.1
    },
    orchestration: {
      parallelAgents: ['anomaly_detector', 'trend_analyzer', 'compliance_monitor', 'optimization_advisor']
    }
  },
  agriculture: {
    label: 'Agriculture',
    focusAreas: ['energy', 'water', 'transportation'],
    behaviorWeights: {
      energy: 0.9,
      water: 1.2,
      transportation: 1.1
    },
    orchestration: {
      parallelAgents: ['trend_analyzer', 'optimization_advisor']
    }
  },
  handicrafts: {
    label: 'Handicrafts',
    focusAreas: ['materials', 'energy', 'other'],
    behaviorWeights: {
      materials: 1.2,
      energy: 0.8,
      other: 1.1
    },
    orchestration: {
      parallelAgents: ['trend_analyzer']
    }
  },
  food_processing: {
    label: 'Food Processing',
    focusAreas: ['energy', 'water', 'waste'],
    behaviorWeights: {
      energy: 1.3,
      water: 1.2,
      waste: 1.2
    },
    orchestration: {
      parallelAgents: ['anomaly_detector', 'trend_analyzer', 'compliance_monitor', 'optimization_advisor']
    }
  },
  textiles: {
    label: 'Textiles',
    focusAreas: ['energy', 'water', 'materials'],
    behaviorWeights: {
      energy: 1.4,
      water: 1.3,
      materials: 1.3
    },
    orchestration: {
      parallelAgents: ['anomaly_detector', 'trend_analyzer', 'compliance_monitor', 'optimization_advisor']
    }
  },
  electronics: {
    label: 'Electronics',
    focusAreas: ['energy', 'materials'],
    behaviorWeights: {
      energy: 1.2,
      materials: 1.2
    },
    orchestration: {
      parallelAgents: ['trend_analyzer', 'optimization_advisor']
    }
  },
  automotive: {
    label: 'Automotive',
    focusAreas: ['energy', 'materials', 'manufacturing'],
    behaviorWeights: {
      energy: 1.5,
      materials: 1.6,
      manufacturing: 1.4
    },
    orchestration: {
      parallelAgents: ['anomaly_detector', 'trend_analyzer', 'compliance_monitor', 'optimization_advisor']
    }
  },
  construction: {
    label: 'Construction',
    focusAreas: ['materials', 'transportation', 'waste'],
    behaviorWeights: {
      materials: 1.8,
      transportation: 1.3,
      waste: 1.4
    },
    orchestration: {
      parallelAgents: ['anomaly_detector', 'trend_analyzer', 'compliance_monitor', 'optimization_advisor']
    }
  },
  healthcare: {
    label: 'Healthcare',
    focusAreas: ['energy', 'waste', 'other'],
    behaviorWeights: {
      energy: 1.1,
      waste: 1.2,
      other: 1.1
    },
    orchestration: {
      parallelAgents: ['trend_analyzer', 'compliance_monitor']
    }
  },
  education: {
    label: 'Education',
    focusAreas: ['energy', 'other'],
    behaviorWeights: {
      energy: 0.9,
      other: 1.1
    },
    orchestration: {
      parallelAgents: ['trend_analyzer']
    }
  },
  tourism: {
    label: 'Tourism',
    focusAreas: ['transportation', 'energy'],
    behaviorWeights: {
      transportation: 1.2,
      energy: 1.0
    },
    orchestration: {
      parallelAgents: ['trend_analyzer', 'optimization_advisor']
    }
  },
  other: {
    label: 'Other',
    focusAreas: ['energy', 'transportation', 'materials', 'waste'],
    behaviorWeights: {},
    orchestration: {
      parallelAgents: ['trend_analyzer']
    }
  }
};

const CATEGORY_TO_BEHAVIOR = {
  energy: 'energy',
  electricity: 'energy',
  fuel: 'energy',
  diesel: 'energy',
  petrol: 'energy',
  gas: 'energy',
  lpg: 'energy',
  natural_gas: 'energy',
  coal: 'energy',
  biomass: 'energy',
  water: 'water',
  water_supply: 'water',
  water_treatment: 'water',
  wastewater: 'water',
  waste_management: 'waste',
  waste: 'waste',
  hazardous_waste: 'waste',
  recycling: 'waste',
  scrap: 'waste',
  transportation: 'transportation',
  raw_materials: 'materials',
  materials: 'materials',
  chemicals: 'materials',
  packaging: 'materials',
  consumables: 'materials',
  equipment: 'manufacturing',
  machinery: 'manufacturing',
  process: 'manufacturing',
  maintenance: 'manufacturing',
  utilities: 'other',
  services: 'other',
  air_pollution: 'other',
  air_emissions: 'other',
  other: 'other'
};

class SectorProfilerAgent {
  async analyzeProfile(input) {
    try {
      const msmeData = input?.msmeData || {};
      const transactions = Array.isArray(input?.transactions) ? input.transactions : [];
      const context = input?.context || {};

      const sectorKey = this.normalizeSector(msmeData.businessDomain);
      const sectorProfile = SECTOR_PROFILES[sectorKey] || SECTOR_PROFILES.other;
      const sectorModel = getSectorModel(sectorKey);
      const summary = await this.summarizeTransactions(transactions, { msmeData, context });
      const transactionTypeSummary = this.summarizeTransactionTypes(transactions);
      const sectorClassification = this.runSectorClassifier(sectorKey, sectorProfile, msmeData);
      const behaviorWeighting = this.runBehaviorWeighting(sectorProfile, summary, context);
      const orchestrationPlanning = this.runOrchestrationPlanner(sectorProfile, summary, msmeData);
      const ragClassification = this.resolveUnknownCategorySignals(transactions, msmeData);
      const behaviorWeights = behaviorWeighting.behaviorWeights;
      const orchestrationPlan = orchestrationPlanning.orchestrationPlan;

      return {
        sector: sectorKey,
        label: sectorProfile.label,
        focusAreas: sectorProfile.focusAreas,
        sectorModel,
        transactionContext: {
          transactionTypes: sectorModel.transactionTypes,
          transactionTypeSummary
        },
        behaviorWeights,
        orchestrationPlan,
        ragClassification,
        subAgents: {
          sectorClassifier: sectorClassification,
          behaviorWeighting,
          orchestrationPlanner: orchestrationPlanning
        },
        profile: {
          company: this.buildCompanySnapshot(msmeData),
          operations: this.buildOperationsSnapshot(msmeData),
          transactionSummary: summary,
          transactionTypeSummary,
          activitySignals: this.buildActivitySignals(summary)
        },
        confidence: this.calculateConfidence(summary, msmeData)
      };
    } catch (error) {
      logger.error('Sector profiling failed:', error);
      throw error;
    }
  }

  normalizeSector(businessDomain) {
    return (businessDomain || 'other').toLowerCase();
  }

  async summarizeTransactions(transactions, runtimeContext = {}) {
    const summary = {
      totalTransactions: transactions.length,
      totalAmount: 0,
      categoryTotals: {},
      categoryCounts: {},
      emissionTotals: {},
      emissionIntensity: {}
    };

    for (const transaction of transactions) {
      const category = (transaction.category || 'other').toLowerCase();
      const amount = Number(transaction.amount) || 0;
      summary.totalAmount += amount;
      summary.categoryTotals[category] = (summary.categoryTotals[category] || 0) + amount;
      summary.categoryCounts[category] = (summary.categoryCounts[category] || 0) + 1;

      const carbonData = await carbonCalculationService.calculateTransactionCarbonFootprintForAgent(
        transaction,
        runtimeContext
      );
      summary.emissionTotals[category] = (summary.emissionTotals[category] || 0) + carbonData.co2Emissions;
    }

    Object.keys(summary.categoryTotals).forEach(category => {
      const amount = summary.categoryTotals[category];
      const emissions = summary.emissionTotals[category] || 0;
      summary.emissionIntensity[category] = amount > 0 ? emissions / amount : 0;
    });

    return summary;
  }

  summarizeTransactionTypes(transactions) {
    const summary = {
      transactionTypeCounts: {},
      subcategoryCounts: {},
      categoryByTransactionType: {}
    };

    transactions.forEach(transaction => {
      const transactionType = (transaction.transactionType || 'other').toLowerCase();
      const category = (transaction.category || 'other').toLowerCase();
      const subcategory = (transaction.subcategory || 'general').toLowerCase();

      summary.transactionTypeCounts[transactionType] = (summary.transactionTypeCounts[transactionType] || 0) + 1;
      summary.subcategoryCounts[subcategory] = (summary.subcategoryCounts[subcategory] || 0) + 1;
      if (!summary.categoryByTransactionType[transactionType]) {
        summary.categoryByTransactionType[transactionType] = {};
      }
      summary.categoryByTransactionType[transactionType][category] =
        (summary.categoryByTransactionType[transactionType][category] || 0) + 1;
    });

    return summary;
  }

  runSectorClassifier(sectorKey, sectorProfile, msmeData) {
    const confidence = msmeData.businessDomain ? 0.85 : 0.6;
    return {
      sector: sectorKey,
      label: sectorProfile.label,
      focusAreas: sectorProfile.focusAreas,
      confidence,
      rationale: msmeData.businessDomain
        ? 'Sector inferred from MSME business domain.'
        : 'Sector defaulted to other.'
    };
  }

  runBehaviorWeighting(sectorProfile, summary, context) {
    const behaviorWeights = this.buildBehaviorWeights(sectorProfile, summary, context);
    return {
      behaviorWeights,
      signals: {
        dominantCategories: Object.keys(summary.categoryTotals)
      }
    };
  }

  runOrchestrationPlanner(sectorProfile, summary, msmeData) {
    const orchestrationPlan = this.buildOrchestrationPlan(sectorProfile, summary, msmeData);
    return {
      orchestrationPlan,
      signals: {
        transactionCount: summary.totalTransactions,
        totalAmount: summary.totalAmount
      }
    };
  }

  buildBehaviorWeights(sectorProfile, summary, context) {
    const weights = {
      energy: 1,
      water: 1,
      waste: 1,
      transportation: 1,
      materials: 1,
      manufacturing: 1,
      other: 1,
      ...(sectorProfile.behaviorWeights || {})
    };

    const totalAmount = summary.totalAmount || 0;
    if (totalAmount > 0) {
      Object.entries(summary.categoryTotals).forEach(([category, amount]) => {
        const share = amount / totalAmount;
        if (share > 0.25) {
          const behavior = CATEGORY_TO_BEHAVIOR[category] || 'other';
          weights[behavior] = (weights[behavior] || 1) * 1.1;
        }
      });
    }

    if (context.season === 'summer') {
      weights.energy *= 1.05;
    }

    return weights;
  }

  buildOrchestrationPlan(sectorProfile, summary, msmeData) {
    const baseAgents = new Set(sectorProfile.orchestration?.parallelAgents || []);
    const totalAmount = summary.totalAmount || 0;

    if (summary.totalTransactions > 25) {
      baseAgents.add('anomaly_detector');
    }

    const categoryShare = (category) => {
      if (totalAmount === 0) return 0;
      return (summary.categoryTotals[category] || 0) / totalAmount;
    };

    if (categoryShare('transportation') > 0.2) {
      baseAgents.add('trend_analyzer');
    }

    if (categoryShare('waste_management') > 0.1) {
      baseAgents.add('compliance_monitor');
    }

    if (categoryShare('energy') > 0.2) {
      baseAgents.add('optimization_advisor');
    }

    if (msmeData.environmentalCompliance &&
        (!msmeData.environmentalCompliance.hasPollutionControlBoard ||
         !msmeData.environmentalCompliance.hasEnvironmentalClearance)) {
      baseAgents.add('compliance_monitor');
    }

    return {
      parallelAgents: Array.from(baseAgents),
      outputs: {
        recommendations: true,
        report: true
      },
      rationale: this.buildPlanRationale(summary, sectorProfile)
    };
  }

  buildPlanRationale(summary, sectorProfile) {
    const rationale = [];
    if (summary.totalTransactions > 25) {
      rationale.push('High transaction volume drives anomaly detection.');
    }
    if ((summary.categoryTotals.transportation || 0) > 0) {
      rationale.push('Transportation activity informs trend monitoring.');
    }
    if ((summary.categoryTotals.waste_management || 0) > 0) {
      rationale.push('Waste activity adds compliance focus.');
    }
    rationale.push(`Sector focus aligned to ${sectorProfile.label}.`);
    return rationale;
  }

  buildCompanySnapshot(msmeData) {
    return {
      companyName: msmeData.companyName,
      businessDomain: msmeData.businessDomain,
      industry: msmeData.industry,
      companyType: msmeData.companyType,
      establishmentYear: msmeData.establishmentYear
    };
  }

  buildOperationsSnapshot(msmeData) {
    return {
      annualTurnover: msmeData?.business?.annualTurnover,
      numberOfEmployees: msmeData?.business?.numberOfEmployees,
      manufacturingUnits: msmeData?.business?.manufacturingUnits,
      primaryProducts: msmeData?.business?.primaryProducts
    };
  }

  buildActivitySignals(summary) {
    const totalAmount = summary.totalAmount || 0;
    const signals = {};

    Object.keys(summary.categoryTotals).forEach(category => {
      signals[category] = totalAmount > 0 ? summary.categoryTotals[category] / totalAmount : 0;
    });

    return signals;
  }

  calculateConfidence(summary, msmeData) {
    let score = Math.min(1, summary.totalTransactions / 15);
    if (msmeData?.business?.annualTurnover) {
      score += 0.1;
    }
    if (msmeData?.business?.numberOfEmployees) {
      score += 0.05;
    }
    return Math.min(1, score);
  }

  resolveUnknownCategorySignals(transactions = [], msmeData = {}) {
    const unknownCandidates = (Array.isArray(transactions) ? transactions : [])
      .filter(transaction => {
        const category = String(transaction?.category || '').toLowerCase();
        return !category || category === 'other' || category === 'unknown';
      })
      .map(transaction => ({
        text: [transaction.description, transaction.metadata?.originalText].filter(Boolean).join(' '),
        transactionType: transaction.transactionType || 'other',
        parameterType: 'transaction',
        location: transaction.location?.state || transaction.state || ''
      }))
      .filter(item => item.text);

    const classifications = verifiedKnowledgeRagService.classifyBatch(unknownCandidates, {
      businessDomain: msmeData?.businessDomain || 'other',
      location: msmeData?.contact?.address?.state || ''
    });

    return {
      totalCandidates: unknownCandidates.length,
      resolvedCandidates: classifications.length,
      unresolvedCandidates: Math.max(0, unknownCandidates.length - classifications.length),
      classifications: classifications.map(entry => ({
        candidate: entry.item,
        classification: entry.result
      }))
    };
  }
}

module.exports = new SectorProfilerAgent();
