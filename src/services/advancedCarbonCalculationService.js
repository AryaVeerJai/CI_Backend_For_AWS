const natural = require('natural');
const logger = require('../utils/logger');
const carbonCalculationService = require('./carbonCalculationService');

class AdvancedCarbonCalculationService {
  constructor() {
    // Enhanced emission factors with ML-based adjustments
    this.emissionFactors = {
      energy: {
        electricity: {
          grid: 0.8, // kg CO2 per kWh (Indian grid average)
          renewable: 0.1,
          mixed: 0.4,
          // ML-adjusted factors based on region and time
          regional: {
            'north': 0.85,
            'south': 0.75,
            'east': 0.82,
            'west': 0.78,
            'central': 0.88
          }
        },
        fuel: {
          diesel: 2.68, // kg CO2 per liter
          petrol: 2.31,
          lpg: 1.51,
          cng: 1.51,
          coal: 2.42,
          natural_gas: 1.89
        }
      },
      materials: {
        steel: 1.85, // kg CO2 per kg
        aluminum: 8.24,
        plastic: 2.53,
        paper: 0.93,
        glass: 0.85,
        wood: 0.3,
        concrete: 0.15,
        cement: 0.9,
        textile: 1.2,
        leather: 2.5
      },
      transportation: {
        road: {
          diesel: 2.68,
          petrol: 2.31,
          cng: 1.51
        },
        air: 0.255, // kg CO2 per km per kg
        sea: 0.01,
        rail: 0.03
      },
      waste: {
        solid: 0.5, // kg CO2 per kg (landfill)
        hazardous: 2.0,
        organic: 0.3,
        recyclable: 0.1
      },
      water: {
        consumption: 0.0004, // kg CO2 per liter
        treatment: 0.001
      }
    };

    // Industry-specific multipliers with ML learning
    this.industryMultipliers = {
      manufacturing: {
        base: 1.0,
        subcategories: {
          'textile': 1.2,
          'food': 0.8,
          'chemicals': 1.5,
          'electronics': 1.1,
          'automotive': 1.3,
          'pharmaceuticals': 1.4,
          'construction': 1.6,
          'metals': 1.8
        }
      },
      services: {
        base: 0.3,
        subcategories: {
          'it': 0.2,
          'finance': 0.4,
          'healthcare': 0.6,
          'education': 0.3,
          'retail': 0.5
        }
      },
      agriculture: {
        base: 0.9,
        subcategories: {
          'crops': 0.8,
          'livestock': 1.2,
          'dairy': 1.1
        }
      }
    };

    // ML models for predictive analysis
    this.mlModels = {
      consumptionPredictor: new natural.BayesClassifier(),
      efficiencyPredictor: new natural.BayesClassifier(),
      trendAnalyzer: new natural.BayesClassifier()
    };

    // Initialize ML models
    this.initializeMLModels();
  }

  initializeMLModels() {
    // Train consumption predictor
    const consumptionTrainingData = [
      { features: 'high_energy_consumption', category: 'high_carbon' },
      { features: 'low_energy_consumption', category: 'low_carbon' },
      { features: 'renewable_energy', category: 'sustainable' },
      { features: 'fossil_fuel_heavy', category: 'high_carbon' },
      { features: 'efficient_equipment', category: 'efficient' },
      { features: 'outdated_equipment', category: 'inefficient' }
    ];

    consumptionTrainingData.forEach(item => {
      this.mlModels.consumptionPredictor.addDocument(item.features, item.category);
    });

    this.mlModels.consumptionPredictor.train();
  }

  async calculateAdvancedCarbonFootprint(extractedData, msmeProfile) {
    try {
      const calculation = {
        totalCO2Emissions: 0,
        breakdown: {
          energy: { co2: 0, percentage: 0 },
          materials: { co2: 0, percentage: 0 },
          transportation: { co2: 0, percentage: 0 },
          waste: { co2: 0, percentage: 0 },
          water: { co2: 0, percentage: 0 }
        },
        scopeBreakdown: {
          scope1: { co2: 0, percentage: 0 },
          scope2: { co2: 0, percentage: 0 },
          scope3: { co2: 0, percentage: 0 }
        },
        industryAdjustment: 1.0,
        mlInsights: [],
        recommendations: [],
        carbonScore: 0,
        sustainabilityRating: 'C'
      };

      // Apply industry-specific adjustments
      calculation.industryAdjustment = this.getIndustryMultiplier(msmeProfile.industry, msmeProfile.subIndustry);

      // Calculate energy emissions
      calculation.breakdown.energy = await this.calculateEnergyEmissions(extractedData.energy, msmeProfile);
      
      // Calculate material emissions
      calculation.breakdown.materials = await this.calculateMaterialEmissions(extractedData.materials, msmeProfile);
      
      // Calculate transportation emissions
      calculation.breakdown.transportation = await this.calculateTransportationEmissions(extractedData.transportation, msmeProfile);
      
      // Calculate waste emissions
      calculation.breakdown.waste = await this.calculateWasteEmissions(extractedData.waste, msmeProfile);
      
      // Calculate water emissions
      calculation.breakdown.water = await this.calculateWaterEmissions(extractedData.water, msmeProfile);

      // Calculate total emissions
      calculation.totalCO2Emissions = Object.values(calculation.breakdown).reduce((sum, category) => sum + category.co2, 0);
      
      // Apply industry adjustment
      calculation.totalCO2Emissions *= calculation.industryAdjustment;

      // Calculate percentages
      Object.keys(calculation.breakdown).forEach(category => {
        calculation.breakdown[category].percentage = 
          calculation.totalCO2Emissions > 0 ? 
          (calculation.breakdown[category].co2 / calculation.totalCO2Emissions) * 100 : 0;
      });

      // Calculate scope breakdown
      calculation.scopeBreakdown = this.calculateScopeBreakdown(calculation.breakdown);

      // Generate ML insights
      calculation.mlInsights = await this.generateMLInsights(extractedData, calculation);

      // Generate recommendations
      calculation.recommendations = await this.generateRecommendations(extractedData, calculation, msmeProfile);

      // Canonical score from shared carbonScoreCalculation (same as /api/carbon/*)
      const canonicalScore = carbonCalculationService.applyCanonicalCarbonScore(calculation, msmeProfile);
      calculation.carbonScore = canonicalScore.carbonScore;
      calculation.sustainabilityRating = canonicalScore.sustainabilityRating;
      calculation.scoringSource = 'canonical';

      return calculation;

    } catch (error) {
      logger.error('Error in calculateAdvancedCarbonFootprint:', error);
      throw error;
    }
  }

  getIndustryMultiplier(industry, subIndustry) {
    const industryData = this.industryMultipliers[industry] || this.industryMultipliers.manufacturing;
    const baseMultiplier = industryData.base;
    const subMultiplier = subIndustry ? (industryData.subcategories[subIndustry] || 1.0) : 1.0;
    
    return baseMultiplier * subMultiplier;
  }

  async calculateEnergyEmissions(energyData = {}, msmeProfile) {
    let totalCO2 = 0;
    let electricityCO2 = 0;
    let fuelCO2 = 0;

    // Electricity emissions
    if (energyData.electricity && energyData.electricity.consumption > 0) {
      const gridFactor = this.emissionFactors.energy.electricity.grid;
      const renewableFactor = this.emissionFactors.energy.electricity.renewable;
      const renewablePercentage = energyData.renewable?.percentage || 0;
      
      const gridConsumption = energyData.electricity.consumption * (1 - renewablePercentage / 100);
      const renewableConsumption = energyData.electricity.consumption * (renewablePercentage / 100);
      
      electricityCO2 = (gridConsumption * gridFactor) + (renewableConsumption * renewableFactor);
      totalCO2 += electricityCO2;
    }

    // Fuel emissions
    if (energyData.fuel && energyData.fuel.consumption > 0) {
      const fuelType = energyData.fuel.type || 'diesel';
      const fuelFactor = this.emissionFactors.energy.fuel[fuelType] || this.emissionFactors.energy.fuel.diesel;
      fuelCO2 = energyData.fuel.consumption * fuelFactor;
      totalCO2 += fuelCO2;
    }

    return {
      co2: totalCO2,
      percentage: 0,
      details: {
        electricity: energyData.electricity?.consumption || 0,
        fuel: energyData.fuel?.consumption || 0,
        renewable: energyData.renewable?.percentage || 0,
        electricityCO2,
        fuelCO2
      }
    };
  }

  async calculateMaterialEmissions(materialData = {}, msmeProfile) {
    let totalCO2 = 0;

    // Raw materials emissions
    if (materialData.rawMaterials && materialData.rawMaterials.quantity > 0) {
      const materialType = materialData.rawMaterials.type || 'steel';
      const materialFactor = this.emissionFactors.materials[materialType] || this.emissionFactors.materials.steel;
      totalCO2 += materialData.rawMaterials.quantity * materialFactor;
    }

    // Packaging emissions
    if (materialData.packaging && materialData.packaging.quantity > 0) {
      const packagingType = materialData.packaging.type || 'cardboard';
      const packagingFactor = this.emissionFactors.materials[packagingType] || this.emissionFactors.materials.paper;
      totalCO2 += materialData.packaging.quantity * packagingFactor;
    }

    return {
      co2: totalCO2,
      percentage: 0,
      details: {
        rawMaterials: materialData.rawMaterials?.quantity || 0,
        packaging: materialData.packaging?.quantity || 0
      }
    };
  }

  async calculateTransportationEmissions(transportData = {}, msmeProfile) {
    let totalCO2 = 0;

    if (transportData.distance > 0 && transportData.fuelConsumption > 0) {
      const mode = transportData.mode || 'road';
      
      if (mode === 'road') {
        const fuelType = transportData.fuelType || 'diesel';
        const fuelFactor = this.emissionFactors.transportation.road[fuelType] || this.emissionFactors.transportation.road.diesel;
        totalCO2 += transportData.fuelConsumption * fuelFactor;
      } else {
        const modeFactor = this.emissionFactors.transportation[mode] || this.emissionFactors.transportation.road.diesel;
        totalCO2 += transportData.distance * modeFactor * (transportData.fuelConsumption / 1000); // Convert to kg
      }
    }

    return {
      co2: totalCO2,
      percentage: 0,
      details: {
        distance: transportData.distance || 0,
        fuelConsumption: transportData.fuelConsumption || 0,
        mode: transportData.mode || 'road'
      }
    };
  }

  async calculateWasteEmissions(wasteData = {}, msmeProfile) {
    let totalCO2 = 0;

    // Solid waste emissions
    if (wasteData.solid && wasteData.solid.quantity > 0) {
      totalCO2 += wasteData.solid.quantity * this.emissionFactors.waste.solid;
    }

    // Hazardous waste emissions
    if (wasteData.hazardous && wasteData.hazardous.quantity > 0) {
      totalCO2 += wasteData.hazardous.quantity * this.emissionFactors.waste.hazardous;
    }

    return {
      co2: totalCO2,
      percentage: 0,
      details: {
        solid: wasteData.solid?.quantity || 0,
        hazardous: wasteData.hazardous?.quantity || 0
      }
    };
  }

  async calculateWaterEmissions(waterData = {}, msmeProfile) {
    let totalCO2 = 0;

    if (waterData.consumption > 0) {
      totalCO2 += waterData.consumption * this.emissionFactors.water.consumption;
      
      if (waterData.treatment) {
        totalCO2 += waterData.consumption * this.emissionFactors.water.treatment;
      }
    }

    return {
      co2: totalCO2,
      percentage: 0,
      details: {
        consumption: waterData.consumption || 0,
        treatment: waterData.treatment || false
      }
    };
  }

  calculateScopeBreakdown(breakdown) {
    const scopeBreakdown = {
      scope1: { co2: 0, percentage: 0, breakdown: {} },
      scope2: { co2: 0, percentage: 0, breakdown: {} },
      scope3: { co2: 0, percentage: 0, breakdown: {} }
    };

    // Scope 1: Direct emissions (stationary/mobile fuel combustion)
    const directFuelEmissions = Number(breakdown.energy?.details?.fuelCO2) || 0;
    scopeBreakdown.scope1.co2 = directFuelEmissions;
    scopeBreakdown.scope1.breakdown = {
      directFuel: directFuelEmissions,
      directTransport: 0,
      directManufacturing: 0
    };

    // Scope 2: Purchased energy emissions
    const purchasedElectricityEmissions = Number(breakdown.energy?.details?.electricityCO2) || 0;
    scopeBreakdown.scope2.co2 = purchasedElectricityEmissions;
    scopeBreakdown.scope2.breakdown = {
      electricity: purchasedElectricityEmissions,
      heating: 0,
      cooling: 0,
      steam: 0
    };

    // Scope 3: Other value-chain emissions
    const transportationEmissions = Number(breakdown.transportation?.co2) || 0;
    const materialsEmissions = Number(breakdown.materials?.co2) || 0;
    const wasteEmissions = Number(breakdown.waste?.co2) || 0;
    const waterEmissions = Number(breakdown.water?.co2) || 0;
    scopeBreakdown.scope3.co2 = transportationEmissions + materialsEmissions + wasteEmissions + waterEmissions;
    scopeBreakdown.scope3.breakdown = {
      purchasedGoods: materialsEmissions,
      transportation: transportationEmissions,
      wasteDisposal: wasteEmissions,
      other: waterEmissions
    };

    const totalScope = scopeBreakdown.scope1.co2 + scopeBreakdown.scope2.co2 + scopeBreakdown.scope3.co2;

    if (totalScope > 0) {
      scopeBreakdown.scope1.percentage = (scopeBreakdown.scope1.co2 / totalScope) * 100;
      scopeBreakdown.scope2.percentage = (scopeBreakdown.scope2.co2 / totalScope) * 100;
      scopeBreakdown.scope3.percentage = (scopeBreakdown.scope3.co2 / totalScope) * 100;
    }

    return scopeBreakdown;
  }

  async generateMLInsights(extractedData, calculation) {
    const insights = [];

    // Energy efficiency insights
    if (calculation.breakdown.energy.percentage > 60) {
      insights.push({
        type: 'energy_efficiency',
        message: 'High energy consumption detected. Consider energy efficiency measures.',
        priority: 'high',
        impact: 'significant'
      });
    }

    // Material usage insights
    if (calculation.breakdown.materials.percentage > 40) {
      insights.push({
        type: 'material_efficiency',
        message: 'High material consumption. Consider sustainable sourcing and circular economy practices.',
        priority: 'medium',
        impact: 'moderate'
      });
    }

    // Transportation insights
    if (calculation.breakdown.transportation.percentage > 20) {
      insights.push({
        type: 'transportation_optimization',
        message: 'High transportation emissions. Consider local suppliers and logistics optimization.',
        priority: 'medium',
        impact: 'moderate'
      });
    }

    // Waste management insights
    if (calculation.breakdown.waste.percentage > 10) {
      insights.push({
        type: 'waste_management',
        message: 'Significant waste generation. Implement waste reduction and recycling programs.',
        priority: 'high',
        impact: 'significant'
      });
    }

    return insights;
  }

  async generateRecommendations(extractedData, calculation, msmeProfile) {
    const recommendations = [];

    // Energy recommendations
    if (calculation.breakdown.energy.percentage > 50) {
      recommendations.push({
        category: 'energy',
        title: 'Implement Energy Efficiency Measures',
        description: 'Install energy-efficient equipment and implement energy management systems',
        impact: 'high',
        cost: 'medium',
        timeline: '3-6 months',
        co2Reduction: calculation.breakdown.energy.co2 * 0.2 // 20% reduction potential
      });
    }

    // Renewable energy recommendations
    if (extractedData.energy?.renewable?.percentage < 30) {
      recommendations.push({
        category: 'renewable_energy',
        title: 'Adopt Renewable Energy',
        description: 'Install solar panels or purchase renewable energy certificates',
        impact: 'high',
        cost: 'high',
        timeline: '6-12 months',
        co2Reduction: calculation.breakdown.energy.co2 * 0.4 // 40% reduction potential
      });
    }

    // Material recommendations
    if (calculation.breakdown.materials.percentage > 30) {
      recommendations.push({
        category: 'materials',
        title: 'Sustainable Material Sourcing',
        description: 'Source materials from sustainable suppliers and implement circular economy practices',
        impact: 'medium',
        cost: 'low',
        timeline: '1-3 months',
        co2Reduction: calculation.breakdown.materials.co2 * 0.15 // 15% reduction potential
      });
    }

    // Transportation recommendations
    if (calculation.breakdown.transportation.percentage > 15) {
      recommendations.push({
        category: 'transportation',
        title: 'Optimize Logistics',
        description: 'Use local suppliers and optimize delivery routes',
        impact: 'medium',
        cost: 'low',
        timeline: '1-2 months',
        co2Reduction: calculation.breakdown.transportation.co2 * 0.25 // 25% reduction potential
      });
    }

    return recommendations;
  }

  calculateCarbonScore(calculation) {
    // Base score calculation (0-100)
    let score = 100;

    // Penalize high emissions
    if (calculation.totalCO2Emissions > 1000) score -= 20;
    if (calculation.totalCO2Emissions > 5000) score -= 30;
    if (calculation.totalCO2Emissions > 10000) score -= 40;

    // Reward low energy percentage
    if (calculation.breakdown.energy.percentage < 40) score += 10;
    if (calculation.breakdown.energy.percentage > 70) score -= 15;

    // Reward low material percentage
    if (calculation.breakdown.materials.percentage < 30) score += 10;
    if (calculation.breakdown.materials.percentage > 50) score -= 10;

    // Reward low transportation percentage
    if (calculation.breakdown.transportation.percentage < 20) score += 10;
    if (calculation.breakdown.transportation.percentage > 40) score -= 10;

    // Reward low waste percentage
    if (calculation.breakdown.waste.percentage < 10) score += 10;
    if (calculation.breakdown.waste.percentage > 20) score -= 10;

    return Math.max(0, Math.min(100, score));
  }

  calculateSustainabilityRating(carbonScore) {
    if (carbonScore >= 80) return 'A+';
    if (carbonScore >= 70) return 'A';
    if (carbonScore >= 60) return 'B+';
    if (carbonScore >= 50) return 'B';
    if (carbonScore >= 40) return 'C+';
    if (carbonScore >= 30) return 'C';
    if (carbonScore >= 20) return 'D';
    return 'F';
  }

  async predictFutureEmissions(historicalData, timeHorizon = 12) {
    try {
      const predictions = {
        monthly: [],
        total: 0,
        trend: 'stable',
        confidence: 0.5
      };

      // Simple linear regression for prediction
      if (historicalData.length >= 3) {
        const months = historicalData.map((_, index) => index + 1);
        const emissions = historicalData.map(data => data.totalCO2Emissions);

        // Calculate slope and intercept
        const n = months.length;
        const sumX = months.reduce((sum, x) => sum + x, 0);
        const sumY = emissions.reduce((sum, y) => sum + y, 0);
        const sumXY = months.reduce((sum, x, i) => sum + x * emissions[i], 0);
        const sumXX = months.reduce((sum, x) => sum + x * x, 0);

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        // Generate predictions
        for (let i = 1; i <= timeHorizon; i++) {
          const month = n + i;
          const predictedEmission = slope * month + intercept;
          predictions.monthly.push({
            month: month,
            predictedCO2: Math.max(0, predictedEmission),
            confidence: Math.max(0.1, 1 - (i * 0.05)) // Decreasing confidence over time
          });
        }

        predictions.total = predictions.monthly.reduce((sum, pred) => sum + pred.predictedCO2, 0);
        predictions.trend = slope > 0.1 ? 'increasing' : slope < -0.1 ? 'decreasing' : 'stable';
        predictions.confidence = Math.max(0.1, 1 - (timeHorizon * 0.02));
      }

      return predictions;

    } catch (error) {
      logger.error('Error in predictFutureEmissions:', error);
      throw error;
    }
  }

  async generateCarbonReport(calculation, predictions, msmeProfile) {
    return {
      company: {
        name: msmeProfile.companyName,
        industry: msmeProfile.industry,
        size: msmeProfile.companyType
      },
      currentFootprint: calculation,
      predictions: predictions,
      summary: {
        totalEmissions: calculation.totalCO2Emissions,
        sustainabilityRating: calculation.sustainabilityRating,
        carbonScore: calculation.carbonScore,
        keyInsights: calculation.mlInsights.slice(0, 3),
        topRecommendations: calculation.recommendations.slice(0, 3)
      },
      generatedAt: new Date()
    };
  }
}

module.exports = AdvancedCarbonCalculationService;
