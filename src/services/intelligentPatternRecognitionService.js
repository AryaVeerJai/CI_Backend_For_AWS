const natural = require('natural');
const compromise = require('compromise');
const logger = require('../utils/logger');

class IntelligentPatternRecognitionService {
  constructor() {
    this.tokenizer = new natural.WordTokenizer();
    this.stemmer = natural.PorterStemmer;
    this.classifier = new natural.BayesClassifier();
    this.sentimentAnalyzer = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'pattern');
    
    // Advanced business activity patterns
    this.businessPatterns = {
      manufacturing: {
        production: [
          'production', 'manufacturing', 'assembly', 'fabrication', 'processing',
          'production line', 'factory', 'plant', 'workshop', 'machining',
          'cutting', 'welding', 'molding', 'casting', 'forging'
        ],
        quality: [
          'quality control', 'inspection', 'testing', 'certification',
          'quality assurance', 'defect', 'rework', 'scrap'
        ],
        maintenance: [
          'maintenance', 'repair', 'service', 'overhaul', 'calibration',
          'equipment maintenance', 'machine repair', 'preventive maintenance'
        ]
      },
      sales: {
        orders: [
          'order', 'sales order', 'customer order', 'purchase order',
          'booking', 'reservation', 'contract', 'agreement'
        ],
        delivery: [
          'delivery', 'shipment', 'dispatch', 'shipping', 'logistics',
          'transportation', 'freight', 'cargo', 'consignment'
        ],
        payment: [
          'payment', 'invoice', 'billing', 'receipt', 'collection',
          'payment received', 'payment made', 'transaction'
        ]
      },
      procurement: {
        purchasing: [
          'purchase', 'procurement', 'buying', 'acquisition', 'sourcing',
          'vendor selection', 'supplier', 'procurement order'
        ],
        inventory: [
          'inventory', 'stock', 'warehouse', 'storage', 'supply',
          'raw materials', 'components', 'parts', 'materials'
        ],
        supplier: [
          'supplier', 'vendor', 'contractor', 'partner', 'distributor',
          'supplier payment', 'vendor management'
        ]
      },
      finance: {
        expenses: [
          'expense', 'cost', 'expenditure', 'outlay', 'spending',
          'operating expense', 'overhead', 'cost center'
        ],
        investment: [
          'investment', 'capital expenditure', 'capex', 'asset',
          'equipment purchase', 'infrastructure', 'upgrade'
        ],
        revenue: [
          'revenue', 'income', 'sales', 'earnings', 'profit',
          'turnover', 'gross revenue', 'net revenue'
        ]
      },
      operations: {
        logistics: [
          'logistics', 'supply chain', 'distribution', 'warehousing',
          'inventory management', 'order fulfillment'
        ],
        hr: [
          'employee', 'staff', 'personnel', 'hiring', 'training',
          'payroll', 'benefits', 'attendance', 'leave'
        ],
        compliance: [
          'compliance', 'regulation', 'audit', 'certification',
          'license', 'permit', 'inspection', 'documentation'
        ]
      }
    };

    // Carbon-intensive activity patterns
    this.carbonIntensivePatterns = {
      highEnergy: [
        'heavy machinery', 'industrial equipment', 'furnace', 'boiler',
        'compressor', 'motor', 'generator', 'heating', 'cooling',
        'air conditioning', 'refrigeration'
      ],
      highMaterial: [
        'steel production', 'metal working', 'chemical processing',
        'textile manufacturing', 'paper production', 'plastic molding',
        'concrete mixing', 'cement production'
      ],
      highTransport: [
        'long distance shipping', 'air freight', 'heavy vehicle',
        'fleet operations', 'logistics', 'supply chain',
        'international trade', 'import', 'export'
      ],
      highWaste: [
        'waste generation', 'scrap material', 'hazardous waste',
        'chemical waste', 'industrial waste', 'disposal',
        'landfill', 'incineration'
      ]
    };

    // Industry-specific patterns
    this.industryPatterns = {
      textile: [
        'fabric', 'yarn', 'dyeing', 'weaving', 'knitting',
        'garment', 'clothing', 'textile processing'
      ],
      food: [
        'food processing', 'packaging', 'preservation', 'cooking',
        'baking', 'freezing', 'canning', 'bottling'
      ],
      chemicals: [
        'chemical reaction', 'synthesis', 'distillation', 'extraction',
        'polymerization', 'catalysis', 'chemical processing'
      ],
      electronics: [
        'circuit board', 'semiconductor', 'assembly', 'testing',
        'electronic components', 'pcb', 'microchip'
      ],
      automotive: [
        'vehicle assembly', 'engine', 'transmission', 'brake',
        'automotive parts', 'car manufacturing'
      ],
      construction: [
        'construction', 'building', 'cement', 'concrete', 'steel',
        'excavation', 'foundation', 'roofing'
      ]
    };

    // Initialize ML models
    this.initializeMLModels();
  }

  initializeMLModels() {
    // Train business activity classifier
    const trainingData = [];
    
    Object.entries(this.businessPatterns).forEach(([category, subcategories]) => {
      Object.entries(subcategories).forEach(([subcategory, patterns]) => {
        patterns.forEach(pattern => {
          trainingData.push({
            text: pattern,
            category: `${category}_${subcategory}`
          });
        });
      });
    });

    trainingData.forEach(item => {
      this.classifier.addDocument(item.text, item.category);
    });

    this.classifier.train();
  }

  async analyzeBusinessActivity(text, source = 'unknown') {
    try {
      const analysis = {
        source,
        timestamp: new Date(),
        activities: [],
        carbonIntensity: 'low',
        industryIndicators: [],
        confidence: 0,
        insights: [],
        recommendations: []
      };

      // Preprocess text
      const cleanedText = this.preprocessText(text);
      
      // Extract business activities
      analysis.activities = await this.extractBusinessActivities(cleanedText);
      
      // Analyze carbon intensity
      analysis.carbonIntensity = this.analyzeCarbonIntensity(cleanedText);
      
      // Identify industry indicators
      analysis.industryIndicators = this.identifyIndustryIndicators(cleanedText);
      
      // Calculate confidence score
      analysis.confidence = this.calculateConfidence(analysis.activities, analysis.carbonIntensity);
      
      // Generate insights
      analysis.insights = this.generateActivityInsights(analysis);
      
      // Generate recommendations
      analysis.recommendations = this.generateActivityRecommendations(analysis);

      return analysis;

    } catch (error) {
      logger.error('Error in analyzeBusinessActivity:', error);
      throw error;
    }
  }

  preprocessText(text) {
    // Convert to lowercase
    let processed = text.toLowerCase();
    
    // Remove special characters but keep important punctuation
    processed = processed.replace(/[^\w\s\d\.\-\+\/\%\&]/g, ' ');
    
    // Normalize whitespace
    processed = processed.replace(/\s+/g, ' ').trim();
    
    return processed;
  }

  async extractBusinessActivities(text) {
    const activities = [];
    
    // Classify text using ML model
    const classification = this.classifier.classify(text);
    const classifications = this.classifier.getClassifications(text);
    
    // Extract activities based on patterns
    Object.entries(this.businessPatterns).forEach(([category, subcategories]) => {
      Object.entries(subcategories).forEach(([subcategory, patterns]) => {
        const matches = patterns.filter(pattern => text.includes(pattern));
        if (matches.length > 0) {
          activities.push({
            category,
            subcategory,
            confidence: matches.length / patterns.length,
            matchedPatterns: matches,
            mlConfidence: classifications.find(c => c.label === `${category}_${subcategory}`)?.value || 0
          });
        }
      });
    });

    // Sort by confidence
    activities.sort((a, b) => (b.confidence + b.mlConfidence) - (a.confidence + a.mlConfidence));

    return activities;
  }

  analyzeCarbonIntensity(text) {
    let intensityScore = 0;
    let totalMatches = 0;

    // Check for carbon-intensive patterns
    Object.entries(this.carbonIntensivePatterns).forEach(([category, patterns]) => {
      patterns.forEach(pattern => {
        if (text.includes(pattern)) {
          intensityScore += 1;
          totalMatches += 1;
        }
      });
    });

    // Check for energy-intensive keywords
    const energyKeywords = ['electricity', 'power', 'energy', 'fuel', 'diesel', 'petrol', 'coal'];
    energyKeywords.forEach(keyword => {
      if (text.includes(keyword)) {
        intensityScore += 0.5;
        totalMatches += 1;
      }
    });

    // Check for material-intensive keywords
    const materialKeywords = ['steel', 'aluminum', 'plastic', 'concrete', 'cement', 'chemical'];
    materialKeywords.forEach(keyword => {
      if (text.includes(keyword)) {
        intensityScore += 0.5;
        totalMatches += 1;
      }
    });

    const averageScore = totalMatches > 0 ? intensityScore / totalMatches : 0;

    if (averageScore >= 0.7) return 'high';
    if (averageScore >= 0.4) return 'medium';
    return 'low';
  }

  identifyIndustryIndicators(text) {
    const indicators = [];

    Object.entries(this.industryPatterns).forEach(([industry, patterns]) => {
      const matches = patterns.filter(pattern => text.includes(pattern));
      if (matches.length > 0) {
        indicators.push({
          industry,
          confidence: matches.length / patterns.length,
          matchedPatterns: matches
        });
      }
    });

    // Sort by confidence
    indicators.sort((a, b) => b.confidence - a.confidence);

    return indicators;
  }

  calculateConfidence(activities, carbonIntensity) {
    let confidence = 0;

    // Base confidence from activities
    if (activities.length > 0) {
      const avgActivityConfidence = activities.reduce((sum, activity) => 
        sum + (activity.confidence + activity.mlConfidence) / 2, 0) / activities.length;
      confidence += avgActivityConfidence * 0.6;
    }

    // Add confidence from carbon intensity
    if (carbonIntensity === 'high') confidence += 0.3;
    else if (carbonIntensity === 'medium') confidence += 0.2;
    else confidence += 0.1;

    return Math.min(1, confidence);
  }

  generateActivityInsights(analysis) {
    const insights = [];

    // Activity insights
    if (analysis.activities.length > 0) {
      const topActivity = analysis.activities[0];
      insights.push({
        type: 'primary_activity',
        message: `Primary business activity detected: ${topActivity.category} - ${topActivity.subcategory}`,
        confidence: topActivity.confidence
      });
    }

    // Carbon intensity insights
    if (analysis.carbonIntensity === 'high') {
      insights.push({
        type: 'carbon_intensity',
        message: 'High carbon-intensive activities detected. Consider sustainability measures.',
        priority: 'high'
      });
    } else if (analysis.carbonIntensity === 'medium') {
      insights.push({
        type: 'carbon_intensity',
        message: 'Medium carbon-intensive activities detected. Monitor and optimize processes.',
        priority: 'medium'
      });
    }

    // Industry insights
    if (analysis.industryIndicators.length > 0) {
      const topIndustry = analysis.industryIndicators[0];
      insights.push({
        type: 'industry_identification',
        message: `Industry indicators suggest: ${topIndustry.industry}`,
        confidence: topIndustry.confidence
      });
    }

    return insights;
  }

  generateActivityRecommendations(analysis) {
    const recommendations = [];

    // Carbon intensity recommendations
    if (analysis.carbonIntensity === 'high') {
      recommendations.push({
        category: 'sustainability',
        title: 'Implement Carbon Reduction Measures',
        description: 'High carbon-intensive activities detected. Implement energy efficiency and sustainable practices.',
        priority: 'high',
        impact: 'significant'
      });
    }

    // Activity-specific recommendations
    analysis.activities.forEach(activity => {
      if (activity.category === 'manufacturing' && activity.subcategory === 'production') {
        recommendations.push({
          category: 'manufacturing',
          title: 'Optimize Production Processes',
          description: 'Implement lean manufacturing and process optimization to reduce resource consumption.',
          priority: 'medium',
          impact: 'moderate'
        });
      }

      if (activity.category === 'procurement' && activity.subcategory === 'purchasing') {
        recommendations.push({
          category: 'procurement',
          title: 'Sustainable Sourcing',
          description: 'Source materials from sustainable suppliers and implement green procurement practices.',
          priority: 'medium',
          impact: 'moderate'
        });
      }

      if (activity.category === 'sales' && activity.subcategory === 'delivery') {
        recommendations.push({
          category: 'logistics',
          title: 'Optimize Delivery Routes',
          description: 'Optimize delivery routes and consider eco-friendly transportation options.',
          priority: 'low',
          impact: 'moderate'
        });
      }
    });

    return recommendations;
  }

  async analyzeTextPatterns(texts) {
    try {
      const results = [];
      
      for (const text of texts) {
        const analysis = await this.analyzeBusinessActivity(text.content, text.source);
        results.push({
          id: text.id,
          timestamp: text.timestamp,
          analysis
        });
      }

      // Generate aggregated insights
      const aggregatedInsights = this.generateAggregatedInsights(results);
      
      return {
        individualAnalyses: results,
        aggregatedInsights,
        summary: {
          totalTexts: texts.length,
          highCarbonIntensity: results.filter(r => r.analysis.carbonIntensity === 'high').length,
          mediumCarbonIntensity: results.filter(r => r.analysis.carbonIntensity === 'medium').length,
          lowCarbonIntensity: results.filter(r => r.analysis.carbonIntensity === 'low').length,
          averageConfidence: results.reduce((sum, r) => sum + r.analysis.confidence, 0) / results.length
        }
      };

    } catch (error) {
      logger.error('Error in analyzeTextPatterns:', error);
      throw error;
    }
  }

  generateAggregatedInsights(results) {
    const insights = [];

    // Activity frequency analysis
    const activityCounts = {};
    results.forEach(result => {
      result.analysis.activities.forEach(activity => {
        const key = `${activity.category}_${activity.subcategory}`;
        activityCounts[key] = (activityCounts[key] || 0) + 1;
      });
    });

    const topActivities = Object.entries(activityCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3);

    if (topActivities.length > 0) {
      insights.push({
        type: 'activity_frequency',
        message: `Most frequent activities: ${topActivities.map(([activity]) => activity).join(', ')}`,
        priority: 'medium'
      });
    }

    // Carbon intensity trends
    const carbonIntensityCounts = {
      high: results.filter(r => r.analysis.carbonIntensity === 'high').length,
      medium: results.filter(r => r.analysis.carbonIntensity === 'medium').length,
      low: results.filter(r => r.analysis.carbonIntensity === 'low').length
    };

    if (carbonIntensityCounts.high > results.length * 0.3) {
      insights.push({
        type: 'carbon_trend',
        message: 'High frequency of carbon-intensive activities detected across multiple communications.',
        priority: 'high'
      });
    }

    // Industry identification
    const industryCounts = {};
    results.forEach(result => {
      result.analysis.industryIndicators.forEach(indicator => {
        industryCounts[indicator.industry] = (industryCounts[indicator.industry] || 0) + 1;
      });
    });

    const topIndustry = Object.entries(industryCounts)
      .sort(([,a], [,b]) => b - a)[0];

    if (topIndustry) {
      insights.push({
        type: 'industry_identification',
        message: `Strong industry indicators for: ${topIndustry[0]}`,
        confidence: topIndustry[1] / results.length,
        priority: 'medium'
      });
    }

    return insights;
  }

  async detectAnomalies(historicalData, currentData) {
    try {
      const anomalies = [];

      // Compare activity patterns
      const historicalActivities = this.getActivityPatterns(historicalData);
      const currentActivities = this.getActivityPatterns([currentData]);

      // Detect new activity patterns
      currentActivities.forEach(activity => {
        if (!historicalActivities.includes(activity)) {
          anomalies.push({
            type: 'new_activity',
            message: `New activity pattern detected: ${activity}`,
            severity: 'medium',
            confidence: 0.8
          });
        }
      });

      // Detect carbon intensity changes
      const historicalCarbonIntensity = this.getAverageCarbonIntensity(historicalData);
      const currentCarbonIntensity = this.getCarbonIntensityScore(currentData.carbonIntensity);

      if (Math.abs(currentCarbonIntensity - historicalCarbonIntensity) > 0.3) {
        anomalies.push({
          type: 'carbon_intensity_change',
          message: `Significant change in carbon intensity detected`,
          severity: 'high',
          confidence: 0.9,
          change: currentCarbonIntensity - historicalCarbonIntensity
        });
      }

      return anomalies;

    } catch (error) {
      logger.error('Error in detectAnomalies:', error);
      throw error;
    }
  }

  getActivityPatterns(data) {
    const patterns = [];
    data.forEach(item => {
      if (item.analysis && item.analysis.activities) {
        item.analysis.activities.forEach(activity => {
          patterns.push(`${activity.category}_${activity.subcategory}`);
        });
      }
    });
    return [...new Set(patterns)];
  }

  getAverageCarbonIntensity(data) {
    const intensityScores = data.map(item => this.getCarbonIntensityScore(item.analysis?.carbonIntensity || 'low'));
    return intensityScores.reduce((sum, score) => sum + score, 0) / intensityScores.length;
  }

  getCarbonIntensityScore(intensity) {
    switch (intensity) {
      case 'high': return 1.0;
      case 'medium': return 0.5;
      case 'low': return 0.0;
      default: return 0.0;
    }
  }
}

module.exports = IntelligentPatternRecognitionService;
