const natural = require('natural');
const logger = require('../utils/logger');
const carbonRating = require('../../../shared/carbonRating');
const carbonCalculationService = require('./carbonCalculationService');

class AICarbonScoringService {
  constructor() {
    // AI models for scoring
    this.scoringModels = {
      carbonFootprint: new natural.BayesClassifier(),
      sustainability: new natural.BayesClassifier(),
      efficiency: new natural.BayesClassifier(),
      riskAssessment: new natural.BayesClassifier()
    };

    // Scoring criteria and weights
    this.scoringCriteria = {
      carbonFootprint: {
        weight: 0.4,
        factors: {
          totalEmissions: { weight: 0.3, threshold: 1000 },
          energyEfficiency: { weight: 0.25, threshold: 0.7 },
          renewableEnergy: { weight: 0.2, threshold: 0.3 },
          wasteReduction: { weight: 0.15, threshold: 0.1 },
          materialEfficiency: { weight: 0.1, threshold: 0.5 }
        }
      },
      sustainability: {
        weight: 0.3,
        factors: {
          environmentalImpact: { weight: 0.4, threshold: 0.6 },
          socialResponsibility: { weight: 0.3, threshold: 0.5 },
          governance: { weight: 0.3, threshold: 0.7 }
        }
      },
      efficiency: {
        weight: 0.2,
        factors: {
          resourceUtilization: { weight: 0.4, threshold: 0.8 },
          processOptimization: { weight: 0.3, threshold: 0.7 },
          technologyAdoption: { weight: 0.3, threshold: 0.6 }
        }
      },
      riskAssessment: {
        weight: 0.1,
        factors: {
          regulatoryCompliance: { weight: 0.4, threshold: 0.8 },
          marketRisk: { weight: 0.3, threshold: 0.6 },
          operationalRisk: { weight: 0.3, threshold: 0.7 }
        }
      }
    };

    // Industry benchmarks
    this.industryBenchmarks = {
      manufacturing: {
        carbonFootprint: { excellent: 500, good: 1000, average: 2000, poor: 5000 },
        sustainability: { excellent: 0.8, good: 0.6, average: 0.4, poor: 0.2 },
        efficiency: { excellent: 0.9, good: 0.7, average: 0.5, poor: 0.3 }
      },
      services: {
        carbonFootprint: { excellent: 100, good: 300, average: 600, poor: 1200 },
        sustainability: { excellent: 0.9, good: 0.7, average: 0.5, poor: 0.3 },
        efficiency: { excellent: 0.95, good: 0.8, average: 0.6, poor: 0.4 }
      },
      agriculture: {
        carbonFootprint: { excellent: 200, good: 500, average: 1000, poor: 2000 },
        sustainability: { excellent: 0.7, good: 0.5, average: 0.3, poor: 0.1 },
        efficiency: { excellent: 0.8, good: 0.6, average: 0.4, poor: 0.2 }
      }
    };

    // Initialize ML models
    this.initializeMLModels();
  }

  initializeMLModels() {
    // Train carbon footprint classifier
    const carbonTrainingData = [
      { features: 'low_emissions renewable_energy efficient', category: 'excellent' },
      { features: 'moderate_emissions some_renewable efficient', category: 'good' },
      { features: 'high_emissions fossil_fuels inefficient', category: 'poor' },
      { features: 'very_high_emissions no_renewable very_inefficient', category: 'critical' }
    ];

    carbonTrainingData.forEach(item => {
      this.scoringModels.carbonFootprint.addDocument(item.features, item.category);
    });

    // Train sustainability classifier
    const sustainabilityTrainingData = [
      { features: 'environmental_social_governance compliance', category: 'excellent' },
      { features: 'some_sustainability basic_compliance', category: 'good' },
      { features: 'minimal_sustainability poor_compliance', category: 'poor' },
      { features: 'no_sustainability non_compliant', category: 'critical' }
    ];

    sustainabilityTrainingData.forEach(item => {
      this.scoringModels.sustainability.addDocument(item.features, item.category);
    });

    // Train efficiency classifier
    const efficiencyTrainingData = [
      { features: 'high_efficiency optimized_processes advanced_tech', category: 'excellent' },
      { features: 'good_efficiency some_optimization modern_tech', category: 'good' },
      { features: 'poor_efficiency outdated_processes old_tech', category: 'poor' },
      { features: 'very_poor_efficiency no_optimization obsolete_tech', category: 'critical' }
    ];

    efficiencyTrainingData.forEach(item => {
      this.scoringModels.efficiency.addDocument(item.features, item.category);
    });

    // Train risk assessment classifier
    const riskTrainingData = [
      { features: 'full_compliance low_risk good_governance', category: 'low' },
      { features: 'partial_compliance medium_risk basic_governance', category: 'medium' },
      { features: 'poor_compliance high_risk weak_governance', category: 'high' },
      { features: 'non_compliant very_high_risk no_governance', category: 'critical' }
    ];

    riskTrainingData.forEach(item => {
      this.scoringModels.riskAssessment.addDocument(item.features, item.category);
    });

    // Train all models
    Object.values(this.scoringModels).forEach(model => model.train());
  }

  async calculateAICarbonScore(carbonData, msmeProfile, historicalData = []) {
    try {
      const score = {
        overall: 0,
        categories: {
          carbonFootprint: { score: 0, rating: 'C', details: {} },
          sustainability: { score: 0, rating: 'C', details: {} },
          efficiency: { score: 0, rating: 'C', details: {} },
          riskAssessment: { score: 0, rating: 'C', details: {} }
        },
        trends: {
          carbonFootprint: 'stable',
          sustainability: 'stable',
          efficiency: 'stable',
          riskAssessment: 'stable'
        },
        benchmarks: {},
        recommendations: [],
        insights: [],
        confidence: 0
      };

      // Calculate individual category scores
      score.categories.carbonFootprint = await this.calculateCarbonFootprintScore(carbonData, msmeProfile);
      score.categories.sustainability = await this.calculateSustainabilityScore(carbonData, msmeProfile);
      score.categories.efficiency = await this.calculateEfficiencyScore(carbonData, msmeProfile);
      score.categories.riskAssessment = await this.calculateRiskAssessmentScore(carbonData, msmeProfile);

      // Canonical overall score (same as /api/carbon/*); keep AI category scores as supplements
      this.normalizeCategoryScores(score.categories);
      const canonicalScore = carbonCalculationService.applyCanonicalCarbonScore(carbonData, msmeProfile);
      score.overall = canonicalScore.carbonScore;
      score.overallRating = canonicalScore.sustainabilityRating;
      score.scoringSource = 'canonical';

      // Calculate trends if historical data is available
      if (historicalData.length > 0) {
        score.trends = await this.calculateTrends(historicalData, score.categories);
      }

      // Calculate benchmarks
      score.benchmarks = this.calculateBenchmarks(score.categories, msmeProfile.industry);

      // Generate recommendations
      score.recommendations = await this.generateScoringRecommendations(score.categories, msmeProfile);

      // Generate insights
      score.insights = await this.generateScoringInsights(score.categories, score.trends);

      // Calculate confidence
      score.confidence = this.calculateConfidence(score.categories, historicalData);

      return score;

    } catch (error) {
      logger.error('Error in calculateAICarbonScore:', error);
      throw error;
    }
  }

  async calculateCarbonFootprintScore(carbonData, msmeProfile) {
    const factors = this.scoringCriteria.carbonFootprint.factors;
    let totalScore = 0;
    let totalWeight = 0;
    const details = {};

    // Total emissions score
    const emissionsScore = this.calculateEmissionsScore(carbonData.totalCO2Emissions, factors.totalEmissions.threshold);
    totalScore += emissionsScore * factors.totalEmissions.weight;
    totalWeight += factors.totalEmissions.weight;
    details.totalEmissions = { score: emissionsScore, value: carbonData.totalCO2Emissions };

    // Energy efficiency score
    const energyEfficiency = this.calculateEnergyEfficiency(carbonData.breakdown?.energy);
    const energyScore = this.calculateFactorScore(energyEfficiency, factors.energyEfficiency.threshold);
    totalScore += energyScore * factors.energyEfficiency.weight;
    totalWeight += factors.energyEfficiency.weight;
    details.energyEfficiency = { score: energyScore, value: energyEfficiency };

    // Renewable energy score
    const renewablePercentage = this.calculateRenewablePercentage(carbonData.breakdown?.energy);
    const renewableScore = this.calculateFactorScore(renewablePercentage, factors.renewableEnergy.threshold);
    totalScore += renewableScore * factors.renewableEnergy.weight;
    totalWeight += factors.renewableEnergy.weight;
    details.renewableEnergy = { score: renewableScore, value: renewablePercentage };

    // Waste reduction score
    const wasteReduction = this.calculateWasteReduction(carbonData.breakdown?.waste);
    const wasteScore = this.calculateFactorScore(wasteReduction, factors.wasteReduction.threshold);
    totalScore += wasteScore * factors.wasteReduction.weight;
    totalWeight += factors.wasteReduction.weight;
    details.wasteReduction = { score: wasteScore, value: wasteReduction };

    // Material efficiency score
    const materialEfficiency = this.calculateMaterialEfficiency(carbonData.breakdown?.materials);
    const materialScore = this.calculateFactorScore(materialEfficiency, factors.materialEfficiency.threshold);
    totalScore += materialScore * factors.materialEfficiency.weight;
    totalWeight += factors.materialEfficiency.weight;
    details.materialEfficiency = { score: materialScore, value: materialEfficiency };

    const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;

    return this.buildCategoryScore(finalScore, details);
  }

  async calculateSustainabilityScore(carbonData, msmeProfile) {
    const factors = this.scoringCriteria.sustainability.factors;
    let totalScore = 0;
    let totalWeight = 0;
    const details = {};

    // Environmental impact score
    const environmentalImpact = this.calculateEnvironmentalImpact(carbonData);
    const envScore = this.calculateFactorScore(environmentalImpact, factors.environmentalImpact.threshold);
    totalScore += envScore * factors.environmentalImpact.weight;
    totalWeight += factors.environmentalImpact.weight;
    details.environmentalImpact = { score: envScore, value: environmentalImpact };

    // Social responsibility score (based on available data)
    const socialResponsibility = this.calculateSocialResponsibility(msmeProfile);
    const socialScore = this.calculateFactorScore(socialResponsibility, factors.socialResponsibility.threshold);
    totalScore += socialScore * factors.socialResponsibility.weight;
    totalWeight += factors.socialResponsibility.weight;
    details.socialResponsibility = { score: socialScore, value: socialResponsibility };

    // Governance score
    const governance = this.calculateGovernance(msmeProfile);
    const govScore = this.calculateFactorScore(governance, factors.governance.threshold);
    totalScore += govScore * factors.governance.weight;
    totalWeight += factors.governance.weight;
    details.governance = { score: govScore, value: governance };

    const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;

    return this.buildCategoryScore(finalScore, details);
  }

  async calculateEfficiencyScore(carbonData, msmeProfile) {
    const factors = this.scoringCriteria.efficiency.factors;
    let totalScore = 0;
    let totalWeight = 0;
    const details = {};

    // Resource utilization score
    const resourceUtilization = this.calculateResourceUtilization(carbonData);
    const resourceScore = this.calculateFactorScore(resourceUtilization, factors.resourceUtilization.threshold);
    totalScore += resourceScore * factors.resourceUtilization.weight;
    totalWeight += factors.resourceUtilization.weight;
    details.resourceUtilization = { score: resourceScore, value: resourceUtilization };

    // Process optimization score
    const processOptimization = this.calculateProcessOptimization(carbonData);
    const processScore = this.calculateFactorScore(processOptimization, factors.processOptimization.threshold);
    totalScore += processScore * factors.processOptimization.weight;
    totalWeight += factors.processOptimization.weight;
    details.processOptimization = { score: processScore, value: processOptimization };

    // Technology adoption score
    const technologyAdoption = this.calculateTechnologyAdoption(msmeProfile);
    const techScore = this.calculateFactorScore(technologyAdoption, factors.technologyAdoption.threshold);
    totalScore += techScore * factors.technologyAdoption.weight;
    totalWeight += factors.technologyAdoption.weight;
    details.technologyAdoption = { score: techScore, value: technologyAdoption };

    const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;

    return this.buildCategoryScore(finalScore, details);
  }

  async calculateRiskAssessmentScore(carbonData, msmeProfile) {
    const factors = this.scoringCriteria.riskAssessment.factors;
    let totalScore = 0;
    let totalWeight = 0;
    const details = {};

    // Regulatory compliance score
    const regulatoryCompliance = this.calculateRegulatoryCompliance(msmeProfile);
    const regScore = this.calculateFactorScore(regulatoryCompliance, factors.regulatoryCompliance.threshold);
    totalScore += regScore * factors.regulatoryCompliance.weight;
    totalWeight += factors.regulatoryCompliance.weight;
    details.regulatoryCompliance = { score: regScore, value: regulatoryCompliance };

    // Market risk score
    const marketRisk = this.calculateMarketRisk(carbonData, msmeProfile);
    const marketScore = this.calculateFactorScore(marketRisk, factors.marketRisk.threshold);
    totalScore += marketScore * factors.marketRisk.weight;
    totalWeight += factors.marketRisk.weight;
    details.marketRisk = { score: marketScore, value: marketRisk };

    // Operational risk score
    const operationalRisk = this.calculateOperationalRisk(carbonData, msmeProfile);
    const opScore = this.calculateFactorScore(operationalRisk, factors.operationalRisk.threshold);
    totalScore += opScore * factors.operationalRisk.weight;
    totalWeight += factors.operationalRisk.weight;
    details.operationalRisk = { score: opScore, value: operationalRisk };

    const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;

    return this.buildCategoryScore(finalScore, details);
  }

  calculateEmissionsScore(emissions, threshold) {
    if (emissions <= threshold * 0.5) return 1.0; // Excellent
    if (emissions <= threshold) return 0.8; // Good
    if (emissions <= threshold * 2) return 0.6; // Average
    if (emissions <= threshold * 5) return 0.4; // Poor
    return 0.2; // Critical
  }

  calculateEnergyEfficiency(energyData) {
    if (!energyData) return 0.5;
    
    // Calculate efficiency based on energy mix and consumption patterns
    const renewablePercentage = energyData.renewable?.percentage || 0;
    const totalConsumption = (energyData.electricity?.consumption || 0) + (energyData.fuel?.consumption || 0);
    
    if (totalConsumption === 0) return 0.5;
    
    // Higher renewable percentage = higher efficiency
    return Math.min(1, renewablePercentage / 100 + 0.3);
  }

  calculateRenewablePercentage(energyData) {
    if (!energyData || !energyData.renewable) return 0;
    return energyData.renewable.percentage / 100;
  }

  calculateWasteReduction(wasteData) {
    if (!wasteData) return 0.5;
    
    const totalWaste = (wasteData.solid?.quantity || 0) + (wasteData.hazardous?.quantity || 0);
    if (totalWaste === 0) return 1.0;
    
    // Lower waste = higher score
    return Math.max(0, 1 - (totalWaste / 1000));
  }

  calculateMaterialEfficiency(materialData) {
    if (!materialData) return 0.5;
    
    const totalMaterials = (materialData.rawMaterials?.quantity || 0) + (materialData.packaging?.quantity || 0);
    if (totalMaterials === 0) return 1.0;
    
    // Lower material usage = higher efficiency
    return Math.max(0, 1 - (totalMaterials / 5000));
  }

  calculateEnvironmentalImpact(carbonData) {
    // Calculate based on total emissions and breakdown
    const totalEmissions = carbonData.totalCO2Emissions || 0;
    const breakdown = carbonData.breakdown || {};
    
    let impact = 0.5; // Base impact
    
    // Adjust based on emission levels
    if (totalEmissions < 500) impact = 0.9;
    else if (totalEmissions < 1000) impact = 0.7;
    else if (totalEmissions < 2000) impact = 0.5;
    else if (totalEmissions < 5000) impact = 0.3;
    else impact = 0.1;
    
    return impact;
  }

  calculateSocialResponsibility(msmeProfile) {
    // Calculate based on company profile and practices
    let score = 0.5; // Base score
    
    // Add points for company size (smaller companies often have better community relations)
    if (msmeProfile.companyType === 'micro') score += 0.2;
    else if (msmeProfile.companyType === 'small') score += 0.1;
    
    // Add points for local presence
    if (msmeProfile.contact?.address) score += 0.1;
    
    return Math.min(1, score);
  }

  calculateGovernance(msmeProfile) {
    // Calculate based on compliance and documentation
    let score = 0.5; // Base score
    
    // Add points for proper registration
    if (msmeProfile.udyamRegistrationNumber || msmeProfile.udyogAadharNumber) score += 0.2;
    if (msmeProfile.gstNumber) score += 0.2;
    if (msmeProfile.panNumber) score += 0.1;
    
    return Math.min(1, score);
  }

  calculateResourceUtilization(carbonData) {
    // Calculate based on how efficiently resources are used
    const breakdown = carbonData.breakdown || {};
    const totalEmissions = carbonData.totalCO2Emissions || 1;
    
    // Calculate resource efficiency based on emission distribution
    let efficiency = 0.5;
    
    // If energy is the dominant source, check for efficiency
    if (breakdown.energy?.percentage > 60) {
      efficiency = breakdown.energy.percentage > 80 ? 0.3 : 0.6;
    }
    
    return efficiency;
  }

  calculateProcessOptimization(carbonData) {
    // Calculate based on process efficiency indicators
    const breakdown = carbonData.breakdown || {};
    
    let optimization = 0.5;
    
    // Check for balanced emission sources (indicates good process optimization)
    const percentages = Object.values(breakdown).map(cat => cat.percentage || 0);
    const maxPercentage = Math.max(...percentages);
    
    if (maxPercentage < 50) optimization = 0.8; // Well balanced
    else if (maxPercentage < 70) optimization = 0.6; // Moderately balanced
    else optimization = 0.4; // Poorly balanced
    
    return optimization;
  }

  calculateTechnologyAdoption(msmeProfile) {
    // Calculate based on technology indicators in profile
    let adoption = 0.5; // Base score
    
    // Add points for digital presence
    if (msmeProfile.contact?.email) adoption += 0.1;
    if (msmeProfile.contact?.website) adoption += 0.2;
    
    // Add points for modern business practices
    if (msmeProfile.udyamRegistrationNumber || msmeProfile.udyogAadharNumber) adoption += 0.1;
    if (msmeProfile.gstNumber) adoption += 0.1;
    
    return Math.min(1, adoption);
  }

  calculateRegulatoryCompliance(msmeProfile) {
    // Calculate based on compliance documentation
    let compliance = 0.5; // Base score
    
    // Add points for each compliance document
    if (msmeProfile.udyamRegistrationNumber || msmeProfile.udyogAadharNumber) compliance += 0.2;
    if (msmeProfile.gstNumber) compliance += 0.2;
    if (msmeProfile.panNumber) compliance += 0.1;
    
    return Math.min(1, compliance);
  }

  calculateMarketRisk(carbonData, msmeProfile) {
    // Calculate based on carbon footprint and market position
    const totalEmissions = carbonData.totalCO2Emissions || 0;
    
    let risk = 0.5; // Base risk
    
    // Higher emissions = higher market risk
    if (totalEmissions > 5000) risk = 0.8;
    else if (totalEmissions > 2000) risk = 0.6;
    else if (totalEmissions < 500) risk = 0.2;
    
    return risk;
  }

  calculateOperationalRisk(carbonData, msmeProfile) {
    // Calculate based on operational efficiency
    const breakdown = carbonData.breakdown || {};
    
    let risk = 0.5; // Base risk
    
    // High energy dependency = higher operational risk
    if (breakdown.energy?.percentage > 70) risk = 0.8;
    else if (breakdown.energy?.percentage > 50) risk = 0.6;
    else if (breakdown.energy?.percentage < 30) risk = 0.3;
    
    return risk;
  }

  calculateFactorScore(value, threshold) {
    if (value >= threshold) return 1.0;
    if (value >= threshold * 0.8) return 0.8;
    if (value >= threshold * 0.6) return 0.6;
    if (value >= threshold * 0.4) return 0.4;
    return 0.2;
  }

  buildCategoryScore(rawScore, details = {}) {
    const score = carbonRating.normalizeScore(rawScore);
    return {
      score,
      rating: carbonRating.getRating(score),
      details
    };
  }

  normalizeCategoryScores(categories = {}) {
    Object.values(categories).forEach((category) => {
      if (!category || typeof category !== 'object') {
        return;
      }
      category.score = carbonRating.normalizeScore(category.score);
      category.rating = carbonRating.getRating(category.score);
    });
  }

  calculateOverallScore(categories) {
    let totalScore = 0;
    let totalWeight = 0;
    
    Object.entries(this.scoringCriteria).forEach(([category, criteria]) => {
      if (categories[category]) {
        totalScore += categories[category].score * criteria.weight;
        totalWeight += criteria.weight;
      }
    });
    
    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  getRating(score) {
    return carbonRating.getRating(score);
  }

  calculateBenchmarks(categories, industry) {
    const benchmarks = this.industryBenchmarks[industry] || this.industryBenchmarks.manufacturing;
    const results = {};
    
    Object.entries(categories).forEach(([category, data]) => {
      const benchmark = benchmarks[category];
      if (benchmark) {
        let level = 'poor';
        if (data.score >= 0.8) level = 'excellent';
        else if (data.score >= 0.6) level = 'good';
        else if (data.score >= 0.4) level = 'average';
        
        results[category] = {
          level,
          benchmark: benchmark[level],
          performance: data.score
        };
      }
    });
    
    return results;
  }

  async calculateTrends(historicalData, currentCategories) {
    const trends = {};
    
    // Calculate trends for each category
    Object.keys(currentCategories).forEach(category => {
      const historicalScores = historicalData.map(data => data.categories?.[category]?.score || 0);
      if (historicalScores.length > 1) {
        const currentScore = currentCategories[category].score;
        const averageHistorical = historicalScores.reduce((sum, score) => sum + score, 0) / historicalScores.length;
        
        const change = currentScore - averageHistorical;
        if (change > 0.1) trends[category] = 'improving';
        else if (change < -0.1) trends[category] = 'declining';
        else trends[category] = 'stable';
      } else {
        trends[category] = 'stable';
      }
    });
    
    return trends;
  }

  async generateScoringRecommendations(categories, msmeProfile) {
    const recommendations = [];
    
    Object.entries(categories).forEach(([category, data]) => {
      if (data.score < 0.6) {
        recommendations.push({
          category,
          priority: data.score < 0.4 ? 'high' : 'medium',
          title: `Improve ${category} Score`,
          description: `Current ${category} score is ${data.score.toFixed(2)} (${data.rating}). Focus on improving this area.`,
          impact: 'significant',
          timeline: '3-6 months'
        });
      }
    });
    
    return recommendations;
  }

  async generateScoringInsights(categories, trends) {
    const insights = [];
    
    // Overall performance insights
    const overallScore = this.calculateOverallScore(categories);
    if (overallScore >= 0.8) {
      insights.push({
        type: 'performance',
        message: 'Excellent overall sustainability performance',
        priority: 'low'
      });
    } else if (overallScore < 0.4) {
      insights.push({
        type: 'performance',
        message: 'Critical sustainability performance issues detected',
        priority: 'high'
      });
    }
    
    // Trend insights
    Object.entries(trends).forEach(([category, trend]) => {
      if (trend === 'improving') {
        insights.push({
          type: 'trend',
          message: `${category} performance is improving`,
          priority: 'low'
        });
      } else if (trend === 'declining') {
        insights.push({
          type: 'trend',
          message: `${category} performance is declining`,
          priority: 'high'
        });
      }
    });
    
    return insights;
  }

  calculateConfidence(categories, historicalData) {
    let confidence = 0.5; // Base confidence
    
    // Increase confidence based on data completeness
    const dataCompleteness = Object.values(categories).filter(cat => cat.score > 0).length / Object.keys(categories).length;
    confidence += dataCompleteness * 0.3;
    
    // Increase confidence based on historical data availability
    if (historicalData.length > 0) {
      confidence += Math.min(0.2, historicalData.length * 0.05);
    }
    
    return Math.min(1, confidence);
  }

  async generateSustainabilityReport(score, msmeProfile) {
    return {
      company: {
        name: msmeProfile.companyName,
        industry: msmeProfile.industry,
        size: msmeProfile.companyType
      },
      overallScore: score.overall,
      overallRating: carbonRating.getRating(score.overall),
      categoryScores: score.categories,
      trends: score.trends,
      benchmarks: score.benchmarks,
      recommendations: score.recommendations,
      insights: score.insights,
      confidence: score.confidence,
      generatedAt: new Date()
    };
  }
}

module.exports = AICarbonScoringService;
