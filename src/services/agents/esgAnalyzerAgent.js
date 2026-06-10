const carbonCalculationService = require('../carbonCalculationService');
const carbonRating = require('../../../../shared/carbonRating');
const logger = require('../../utils/logger');

class ESGAnalyzerAgent {
  constructor() {
    this.name = 'ESG Analyzer Agent';
    this.type = 'esg_analyzer';
    this.capabilities = [
      'esg_metrics_calculation',
      'sustainability_scoring',
      'environmental_impact_assessment',
      'social_governance_analysis',
      'carbon_footprint_esg_mapping',
      'sustainability_reporting',
      'esg_risk_assessment',
      'stakeholder_impact_analysis'
    ];
  }

  async analyzeESGMetrics(msmeData, transactions, smsData = []) {
    try {
      const esgAnalysis = {
        environmental: await this.analyzeEnvironmentalMetrics(msmeData, transactions, smsData),
        social: await this.analyzeSocialMetrics(msmeData, transactions, smsData),
        governance: await this.analyzeGovernanceMetrics(msmeData, transactions, smsData),
        overall: {},
        recommendations: [],
        riskAssessment: {},
        stakeholderImpact: {}
      };

      // Calculate overall ESG score
      esgAnalysis.overall = this.calculateOverallESGScore(esgAnalysis);

      // Generate recommendations
      esgAnalysis.recommendations = this.generateESGRecommendations(esgAnalysis);

      // Risk assessment
      esgAnalysis.riskAssessment = this.assessESGRisks(esgAnalysis);

      // Stakeholder impact analysis
      esgAnalysis.stakeholderImpact = this.analyzeStakeholderImpact(esgAnalysis, msmeData);

      return esgAnalysis;
    } catch (error) {
      logger.error('ESG analysis failed:', error);
      throw error;
    }
  }

  async analyzeEnvironmentalMetrics(msmeData, transactions, smsData) {
    const environmental = {
      carbonFootprint: {
        totalCO2Emissions: 0,
        scope1Emissions: 0,
        scope2Emissions: 0,
        scope3Emissions: 0,
        carbonIntensity: 0,
        renewableEnergyUsage: 0,
        energyEfficiency: 0
      },
      resourceUsage: {
        waterConsumption: 0,
        wasteGeneration: 0,
        materialEfficiency: 0,
        recyclingRate: 0
      },
      environmentalCompliance: {
        environmentalClearance: msmeData.environmentalCompliance?.hasEnvironmentalClearance || false,
        pollutionControlBoard: msmeData.environmentalCompliance?.hasPollutionControlBoard || false,
        wasteManagement: msmeData.environmentalCompliance?.hasWasteManagement || false,
        complianceScore: 0
      },
      biodiversity: {
        landUseImpact: 0,
        ecosystemServices: 0,
        conservationEfforts: 0
      },
      score: 0
    };

    // Calculate carbon footprint from transactions and SMS data
    const allTransactions = [...transactions, ...this.extractTransactionsFromSMS(smsData)];
    const runtimeContext = { msmeData };
    
    for (const transaction of allTransactions) {
      const carbonData = await carbonCalculationService.calculateTransactionCarbonFootprintForAgent(
        transaction,
        runtimeContext
      );
      environmental.carbonFootprint.totalCO2Emissions += carbonData.co2Emissions;
      
      // Classify by ESG scope
      if (this.isScope1Emission(transaction)) {
        environmental.carbonFootprint.scope1Emissions += carbonData.co2Emissions;
      } else if (this.isScope2Emission(transaction)) {
        environmental.carbonFootprint.scope2Emissions += carbonData.co2Emissions;
      } else {
        environmental.carbonFootprint.scope3Emissions += carbonData.co2Emissions;
      }
    }

    // Calculate carbon intensity (emissions per revenue)
    const totalRevenue = allTransactions
      .filter(t => t.transactionType === 'sale')
      .reduce((sum, t) => sum + t.amount, 0);
    
    if (totalRevenue > 0) {
      environmental.carbonFootprint.carbonIntensity = 
        environmental.carbonFootprint.totalCO2Emissions / totalRevenue;
    }

    // Analyze renewable energy usage from SMS data
    environmental.carbonFootprint.renewableEnergyUsage = this.calculateRenewableEnergyUsage(smsData);
    
    // Calculate energy efficiency score
    environmental.carbonFootprint.energyEfficiency = this.calculateEnergyEfficiency(msmeData, allTransactions);

    // Resource usage analysis
    environmental.resourceUsage = this.analyzeResourceUsage(allTransactions, smsData);

    // Environmental compliance score
    environmental.environmentalCompliance.complianceScore = this.calculateComplianceScore(
      environmental.environmentalCompliance
    );

    // Calculate environmental score
    environmental.score = this.calculateEnvironmentalScore(environmental);

    return environmental;
  }

  async analyzeSocialMetrics(msmeData, transactions, smsData) {
    const social = {
      laborPractices: {
        employeeCount: msmeData.employeeCount || 0,
        wageFairness: 0,
        workingConditions: 0,
        safetyRecord: 0,
        trainingPrograms: 0
      },
      communityImpact: {
        localEmployment: 0,
        communityInvestment: 0,
        localSourcing: 0,
        socialInitiatives: 0
      },
      humanRights: {
        diversityInclusion: 0,
        nonDiscrimination: 0,
        childLaborPrevention: 0,
        forcedLaborPrevention: 0
      },
      productResponsibility: {
        productSafety: 0,
        customerSatisfaction: 0,
        dataPrivacy: 0,
        fairPricing: 0
      },
      score: 0
    };

    // Analyze labor practices from SMS and transaction data
    social.laborPractices = this.analyzeLaborPractices(msmeData, transactions, smsData);

    // Community impact analysis
    social.communityImpact = this.analyzeCommunityImpact(msmeData, transactions, smsData);

    // Human rights assessment
    social.humanRights = this.assessHumanRights(msmeData);

    // Product responsibility
    social.productResponsibility = this.assessProductResponsibility(msmeData, transactions);

    // Calculate social score
    social.score = this.calculateSocialScore(social);

    return social;
  }

  async analyzeGovernanceMetrics(msmeData, transactions, smsData) {
    const governance = {
      businessEthics: {
        antiCorruption: 0,
        transparency: 0,
        ethicalSourcing: 0,
        conflictOfInterest: 0
      },
      riskManagement: {
        financialRisk: 0,
        operationalRisk: 0,
        complianceRisk: 0,
        reputationalRisk: 0
      },
      stakeholderEngagement: {
        shareholderRights: 0,
        stakeholderCommunication: 0,
        grievanceMechanisms: 0,
        feedbackSystems: 0
      },
      dataGovernance: {
        dataSecurity: 0,
        privacyProtection: 0,
        dataAccuracy: 0,
        dataRetention: 0
      },
      score: 0
    };

    // Business ethics assessment
    governance.businessEthics = this.assessBusinessEthics(msmeData, transactions);

    // Risk management analysis
    governance.riskManagement = this.analyzeRiskManagement(msmeData, transactions, smsData);

    // Stakeholder engagement
    governance.stakeholderEngagement = this.assessStakeholderEngagement(msmeData);

    // Data governance
    governance.dataGovernance = this.assessDataGovernance(msmeData, smsData);

    // Calculate governance score
    governance.score = this.calculateGovernanceScore(governance);

    return governance;
  }

  extractTransactionsFromSMS(smsData) {
    const transactions = [];
    
    for (const sms of smsData) {
      if (sms.processedData && sms.processedData.transaction) {
        const smsTransaction = sms.processedData.transaction;
        const category = smsTransaction.category || 'other';
        const transactionType = smsTransaction.transactionType || smsTransaction.type || this.getTransactionTypeFromCategory(category);

        const normalized = {
          source: 'sms',
          dataSource: 'sms',
          sourceId: sms.id || sms.messageId || smsTransaction.id || `sms_${transactions.length + 1}`,
          transactionType,
          amount: Number(smsTransaction.amount) || 0,
          currency: smsTransaction.currency || 'INR',
          description: smsTransaction.description || sms.body || '',
          category,
          subcategory: smsTransaction.subcategory || 'general',
          date: smsTransaction.date ? new Date(smsTransaction.date) : new Date(sms.timestamp || Date.now()),
          vendor: smsTransaction.vendor || {},
          carbonFootprint: smsTransaction.carbonFootprint || {
            co2Emissions: 0,
            emissionFactor: 0,
            calculationMethod: 'sms_inference'
          },
          sustainability: smsTransaction.sustainability || {
            isGreen: false,
            greenScore: 0,
            sustainabilityFactors: []
          },
          metadata: {
            ...(smsTransaction.metadata || {}),
            dataSourceDisclaimer: this.getSMSDataDisclaimer(),
            sentiment: sms.processedData.sentiment,
            carbonRelevance: sms.processedData.carbonRelevance,
            originalText: sms.body || sms.message || ''
          },
          tags: Array.isArray(smsTransaction.tags) ? smsTransaction.tags : []
        };

        transactions.push(normalized);
      }
    }
    
    return transactions;
  }

  getSMSDataDisclaimer() {
    return 'Advanced-only source: mobile application SMS messages are analysed only after the in-app disclaimer is accepted and explicit user consent is captured.';
  }

  getTransactionTypeFromCategory(category) {
    switch (category) {
      case 'raw_materials':
        return 'purchase';
      case 'energy':
      case 'utilities':
      case 'water':
        return 'utility';
      case 'transportation':
        return 'transport';
      case 'equipment':
        return 'investment';
      case 'maintenance':
      case 'waste_management':
        return 'expense';
      default:
        return 'expense';
    }
  }

  // Delegate to the canonical GHG classifier in carbonCalculationService so the
  // agent path and the direct path stay in lockstep (single source of truth).
  isScope1Emission(transaction) {
    return carbonCalculationService.isScope1Emission(transaction);
  }

  isScope2Emission(transaction) {
    return carbonCalculationService.isScope2Emission(transaction);
  }

  calculateRenewableEnergyUsage(smsData) {
    let renewableEnergyTransactions = 0;
    let totalEnergyTransactions = 0;
    
    for (const sms of smsData) {
      if (sms.processedData && sms.processedData.transaction) {
        const transaction = sms.processedData.transaction;
        if (transaction.category === 'energy') {
          totalEnergyTransactions++;
          if (transaction.subcategory === 'renewable' || 
              transaction.description.toLowerCase().includes('solar') ||
              transaction.description.toLowerCase().includes('wind') ||
              transaction.description.toLowerCase().includes('renewable')) {
            renewableEnergyTransactions++;
          }
        }
      }
    }
    
    return totalEnergyTransactions > 0 ? 
      (renewableEnergyTransactions / totalEnergyTransactions) * 100 : 0;
  }

  calculateEnergyEfficiency(msmeData, transactions) {
    // Calculate energy efficiency based on energy consumption vs output
    const energyTransactions = transactions.filter(t => t.category === 'energy');
    const totalEnergyCost = energyTransactions.reduce((sum, t) => sum + t.amount, 0);
    
    // Get production data from MSME
    const productionValue = msmeData.annualRevenue || 1000000; // Default fallback
    
    // Energy efficiency = production value / energy cost
    return totalEnergyCost > 0 ? (productionValue / totalEnergyCost) : 0;
  }

  analyzeResourceUsage(transactions, smsData) {
    const resourceUsage = {
      waterConsumption: 0,
      wasteGeneration: 0,
      materialEfficiency: 0,
      recyclingRate: 0
    };

    // Analyze water consumption from SMS data
    for (const sms of smsData) {
      if (sms.processedData && sms.processedData.transaction) {
        const transaction = sms.processedData.transaction;
        if (transaction.category === 'water' || 
            transaction.description.toLowerCase().includes('water')) {
          resourceUsage.waterConsumption += transaction.amount;
        }
      }
    }

    // Analyze waste management
    const wasteTransactions = transactions.filter(t => 
      t.category === 'waste_management' || 
      t.description.toLowerCase().includes('waste')
    );
    
    resourceUsage.wasteGeneration = wasteTransactions.reduce((sum, t) => sum + t.amount, 0);

    // Calculate material efficiency
    const materialTransactions = transactions.filter(t => t.category === 'raw_materials');
    const totalMaterialCost = materialTransactions.reduce((sum, t) => sum + t.amount, 0);
    const productionValue = transactions
      .filter(t => t.transactionType === 'sale')
      .reduce((sum, t) => sum + t.amount, 0);
    
    resourceUsage.materialEfficiency = totalMaterialCost > 0 ? 
      (productionValue / totalMaterialCost) : 0;

    // Calculate recycling rate (placeholder)
    resourceUsage.recyclingRate = this.calculateRecyclingRate(transactions, smsData);

    return resourceUsage;
  }

  calculateRecyclingRate(transactions, smsData) {
    let recyclingTransactions = 0;
    let totalWasteTransactions = 0;
    
    // Count recycling-related transactions
    for (const transaction of transactions) {
      if (transaction.category === 'waste_management' || 
          transaction.description.toLowerCase().includes('waste')) {
        totalWasteTransactions++;
        if (transaction.description.toLowerCase().includes('recycl') ||
            transaction.description.toLowerCase().includes('reuse')) {
          recyclingTransactions++;
        }
      }
    }
    
    return totalWasteTransactions > 0 ? 
      (recyclingTransactions / totalWasteTransactions) * 100 : 0;
  }

  calculateComplianceScore(compliance) {
    let score = 0;
    if (compliance.environmentalClearance) score += 25;
    if (compliance.pollutionControlBoard) score += 25;
    if (compliance.wasteManagement) score += 25;
    
    // Additional compliance factors
    score += 25; // Base compliance assumption
    
    return Math.min(100, score);
  }

  calculateEnvironmentalScore(environmental) {
    const weights = {
      carbonFootprint: 0.4,
      resourceUsage: 0.3,
      environmentalCompliance: 0.2,
      biodiversity: 0.1
    };

    let score = 0;
    
    // Carbon footprint score (inverse relationship with emissions)
    const carbonScore = Math.max(0, 100 - (environmental.carbonFootprint.totalCO2Emissions / 10));
    score += carbonScore * weights.carbonFootprint;
    
    // Resource usage score
    const resourceScore = this.calculateResourceUsageScore(environmental.resourceUsage);
    score += resourceScore * weights.resourceUsage;
    
    // Compliance score
    score += environmental.environmentalCompliance.complianceScore * weights.environmentalCompliance;
    
    // Biodiversity score (placeholder)
    score += 70 * weights.biodiversity; // Default score
    
    return Math.round(score);
  }

  calculateResourceUsageScore(resourceUsage) {
    let score = 0;
    
    // Water efficiency (lower consumption is better)
    if (resourceUsage.waterConsumption > 0) {
      score += Math.max(0, 100 - (resourceUsage.waterConsumption / 1000));
    } else {
      score += 50; // Neutral score if no data
    }
    
    // Material efficiency (higher is better)
    score += Math.min(100, resourceUsage.materialEfficiency / 10);
    
    // Recycling rate
    score += resourceUsage.recyclingRate;
    
    return Math.min(100, score / 3);
  }

  analyzeLaborPractices(msmeData, transactions, smsData) {
    return {
      employeeCount: msmeData.employeeCount || 0,
      wageFairness: this.assessWageFairness(msmeData, transactions),
      workingConditions: this.assessWorkingConditions(msmeData),
      safetyRecord: this.assessSafetyRecord(msmeData, transactions),
      trainingPrograms: this.assessTrainingPrograms(msmeData)
    };
  }

  assessWageFairness(msmeData, transactions) {
    // Analyze wage-related transactions and compare with industry standards
    const wageTransactions = transactions.filter(t => 
      t.description.toLowerCase().includes('salary') ||
      t.description.toLowerCase().includes('wage') ||
      t.description.toLowerCase().includes('payroll')
    );
    
    // Placeholder calculation - would need industry benchmarks
    return 75; // Default score
  }

  assessWorkingConditions(msmeData) {
    // Assess based on MSME data and compliance records
    let score = 50; // Base score
    
    if (msmeData.environmentalCompliance?.hasPollutionControlBoard) score += 10;
    if (msmeData.environmentalCompliance?.hasWasteManagement) score += 10;
    
    return Math.min(100, score);
  }

  assessSafetyRecord(msmeData, transactions) {
    // Analyze safety-related transactions and incidents
    const safetyTransactions = transactions.filter(t => 
      t.description.toLowerCase().includes('safety') ||
      t.description.toLowerCase().includes('ppe') ||
      t.description.toLowerCase().includes('training')
    );
    
    return Math.min(100, 60 + (safetyTransactions.length * 5));
  }

  assessTrainingPrograms(msmeData) {
    // Assess training programs based on MSME data
    return msmeData.trainingPrograms ? 80 : 40;
  }

  analyzeCommunityImpact(msmeData, transactions, smsData) {
    return {
      localEmployment: this.calculateLocalEmployment(msmeData),
      communityInvestment: this.calculateCommunityInvestment(transactions),
      localSourcing: this.calculateLocalSourcing(transactions, smsData),
      socialInitiatives: this.assessSocialInitiatives(msmeData)
    };
  }

  calculateLocalEmployment(msmeData) {
    // Calculate percentage of local employees
    const totalEmployees = msmeData.employeeCount || 0;
    const localEmployees = msmeData.localEmployeeCount || Math.floor(totalEmployees * 0.8);
    
    return totalEmployees > 0 ? (localEmployees / totalEmployees) * 100 : 0;
  }

  calculateCommunityInvestment(transactions) {
    const communityTransactions = transactions.filter(t => 
      t.description.toLowerCase().includes('donation') ||
      t.description.toLowerCase().includes('charity') ||
      t.description.toLowerCase().includes('community') ||
      t.description.toLowerCase().includes('csr')
    );
    
    return communityTransactions.reduce((sum, t) => sum + t.amount, 0);
  }

  calculateLocalSourcing(transactions, smsData) {
    let localSourcingTransactions = 0;
    let totalSourcingTransactions = 0;
    
    const sourcingTransactions = transactions.filter(t => 
      t.transactionType === 'purchase' && 
      (t.category === 'raw_materials' || t.category === 'supplies')
    );
    
    for (const transaction of sourcingTransactions) {
      totalSourcingTransactions++;
      if (transaction.vendor?.location === 'local' ||
          transaction.description.toLowerCase().includes('local') ||
          transaction.description.toLowerCase().includes('nearby')) {
        localSourcingTransactions++;
      }
    }
    
    return totalSourcingTransactions > 0 ? 
      (localSourcingTransactions / totalSourcingTransactions) * 100 : 0;
  }

  assessSocialInitiatives(msmeData) {
    // Assess social initiatives based on MSME data
    let score = 0;
    
    if (msmeData.socialInitiatives?.hasEducationPrograms) score += 25;
    if (msmeData.socialInitiatives?.hasHealthPrograms) score += 25;
    if (msmeData.socialInitiatives?.hasWomenEmpowerment) score += 25;
    if (msmeData.socialInitiatives?.hasSkillDevelopment) score += 25;
    
    return score;
  }

  assessHumanRights(msmeData) {
    return {
      diversityInclusion: this.assessDiversityInclusion(msmeData),
      nonDiscrimination: this.assessNonDiscrimination(msmeData),
      childLaborPrevention: this.assessChildLaborPrevention(msmeData),
      forcedLaborPrevention: this.assessForcedLaborPrevention(msmeData)
    };
  }

  assessDiversityInclusion(msmeData) {
    // Assess diversity and inclusion based on employee demographics
    return msmeData.diversityMetrics?.diversityScore || 70;
  }

  assessNonDiscrimination(msmeData) {
    // Assess non-discrimination policies and practices
    return msmeData.humanRights?.nonDiscriminationPolicy ? 90 : 60;
  }

  assessChildLaborPrevention(msmeData) {
    // Assess child labor prevention measures
    return msmeData.humanRights?.childLaborPrevention ? 95 : 70;
  }

  assessForcedLaborPrevention(msmeData) {
    // Assess forced labor prevention measures
    return msmeData.humanRights?.forcedLaborPrevention ? 95 : 70;
  }

  assessProductResponsibility(msmeData, transactions) {
    return {
      productSafety: this.assessProductSafety(msmeData),
      customerSatisfaction: this.assessCustomerSatisfaction(transactions),
      dataPrivacy: this.assessDataPrivacy(msmeData),
      fairPricing: this.assessFairPricing(transactions)
    };
  }

  assessProductSafety(msmeData) {
    // Assess product safety based on MSME data
    return msmeData.productSafety?.safetyCertification ? 90 : 60;
  }

  assessCustomerSatisfaction(transactions) {
    // Analyze customer feedback from transactions
    const feedbackTransactions = transactions.filter(t => 
      t.description.toLowerCase().includes('feedback') ||
      t.description.toLowerCase().includes('complaint') ||
      t.description.toLowerCase().includes('satisfaction')
    );
    
    return Math.min(100, 70 + (feedbackTransactions.length * 2));
  }

  assessDataPrivacy(msmeData) {
    // Assess data privacy measures
    return msmeData.dataPrivacy?.privacyPolicy ? 85 : 50;
  }

  assessFairPricing(transactions) {
    // Analyze pricing patterns for fairness
    const pricingTransactions = transactions.filter(t => t.transactionType === 'sale');
    // Placeholder calculation
    return 75;
  }

  calculateSocialScore(social) {
    const weights = {
      laborPractices: 0.3,
      communityImpact: 0.25,
      humanRights: 0.25,
      productResponsibility: 0.2
    };

    let score = 0;
    
    // Labor practices score
    const laborScore = this.calculateLaborPracticesScore(social.laborPractices);
    score += laborScore * weights.laborPractices;
    
    // Community impact score
    const communityScore = this.calculateCommunityImpactScore(social.communityImpact);
    score += communityScore * weights.communityImpact;
    
    // Human rights score
    const humanRightsScore = this.calculateHumanRightsScore(social.humanRights);
    score += humanRightsScore * weights.humanRights;
    
    // Product responsibility score
    const productScore = this.calculateProductResponsibilityScore(social.productResponsibility);
    score += productScore * weights.productResponsibility;
    
    return Math.round(score);
  }

  calculateLaborPracticesScore(laborPractices) {
    let score = 0;
    score += laborPractices.wageFairness * 0.2;
    score += laborPractices.workingConditions * 0.2;
    score += laborPractices.safetyRecord * 0.3;
    score += laborPractices.trainingPrograms * 0.3;
    
    return Math.min(100, score);
  }

  calculateCommunityImpactScore(communityImpact) {
    let score = 0;
    score += Math.min(100, communityImpact.localEmployment) * 0.3;
    score += Math.min(100, communityImpact.communityInvestment / 1000) * 0.2;
    score += communityImpact.localSourcing * 0.3;
    score += communityImpact.socialInitiatives * 0.2;
    
    return Math.min(100, score);
  }

  calculateHumanRightsScore(humanRights) {
    let score = 0;
    score += humanRights.diversityInclusion * 0.25;
    score += humanRights.nonDiscrimination * 0.25;
    score += humanRights.childLaborPrevention * 0.25;
    score += humanRights.forcedLaborPrevention * 0.25;
    
    return Math.min(100, score);
  }

  calculateProductResponsibilityScore(productResponsibility) {
    let score = 0;
    score += productResponsibility.productSafety * 0.25;
    score += productResponsibility.customerSatisfaction * 0.25;
    score += productResponsibility.dataPrivacy * 0.25;
    score += productResponsibility.fairPricing * 0.25;
    
    return Math.min(100, score);
  }

  assessBusinessEthics(msmeData, transactions) {
    return {
      antiCorruption: this.assessAntiCorruption(msmeData),
      transparency: this.assessTransparency(msmeData, transactions),
      ethicalSourcing: this.assessEthicalSourcing(transactions),
      conflictOfInterest: this.assessConflictOfInterest(msmeData)
    };
  }

  assessAntiCorruption(msmeData) {
    return msmeData.governance?.antiCorruptionPolicy ? 90 : 60;
  }

  assessTransparency(msmeData, transactions) {
    let score = 50; // Base score
    
    if (msmeData.governance?.financialTransparency) score += 20;
    if (msmeData.governance?.stakeholderReporting) score += 20;
    if (transactions.length > 0) score += 10; // Having transaction records
    
    return Math.min(100, score);
  }

  assessEthicalSourcing(transactions) {
    const ethicalSourcingTransactions = transactions.filter(t => 
      t.description.toLowerCase().includes('ethical') ||
      t.description.toLowerCase().includes('sustainable') ||
      t.description.toLowerCase().includes('fair trade')
    );
    
    return Math.min(100, 60 + (ethicalSourcingTransactions.length * 5));
  }

  assessConflictOfInterest(msmeData) {
    return msmeData.governance?.conflictOfInterestPolicy ? 85 : 60;
  }

  analyzeRiskManagement(msmeData, transactions, smsData) {
    return {
      financialRisk: this.assessFinancialRisk(transactions),
      operationalRisk: this.assessOperationalRisk(msmeData, transactions),
      complianceRisk: this.assessComplianceRisk(msmeData),
      reputationalRisk: this.assessReputationalRisk(transactions, smsData)
    };
  }

  assessFinancialRisk(transactions) {
    // Analyze financial stability from transactions
    const revenueTransactions = transactions.filter(t => t.transactionType === 'sale');
    const expenseTransactions = transactions.filter(t => t.transactionType === 'purchase' || t.transactionType === 'expense');
    
    const totalRevenue = revenueTransactions.reduce((sum, t) => sum + t.amount, 0);
    const totalExpenses = expenseTransactions.reduce((sum, t) => sum + t.amount, 0);
    
    if (totalRevenue === 0) return 50; // Neutral if no data
    
    const profitMargin = (totalRevenue - totalExpenses) / totalRevenue;
    return Math.max(0, Math.min(100, 50 + (profitMargin * 100)));
  }

  assessOperationalRisk(msmeData, transactions) {
    let score = 70; // Base score
    
    // Check for operational issues in transactions
    const issueTransactions = transactions.filter(t => 
      t.description.toLowerCase().includes('breakdown') ||
      t.description.toLowerCase().includes('maintenance') ||
      t.description.toLowerCase().includes('repair')
    );
    
    score -= issueTransactions.length * 5;
    
    return Math.max(0, Math.min(100, score));
  }

  assessComplianceRisk(msmeData) {
    let score = 50; // Base score
    
    if (msmeData.environmentalCompliance?.hasEnvironmentalClearance) score += 15;
    if (msmeData.environmentalCompliance?.hasPollutionControlBoard) score += 15;
    if (msmeData.environmentalCompliance?.hasWasteManagement) score += 15;
    if (msmeData.governance?.complianceProgram) score += 5;
    
    return Math.min(100, score);
  }

  assessReputationalRisk(transactions, smsData) {
    let score = 80; // Base score
    
    // Check for negative mentions in SMS data
    for (const sms of smsData) {
      if (sms.processedData && sms.processedData.sentiment) {
        if (sms.processedData.sentiment < 0.3) {
          score -= 10; // Negative sentiment reduces score
        }
      }
    }
    
    return Math.max(0, Math.min(100, score));
  }

  assessStakeholderEngagement(msmeData) {
    return {
      shareholderRights: this.assessShareholderRights(msmeData),
      stakeholderCommunication: this.assessStakeholderCommunication(msmeData),
      grievanceMechanisms: this.assessGrievanceMechanisms(msmeData),
      feedbackSystems: this.assessFeedbackSystems(msmeData)
    };
  }

  assessShareholderRights(msmeData) {
    return msmeData.governance?.shareholderRights ? 85 : 60;
  }

  assessStakeholderCommunication(msmeData) {
    return msmeData.governance?.stakeholderCommunication ? 80 : 60;
  }

  assessGrievanceMechanisms(msmeData) {
    return msmeData.governance?.grievanceMechanisms ? 75 : 50;
  }

  assessFeedbackSystems(msmeData) {
    return msmeData.governance?.feedbackSystems ? 80 : 60;
  }

  assessDataGovernance(msmeData, smsData) {
    return {
      dataSecurity: this.assessDataSecurity(msmeData),
      privacyProtection: this.assessPrivacyProtection(msmeData),
      dataAccuracy: this.assessDataAccuracy(smsData),
      dataRetention: this.assessDataRetention(msmeData)
    };
  }

  assessDataSecurity(msmeData) {
    return msmeData.dataGovernance?.dataSecurity ? 90 : 60;
  }

  assessPrivacyProtection(msmeData) {
    return msmeData.dataGovernance?.privacyProtection ? 85 : 60;
  }

  assessDataAccuracy(smsData) {
    // Assess data accuracy based on SMS processing success rate
    const totalSMS = smsData.length;
    const processedSMS = smsData.filter(sms => sms.processedData && sms.processedData.transaction).length;
    
    return totalSMS > 0 ? (processedSMS / totalSMS) * 100 : 70;
  }

  assessDataRetention(msmeData) {
    return msmeData.dataGovernance?.dataRetention ? 80 : 60;
  }

  calculateGovernanceScore(governance) {
    const weights = {
      businessEthics: 0.3,
      riskManagement: 0.3,
      stakeholderEngagement: 0.2,
      dataGovernance: 0.2
    };

    let score = 0;
    
    // Business ethics score
    const ethicsScore = this.calculateBusinessEthicsScore(governance.businessEthics);
    score += ethicsScore * weights.businessEthics;
    
    // Risk management score
    const riskScore = this.calculateRiskManagementScore(governance.riskManagement);
    score += riskScore * weights.riskManagement;
    
    // Stakeholder engagement score
    const stakeholderScore = this.calculateStakeholderEngagementScore(governance.stakeholderEngagement);
    score += stakeholderScore * weights.stakeholderEngagement;
    
    // Data governance score
    const dataScore = this.calculateDataGovernanceScore(governance.dataGovernance);
    score += dataScore * weights.dataGovernance;
    
    return Math.round(score);
  }

  calculateBusinessEthicsScore(businessEthics) {
    let score = 0;
    score += businessEthics.antiCorruption * 0.25;
    score += businessEthics.transparency * 0.25;
    score += businessEthics.ethicalSourcing * 0.25;
    score += businessEthics.conflictOfInterest * 0.25;
    
    return Math.min(100, score);
  }

  calculateRiskManagementScore(riskManagement) {
    let score = 0;
    score += riskManagement.financialRisk * 0.25;
    score += riskManagement.operationalRisk * 0.25;
    score += riskManagement.complianceRisk * 0.25;
    score += riskManagement.reputationalRisk * 0.25;
    
    return Math.min(100, score);
  }

  calculateStakeholderEngagementScore(stakeholderEngagement) {
    let score = 0;
    score += stakeholderEngagement.shareholderRights * 0.25;
    score += stakeholderEngagement.stakeholderCommunication * 0.25;
    score += stakeholderEngagement.grievanceMechanisms * 0.25;
    score += stakeholderEngagement.feedbackSystems * 0.25;
    
    return Math.min(100, score);
  }

  calculateDataGovernanceScore(dataGovernance) {
    let score = 0;
    score += dataGovernance.dataSecurity * 0.25;
    score += dataGovernance.privacyProtection * 0.25;
    score += dataGovernance.dataAccuracy * 0.25;
    score += dataGovernance.dataRetention * 0.25;
    
    return Math.min(100, score);
  }

  calculateOverallESGScore(esgAnalysis) {
    const weights = {
      environmental: 0.4,
      social: 0.3,
      governance: 0.3
    };

    const overallScore = 
      (esgAnalysis.environmental.score * weights.environmental) +
      (esgAnalysis.social.score * weights.social) +
      (esgAnalysis.governance.score * weights.governance);

    return {
      score: Math.round(overallScore),
      grade: this.getESGGrade(overallScore),
      level: this.getESGLevel(overallScore),
      strengths: this.identifyESGStrengths(esgAnalysis),
      weaknesses: this.identifyESGWeaknesses(esgAnalysis)
    };
  }

  getESGGrade(score) {
    return carbonRating.getRating(score);
  }

  getESGLevel(score) {
    return carbonRating.getScoreLabel(score);
  }

  identifyESGStrengths(esgAnalysis) {
    const strengths = [];
    
    if (esgAnalysis.environmental.score >= 80) {
      strengths.push('Strong environmental performance');
    }
    if (esgAnalysis.social.score >= 80) {
      strengths.push('Excellent social practices');
    }
    if (esgAnalysis.governance.score >= 80) {
      strengths.push('Robust governance framework');
    }
    
    return strengths;
  }

  identifyESGWeaknesses(esgAnalysis) {
    const weaknesses = [];
    
    if (esgAnalysis.environmental.score < 60) {
      weaknesses.push('Environmental performance needs improvement');
    }
    if (esgAnalysis.social.score < 60) {
      weaknesses.push('Social practices require enhancement');
    }
    if (esgAnalysis.governance.score < 60) {
      weaknesses.push('Governance framework needs strengthening');
    }
    
    return weaknesses;
  }

  generateESGRecommendations(esgAnalysis) {
    const recommendations = [];
    
    // Environmental recommendations
    if (esgAnalysis.environmental.score < 70) {
      recommendations.push({
        category: 'Environmental',
        priority: 'High',
        title: 'Improve Environmental Performance',
        description: 'Focus on reducing carbon emissions and improving resource efficiency',
        potentialImpact: 'High',
        implementationCost: 'Medium',
        timeline: '6-12 months'
      });
    }
    
    // Social recommendations
    if (esgAnalysis.social.score < 70) {
      recommendations.push({
        category: 'Social',
        priority: 'Medium',
        title: 'Enhance Social Practices',
        description: 'Improve labor practices and community engagement',
        potentialImpact: 'Medium',
        implementationCost: 'Low',
        timeline: '3-6 months'
      });
    }
    
    // Governance recommendations
    if (esgAnalysis.governance.score < 70) {
      recommendations.push({
        category: 'Governance',
        priority: 'High',
        title: 'Strengthen Governance Framework',
        description: 'Implement better risk management and stakeholder engagement',
        potentialImpact: 'High',
        implementationCost: 'Medium',
        timeline: '6-12 months'
      });
    }
    
    return recommendations;
  }

  assessESGRisks(esgAnalysis) {
    const risks = [];
    
    // Environmental risks
    if (esgAnalysis.environmental.score < 50) {
      risks.push({
        category: 'Environmental',
        type: 'Regulatory Risk',
        severity: 'High',
        description: 'Low environmental performance may lead to regulatory penalties',
        mitigation: 'Implement environmental management system'
      });
    }
    
    // Social risks
    if (esgAnalysis.social.score < 50) {
      risks.push({
        category: 'Social',
        type: 'Reputational Risk',
        severity: 'Medium',
        description: 'Poor social practices may damage company reputation',
        mitigation: 'Develop comprehensive social responsibility program'
      });
    }
    
    // Governance risks
    if (esgAnalysis.governance.score < 50) {
      risks.push({
        category: 'Governance',
        type: 'Operational Risk',
        severity: 'High',
        description: 'Weak governance may lead to operational failures',
        mitigation: 'Strengthen governance framework and risk management'
      });
    }
    
    return {
      risks,
      overallRiskLevel: this.calculateOverallRiskLevel(risks),
      riskScore: this.calculateRiskScore(risks)
    };
  }

  calculateOverallRiskLevel(risks) {
    const highRisks = risks.filter(r => r.severity === 'High').length;
    const mediumRisks = risks.filter(r => r.severity === 'Medium').length;
    
    if (highRisks >= 2) return 'High';
    if (highRisks >= 1 || mediumRisks >= 3) return 'Medium';
    if (mediumRisks >= 1) return 'Low';
    return 'Very Low';
  }

  calculateRiskScore(risks) {
    let score = 0;
    risks.forEach(risk => {
      switch (risk.severity) {
        case 'High': score += 3; break;
        case 'Medium': score += 2; break;
        case 'Low': score += 1; break;
      }
    });
    
    return Math.min(10, score);
  }

  analyzeStakeholderImpact(esgAnalysis, msmeData) {
    return {
      employees: this.analyzeEmployeeImpact(esgAnalysis, msmeData),
      customers: this.analyzeCustomerImpact(esgAnalysis, msmeData),
      community: this.analyzeStakeholderCommunityImpact(esgAnalysis, msmeData),
      investors: this.analyzeInvestorImpact(esgAnalysis, msmeData),
      suppliers: this.analyzeSupplierImpact(esgAnalysis, msmeData)
    };
  }

  analyzeEmployeeImpact(esgAnalysis, msmeData) {
    return {
      jobSecurity: esgAnalysis.governance.score > 70 ? 'High' : 'Medium',
      workingConditions: esgAnalysis.social.score > 70 ? 'Good' : 'Fair',
      careerDevelopment: esgAnalysis.social.score > 60 ? 'Available' : 'Limited',
      satisfaction: esgAnalysis.social.score > 70 ? 'High' : 'Medium'
    };
  }

  analyzeCustomerImpact(esgAnalysis, msmeData) {
    return {
      productQuality: esgAnalysis.social.score > 70 ? 'High' : 'Medium',
      serviceReliability: esgAnalysis.governance.score > 70 ? 'High' : 'Medium',
      dataProtection: esgAnalysis.governance.score > 80 ? 'Strong' : 'Adequate',
      valueForMoney: esgAnalysis.social.score > 60 ? 'Good' : 'Fair'
    };
  }

  analyzeStakeholderCommunityImpact(esgAnalysis, msmeData) {
    return {
      economicContribution: esgAnalysis.social.score > 60 ? 'Positive' : 'Neutral',
      environmentalImpact: esgAnalysis.environmental.score > 70 ? 'Minimal' : 'Moderate',
      socialContribution: esgAnalysis.social.score > 70 ? 'Significant' : 'Limited',
      localEmployment: esgAnalysis.social.score > 60 ? 'High' : 'Medium'
    };
  }

  analyzeInvestorImpact(esgAnalysis, msmeData) {
    return {
      financialReturns: esgAnalysis.governance.score > 70 ? 'Stable' : 'Variable',
      riskLevel: esgAnalysis.governance.score > 70 ? 'Low' : 'Medium',
      transparency: esgAnalysis.governance.score > 80 ? 'High' : 'Medium',
      sustainability: esgAnalysis.overall.score > 70 ? 'Strong' : 'Moderate'
    };
  }

  analyzeSupplierImpact(esgAnalysis, msmeData) {
    return {
      businessStability: esgAnalysis.governance.score > 70 ? 'High' : 'Medium',
      paymentReliability: esgAnalysis.governance.score > 80 ? 'Excellent' : 'Good',
      partnershipValue: esgAnalysis.social.score > 70 ? 'High' : 'Medium',
      longTermCommitment: esgAnalysis.governance.score > 70 ? 'Strong' : 'Moderate'
    };
  }
}

module.exports = new ESGAnalyzerAgent();