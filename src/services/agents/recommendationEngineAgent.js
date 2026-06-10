const logger = require('../../utils/logger');
const { buildRecommendationBreakdown } = require('./carbonDataNormalization');

class RecommendationEngineAgent {
  constructor() {
    this.name = 'Recommendation Engine Agent';
    this.type = 'recommendation_engine';
    this.capabilities = [
      'sustainability_recommendations',
      'cost_optimization',
      'efficiency_improvements',
      'compliance_guidance',
      'technology_adoption'
    ];
  }

  async generateRecommendations(input) {
    try {
      const recommendations = [];

      // Generate recommendations based on input type
      if (input.carbonData) {
        recommendations.push(...await this.generateCarbonBasedRecommendations(input.carbonData));
      }

      if (input.transactions) {
        recommendations.push(...await this.generateTransactionBasedRecommendations(input.transactions));
      }

      if (input.msmeData) {
        recommendations.push(...await this.generateMSMEBasedRecommendations(input.msmeData));
      }

      if (input.trends) {
        recommendations.push(...await this.generateTrendBasedRecommendations(input.trends));
      }

      // Remove duplicates and prioritize
      const uniqueRecommendations = this.deduplicateRecommendations(recommendations);
      const prioritizedRecommendations = this.prioritizeRecommendations(uniqueRecommendations);

      return {
        recommendations: prioritizedRecommendations,
        totalGenerated: uniqueRecommendations.length,
        categories: [...new Set(uniqueRecommendations.map(r => r.category))],
        priorityDistribution: this.calculatePriorityDistribution(prioritizedRecommendations)
      };
    } catch (error) {
      logger.error('Recommendation generation failed:', error);
      throw error;
    }
  }

  async generateCarbonBasedRecommendations(carbonData) {
    const recommendations = [];
    const normalized = {
      ...carbonData,
      breakdown: carbonData?.breakdown || buildRecommendationBreakdown(carbonData?.categoryBreakdown || {})
    };

    // Energy efficiency recommendations
    if (normalized.breakdown?.energy?.total > 500) {
      recommendations.push({
        id: this.generateRecommendationId(),
        category: 'energy',
        title: 'Implement Renewable Energy Solutions',
        description: 'Install solar panels or purchase renewable energy credits to reduce grid dependency',
        priority: 'high',
        potentialCO2Reduction: normalized.breakdown.energy.total * 0.4,
        implementationCost: 75000,
        paybackPeriod: 36,
        confidence: 0.9,
        impact: 'high',
        effort: 'medium',
        timeline: '6-12 months',
        benefits: [
          'Reduce energy costs by 30-50%',
          'Improve carbon score significantly',
          'Qualify for government incentives',
          'Enhance brand reputation'
        ],
        requirements: [
          'Roof space assessment',
          'Electrical system upgrade',
          'Permit applications',
          'Financing options'
        ]
      });

      recommendations.push({
        id: this.generateRecommendationId(),
        category: 'energy',
        title: 'Energy Audit and Optimization',
        description: 'Conduct comprehensive energy audit to identify efficiency opportunities',
        priority: 'medium',
        potentialCO2Reduction: normalized.breakdown.energy.total * 0.15,
        implementationCost: 15000,
        paybackPeriod: 12,
        confidence: 0.8,
        impact: 'medium',
        effort: 'low',
        timeline: '1-3 months',
        benefits: [
          'Identify energy waste',
          'Quick implementation',
          'Immediate cost savings',
          'Baseline for future improvements'
        ]
      });
    }

    // Waste management recommendations
    if (normalized.breakdown?.waste?.total > 100) {
      recommendations.push({
        id: this.generateRecommendationId(),
        category: 'waste',
        title: 'Comprehensive Waste Management Program',
        description: 'Implement waste segregation, recycling, and composting programs',
        priority: 'medium',
        potentialCO2Reduction: normalized.breakdown.waste.total * 0.5,
        implementationCost: 25000,
        paybackPeriod: 18,
        confidence: 0.85,
        impact: 'medium',
        effort: 'medium',
        timeline: '3-6 months',
        benefits: [
          'Reduce landfill waste by 60%',
          'Generate revenue from recyclables',
          'Improve environmental compliance',
          'Reduce waste disposal costs'
        ]
      });
    }

    // Transportation recommendations
    if (normalized.breakdown?.transportation?.co2Emissions > 50) {
      recommendations.push({
        id: this.generateRecommendationId(),
        category: 'transportation',
        title: 'Fleet Electrification',
        description: 'Replace diesel vehicles with electric or hybrid alternatives',
        priority: 'high',
        potentialCO2Reduction: normalized.breakdown.transportation.co2Emissions * 0.7,
        implementationCost: 150000,
        paybackPeriod: 48,
        confidence: 0.9,
        impact: 'high',
        effort: 'high',
        timeline: '12-18 months',
        benefits: [
          'Eliminate direct emissions',
          'Lower fuel costs',
          'Reduced maintenance',
          'Future-proof fleet'
        ]
      });

      recommendations.push({
        id: this.generateRecommendationId(),
        category: 'transportation',
        title: 'Route Optimization',
        description: 'Implement route optimization software to reduce fuel consumption',
        priority: 'low',
        potentialCO2Reduction: normalized.breakdown.transportation.co2Emissions * 0.2,
        implementationCost: 5000,
        paybackPeriod: 6,
        confidence: 0.8,
        impact: 'low',
        effort: 'low',
        timeline: '1-2 months',
        benefits: [
          'Immediate fuel savings',
          'Reduced driver fatigue',
          'Better customer service',
          'Lower operational costs'
        ]
      });
    }

    // Water conservation recommendations
    if (carbonData.breakdown?.water?.co2Emissions > 20) {
      recommendations.push({
        id: this.generateRecommendationId(),
        category: 'water',
        title: 'Water Conservation System',
        description: 'Install water recycling and conservation systems',
        priority: 'medium',
        potentialCO2Reduction: carbonData.breakdown.water.co2Emissions * 0.3,
        implementationCost: 35000,
        paybackPeriod: 24,
        confidence: 0.75,
        impact: 'medium',
        effort: 'medium',
        timeline: '4-8 months',
        benefits: [
          'Reduce water consumption by 40%',
          'Lower utility bills',
          'Improve water quality',
          'Enhanced sustainability profile'
        ]
      });
    }

    return recommendations;
  }

  async generateTransactionBasedRecommendations(transactions) {
    const recommendations = [];
    
    // Analyze transaction patterns
    const patterns = this.analyzeTransactionPatterns(transactions);
    
    // High-frequency, high-emission transactions
    if (patterns.highFrequencyHighEmission.length > 0) {
      recommendations.push({
        id: this.generateRecommendationId(),
        category: 'process_optimization',
        title: 'Process Optimization for High-Impact Transactions',
        description: 'Focus on optimizing processes that generate high emissions frequently',
        priority: 'high',
        potentialCO2Reduction: patterns.highFrequencyHighEmission.reduce((sum, t) => 
          sum + (t.carbonFootprint?.co2Emissions || 0), 0) * 0.25,
        implementationCost: 30000,
        paybackPeriod: 18,
        confidence: 0.8,
        impact: 'high',
        effort: 'medium',
        timeline: '6-9 months',
        affectedTransactions: patterns.highFrequencyHighEmission.length
      });
    }

    // Vendor consolidation opportunities
    if (patterns.vendorFragmentation > 0.7) {
      recommendations.push({
        id: this.generateRecommendationId(),
        category: 'supply_chain',
        title: 'Vendor Consolidation Strategy',
        description: 'Consolidate vendors to reduce transportation emissions and improve efficiency',
        priority: 'medium',
        potentialCO2Reduction: patterns.totalEmissions * 0.15,
        implementationCost: 20000,
        paybackPeriod: 15,
        confidence: 0.7,
        impact: 'medium',
        effort: 'high',
        timeline: '9-12 months',
        benefits: [
          'Reduced transportation costs',
          'Better vendor relationships',
          'Improved quality control',
          'Simplified procurement'
        ]
      });
    }

    return recommendations;
  }

  async generateMSMEBasedRecommendations(msmeData) {
    const recommendations = [];

    // Industry-specific recommendations
    const industry = msmeData.industry?.toLowerCase();
    
    if (industry === 'manufacturing') {
      recommendations.push({
        id: this.generateRecommendationId(),
        category: 'manufacturing',
        title: 'Lean Manufacturing Implementation',
        description: 'Implement lean manufacturing principles to reduce waste and improve efficiency',
        priority: 'high',
        potentialCO2Reduction: 200, // Estimated based on industry
        implementationCost: 50000,
        paybackPeriod: 24,
        confidence: 0.85,
        impact: 'high',
        effort: 'high',
        timeline: '12-18 months',
        benefits: [
          'Reduce material waste by 30%',
          'Improve production efficiency',
          'Lower energy consumption',
          'Better quality control'
        ]
      });
    }

    if (industry === 'textiles') {
      recommendations.push({
        id: this.generateRecommendationId(),
        category: 'textiles',
        title: 'Sustainable Dyeing Process',
        description: 'Adopt eco-friendly dyeing techniques and water recycling systems',
        priority: 'high',
        potentialCO2Reduction: 150,
        implementationCost: 40000,
        paybackPeriod: 20,
        confidence: 0.8,
        impact: 'high',
        effort: 'medium',
        timeline: '6-12 months'
      });
    }

    // Size-based recommendations
    if (msmeData.employeeCount < 50) {
      recommendations.push({
        id: this.generateRecommendationId(),
        category: 'small_business',
        title: 'Digital Transformation for Sustainability',
        description: 'Implement digital tools for better resource tracking and optimization',
        priority: 'medium',
        potentialCO2Reduction: 50,
        implementationCost: 15000,
        paybackPeriod: 12,
        confidence: 0.75,
        impact: 'medium',
        effort: 'low',
        timeline: '3-6 months'
      });
    }

    return recommendations;
  }

  async generateTrendBasedRecommendations(trends) {
    const recommendations = [];

    // Declining efficiency trend
    if (trends.efficiency?.trend === 'declining') {
      recommendations.push({
        id: this.generateRecommendationId(),
        category: 'efficiency',
        title: 'Efficiency Recovery Program',
        description: 'Address declining efficiency trends with targeted improvement initiatives',
        priority: 'high',
        potentialCO2Reduction: trends.efficiency.decline * 0.5,
        implementationCost: 25000,
        paybackPeriod: 15,
        confidence: 0.8,
        impact: 'high',
        effort: 'medium',
        timeline: '6-9 months'
      });
    }

    // Rising energy costs
    if (trends.energy?.costTrend === 'rising') {
      recommendations.push({
        id: this.generateRecommendationId(),
        category: 'energy',
        title: 'Energy Cost Mitigation Strategy',
        description: 'Implement energy efficiency measures to offset rising energy costs',
        priority: 'high',
        potentialCO2Reduction: 100,
        implementationCost: 30000,
        paybackPeriod: 18,
        confidence: 0.85,
        impact: 'high',
        effort: 'medium',
        timeline: '6-12 months'
      });
    }

    return recommendations;
  }

  analyzeTransactionPatterns(transactions) {
    const patterns = {
      highFrequencyHighEmission: [],
      vendorFragmentation: 0,
      totalEmissions: 0,
      categoryDistribution: {},
      seasonalPatterns: {}
    };

    // Calculate total emissions
    patterns.totalEmissions = transactions.reduce((sum, t) => 
      sum + (t.carbonFootprint?.co2Emissions || 0), 0);

    // Find high-frequency, high-emission transactions
    const avgEmission = patterns.totalEmissions / transactions.length;
    patterns.highFrequencyHighEmission = transactions.filter(t => 
      (t.carbonFootprint?.co2Emissions || 0) > avgEmission * 2);

    // Calculate vendor fragmentation
    const uniqueVendors = new Set(transactions.map(t => t.vendor)).size;
    patterns.vendorFragmentation = uniqueVendors / transactions.length;

    // Category distribution
    transactions.forEach(t => {
      if (!patterns.categoryDistribution[t.category]) {
        patterns.categoryDistribution[t.category] = 0;
      }
      patterns.categoryDistribution[t.category] += 1;
    });

    return patterns;
  }

  deduplicateRecommendations(recommendations) {
    const seen = new Set();
    return recommendations.filter(rec => {
      const key = `${rec.category}-${rec.title}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  prioritizeRecommendations(recommendations) {
    return recommendations.sort((a, b) => {
      // Priority weight: high=3, medium=2, low=1
      const priorityWeight = { high: 3, medium: 2, low: 1 };
      const aPriority = priorityWeight[a.priority] || 0;
      const bPriority = priorityWeight[b.priority] || 0;
      
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }
      
      // If same priority, sort by potential CO2 reduction
      return (b.potentialCO2Reduction || 0) - (a.potentialCO2Reduction || 0);
    });
  }

  calculatePriorityDistribution(recommendations) {
    const distribution = { high: 0, medium: 0, low: 0 };
    recommendations.forEach(rec => {
      distribution[rec.priority] = (distribution[rec.priority] || 0) + 1;
    });
    return distribution;
  }

  generateRecommendationId() {
    return `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = new RecommendationEngineAgent();