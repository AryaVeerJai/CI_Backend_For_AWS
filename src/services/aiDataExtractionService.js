const natural = require('natural');
const compromise = require('compromise');
const logger = require('../utils/logger');

class AIDataExtractionService {
  constructor() {
    this.tokenizer = new natural.WordTokenizer();
    this.stemmer = natural.PorterStemmer;
    this.classifier = new natural.BayesClassifier();
    this.sentimentAnalyzer = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'pattern');
    
    // Advanced pattern recognition for carbon footprint data
    this.carbonPatterns = {
      energy: {
        electricity: [
          'electricity', 'power', 'kwh', 'kilowatt', 'kw', 'watt', 'w',
          'electric bill', 'power bill', 'energy consumption', 'electrical'
        ],
        fuel: [
          'diesel', 'petrol', 'gasoline', 'fuel', 'lpg', 'cng', 'natural gas', 'coal',
          'fuel consumption', 'fuel cost', 'diesel bill', 'petrol bill', 'coal purchase'
        ],
        renewable: [
          'solar', 'wind', 'renewable energy', 'green energy', 'clean energy',
          'solar panel', 'wind turbine', 'renewable source'
        ]
      },
      materials: {
        rawMaterials: [
          'raw material', 'steel', 'aluminum', 'plastic', 'paper', 'wood',
          'concrete', 'cement', 'fabric', 'textile', 'metal', 'chemical'
        ],
        packaging: [
          'packaging', 'box', 'container', 'wrapper', 'plastic bag',
          'cardboard', 'packing material'
        ]
      },
      transportation: {
        logistics: [
          'shipping', 'freight', 'transport', 'logistics', 'delivery',
          'cargo', 'truck', 'vehicle', 'fleet', 'supply chain'
        ],
        fuel: [
          'fuel cost', 'diesel', 'petrol', 'transportation fuel',
          'vehicle fuel', 'fleet fuel'
        ]
      },
      waste: {
        solid: [
          'waste', 'garbage', 'trash', 'solid waste', 'disposal',
          'landfill', 'waste management'
        ],
        hazardous: [
          'hazardous waste', 'chemical waste', 'toxic waste',
          'dangerous waste', 'hazardous material'
        ]
      },
      water: {
        consumption: [
          'water', 'water consumption', 'water usage', 'water bill',
          'water treatment', 'wastewater'
        ]
      }
    };

    // Business activity patterns
    this.businessActivities = {
      manufacturing: [
        'production', 'manufacturing', 'assembly', 'processing', 'fabrication',
        'production line', 'factory', 'plant', 'workshop'
      ],
      sales: [
        'sale', 'sales', 'revenue', 'customer', 'order', 'invoice',
        'sales order', 'customer order', 'revenue generation'
      ],
      procurement: [
        'purchase', 'procurement', 'buying', 'supplier', 'vendor',
        'purchase order', 'procurement order', 'supplier payment'
      ],
      maintenance: [
        'maintenance', 'repair', 'service', 'upkeep', 'overhaul',
        'maintenance cost', 'repair cost', 'service charge'
      ],
      investment: [
        'investment', 'equipment', 'machinery', 'capital expenditure',
        'capex', 'asset', 'infrastructure', 'upgrade'
      ]
    };

    // Initialize ML models
    this.initializeModels();
  }

  initializeModels() {
    // Train classifier for carbon-related activities
    const trainingData = [
      // Energy patterns
      ...this.carbonPatterns.energy.electricity.map(text => ({ text, category: 'energy_electricity' })),
      ...this.carbonPatterns.energy.fuel.map(text => ({ text, category: 'energy_fuel' })),
      ...this.carbonPatterns.energy.renewable.map(text => ({ text, category: 'energy_renewable' })),
      
      // Material patterns
      ...this.carbonPatterns.materials.rawMaterials.map(text => ({ text, category: 'materials_raw' })),
      ...this.carbonPatterns.materials.packaging.map(text => ({ text, category: 'materials_packaging' })),
      
      // Transportation patterns
      ...this.carbonPatterns.transportation.logistics.map(text => ({ text, category: 'transport_logistics' })),
      ...this.carbonPatterns.transportation.fuel.map(text => ({ text, category: 'transport_fuel' })),
      
      // Waste patterns
      ...this.carbonPatterns.waste.solid.map(text => ({ text, category: 'waste_solid' })),
      ...this.carbonPatterns.waste.hazardous.map(text => ({ text, category: 'waste_hazardous' })),
      
      // Water patterns
      ...this.carbonPatterns.water.consumption.map(text => ({ text, category: 'water_consumption' }))
    ];

    trainingData.forEach(item => {
      this.classifier.addDocument(item.text, item.category);
    });

    this.classifier.train();
  }

  async extractCarbonDataFromText(text, source = 'unknown') {
    try {
      const analysis = {
        source,
        timestamp: new Date(),
        extractedData: {
          energy: {},
          materials: {},
          transportation: {},
          waste: {},
          water: {},
          businessActivities: [],
          carbonRelevant: false,
          confidence: 0
        },
        insights: [],
        recommendations: []
      };

      // Clean and preprocess text
      const cleanedText = this.preprocessText(text);
      
      // Extract numerical values and units
      const numericalData = this.extractNumericalData(cleanedText);
      
      // Classify text for carbon relevance
      const classification = this.classifyCarbonRelevance(cleanedText);
      
      // Extract energy-related data
      analysis.extractedData.energy = await this.extractEnergyData(cleanedText, numericalData);
      
      // Extract material data
      analysis.extractedData.materials = await this.extractMaterialData(cleanedText, numericalData);
      
      // Extract transportation data
      analysis.extractedData.transportation = await this.extractTransportationData(cleanedText, numericalData);
      
      // Extract waste data
      analysis.extractedData.waste = await this.extractWasteData(cleanedText, numericalData);
      
      // Extract water data
      analysis.extractedData.water = await this.extractWaterData(cleanedText, numericalData);
      
      // Identify business activities
      analysis.extractedData.businessActivities = this.identifyBusinessActivities(cleanedText);
      
      // Calculate carbon relevance score
      analysis.extractedData.carbonRelevant = classification.score > 0.3;
      analysis.extractedData.confidence = classification.score;
      
      // Generate insights and recommendations
      analysis.insights = this.generateInsights(analysis.extractedData);
      analysis.recommendations = this.generateRecommendations(analysis.extractedData);
      
      return analysis;
      
    } catch (error) {
      logger.error('Error in extractCarbonDataFromText:', error);
      throw error;
    }
  }

  preprocessText(text) {
    // Convert to lowercase
    let processed = text.toLowerCase();
    
    // Remove special characters but keep numbers and units
    processed = processed.replace(/[^\w\s\d\.\-\+\/\%]/g, ' ');
    
    // Normalize whitespace
    processed = processed.replace(/\s+/g, ' ').trim();
    
    return processed;
  }

  extractNumericalData(text) {
    const numericalData = [];
    
    // Pattern for numbers with units
    const unitPatterns = [
      /(\d+(?:\.\d+)?)\s*(kwh|kilowatt|kw|watt|w)/gi,
      /(\d+(?:\.\d+)?)\s*(liter|litre|l|ml|gallon|gal)/gi,
      /(\d+(?:\.\d+)?)\s*(kg|kilogram|gram|g|ton|tonne|mt)/gi,
      /(\d+(?:\.\d+)?)\s*(rupee|rs|inr|\$|usd|euro|€)/gi,
      /(\d+(?:\.\d+)?)\s*(meter|m|km|kilometer|cm|centimeter)/gi,
      /(\d+(?:\.\d+)?)\s*(piece|pcs|unit|units|nos)/gi
    ];

    unitPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        numericalData.push({
          value: parseFloat(match[1]),
          unit: match[2].toLowerCase(),
          context: text.substring(Math.max(0, match.index - 20), match.index + 20)
        });
      }
    });

    return numericalData;
  }

  classifyCarbonRelevance(text) {
    const tokens = this.tokenizer.tokenize(text);
    const stemmedTokens = tokens.map(token => this.stemmer.stem(token));
    
    let carbonScore = 0;
    let totalMatches = 0;
    
    // Check for carbon-related keywords
    Object.values(this.carbonPatterns).forEach(category => {
      Object.values(category).forEach(keywords => {
        keywords.forEach(keyword => {
          if (text.includes(keyword)) {
            carbonScore += 1;
            totalMatches += 1;
          }
        });
      });
    });

    // Check for business activity keywords
    Object.values(this.businessActivities).forEach(activities => {
      activities.forEach(activity => {
        if (text.includes(activity)) {
          carbonScore += 0.5;
          totalMatches += 1;
        }
      });
    });

    const score = totalMatches > 0 ? carbonScore / totalMatches : 0;
    
    return {
      score,
      isRelevant: score > 0.3,
      matchedKeywords: totalMatches
    };
  }

  async extractEnergyData(text, numericalData) {
    const energyData = {
      electricity: { consumption: 0, cost: 0, source: 'grid' },
      fuel: { consumption: 0, cost: 0, type: 'diesel' },
      renewable: { percentage: 0, type: 'solar' },
      totalCost: 0
    };

    // Extract electricity data
    const electricityData = numericalData.filter(data => 
      ['kwh', 'kilowatt', 'kw', 'watt', 'w'].includes(data.unit)
    );
    
    if (electricityData.length > 0) {
      energyData.electricity.consumption = electricityData.reduce((sum, data) => sum + data.value, 0);
    }

    // Extract fuel data
    const fuelData = numericalData.filter(data => 
      (
        ['liter', 'litre', 'l', 'gallon', 'gal'].includes(data.unit) ||
        (text.includes('coal') && ['kg', 'kilogram', 'gram', 'g', 'ton', 'tonne', 'mt'].includes(data.unit))
      ) &&
      (text.includes('diesel') || text.includes('petrol') || text.includes('coal') || text.includes('fuel'))
    );
    
    if (fuelData.length > 0) {
      energyData.fuel.consumption = fuelData.reduce((sum, data) => sum + data.value, 0);
    }

    if (text.includes('coal')) {
      energyData.fuel.type = 'coal';
    } else if (text.includes('lpg')) {
      energyData.fuel.type = 'lpg';
    } else if (text.includes('cng')) {
      energyData.fuel.type = 'cng';
    } else if (text.includes('petrol') || text.includes('gasoline')) {
      energyData.fuel.type = 'petrol';
    } else if (text.includes('diesel')) {
      energyData.fuel.type = 'diesel';
    }

    // Extract cost data
    const costData = numericalData.filter(data => 
      ['rupee', 'rs', 'inr', '$', 'usd', 'euro', '€'].includes(data.unit)
    );
    
    if (costData.length > 0) {
      energyData.totalCost = costData.reduce((sum, data) => sum + data.value, 0);
    }

    // Detect renewable energy
    if (text.includes('solar') || text.includes('renewable')) {
      energyData.renewable.percentage = 50; // Default assumption
      energyData.renewable.type = 'solar';
    }

    return energyData;
  }

  async extractMaterialData(text, numericalData) {
    const materialData = {
      rawMaterials: { quantity: 0, type: 'steel', cost: 0 },
      packaging: { quantity: 0, type: 'cardboard', cost: 0 },
      totalCost: 0
    };

    // Extract material quantities
    const materialData_nums = numericalData.filter(data => 
      ['kg', 'kilogram', 'gram', 'g', 'ton', 'tonne', 'mt', 'piece', 'pcs', 'unit', 'units'].includes(data.unit)
    );
    
    if (materialData_nums.length > 0) {
      materialData.rawMaterials.quantity = materialData_nums.reduce((sum, data) => sum + data.value, 0);
    }

    // Detect material types
    if (text.includes('steel')) materialData.rawMaterials.type = 'steel';
    else if (text.includes('aluminum')) materialData.rawMaterials.type = 'aluminum';
    else if (text.includes('plastic')) materialData.rawMaterials.type = 'plastic';
    else if (text.includes('wood')) materialData.rawMaterials.type = 'wood';

    return materialData;
  }

  async extractTransportationData(text, numericalData) {
    const transportData = {
      distance: 0,
      fuelConsumption: 0,
      cost: 0,
      mode: 'road'
    };

    // Extract distance data
    const distanceData = numericalData.filter(data => 
      ['meter', 'm', 'km', 'kilometer', 'cm', 'centimeter'].includes(data.unit)
    );
    
    if (distanceData.length > 0) {
      transportData.distance = distanceData.reduce((sum, data) => sum + data.value, 0);
    }

    // Extract fuel consumption
    const fuelData = numericalData.filter(data => 
      ['liter', 'litre', 'l', 'gallon', 'gal'].includes(data.unit) &&
      (text.includes('transport') || text.includes('shipping') || text.includes('logistics'))
    );
    
    if (fuelData.length > 0) {
      transportData.fuelConsumption = fuelData.reduce((sum, data) => sum + data.value, 0);
    }

    // Detect transport mode
    if (text.includes('air') || text.includes('flight')) transportData.mode = 'air';
    else if (text.includes('sea') || text.includes('ship')) transportData.mode = 'sea';
    else if (text.includes('rail') || text.includes('train')) transportData.mode = 'rail';

    return transportData;
  }

  async extractWasteData(text, numericalData) {
    const wasteData = {
      solid: { quantity: 0, cost: 0 },
      hazardous: { quantity: 0, cost: 0 },
      totalCost: 0
    };

    // Extract waste quantities
    const wasteData_nums = numericalData.filter(data => 
      ['kg', 'kilogram', 'gram', 'g', 'ton', 'tonne', 'mt'].includes(data.unit) &&
      (text.includes('waste') || text.includes('garbage') || text.includes('trash'))
    );
    
    if (wasteData_nums.length > 0) {
      wasteData.solid.quantity = wasteData_nums.reduce((sum, data) => sum + data.value, 0);
    }

    // Detect hazardous waste
    if (text.includes('hazardous') || text.includes('toxic') || text.includes('chemical')) {
      wasteData.hazardous.quantity = wasteData.solid.quantity * 0.1; // Assume 10% is hazardous
    }

    return wasteData;
  }

  async extractWaterData(text, numericalData) {
    const waterData = {
      consumption: 0,
      cost: 0,
      treatment: false
    };

    // Extract water consumption
    const waterData_nums = numericalData.filter(data => 
      ['liter', 'litre', 'l', 'ml', 'gallon', 'gal'].includes(data.unit) &&
      text.includes('water')
    );
    
    if (waterData_nums.length > 0) {
      waterData.consumption = waterData_nums.reduce((sum, data) => sum + data.value, 0);
    }

    // Detect water treatment
    if (text.includes('treatment') || text.includes('wastewater')) {
      waterData.treatment = true;
    }

    return waterData;
  }

  identifyBusinessActivities(text) {
    const activities = [];
    
    Object.entries(this.businessActivities).forEach(([activity, keywords]) => {
      const matches = keywords.filter(keyword => text.includes(keyword));
      if (matches.length > 0) {
        activities.push({
          type: activity,
          confidence: matches.length / keywords.length,
          matchedKeywords: matches
        });
      }
    });

    return activities;
  }

  generateInsights(extractedData) {
    const insights = [];
    
    // Energy insights
    if (extractedData.energy.electricity.consumption > 0) {
      insights.push(`High electricity consumption detected: ${extractedData.energy.electricity.consumption} kWh`);
    }
    
    if (extractedData.energy.renewable.percentage > 0) {
      insights.push(`Renewable energy usage detected: ${extractedData.energy.renewable.percentage}% ${extractedData.energy.renewable.type}`);
    }
    
    // Material insights
    if (extractedData.materials.rawMaterials.quantity > 0) {
      insights.push(`Raw material consumption: ${extractedData.materials.rawMaterials.quantity} units of ${extractedData.materials.rawMaterials.type}`);
    }
    
    // Transportation insights
    if (extractedData.transportation.distance > 0) {
      insights.push(`Transportation distance: ${extractedData.transportation.distance} km via ${extractedData.transportation.mode}`);
    }
    
    // Waste insights
    if (extractedData.waste.solid.quantity > 0) {
      insights.push(`Waste generation: ${extractedData.waste.solid.quantity} kg`);
    }
    
    if (extractedData.waste.hazardous.quantity > 0) {
      insights.push(`Hazardous waste detected: ${extractedData.waste.hazardous.quantity} kg`);
    }
    
    return insights;
  }

  generateRecommendations(extractedData) {
    const recommendations = [];
    
    // Energy recommendations
    if (extractedData.energy.electricity.consumption > 1000) {
      recommendations.push('Consider implementing energy efficiency measures to reduce electricity consumption');
    }
    
    if (extractedData.energy.renewable.percentage < 20) {
      recommendations.push('Explore renewable energy options to reduce carbon footprint');
    }
    
    // Material recommendations
    if (extractedData.materials.rawMaterials.quantity > 1000) {
      recommendations.push('Consider sustainable material sourcing and circular economy practices');
    }
    
    // Transportation recommendations
    if (extractedData.transportation.distance > 100) {
      recommendations.push('Optimize logistics and consider local suppliers to reduce transportation emissions');
    }
    
    // Waste recommendations
    if (extractedData.waste.solid.quantity > 100) {
      recommendations.push('Implement waste reduction and recycling programs');
    }
    
    if (extractedData.waste.hazardous.quantity > 0) {
      recommendations.push('Ensure proper hazardous waste disposal and consider alternatives');
    }
    
    return recommendations;
  }

  async processSMSData(smsData) {
    try {
      const results = [];
      
      for (const sms of smsData) {
        const analysis = await this.extractCarbonDataFromText(sms.message, 'sms');
        results.push({
          smsId: sms.id,
          phoneNumber: sms.phoneNumber,
          timestamp: sms.timestamp,
          analysis
        });
      }
      
      return results;
    } catch (error) {
      logger.error('Error processing SMS data:', error);
      throw error;
    }
  }

  async processEmailData(emailData) {
    try {
      const results = [];
      
      for (const email of emailData) {
        const analysis = await this.extractCarbonDataFromText(email.content, 'email');
        results.push({
          emailId: email.id,
          sender: email.sender,
          subject: email.subject,
          timestamp: email.timestamp,
          analysis
        });
      }
      
      return results;
    } catch (error) {
      logger.error('Error processing email data:', error);
      throw error;
    }
  }
}

module.exports = AIDataExtractionService;
