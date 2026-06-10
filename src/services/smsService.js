const natural = require('natural');
const compromise = require('compromise');
const carbonCategoryTaxonomy = require('../../../shared/carbonCategoryTaxonomy');
const {
  buildMsmeClassificationContext,
  findContextMatches
} = require('./msmeContextService');
const verifiedKnowledgeRagService = require('./verifiedKnowledgeRagService');

class SMSService {
  constructor() {
    this.tokenizer = new natural.WordTokenizer();
    this.stemmer = natural.PorterStemmer;
    this.classifier = new natural.BayesClassifier();
    this.highValueThreshold = Number(process.env.HIGH_VALUE_TRANSACTION_THRESHOLD_INR) || 250000;
    
    // Initialize with common transaction patterns
    this.initializePatterns();
  }

  initializePatterns() {
    // Transaction type patterns
    const patterns = {
      purchase: [
        'purchased', 'bought', 'order', 'invoice', 'payment made',
        'debit', 'paid to', 'purchase order', 'procurement'
      ],
      sale: [
        'sold', 'sale', 'received payment', 'credit', 'invoice generated',
        'order received', 'customer payment', 'revenue'
      ],
      expense: [
        'expense', 'cost', 'spent', 'bill', 'charges', 'fees',
        'maintenance', 'repair', 'service charge'
      ],
      utility: [
        'electricity', 'water', 'gas', 'coal', 'internet', 'phone', 'utility',
        'power bill', 'water bill', 'energy consumption'
      ],
      transport: [
        'fuel', 'diesel', 'petrol', 'transport', 'shipping', 'logistics',
        'delivery', 'freight', 'vehicle'
      ],
      investment: [
        'investment', 'capital infusion', 'equity', 'seed funding', 'loan disbursed',
        'funding received', 'venture', 'series'
      ]
    };

    this.transactionTypePatterns = patterns;

    // Train classifier with patterns
    Object.entries(patterns).forEach(([type, keywords]) => {
      keywords.forEach(keyword => {
        this.classifier.addDocument(keyword, type);
      });
    });
    
    this.classifier.train();
  }

  async processSMS(smsData, msmeProfile = null) {
    try {
      const { body, sender, timestamp, messageId } = smsData;
      
      // Extract transaction information
      const transaction = await this.extractTransactionData(
        body,
        sender,
        timestamp,
        messageId,
        msmeProfile
      );
      
      return {
        success: true,
        transaction,
        confidence: transaction.metadata.confidence
      };
    } catch (error) {
      console.error('SMS processing error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async extractTransactionData(text, sender, timestamp, messageId, msmeProfile = null) {
    // Clean and normalize text
    if (!text) {
      throw new Error('SMS text is required');
    }
    const cleanText = text.toLowerCase().trim();
    
    // Extract amount using regex
    const amountMatch = cleanText.match(/(?:rs\.?|₹|inr)\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;
    
    // Extract date
    const dateMatch = cleanText.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
    const extractedDate = dateMatch ? new Date(dateMatch[1]) : new Date(timestamp);
    
    // Classify transaction type
    const transactionType = this.classifyTransactionType(cleanText);
    
    // Extract vendor/merchant name
    const vendorName = this.extractVendorName(cleanText, sender);
    
    // Determine category based on content
    let category = this.determineCategory(cleanText, transactionType);
    let subcategory = this.extractSubcategory(cleanText, category);
    
    // Calculate confidence score
    const confidence = this.calculateConfidence(cleanText, amount, transactionType);
    
    // Extract sustainability factors
    const sustainabilityFactors = this.extractSustainabilityFactors(cleanText);
    
    const baseTransaction = {
      source: 'sms',
      sourceId: messageId,
      transactionType,
      amount: amount || 0,
      currency: 'INR',
      description: text,
      vendor: {
        name: vendorName,
        category: this.categorizeVendor(vendorName),
        location: this.extractLocation(cleanText)
      },
      category,
      subcategory,
      date: extractedDate,
      carbonFootprint: {
        co2Emissions: 0, // Will be calculated later
        emissionFactor: 0,
        calculationMethod: 'sms_extraction'
      },
      sustainability: {
        isGreen: sustainabilityFactors.length > 0,
        greenScore: this.calculateGreenScore(sustainabilityFactors),
        sustainabilityFactors
      },
      metadata: {
        originalText: text,
        extractedData: {
          amountMatch: amountMatch?.[0],
          dateMatch: dateMatch?.[0],
          sender: sender
        },
        confidence,
        transactionTypeConfidence: this.calculateTransactionTypeConfidence(cleanText, transactionType)
      },
      tags: this.extractTags(cleanText)
    };

    if (this.shouldResolveWithRag(baseTransaction)) {
      const ragClassification = verifiedKnowledgeRagService.classifyUnknownTransaction({
        text: cleanText,
        businessDomain: msmeProfile?.businessDomain || 'other',
        transactionType: baseTransaction.transactionType || 'other',
        parameterType: 'transaction',
        candidateLocation: baseTransaction.vendor?.location || ''
      });
      if (ragClassification) {
        category = ragClassification.category || category;
        subcategory = ragClassification.subcategory || subcategory || 'general';
        baseTransaction.transactionType = ragClassification.transactionType || baseTransaction.transactionType;
        baseTransaction.category = category;
        baseTransaction.subcategory = subcategory;
        if (ragClassification.locationInference?.region) {
          baseTransaction.region = ragClassification.locationInference.region;
          baseTransaction.location = {
            ...(baseTransaction.location || {}),
            region: ragClassification.locationInference.region
          };
        }
        if (Number.isFinite(ragClassification.confidence)) {
          baseTransaction.metadata.confidence = Math.max(
            Number(baseTransaction.metadata.confidence) || 0,
            ragClassification.confidence
          );
        }
        baseTransaction.metadata.ragClassification = {
          retrievalMethod: ragClassification.retrievalMethod,
          normalizedLabel: ragClassification.normalizedLabel,
          verifiedSource: ragClassification.verifiedSource,
          referenceNote: ragClassification.referenceNote,
          emissionFactor: ragClassification.emissionFactor,
          matchedKeywords: ragClassification.matchedKeywords,
          confidence: ragClassification.confidence
        };
      }
    }

    return this.applyMsmeContext(baseTransaction, cleanText, msmeProfile);
  }

  shouldResolveWithRag(transaction = {}) {
    const category = String(transaction.category || '').toLowerCase();
    const subcategory = String(transaction.subcategory || '').toLowerCase();
    const confidence = Number(transaction.metadata?.confidence || 0);
    return (
      category === 'other' ||
      category === 'unknown' ||
      subcategory === 'general' ||
      confidence < 0.55
    );
  }

  extractVendorName(text, sender) {
    // Common patterns for vendor names in SMS
    const patterns = [
      /from\s+([a-z\s]+?)(?:\s+for\s+rs|$)/i,
      /to\s+([a-z\s]+?)(?:\s+for\s+rs|$)/i,
      /at\s+([a-z\s]+?)(?:\s+for\s+rs|$)/i,
      /merchant:\s*([a-z\s]+?)(?:\s+for\s+rs|$)/i,
      /vendor:\s*([a-z\s]+?)(?:\s+for\s+rs|$)/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return this.capitalizeWords(match[1].trim());
      }
    }
    
    // If no pattern matches, use sender or extract from common merchant names
    return this.getCommonMerchantName(text) || sender;
  }

  getCommonMerchantName(text) {
    const merchants = [
      'amazon', 'flipkart', 'swiggy', 'zomato', 'uber', 'ola',
      'paytm', 'phonepe', 'google pay', 'razorpay', 'stripe',
      'electricity board', 'water board', 'gas company'
    ];
    
    for (const merchant of merchants) {
      if (text.includes(merchant)) {
        return this.capitalizeWords(merchant);
      }
    }
    
    return null;
  }

  capitalizeWords(str) {
    return str.replace(/\b\w/g, l => l.toUpperCase());
  }

  determineCategory(text, transactionType) {
    const categoryMap = {
      purchase: 'raw_materials',
      sale: 'other',
      expense: 'other',
      utility: 'utilities',
      transport: 'transportation'
    };

    const normalizedText = String(text || '').toLowerCase();
    if (
      /\bmaintenance\b/.test(normalizedText)
      || (/\brepair\b/.test(normalizedText) && /\bservice\b/.test(normalizedText))
      || /\bamc\b/.test(normalizedText)
    ) {
      return carbonCategoryTaxonomy.normalizeTransactionCategory('maintenance');
    }

    const keywords = carbonCategoryTaxonomy.getCategoryKeywords();
    let bestMatch = null;
    let bestScore = 0;

    for (const [category, terms] of Object.entries(keywords)) {
      let score = 0;
      for (const term of terms) {
        if (text.includes(term)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = category;
      }
    }

    if (bestMatch && bestScore > 0) {
      return carbonCategoryTaxonomy.normalizeTransactionCategory(bestMatch);
    }

    return carbonCategoryTaxonomy.normalizeTransactionCategory(categoryMap[transactionType] || 'other');
  }

  extractSubcategory(text, category) {
    const normalizedCategory = carbonCategoryTaxonomy.normalizeTransactionCategory(category);
    const inferred = carbonCategoryTaxonomy.classifySubcategoryFromText(text, normalizedCategory);
    if (inferred && inferred !== 'general') {
      return carbonCategoryTaxonomy.normalizeSubcategory(inferred);
    }
    return 'general';
  }

  extractLocation(text) {
    // Simple location extraction - can be enhanced with NLP
    const locationPatterns = [
      /in\s+([a-z\s]+?)(?:\s+for\s+rs|$)/i,
      /at\s+([a-z\s]+?)(?:\s+for\s+rs|$)/i,
      /location:\s*([a-z\s]+?)(?:\s+for\s+rs|$)/i
    ];
    
    for (const pattern of locationPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    return null;
  }

  categorizeVendor(vendorName) {
    const categories = {
      'energy': ['electricity', 'power', 'energy'],
      'transport': ['fuel', 'diesel', 'petrol', 'transport'],
      'materials': ['steel', 'aluminum', 'plastic', 'raw'],
      'utilities': ['water', 'gas', 'internet', 'phone'],
      'services': ['maintenance', 'repair', 'service']
    };
    
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => vendorName.toLowerCase().includes(keyword))) {
        return category;
      }
    }
    
    return 'other';
  }

  applyMsmeContext(transaction, text, msmeProfile) {
    if (!msmeProfile) {
      return transaction;
    }

    const classificationContext = buildMsmeClassificationContext(msmeProfile);
    if (!classificationContext) {
      return transaction;
    }

    const matches = findContextMatches(text, classificationContext);
    const updated = { ...transaction };

    updated.classificationContext = {
      ...classificationContext,
      matchedProcess: matches.processMatch,
      matchedMachinery: matches.machineryMatch,
      matchedProducts: matches.productMatches
    };

    if ((!updated.subcategory || updated.subcategory === 'general') && matches.processMatch) {
      updated.subcategory = matches.processMatch;
    } else if ((!updated.subcategory || updated.subcategory === 'general') && matches.machineryMatch) {
      updated.subcategory = matches.machineryMatch;
    }

    return updated;
  }

  extractSustainabilityFactors(text) {
    const factors = [];
    
    const greenKeywords = [
      'solar', 'wind', 'renewable', 'green', 'eco', 'sustainable',
      'recycling', 'recycled', 'biodegradable', 'organic', 'natural'
    ];
    
    greenKeywords.forEach(keyword => {
      if (text.toLowerCase().includes(keyword)) {
        factors.push(keyword);
      }
    });
    
    return factors;
  }

  calculateGreenScore(factors) {
    if (factors.length === 0) return 0;
    
    const baseScore = factors.length * 20; // 20 points per factor
    return Math.min(100, baseScore);
  }

  extractTags(text) {
    const tags = [];
    
    // Extract common tags
    if (text.includes('urgent')) tags.push('urgent');
    if (text.includes('recurring')) tags.push('recurring');
    if (text.includes('one-time')) tags.push('one-time');
    if (text.includes('bulk')) tags.push('bulk');
    if (text.includes('discount')) tags.push('discount');
    
    return tags;
  }

  calculateConfidence(text, amount, transactionType) {
    let confidence = 0.5; // Base confidence
    
    // Increase confidence if amount is found
    if (amount && amount > 0) confidence += 0.3;
    
    // Increase confidence if transaction type is clear
    if (transactionType !== 'other') confidence += 0.2;
    
    // Decrease confidence for very short texts
    if (text.length < 20) confidence -= 0.2;
    
    // Increase confidence for structured messages
    if (text.includes('rs') || text.includes('₹') || text.includes('inr')) confidence += 0.1;
    
    return Math.min(1, Math.max(0, confidence));
  }

  classifyTransactionType(text) {
    const priorityMatchers = [
      { type: 'investment', regex: /\b(investment|equity|funding received|loan disbursed|venture)\b/i },
      { type: 'purchase', regex: /\b(purchase order|procurement|paid to)\b/i },
      { type: 'sale', regex: /\b(received payment|customer payment|revenue)\b/i },
      { type: 'transport', regex: /\b(freight charges|logistics|shipping)\b/i },
      { type: 'utility', regex: /\b(electricity|power bill|water bill|gas bill)\b/i }
    ];
    for (const { type, regex } of priorityMatchers) {
      if (regex.test(text)) {
        return type;
      }
    }

    const patternGroups = Object.values(this.transactionTypePatterns || {});
    const hasKnownKeyword = patternGroups.some(keywords => keywords.some(keyword => text.includes(keyword)));
    if (!hasKnownKeyword) {
      return 'other';
    }

    const classifications = this.classifier.getClassifications(text);
    if (!classifications || classifications.length === 0) {
      return 'other';
    }

    const [top, runnerUp] = classifications.sort((a, b) => b.value - a.value);
    const total = (top?.value || 0) + (runnerUp?.value || 0);
    const confidence = total > 0 ? (top.value / total) : 0;

    if (confidence < 0.4) {
      return 'other';
    }

    return top.label || 'other';
  }

  calculateTransactionTypeConfidence(text, transactionType) {
    if (!text) return 0;
    const classifications = this.classifier.getClassifications(text);
    const match = classifications.find(item => item.label === transactionType);
    if (!match) return 0;
    const total = classifications.reduce((sum, item) => sum + (item.value || 0), 0);
    return total > 0 ? match.value / total : 0;
  }

  isHighValueTransaction(amount, threshold = this.highValueThreshold) {
    const numericAmount = Number(amount);
    const numericThreshold = Number(threshold);
    if (!Number.isFinite(numericAmount) || !Number.isFinite(numericThreshold)) {
      return false;
    }
    return numericAmount >= numericThreshold;
  }

  buildHighValueBillUploadRequirement({
    amount,
    threshold = this.highValueThreshold,
    uploadEndpoint = '/api/documents/upload'
  } = {}) {
    return {
      required: true,
      workflow: 'high_value_sms_bill_pdf',
      reason: 'High-value transaction requires bill-level verification for detailed GHG calculation.',
      transactionAmount: Number(amount) || 0,
      thresholdAmount: Number(threshold) || this.highValueThreshold,
      acceptedMimeTypes: ['application/pdf'],
      requiredDocumentType: 'bill',
      uploadEndpoint,
      ghgProtocol: {
        standard: 'GHG Protocol Corporate Standard',
        scopes: ['Scope 1', 'Scope 2', 'Scope 3'],
        expectation: 'Upload the source bill PDF for line-item breakup and protocol-aligned emissions attribution.'
      }
    };
  }
}

module.exports = new SMSService();