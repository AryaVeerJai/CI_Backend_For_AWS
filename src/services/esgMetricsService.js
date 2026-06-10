const ESGAnalyzerAgent = require('./agents/esgAnalyzerAgent');
const logger = require('../utils/logger');
const carbonCategoryTaxonomy = require('../../../shared/carbonCategoryTaxonomy');

class ESGMetricsService {
  constructor() {
    this.esgAnalyzer = ESGAnalyzerAgent;
    this.metricsCache = new Map();
    this.cacheExpiry = 30 * 60 * 1000; // 30 minutes
    this.defaultDataSourceMode = 'standard';
    this.dataSourceDisclaimers = {
      documents: 'Uploaded sustainability documents are the default ESG data source and are used to derive carbon insights.',
      sms: 'Advanced-only source: mobile application SMS messages are analysed only after the user accepts the in-app disclaimer and grants explicit consent.',
      email: 'Advanced-only source: email ingestion requires mailbox access consent and a privacy disclaimer advising users to avoid personal data.'
    };
  }

  async calculateComprehensiveESGMetrics(msmeId, options = {}) {
    try {
      const {
        dataSourceMode = this.defaultDataSourceMode,
        includeSMSData,
        includeTransactionData = true,
        includeDocumentData,
        includeEmailData,
        timeRange = '12months',
        granularity = 'monthly'
      } = options;

      const useDocuments = includeDocumentData ?? true;
      const useSMS = includeSMSData ?? (dataSourceMode === 'advanced');
      const useEmails = includeEmailData ?? (dataSourceMode === 'advanced');
      const useTransactionData = includeTransactionData;

      const msmeData = await this.getMSMEData(msmeId);
      if (!msmeData) {
        throw new Error('MSME not found');
      }

      const baseTransactions = [];
      let emailSourceRecords = [];

      if (useTransactionData) {
        const rawTransactions = await this.getTransactionData(msmeId, timeRange);

        rawTransactions.forEach(rawTransaction => {
          const normalized = this.normalizeTransactionForAnalysis(rawTransaction);

          if (normalized.source === 'sms') {
            return;
          }

          if (!useEmails && normalized.source === 'email') {
            return;
          }

          if (useEmails && normalized.source === 'email') {
            emailSourceRecords.push(normalized);
            return;
          }

          baseTransactions.push(normalized);
        });
      }

      if (useEmails && emailSourceRecords.length === 0) {
        const emailData = await this.getEmailData(msmeId, timeRange);
        emailSourceRecords = emailData.map(email => 
          this.normalizeTransactionForAnalysis(email, { dataSource: 'email' })
        );
      }

      const emailTransactions = useEmails
        ? emailSourceRecords.map(tx =>
            this.normalizeTransactionForAnalysis(tx, {
              dataSource: 'email',
              disclaimer: this.dataSourceDisclaimers.email,
              consentRequired: true
            })
          )
        : [];

      const documentRecords = useDocuments
        ? await this.getDocumentData(msmeId, timeRange)
        : [];

      const documentTransactions = useDocuments
        ? this.transformDocumentsToTransactions(documentRecords)
        : [];

      const smsData = useSMS
        ? await this.getSMSData(msmeId, timeRange)
        : [];

      const aggregatedTransactions = [
        ...baseTransactions,
        ...documentTransactions,
        ...emailTransactions
      ];

      const esgMetrics = await this.esgAnalyzer.analyzeESGMetrics(
        msmeData,
        aggregatedTransactions,
        smsData
      );

      const timeSeriesMetrics = await this.calculateTimeSeriesMetrics(
        msmeId,
        timeRange,
        granularity,
        {
          transactions: aggregatedTransactions,
          smsData
        }
      );

      const benchmarking = await this.calculateBenchmarking(esgMetrics, msmeData);
      const predictions = await this.calculatePredictiveAnalytics(esgMetrics, timeSeriesMetrics);

      const dataSourcesSummary = this.buildDataSourcesSummary(dataSourceMode, {
        documents: {
          included: useDocuments,
          records: documentTransactions.length,
          uploads: documentRecords.length
        },
        sms: {
          included: useSMS,
          messages: smsData.length
        },
        emails: {
          included: useEmails,
          records: emailTransactions.length
        },
        transactions: {
          included: useTransactionData,
          records: baseTransactions.length
        }
      });

      const comprehensiveReport = {
        msmeId,
        generatedAt: new Date().toISOString(),
        timeRange,
        granularity,
        dataSourceMode,
        advancedSourcesEnabled: dataSourceMode === 'advanced',
        aggregatedTransactionCount: aggregatedTransactions.length,
        esgMetrics,
        timeSeriesMetrics,
        benchmarking,
        predictions,
        dataSources: dataSourcesSummary,
        confidence: this.calculateOverallConfidence(esgMetrics, aggregatedTransactions, smsData)
      };

      this.cacheResults(msmeId, comprehensiveReport);

      return comprehensiveReport;
    } catch (error) {
      logger.error('Error calculating comprehensive ESG metrics:', error);
      throw error;
    }
  }

  async getMSMEData(msmeId) {
    try {
      const MSME = require('../models/MSME');
      const msme = await MSME.findById(msmeId);
      
      if (!msme) {
        return null;
      }

      // Enhance MSME data with additional fields if needed
      return {
        ...msme.toObject(),
        employeeCount: msme.employeeCount || 0,
        annualRevenue: msme.annualRevenue || 0,
        industry: msme.industry || 'Manufacturing',
        location: msme.location || 'India',
        environmentalCompliance: msme.environmentalCompliance || {},
        socialInitiatives: msme.socialInitiatives || {},
        governance: msme.governance || {},
        humanRights: msme.humanRights || {},
        dataGovernance: msme.dataGovernance || {},
        diversityMetrics: msme.diversityMetrics || {},
        productSafety: msme.productSafety || {}
      };
    } catch (error) {
      logger.error('Error getting MSME data:', error);
      throw error;
    }
  }

  async getTransactionData(msmeId, timeRange) {
    try {
      const Transaction = require('../models/Transaction');
      
      const startDate = this.calculateStartDate(timeRange);
      const endDate = new Date();

      const transactions = await Transaction.find({
        msmeId,
        date: { $gte: startDate, $lte: endDate }
      }).sort({ date: -1 });

      return transactions;
    } catch (error) {
      logger.error('Error getting transaction data:', error);
      throw error;
    }
  }

  async getSMSData(msmeId, timeRange) {
    try {
      const Transaction = require('../models/Transaction');
      const startDate = this.calculateStartDate(timeRange);
      const endDate = new Date();

      const smsTransactions = await Transaction.find({
        msmeId,
        source: 'sms',
        date: { $gte: startDate, $lte: endDate },
        isSpam: { $ne: true },
        isDuplicate: { $ne: true }
      }).sort({ date: -1 });

      return smsTransactions.map((txn) => {
        const plain = typeof txn.toObject === 'function' ? txn.toObject() : txn;
        const txnDate = plain.date || plain.createdAt || new Date();
        const co2 = Number(plain.carbonFootprint?.co2Emissions) || 0;

        return {
          id: String(plain._id || plain.sourceId || ''),
          msmeId,
          body: plain.metadata?.originalText || plain.description || '',
          sender: plain.vendor || plain.metadata?.sender || 'unknown',
          timestamp: new Date(txnDate).toISOString(),
          processedData: {
            transaction: {
              type: plain.type || 'expense',
              amount: plain.amount,
              currency: plain.currency || 'INR',
              category: plain.category,
              subcategory: plain.subcategory,
              description: plain.description,
              date: txnDate
            },
            sentiment: Number(plain.metadata?.sentiment) || 0,
            carbonRelevance: Number(plain.metadata?.confidence) || (co2 > 0 ? 0.8 : 0.5)
          }
        };
      });
    } catch (error) {
      logger.error('Error getting SMS data:', error);
      throw error;
    }
  }

  async getDocumentData(msmeId, timeRange) {
    try {
      const Document = require('../models/Document');
      
      const startDate = this.calculateStartDate(timeRange);
      const endDate = new Date();

      const documents = await Document.find({
        msmeId,
        status: 'processed',
        uploadedAt: { $gte: startDate, $lte: endDate },
        category: { $in: ['environmental', 'social', 'governance', 'compliance'] }
      }).sort({ uploadedAt: -1 });

      return documents;
    } catch (error) {
      logger.error('Error getting document data:', error);
      throw error;
    }
  }

  async getEmailData(msmeId, timeRange) {
    try {
      const Transaction = require('../models/Transaction');

      const startDate = this.calculateStartDate(timeRange);
      const endDate = new Date();

      const emailTransactions = await Transaction.find({
        msmeId,
        source: 'email',
        isSpam: { $ne: true },
        isDuplicate: { $ne: true },
        date: { $gte: startDate, $lte: endDate }
      }).sort({ date: -1 });

      return emailTransactions;
    } catch (error) {
      logger.error('Error getting email data:', error);
      throw error;
    }
  }

  calculateStartDate(timeRange) {
    const now = new Date();
    switch (timeRange) {
      case '1month':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case '3months':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      case '6months':
        return new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
      case '12months':
        return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      case '2years':
        return new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    }
  }

  async calculateTimeSeriesMetrics(msmeId, timeRange, granularity, sourceData = {}) {
    try {
      const msmeData = await this.getMSMEData(msmeId);

      const transactionsInput = Array.isArray(sourceData.transactions)
        ? sourceData.transactions
        : await this.getTransactionData(msmeId, timeRange);

      const smsDataInput = Array.isArray(sourceData.smsData)
        ? sourceData.smsData
        : await this.getSMSData(msmeId, timeRange);

      const transactions = transactionsInput.map(transaction => {
        const plainTransaction = transaction && typeof transaction.toObject === 'function'
          ? transaction.toObject()
          : { ...transaction };
        const normalized = { ...plainTransaction };
        normalized.date = normalized.date ? new Date(normalized.date) : new Date();
        return normalized;
      });

      const smsData = smsDataInput.map(sms => {
        if (!sms || typeof sms !== 'object') {
          return sms;
        }

        const plainSMS = typeof sms.toObject === 'function' ? sms.toObject() : sms;
        const normalized = { ...plainSMS };
        if (normalized.timestamp) {
          normalized.timestamp = new Date(normalized.timestamp).toISOString();
        }
        return normalized;
      });

      const timeSeries = {
        environmental: [],
        social: [],
        governance: [],
        overall: []
      };

      // Group data by time periods
      const periods = this.createTimePeriods(timeRange, granularity);
      
      for (const period of periods) {
        const periodTransactions = transactions.filter(t => 
          new Date(t.date) >= period.start && new Date(t.date) <= period.end
        );
        
        const periodSMS = smsData.filter(sms => 
          new Date(sms.timestamp) >= period.start && new Date(sms.timestamp) <= period.end
        );

        // Calculate ESG metrics for this period
        const periodESG = await this.calculatePeriodESGMetrics(
          periodTransactions,
          periodSMS,
          period,
          msmeData
        );

        timeSeries.environmental.push({
          period: period.label,
          startDate: period.start,
          endDate: period.end,
          metrics: periodESG.environmental
        });

        timeSeries.social.push({
          period: period.label,
          startDate: period.start,
          endDate: period.end,
          metrics: periodESG.social
        });

        timeSeries.governance.push({
          period: period.label,
          startDate: period.start,
          endDate: period.end,
          metrics: periodESG.governance
        });

        timeSeries.overall.push({
          period: period.label,
          startDate: period.start,
          endDate: period.end,
          score: periodESG.overall.score,
          grade: periodESG.overall.grade
        });
      }

      return timeSeries;
    } catch (error) {
      logger.error('Error calculating time series metrics:', error);
      throw error;
    }
  }

  createTimePeriods(timeRange, granularity) {
    const periods = [];
    const now = new Date();
    const startDate = this.calculateStartDate(timeRange);
    
    let currentDate = new Date(startDate);
    let periodIndex = 1;

    while (currentDate < now) {
      let periodEnd;
      
      switch (granularity) {
        case 'daily':
          periodEnd = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
          break;
        case 'weekly':
          periodEnd = new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000);
          break;
        case 'monthly':
          periodEnd = new Date(currentDate);
          periodEnd.setMonth(periodEnd.getMonth() + 1);
          break;
        case 'quarterly':
          periodEnd = new Date(currentDate);
          periodEnd.setMonth(periodEnd.getMonth() + 3);
          break;
        default:
          periodEnd = new Date(currentDate);
          periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      if (periodEnd > now) {
        periodEnd = now;
      }

      periods.push({
        label: this.formatPeriodLabel(currentDate, granularity, periodIndex),
        start: new Date(currentDate),
        end: new Date(periodEnd)
      });

      currentDate = new Date(periodEnd);
      periodIndex++;
    }

    return periods;
  }

  formatPeriodLabel(date, granularity, index) {
    switch (granularity) {
      case 'daily':
        return `Day ${index}`;
      case 'weekly':
        return `Week ${index}`;
      case 'monthly':
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      case 'quarterly': {
        const quarter = Math.ceil((date.getMonth() + 1) / 3);
        return `Q${quarter} ${date.getFullYear()}`;
      }
      default:
        return `Period ${index}`;
    }
  }

  async calculatePeriodESGMetrics(transactions, smsData, period, msmeData) {
    try {
      if (!msmeData) {
        return {
          environmental: { score: 0 },
          social: { score: 0 },
          governance: { score: 0 },
          overall: { score: 0, grade: 'F' }
        };
      }

      const esgMetrics = await this.esgAnalyzer.analyzeESGMetrics(
        msmeData,
        transactions,
        smsData
      );

      return esgMetrics;
    } catch (error) {
      logger.error('Error calculating period ESG metrics:', error);
      return {
        environmental: { score: 0 },
        social: { score: 0 },
        governance: { score: 0 },
        overall: { score: 0, grade: 'F' }
      };
    }
  }

  async calculateBenchmarking(esgMetrics, msmeData) {
    try {
      const industry = msmeData.industry || 'Manufacturing';
      const size = this.categorizeMSMESize(msmeData.employeeCount || 0);
      const region = msmeData.location || 'India';

      // Get industry benchmarks (in a real implementation, this would come from a database)
      const industryBenchmarks = this.getIndustryBenchmarks(industry);
      const sizeBenchmarks = this.getSizeBenchmarks(size);
      const regionalBenchmarks = this.getRegionalBenchmarks(region);

      const benchmarking = {
        industry: {
          average: industryBenchmarks,
          msmeScore: esgMetrics.overall.score,
          percentile: this.calculatePercentile(esgMetrics.overall.score, industryBenchmarks),
          performance: this.assessPerformance(esgMetrics.overall.score, industryBenchmarks)
        },
        size: {
          average: sizeBenchmarks,
          msmeScore: esgMetrics.overall.score,
          percentile: this.calculatePercentile(esgMetrics.overall.score, sizeBenchmarks),
          performance: this.assessPerformance(esgMetrics.overall.score, sizeBenchmarks)
        },
        regional: {
          average: regionalBenchmarks,
          msmeScore: esgMetrics.overall.score,
          percentile: this.calculatePercentile(esgMetrics.overall.score, regionalBenchmarks),
          performance: this.assessPerformance(esgMetrics.overall.score, regionalBenchmarks)
        },
        recommendations: this.generateBenchmarkingRecommendations(esgMetrics, {
          industry: industryBenchmarks,
          size: sizeBenchmarks,
          regional: regionalBenchmarks
        })
      };

      return benchmarking;
    } catch (error) {
      logger.error('Error calculating benchmarking:', error);
      throw error;
    }
  }

  categorizeMSMESize(employeeCount) {
    if (employeeCount <= 10) return 'Micro';
    if (employeeCount <= 50) return 'Small';
    if (employeeCount <= 250) return 'Medium';
    return 'Large';
  }

  getIndustryBenchmarks(industry) {
    // Mock industry benchmarks - in real implementation, this would come from a database
    const benchmarks = {
      'Manufacturing': { environmental: 65, social: 70, governance: 75, overall: 70 },
      'Technology': { environmental: 80, social: 85, governance: 90, overall: 85 },
      'Agriculture': { environmental: 60, social: 65, governance: 60, overall: 62 },
      'Construction': { environmental: 55, social: 60, governance: 65, overall: 60 },
      'Textiles': { environmental: 50, social: 55, governance: 60, overall: 55 }
    };

    return benchmarks[industry] || { environmental: 65, social: 70, governance: 75, overall: 70 };
  }

  getSizeBenchmarks(size) {
    const benchmarks = {
      'Micro': { environmental: 60, social: 65, governance: 70, overall: 65 },
      'Small': { environmental: 65, social: 70, governance: 75, overall: 70 },
      'Medium': { environmental: 70, social: 75, governance: 80, overall: 75 },
      'Large': { environmental: 75, social: 80, governance: 85, overall: 80 }
    };

    return benchmarks[size] || { environmental: 65, social: 70, governance: 75, overall: 70 };
  }

  getRegionalBenchmarks(region) {
    const benchmarks = {
      'India': { environmental: 60, social: 65, governance: 70, overall: 65 },
      'USA': { environmental: 75, social: 80, governance: 85, overall: 80 },
      'Europe': { environmental: 80, social: 85, governance: 90, overall: 85 },
      'Asia': { environmental: 65, social: 70, governance: 75, overall: 70 }
    };

    return benchmarks[region] || { environmental: 65, social: 70, governance: 75, overall: 70 };
  }

  calculatePercentile(score, benchmarks) {
    const average = benchmarks.overall;
    if (score >= average) {
      return Math.min(100, 50 + ((score - average) / average) * 50);
    } else {
      return Math.max(0, 50 - ((average - score) / average) * 50);
    }
  }

  assessPerformance(score, benchmarks) {
    const average = benchmarks.overall;
    const difference = score - average;
    const percentageDifference = (difference / average) * 100;

    if (percentageDifference >= 20) return 'Excellent';
    if (percentageDifference >= 10) return 'Above Average';
    if (percentageDifference >= -10) return 'Average';
    if (percentageDifference >= -20) return 'Below Average';
    return 'Poor';
  }

  generateBenchmarkingRecommendations(esgMetrics, benchmarks) {
    const recommendations = [];

    // Environmental recommendations
    if (esgMetrics.environmental.score < benchmarks.industry.environmental) {
      recommendations.push({
        category: 'Environmental',
        priority: 'High',
        title: 'Improve Environmental Performance',
        description: `Your environmental score (${esgMetrics.environmental.score}) is below industry average (${benchmarks.industry.environmental})`,
        action: 'Focus on reducing carbon emissions and improving resource efficiency'
      });
    }

    // Social recommendations
    if (esgMetrics.social.score < benchmarks.industry.social) {
      recommendations.push({
        category: 'Social',
        priority: 'Medium',
        title: 'Enhance Social Practices',
        description: `Your social score (${esgMetrics.social.score}) is below industry average (${benchmarks.industry.social})`,
        action: 'Improve labor practices and community engagement'
      });
    }

    // Governance recommendations
    if (esgMetrics.governance.score < benchmarks.industry.governance) {
      recommendations.push({
        category: 'Governance',
        priority: 'High',
        title: 'Strengthen Governance Framework',
        description: `Your governance score (${esgMetrics.governance.score}) is below industry average (${benchmarks.industry.governance})`,
        action: 'Implement better risk management and stakeholder engagement'
      });
    }

    return recommendations;
  }

  async calculatePredictiveAnalytics(esgMetrics, timeSeriesMetrics) {
    try {
      const predictions = {
        environmental: this.predictEnvironmentalTrend(esgMetrics, timeSeriesMetrics),
        social: this.predictSocialTrend(esgMetrics, timeSeriesMetrics),
        governance: this.predictGovernanceTrend(esgMetrics, timeSeriesMetrics),
        overall: this.predictOverallTrend(esgMetrics, timeSeriesMetrics),
        risks: this.predictRisks(esgMetrics, timeSeriesMetrics),
        opportunities: this.predictOpportunities(esgMetrics, timeSeriesMetrics)
      };

      return predictions;
    } catch (error) {
      logger.error('Error calculating predictive analytics:', error);
      throw error;
    }
  }

  predictEnvironmentalTrend(esgMetrics, timeSeriesMetrics) {
    const environmentalData = timeSeriesMetrics.environmental;
    
    if (environmentalData.length < 2) {
      return {
        trend: 'stable',
        confidence: 0.5,
        nextPeriodPrediction: esgMetrics.environmental.score,
        description: 'Insufficient data for trend analysis'
      };
    }

    // Simple linear regression for trend prediction
    const scores = environmentalData.map(d => d.metrics.score);
    const trend = this.calculateTrend(scores);
    
    const nextPeriodPrediction = Math.max(0, Math.min(100, 
      esgMetrics.environmental.score + trend * 5 // Predict 5 periods ahead
    ));

    return {
      trend: trend > 0.5 ? 'improving' : trend < -0.5 ? 'declining' : 'stable',
      confidence: Math.min(1, environmentalData.length / 10),
      nextPeriodPrediction: Math.round(nextPeriodPrediction),
      description: this.getTrendDescription(trend, 'environmental')
    };
  }

  predictSocialTrend(esgMetrics, timeSeriesMetrics) {
    const socialData = timeSeriesMetrics.social;
    
    if (socialData.length < 2) {
      return {
        trend: 'stable',
        confidence: 0.5,
        nextPeriodPrediction: esgMetrics.social.score,
        description: 'Insufficient data for trend analysis'
      };
    }

    const scores = socialData.map(d => d.metrics.score);
    const trend = this.calculateTrend(scores);
    
    const nextPeriodPrediction = Math.max(0, Math.min(100, 
      esgMetrics.social.score + trend * 5
    ));

    return {
      trend: trend > 0.5 ? 'improving' : trend < -0.5 ? 'declining' : 'stable',
      confidence: Math.min(1, socialData.length / 10),
      nextPeriodPrediction: Math.round(nextPeriodPrediction),
      description: this.getTrendDescription(trend, 'social')
    };
  }

  predictGovernanceTrend(esgMetrics, timeSeriesMetrics) {
    const governanceData = timeSeriesMetrics.governance;
    
    if (governanceData.length < 2) {
      return {
        trend: 'stable',
        confidence: 0.5,
        nextPeriodPrediction: esgMetrics.governance.score,
        description: 'Insufficient data for trend analysis'
      };
    }

    const scores = governanceData.map(d => d.metrics.score);
    const trend = this.calculateTrend(scores);
    
    const nextPeriodPrediction = Math.max(0, Math.min(100, 
      esgMetrics.governance.score + trend * 5
    ));

    return {
      trend: trend > 0.5 ? 'improving' : trend < -0.5 ? 'declining' : 'stable',
      confidence: Math.min(1, governanceData.length / 10),
      nextPeriodPrediction: Math.round(nextPeriodPrediction),
      description: this.getTrendDescription(trend, 'governance')
    };
  }

  predictOverallTrend(esgMetrics, timeSeriesMetrics) {
    const overallData = timeSeriesMetrics.overall;
    
    if (overallData.length < 2) {
      return {
        trend: 'stable',
        confidence: 0.5,
        nextPeriodPrediction: esgMetrics.overall.score,
        description: 'Insufficient data for trend analysis'
      };
    }

    const scores = overallData.map(d => d.score);
    const trend = this.calculateTrend(scores);
    
    const nextPeriodPrediction = Math.max(0, Math.min(100, 
      esgMetrics.overall.score + trend * 5
    ));

    return {
      trend: trend > 0.5 ? 'improving' : trend < -0.5 ? 'declining' : 'stable',
      confidence: Math.min(1, overallData.length / 10),
      nextPeriodPrediction: Math.round(nextPeriodPrediction),
      description: this.getTrendDescription(trend, 'overall')
    };
  }

  calculateTrend(scores) {
    if (scores.length < 2) return 0;
    
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    const n = scores.length;
    
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += scores[i];
      sumXY += i * scores[i];
      sumXX += i * i;
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return slope;
  }

  getTrendDescription(trend, category) {
    if (trend > 0.5) {
      return `${category.charAt(0).toUpperCase() + category.slice(1)} performance is improving`;
    } else if (trend < -0.5) {
      return `${category.charAt(0).toUpperCase() + category.slice(1)} performance is declining`;
    } else {
      return `${category.charAt(0).toUpperCase() + category.slice(1)} performance is stable`;
    }
  }

  predictRisks(esgMetrics, timeSeriesMetrics) {
    const risks = [];

    // Environmental risks
    if (esgMetrics.environmental.score < 50) {
      risks.push({
        category: 'Environmental',
        severity: 'High',
        probability: 0.8,
        description: 'High risk of environmental non-compliance',
        mitigation: 'Implement environmental management system'
      });
    }

    // Social risks
    if (esgMetrics.social.score < 50) {
      risks.push({
        category: 'Social',
        severity: 'Medium',
        probability: 0.6,
        description: 'Risk of labor disputes and community issues',
        mitigation: 'Improve labor practices and community engagement'
      });
    }

    // Governance risks
    if (esgMetrics.governance.score < 50) {
      risks.push({
        category: 'Governance',
        severity: 'High',
        probability: 0.7,
        description: 'High risk of governance failures',
        mitigation: 'Strengthen governance framework'
      });
    }

    return risks;
  }

  predictOpportunities(esgMetrics, timeSeriesMetrics) {
    const opportunities = [];

    // Environmental opportunities
    if (esgMetrics.environmental.score > 70) {
      opportunities.push({
        category: 'Environmental',
        potential: 'High',
        description: 'Opportunity to become industry leader in sustainability',
        action: 'Leverage environmental performance for competitive advantage'
      });
    }

    // Social opportunities
    if (esgMetrics.social.score > 70) {
      opportunities.push({
        category: 'Social',
        potential: 'Medium',
        description: 'Opportunity to attract top talent and improve retention',
        action: 'Use social performance as recruitment tool'
      });
    }

    // Governance opportunities
    if (esgMetrics.governance.score > 70) {
      opportunities.push({
        category: 'Governance',
        potential: 'High',
        description: 'Opportunity to attract investors and partners',
        action: 'Use governance strength for business development'
      });
    }

    return opportunities;
  }

  buildDataSourcesSummary(mode, summary) {
    return {
      mode,
      defaultSource: 'documents',
      advanced: mode === 'advanced',
      sources: {
        documents: {
          included: summary.documents.included,
          records: summary.documents.records,
          uploads: summary.documents.uploads,
          disclaimer: this.dataSourceDisclaimers.documents
        },
        sms: {
          included: summary.sms.included,
          messages: summary.sms.messages,
          disclaimer: summary.sms.included ? this.dataSourceDisclaimers.sms : undefined,
          consentRequired: summary.sms.included
        },
        emails: {
          included: summary.emails.included,
          records: summary.emails.records,
          disclaimer: summary.emails.included ? this.dataSourceDisclaimers.email : undefined,
          consentRequired: summary.emails.included
        },
        transactions: {
          included: summary.transactions.included,
          records: summary.transactions.records
        }
      },
      breakdown: {
        documents: summary.documents.records,
        documentUploads: summary.documents.uploads,
        smsMessages: summary.sms.messages,
        emailTransactions: summary.emails.records,
        baseTransactions: summary.transactions.records
      }
    };
  }

  transformDocumentsToTransactions(documents = []) {
    return documents
      .filter(doc => doc)
      .map(doc => {
        const plainDoc = doc.toObject ? doc.toObject() : doc;
        const extracted = plainDoc.extractedData || {};
        const category = this.normalizeCategory(extracted.category);
        const subcategory = extracted.subcategory || this.deriveDocumentSubcategory(category, extracted);
        const transactionType = this.mapCategoryToTransactionType(category);

        const baseTransaction = {
          source: 'document',
          dataSource: 'document',
          sourceId: plainDoc._id ? plainDoc._id.toString() : plainDoc.fileName || plainDoc.originalName,
          transactionType,
          amount: Number(extracted.amount) || 0,
          currency: extracted.currency || 'INR',
          description: extracted.description || `Document: ${plainDoc.originalName}`,
          vendor: extracted.vendor || {},
          category,
          subcategory,
          date: extracted.date ? new Date(extracted.date) : new Date(plainDoc.uploadedAt || plainDoc.createdAt || Date.now()),
          carbonFootprint: plainDoc.carbonFootprint && Object.keys(plainDoc.carbonFootprint).length > 0
            ? plainDoc.carbonFootprint
            : {
                co2Emissions: 0,
                emissionFactor: 0,
                calculationMethod: 'document_extraction'
              },
          sustainability: {
            isGreen: (plainDoc.carbonFootprint?.sustainabilityScore || 0) >= 60,
            greenScore: plainDoc.carbonFootprint?.sustainabilityScore || 0,
            sustainabilityFactors: this.extractDocumentSustainabilityFactors(extracted)
          },
          metadata: {
            documentId: plainDoc._id ? plainDoc._id.toString() : undefined,
            documentType: plainDoc.documentType,
            processingConfidence: plainDoc.processingResults?.confidence || 0,
            processingWarnings: plainDoc.processingResults?.warnings || [],
            processingErrors: plainDoc.processingResults?.errors || [],
            extractedData: extracted,
            dataSourceDisclaimer: this.dataSourceDisclaimers.documents
          },
          tags: Array.isArray(plainDoc.tags) ? plainDoc.tags : []
        };

        return this.normalizeTransactionForAnalysis(baseTransaction, { dataSource: 'document' });
      });
  }

  extractDocumentSustainabilityFactors(extracted = {}) {
    const factors = new Set();

    if (Array.isArray(extracted.sustainabilityFactors)) {
      extracted.sustainabilityFactors.filter(Boolean).forEach(factor => factors.add(factor));
    }

    if (Array.isArray(extracted.items)) {
      extracted.items
        .filter(item => item && item.name)
        .forEach(item => factors.add(item.name));
    }

    const description = (extracted.description || '').toLowerCase();
    ['solar', 'wind', 'renewable', 'recycled', 'eco', 'green', 'low carbon', 'carbon neutral'].forEach(keyword => {
      if (description.includes(keyword)) {
        factors.add(keyword);
      }
    });

    return Array.from(factors);
  }

  deriveDocumentSubcategory(category, extracted = {}) {
    if (extracted.subcategory) {
      return extracted.subcategory;
    }

    const description = (extracted.description || '').toLowerCase();

    switch (category) {
      case 'energy':
        if (description.includes('solar') || description.includes('renewable')) return 'renewable';
        if (description.includes('grid') || description.includes('utility')) return 'grid';
        break;
      case 'transportation':
        if (description.includes('diesel')) return 'diesel';
        if (description.includes('petrol')) return 'petrol';
        if (description.includes('cng')) return 'cng';
        break;
      case 'waste_management':
        if (description.includes('hazard')) return 'hazardous';
        if (description.includes('recycl')) return 'recycling';
        break;
      case 'raw_materials':
        if (description.includes('steel')) return 'steel';
        if (description.includes('aluminum')) return 'aluminum';
        if (description.includes('plastic')) return 'plastic';
        break;
      default:
        break;
    }

    return 'general';
  }

  normalizeTransactionForAnalysis(transaction, options = {}) {
    const { dataSource, disclaimer, consentRequired = false } = options;
    const plain = transaction && typeof transaction.toObject === 'function'
      ? transaction.toObject()
      : { ...transaction };

    const normalizedCategory = this.normalizeCategory(plain.category);
    const normalized = {
      ...plain,
      source: plain.source || dataSource || 'manual',
      dataSource: dataSource || plain.dataSource || plain.source || 'manual',
      amount: Number(plain.amount) || 0,
      currency: plain.currency || 'INR',
      description: plain.description || '',
      category: normalizedCategory,
      subcategory: plain.subcategory || 'general',
      transactionType: plain.transactionType || plain.type || this.mapCategoryToTransactionType(normalizedCategory),
      date: plain.date ? new Date(plain.date) : new Date(),
      vendor: plain.vendor || {},
      carbonFootprint: plain.carbonFootprint || {
        co2Emissions: 0,
        emissionFactor: 0,
        calculationMethod: `${dataSource || plain.source || 'unknown'}_ingestion`
      },
      sustainability: plain.sustainability || {
        isGreen: false,
        greenScore: 0,
        sustainabilityFactors: []
      },
      metadata: {
        ...(plain.metadata || {})
      },
      tags: Array.isArray(plain.tags) ? plain.tags : []
    };

    if (!normalized.carbonFootprint.calculationMethod) {
      normalized.carbonFootprint.calculationMethod = `${normalized.dataSource}_ingestion`;
    }

    if (disclaimer) {
      normalized.metadata.dataSourceDisclaimer = disclaimer;
    }

    if (consentRequired) {
      normalized.metadata.dataSourceConsentRequired = true;
    }

    return normalized;
  }

  normalizeCategory(category) {
    if (!category || typeof category !== 'string') {
      return 'other';
    }

    const normalized = category.toLowerCase();
    const allowed = carbonCategoryTaxonomy.TRANSACTION_CATEGORY_SET;

    if (allowed.has(normalized)) {
      return normalized;
    }

    return carbonCategoryTaxonomy.normalizeTransactionCategory(normalized);
  }

  mapCategoryToTransactionType(category) {
    switch (category) {
      case 'raw_materials':
        return 'purchase';
      case 'energy':
      case 'utilities':
      case 'water':
      case 'telecom':
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

  calculateOverallConfidence(esgMetrics, transactions, smsData) {
    let confidence = 0.5; // Base confidence

    // Increase confidence based on data availability
    if (transactions.length > 10) confidence += 0.2;
    if (smsData.length > 5) confidence += 0.2;
    if (esgMetrics.overall.score > 0) confidence += 0.1;

    // Increase confidence based on data quality
    const transactionQuality = this.assessTransactionQuality(transactions);
    const smsQuality = this.assessSMSQuality(smsData);
    
    confidence += (transactionQuality + smsQuality) * 0.1;

    return Math.min(1, confidence);
  }

  assessTransactionQuality(transactions) {
    if (transactions.length === 0) return 0;
    
    let qualityScore = 0;
    transactions.forEach(transaction => {
      if (transaction.amount && transaction.amount > 0) qualityScore += 0.3;
      if (transaction.category && transaction.category !== 'other') qualityScore += 0.3;
      if (transaction.description && transaction.description.length > 10) qualityScore += 0.2;
      if (transaction.carbonFootprint && transaction.carbonFootprint.co2Emissions > 0) qualityScore += 0.2;
    });
    
    return Math.min(1, qualityScore / transactions.length);
  }

  assessSMSQuality(smsData) {
    if (smsData.length === 0) return 0;
    
    let qualityScore = 0;
    smsData.forEach(sms => {
      if (sms.processedData && sms.processedData.transaction) qualityScore += 0.4;
      if (sms.processedData && sms.processedData.carbonRelevance > 0.5) qualityScore += 0.3;
      if (sms.processedData && sms.processedData.confidence > 0.7) qualityScore += 0.3;
    });
    
    return Math.min(1, qualityScore / smsData.length);
  }

  cacheResults(msmeId, results) {
    const cacheKey = `esg_metrics_${msmeId}`;
    this.metricsCache.set(cacheKey, {
      data: results,
      timestamp: Date.now()
    });
  }

  getCachedResults(msmeId) {
    const cacheKey = `esg_metrics_${msmeId}`;
    const cached = this.metricsCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < this.cacheExpiry) {
      return cached.data;
    }
    
    return null;
  }

  async generateESGReport(msmeId, format = 'pdf') {
    try {
      const esgMetrics = await this.calculateComprehensiveESGMetrics(msmeId);
      
      const report = {
        title: 'ESG Sustainability Report',
        msmeId,
        generatedAt: new Date().toISOString(),
        executiveSummary: this.generateExecutiveSummary(esgMetrics),
        environmentalSection: this.generateEnvironmentalSection(esgMetrics),
        socialSection: this.generateSocialSection(esgMetrics),
        governanceSection: this.generateGovernanceSection(esgMetrics),
        recommendations: esgMetrics.esgMetrics.recommendations,
        benchmarking: esgMetrics.benchmarking,
        predictions: esgMetrics.predictions,
        appendices: this.generateAppendices(esgMetrics)
      };

      return report;
    } catch (error) {
      logger.error('Error generating ESG report:', error);
      throw error;
    }
  }

  generateExecutiveSummary(esgMetrics) {
    return {
      overallScore: esgMetrics.esgMetrics.overall.score,
      grade: esgMetrics.esgMetrics.overall.grade,
      level: esgMetrics.esgMetrics.overall.level,
      keyStrengths: esgMetrics.esgMetrics.overall.strengths,
      keyWeaknesses: esgMetrics.esgMetrics.overall.weaknesses,
      topRecommendations: esgMetrics.esgMetrics.recommendations.slice(0, 3),
      dataConfidence: esgMetrics.confidence
    };
  }

  generateEnvironmentalSection(esgMetrics) {
    const env = esgMetrics.esgMetrics.environmental;
    return {
      score: env.score,
      carbonFootprint: env.carbonFootprint,
      resourceUsage: env.resourceUsage,
      compliance: env.environmentalCompliance,
      keyMetrics: {
        totalCO2Emissions: env.carbonFootprint.totalCO2Emissions,
        carbonIntensity: env.carbonFootprint.carbonIntensity,
        renewableEnergyUsage: env.carbonFootprint.renewableEnergyUsage,
        complianceScore: env.environmentalCompliance.complianceScore
      }
    };
  }

  generateSocialSection(esgMetrics) {
    const social = esgMetrics.esgMetrics.social;
    return {
      score: social.score,
      laborPractices: social.laborPractices,
      communityImpact: social.communityImpact,
      humanRights: social.humanRights,
      productResponsibility: social.productResponsibility,
      keyMetrics: {
        employeeCount: social.laborPractices.employeeCount,
        localEmployment: social.communityImpact.localEmployment,
        diversityScore: social.humanRights.diversityInclusion,
        customerSatisfaction: social.productResponsibility.customerSatisfaction
      }
    };
  }

  generateGovernanceSection(esgMetrics) {
    const gov = esgMetrics.esgMetrics.governance;
    return {
      score: gov.score,
      businessEthics: gov.businessEthics,
      riskManagement: gov.riskManagement,
      stakeholderEngagement: gov.stakeholderEngagement,
      dataGovernance: gov.dataGovernance,
      keyMetrics: {
        transparency: gov.businessEthics.transparency,
        financialRisk: gov.riskManagement.financialRisk,
        stakeholderCommunication: gov.stakeholderEngagement.stakeholderCommunication,
        dataSecurity: gov.dataGovernance.dataSecurity
      }
    };
  }

  generateAppendices(esgMetrics) {
    return {
      methodology: 'ESG metrics calculated using industry-standard frameworks including GRI, SASB, and TCFD',
      dataSources: esgMetrics.dataSources,
      timeRange: esgMetrics.timeRange,
      granularity: esgMetrics.granularity,
      confidence: esgMetrics.confidence,
      limitations: 'Analysis based on available data and may not capture all ESG aspects',
      futureImprovements: 'Enhanced data collection and real-time monitoring capabilities planned'
    };
  }
}

module.exports = new ESGMetricsService();