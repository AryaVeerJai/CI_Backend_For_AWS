const nodemailer = require('nodemailer');
const cheerio = require('cheerio');
const natural = require('natural');
const compromise = require('compromise');
const {
  buildMsmeClassificationContext,
  findContextMatches
} = require('./msmeContextService');

class EmailService {
  constructor() {
    this.tokenizer = new natural.WordTokenizer();
    this.stemmer = natural.PorterStemmer;
    this.classifier = new natural.BayesClassifier();
    
    // Initialize with common transaction patterns
    this.initializePatterns();
  }

  initializePatterns() {
    // Transaction type patterns for emails
    const patterns = {
      purchase: [
        'purchase order', 'invoice', 'payment made', 'procurement',
        'order confirmation', 'goods received', 'supplier payment'
      ],
      sale: [
        'sales invoice', 'payment received', 'customer order',
        'revenue', 'sales confirmation', 'order received'
      ],
      expense: [
        'expense report', 'cost', 'bill', 'charges', 'fees',
        'operating expense', 'maintenance cost'
      ],
      utility: [
        'electricity bill', 'water bill', 'utility bill', 'energy consumption',
        'power consumption', 'utility payment'
      ],
      transport: [
        'shipping cost', 'logistics', 'freight', 'transportation',
        'delivery charge', 'fuel cost', 'vehicle expense'
      ],
      investment: [
        'equipment purchase', 'capital expenditure', 'investment',
        'asset acquisition', 'infrastructure'
      ]
    };

    // Train classifier with patterns
    Object.entries(patterns).forEach(([type, keywords]) => {
      keywords.forEach(keyword => {
        this.classifier.addDocument(keyword, type);
      });
    });
    
    this.classifier.train();
  }

  async processEmail(emailData, msmeProfile = null) {
    try {
      const { subject, body, from, to, date, messageId } = emailData;
      
      // Extract transaction information
      const transaction = await this.extractTransactionData(
        subject,
        body,
        from,
        to,
        date,
        messageId,
        msmeProfile
      );
      
      return {
        success: true,
        transaction,
        confidence: transaction.metadata.confidence
      };
    } catch (error) {
      console.error('Email processing error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async extractTransactionData(subject, body, from, to, date, messageId, msmeProfile = null) {
    // Clean HTML and extract text
    const cleanBody = this.cleanEmailBody(body);
    const fullText = `${subject} ${cleanBody}`.toLowerCase();
    
    // Extract amount using multiple patterns
    const amount = this.extractAmount(fullText);
    
    // Extract date
    const extractedDate = this.extractDate(fullText, date);
    
    // Classify transaction type
    const transactionType = this.classifyTransactionType(fullText);
    
    // Extract vendor information
    const vendorInfo = this.extractVendorInfo(subject, body, from);
    
    // Determine category
    const category = this.determineCategory(fullText, transactionType);
    
    // Calculate confidence
    const confidence = this.calculateConfidence(fullText, amount, transactionType);
    
    // Extract sustainability factors
    const sustainabilityFactors = this.extractSustainabilityFactors(fullText);
    
    const baseTransaction = {
      source: 'email',
      sourceId: messageId,
      transactionType,
      amount: amount || 0,
      currency: 'INR',
      description: `${subject} - ${cleanBody.substring(0, 200)}...`,
      vendor: vendorInfo,
      category,
      subcategory: this.extractSubcategory(fullText, category),
      date: extractedDate,
      carbonFootprint: {
        co2Emissions: 0, // Will be calculated later
        emissionFactor: 0,
        calculationMethod: 'email_extraction'
      },
      sustainability: {
        isGreen: sustainabilityFactors.length > 0,
        greenScore: this.calculateGreenScore(sustainabilityFactors),
        sustainabilityFactors
      },
      metadata: {
        originalText: `${subject}\n\n${cleanBody}`,
        extractedData: {
          subject,
          from,
          to,
          amountFound: !!amount,
          dateFound: !!extractedDate
        },
        confidence
      },
      tags: this.extractTags(fullText)
    };

    return this.applyMsmeContext(baseTransaction, fullText, msmeProfile);
  }

  cleanEmailBody(body) {
    // Remove HTML tags
    const $ = cheerio.load(body);
    let text = $.text();
    
    // Remove common email signatures and footers
    const signaturePatterns = [
      /best regards.*$/is,
      /sincerely.*$/is,
      /thank you.*$/is,
      /sent from.*$/is,
      /this email.*$/is
    ];
    
    signaturePatterns.forEach(pattern => {
      text = text.replace(pattern, '');
    });
    
    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    return text;
  }

  extractAmount(text) {
    const amountPatterns = [
      /(?:rs\.?|₹|inr)\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/gi,
      /amount[:\s]*(\d+(?:,\d{3})*(?:\.\d{2})?)/gi,
      /total[:\s]*(\d+(?:,\d{3})*(?:\.\d{2})?)/gi,
      /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:rs\.?|₹|inr)/gi
    ];
    
    for (const pattern of amountPatterns) {
      const matches = [...text.matchAll(pattern)];
      if (matches.length > 0) {
        // Return the largest amount found
        const amounts = matches.map(match => 
          parseFloat(match[1].replace(/,/g, ''))
        );
        return Math.max(...amounts);
      }
    }
    
    return null;
  }

  extractDate(text, emailDate) {
    const datePatterns = [
      /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/g,
      /(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})/gi,
      /(?:date|on)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi
    ];
    
    for (const pattern of datePatterns) {
      const matches = [...text.matchAll(pattern)];
      if (matches.length > 0) {
        const extractedDate = new Date(matches[0][1]);
        if (!isNaN(extractedDate.getTime())) {
          return extractedDate;
        }
      }
    }
    
    return new Date(emailDate);
  }

  classifyTransactionType(text) {
    // Use classifier
    const classification = this.classifier.classify(text);
    
    // Additional keyword-based classification
    if (text.includes('invoice') && text.includes('payment')) {
      return 'purchase';
    }
    if (text.includes('sales') && text.includes('received')) {
      return 'sale';
    }
    if (text.includes('expense') || text.includes('cost')) {
      return 'expense';
    }
    if (text.includes('utility') || text.includes('bill')) {
      return 'utility';
    }
    if (text.includes('shipping') || text.includes('transport')) {
      return 'transport';
    }
    if (text.includes('equipment') || text.includes('investment')) {
      return 'investment';
    }
    
    return classification || 'other';
  }

  extractVendorInfo(subject, body, from) {
    // Extract from subject line
    let vendorName = this.extractVendorFromSubject(subject);
    
    // Extract from email body if not found in subject
    if (!vendorName) {
      vendorName = this.extractVendorFromBody(body);
    }
    
    // Use email domain as fallback
    if (!vendorName) {
      vendorName = from.split('@')[0];
    }
    
    return {
      name: vendorName,
      category: this.categorizeVendor(vendorName),
      location: this.extractLocationFromEmail(body)
    };
  }

  extractVendorFromSubject(subject) {
    const patterns = [
      /from\s+([a-z\s]+)/i,
      /invoice\s+from\s+([a-z\s]+)/i,
      /payment\s+to\s+([a-z\s]+)/i,
      /order\s+from\s+([a-z\s]+)/i
    ];
    
    for (const pattern of patterns) {
      const match = subject.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    return null;
  }

  extractVendorFromBody(body) {
    const patterns = [
      /vendor[:\s]*([a-z\s]+)/i,
      /supplier[:\s]*([a-z\s]+)/i,
      /merchant[:\s]*([a-z\s]+)/i,
      /company[:\s]*([a-z\s]+)/i
    ];
    
    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    return null;
  }

  extractLocationFromEmail(body) {
    const locationPatterns = [
      /location[:\s]*([a-z\s,]+)/i,
      /address[:\s]*([a-z\s,]+)/i,
      /city[:\s]*([a-z\s]+)/i
    ];
    
    for (const pattern of locationPatterns) {
      const match = body.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    return null;
  }

  determineCategory(text, transactionType) {
    const categoryMap = {
      'purchase': 'raw_materials',
      'sale': 'other',
      'expense': 'other',
      'utility': 'energy',
      'transport': 'transportation',
      'investment': 'equipment'
    };
    
    // Override based on content analysis
    if (text.includes('electricity') || text.includes('power') || text.includes('coal')) return 'energy';
    if (text.includes('water')) return 'water';
    if (text.includes('fuel') || text.includes('diesel') || text.includes('petrol')) return 'transportation';
    if (text.includes('waste') || text.includes('recycling')) return 'waste_management';
    if (text.includes('equipment') || text.includes('machinery')) return 'equipment';
    if (text.includes('maintenance') || text.includes('repair')) return 'maintenance';
    
    return categoryMap[transactionType] || 'other';
  }

  extractSubcategory(text, category) {
    const subcategoryMap = {
      'energy': text.includes('solar')
        ? 'renewable'
        : (text.includes('coal') ? 'coal' : 'grid'),
      'transportation': text.includes('diesel') ? 'diesel' : 'petrol',
      'raw_materials': this.getMaterialType(text),
      'waste_management': text.includes('recycling') ? 'recycling' : 'disposal',
      'equipment': this.getEquipmentType(text)
    };
    
    return subcategoryMap[category] || 'general';
  }

  getMaterialType(text) {
    const materials = ['steel', 'aluminum', 'plastic', 'paper', 'glass', 'wood', 'concrete'];
    for (const material of materials) {
      if (text.includes(material)) {
        return material;
      }
    }
    return 'general';
  }

  getEquipmentType(text) {
    const equipment = ['machinery', 'tools', 'vehicles', 'computers', 'furniture'];
    for (const item of equipment) {
      if (text.includes(item)) {
        return item;
      }
    }
    return 'general';
  }

  categorizeVendor(vendorName) {
    const categories = {
      'energy': ['electricity', 'power', 'energy', 'utility', 'coal'],
      'transport': ['fuel', 'diesel', 'petrol', 'transport', 'logistics'],
      'materials': ['steel', 'aluminum', 'plastic', 'raw', 'supplier'],
      'utilities': ['water', 'gas', 'internet', 'phone', 'telecom'],
      'services': ['maintenance', 'repair', 'service', 'consulting'],
      'equipment': ['machinery', 'tools', 'equipment', 'industrial']
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
      'recycling', 'recycled', 'biodegradable', 'organic', 'natural',
      'energy efficient', 'low carbon', 'carbon neutral'
    ];
    
    greenKeywords.forEach(keyword => {
      if (text.includes(keyword)) {
        factors.push(keyword);
      }
    });
    
    return factors;
  }

  calculateGreenScore(factors) {
    if (factors.length === 0) return 0;
    
    const baseScore = factors.length * 15; // 15 points per factor
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
    if (text.includes('contract')) tags.push('contract');
    if (text.includes('agreement')) tags.push('agreement');
    
    return tags;
  }

  calculateConfidence(text, amount, transactionType) {
    let confidence = 0.6; // Base confidence for emails (higher than SMS)
    
    // Increase confidence if amount is found
    if (amount && amount > 0) confidence += 0.2;
    
    // Increase confidence if transaction type is clear
    if (transactionType !== 'other') confidence += 0.15;
    
    // Increase confidence for longer, more detailed emails
    if (text.length > 100) confidence += 0.05;
    
    // Increase confidence for structured content
    if (text.includes('invoice') || text.includes('payment') || text.includes('order')) {
      confidence += 0.1;
    }
    
    return Math.min(1, Math.max(0, confidence));
  }
}

module.exports = new EmailService();