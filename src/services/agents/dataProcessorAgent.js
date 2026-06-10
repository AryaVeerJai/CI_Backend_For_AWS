const natural = require('natural');
const logger = require('../../utils/logger');
const carbonCategoryTaxonomy = require('../../../../shared/carbonCategoryTaxonomy');
const {
  buildMsmeClassificationContext,
  findContextMatches
} = require('../msmeContextService');
const verifiedKnowledgeRagService = require('../verifiedKnowledgeRagService');

class DataProcessorAgent {
  constructor() {
    this.name = 'Data Processor Agent';
    this.type = 'data_processor';
    this.capabilities = [
      'data_cleaning',
      'transaction_classification',
      'text_analysis',
      'data_enrichment',
      'quality_validation'
    ];

    // Initialize NLP tools
    this.tokenizer = new natural.WordTokenizer();
    this.stemmer = natural.PorterStemmer;
    this.classifier = new natural.BayesClassifier();
    this.transactionTypeClassifier = new natural.BayesClassifier();

    this.learningConfig = {
      minCategoryConfidence: 0.55,
      minTransactionTypeConfidence: 0.55,
      learningConfidence: 0.75,
      documentRequestThreshold: 0.4,
      highValueAmountThreshold: 250000,
      maxLearnedKeywordsPerCategory: 40,
      maxLearnedKeywordsPerType: 30
    };

    this.stopWords = new Set([
      'the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'you', 'are',
      'was', 'were', 'has', 'have', 'had', 'been', 'being', 'into', 'onto', 'over',
      'under', 'paid', 'payment', 'received', 'invoice', 'bill', 'charges',
      'rs', 'inr', 'amount', 'transfer', 'txn', 'transaction', 'ref'
    ]);

    // Initialize category keywords
    this.categoryKeywords = this.initializeCategoryKeywords();
    this.transactionTypeKeywords = this.initializeTransactionTypeKeywords();
    this.learnedCategoryKeywords = new Map();
    this.learnedTransactionTypeKeywords = new Map();
    this.validTransactionTypes = new Set([
      'purchase', 'sale', 'expense', 'investment', 'utility', 'transport', 'other'
    ]);

    this.initializeClassifiers();
  }

  async processTransactions(transactions, options = {}) {
    try {
      if (!Array.isArray(transactions)) {
        throw new Error('Transactions input must be an array');
      }

      const learningStats = this.learnFromTransactions(transactions, options);
      const processedData = {
        cleaned: [],
        classified: [],
        enriched: [],
        validated: [],
        documentRequests: [],
        statistics: {
          totalProcessed: 0,
          successfullyClassified: 0,
          validationErrors: 0,
          enrichmentApplied: 0,
          uncertainTransactions: 0,
          documentRequests: 0,
          autoLearnedCategories: learningStats.categoriesLearned,
          autoLearnedTransactionTypes: learningStats.transactionTypesLearned
        }
      };

      for (const transaction of transactions) {
        try {
          // Step 1: Clean transaction data
          const cleaned = await this.cleanTransactionData(transaction);
          processedData.cleaned.push(cleaned);
          processedData.statistics.totalProcessed++;

          // Step 2: Classify transaction
          const classified = await this.classifyTransaction(cleaned, options);
          processedData.classified.push(classified);
          if (classified.category && classified.category !== 'unknown') {
            processedData.statistics.successfullyClassified++;
          }
          if (classified.processingMetadata?.needsReview) {
            processedData.statistics.uncertainTransactions++;
          }

          // Step 3: Enrich with additional data
          const enriched = await this.enrichTransactionData(classified);
          processedData.enriched.push(enriched);
          if (enriched.enrichmentApplied) {
            processedData.statistics.enrichmentApplied++;
          }

          // Step 4: Validate for carbon calculation
          const validated = await this.validateForCarbonCalculation(enriched);
          processedData.validated.push(validated);
          if (validated.validationErrors.length > 0) {
            processedData.statistics.validationErrors += validated.validationErrors.length;
          }

          const documentRequest = this.buildDocumentRequest(validated, options);
          if (documentRequest) {
            validated.documentRequest = documentRequest;
            processedData.documentRequests.push(documentRequest);
            processedData.statistics.documentRequests++;
          }

        } catch (error) {
          logger.error(`Error processing transaction ${transaction._id}:`, error);
          // Add error transaction to results
          processedData.validated.push({
            ...transaction,
            processingError: error.message,
            validationErrors: ['Processing failed']
          });
          processedData.statistics.validationErrors++;
        }
      }

      return processedData;
    } catch (error) {
      logger.error('Transaction processing failed:', error);
      throw error;
    }
  }

  async cleanTransactionData(transaction) {
    if (!transaction || typeof transaction !== 'object') {
      throw new Error('Transaction must be an object');
    }
    const cleaned = { ...transaction };

    // Clean description
    if (cleaned.description) {
      cleaned.description = this.cleanText(cleaned.description);
    }

    // Clean vendor name
    if (cleaned.vendor) {
      cleaned.vendor = this.cleanVendorName(cleaned.vendor);
    }

    // Normalize amount
    if (cleaned.amount) {
      cleaned.amount = this.normalizeAmount(cleaned.amount);
    }

    // Clean and validate date
    if (cleaned.date) {
      cleaned.date = this.normalizeDate(cleaned.date);
    }

    // Remove empty or null fields
    Object.keys(cleaned).forEach(key => {
      if (cleaned[key] === null || cleaned[key] === undefined || cleaned[key] === '') {
        delete cleaned[key];
      }
    });

    return cleaned;
  }

  async classifyTransaction(transaction, options = {}) {
    const classified = { ...transaction };

    // If category is already set and valid, keep it
    const text = this.buildTransactionText(classified);
    const transactionTypeResult = this.resolveTransactionType(classified, text);
    const categoryResult = this.resolveCategory(classified, text, transactionTypeResult.value);

    classified.transactionType = transactionTypeResult.value;
    classified.category = categoryResult.value;
    classified.subcategory = this.classifySubcategory(text, categoryResult.value);
    classified.confidence = Math.max(transactionTypeResult.confidence, categoryResult.confidence);

    const reviewReasons = [
      ...transactionTypeResult.reasons,
      ...categoryResult.reasons
    ].filter(Boolean);

    classified.processingMetadata = {
      ...(classified.processingMetadata || {}),
      classification: {
        transactionType: transactionTypeResult,
        category: categoryResult
      },
      needsReview: reviewReasons.length > 0,
      reviewReasons
    };

    await this.applyVerifiedRagClassification(classified, text, options);
    this.applyMsmeContext(classified, text, options);

    return classified;
  }

  async enrichTransactionData(transaction) {
    const enriched = { ...transaction };
    enriched.enrichmentApplied = false;

    // Enrich with sustainability data
    if (enriched.vendor) {
      const sustainabilityData = await this.getVendorSustainabilityData(enriched.vendor);
      if (sustainabilityData) {
        enriched.sustainability = sustainabilityData;
        enriched.enrichmentApplied = true;
      }
    }

    // Enrich with location data
    if (enriched.description) {
      const locationData = this.extractLocationData(enriched.description);
      if (locationData) {
        enriched.location = locationData;
        enriched.enrichmentApplied = true;
      }
    }

    // Enrich with material type
    if (enriched.category === 'raw_materials' && enriched.description) {
      const materialType = this.extractMaterialType(enriched.description);
      if (materialType) {
        enriched.materialType = materialType;
        enriched.enrichmentApplied = true;
      }
    }

    // Enrich with energy source
    if (enriched.category === 'energy' && enriched.description) {
      const energySource = this.extractEnergySource(enriched.description);
      if (energySource) {
        enriched.energySource = energySource;
        enriched.enrichmentApplied = true;
      }
    }

    // Enrich with mobile industry classification
    const mobileClassification = enriched.metadata?.mobileClassification;
    if (mobileClassification?.industry && mobileClassification.industry !== 'other') {
      enriched.industrySector = mobileClassification.industry;
      enriched.industrySectorLabel = mobileClassification.industryLabel || null;
      enriched.industryConfidence = mobileClassification.industryConfidence || 0;
      enriched.enrichmentApplied = true;
    }

    return enriched;
  }

  async validateForCarbonCalculation(transaction) {
    const validated = { ...transaction };
    validated.validationErrors = [];

    // Required fields validation
    if (!validated.amount || validated.amount <= 0) {
      validated.validationErrors.push('Invalid or missing amount');
    }

    if (!validated.date) {
      validated.validationErrors.push('Missing transaction date');
    }

    if (!validated.category) {
      validated.validationErrors.push('Missing transaction category');
    }

    // Category-specific validation
    if (validated.category === 'energy' && !validated.subcategory) {
      validated.validationErrors.push('Energy transactions require subcategory (grid/renewable/fuel)');
    }

    if (validated.category === 'raw_materials' && !validated.materialType) {
      validated.validationErrors.push('Material transactions should specify material type');
    }

    // Amount range validation
    if (validated.amount > 1000000) {
      validated.validationErrors.push('Amount seems unusually high, please verify');
    }

    // Date validation
    if (validated.date && validated.date > new Date()) {
      validated.validationErrors.push('Transaction date cannot be in the future');
    }

    validated.isValid = validated.validationErrors.length === 0;

    return validated;
  }

  cleanText(text) {
    if (!text) return '';

    return text
      .replace(/[^\w\s]/g, ' ') // Remove special characters
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim()
      .toLowerCase();
  }

  cleanVendorName(vendor) {
    if (!vendor) return '';

    if (typeof vendor === 'object') {
      const cleanedVendor = { ...vendor };
      if (cleanedVendor.name) {
        cleanedVendor.name = this.cleanVendorName(cleanedVendor.name);
      }
      return cleanedVendor;
    }

    if (typeof vendor !== 'string') {
      return vendor;
    }

    return vendor
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim();
  }

  normalizeAmount(amount) {
    if (typeof amount === 'string') {
      // Remove currency symbols and commas
      const cleaned = amount.replace(/[^\d.-]/g, '');
      return parseFloat(cleaned) || 0;
    }
    return Number(amount) || 0;
  }

  normalizeDate(date) {
    if (date instanceof Date) return date;
    if (typeof date === 'string') return new Date(date);
    return new Date();
  }

  initializeCategoryKeywords() {
    return carbonCategoryTaxonomy.getCategoryKeywords();
  }

  initializeTransactionTypeKeywords() {
    return {
      purchase: ['purchased', 'bought', 'order', 'invoice', 'paid to', 'purchase order', 'procurement'],
      sale: ['sold', 'sale', 'received payment', 'credit', 'invoice generated', 'order received', 'customer payment'],
      expense: ['expense', 'cost', 'spent', 'bill', 'charges', 'fees', 'maintenance', 'repair', 'service charge'],
      utility: ['electricity', 'water', 'gas', 'internet', 'phone', 'utility', 'power bill'],
      transport: ['fuel', 'diesel', 'petrol', 'coal', 'transport', 'shipping', 'logistics', 'delivery', 'freight'],
      investment: ['investment', 'deposit', 'capital', 'equity', 'loan disbursed', 'funding'],
      other: ['adjustment', 'miscellaneous', 'other', 'general']
    };
  }

  initializeClassifiers() {
    try {
      this.classifier = new natural.BayesClassifier();
      Object.entries(this.categoryKeywords).forEach(([category, keywords]) => {
        keywords.forEach(keyword => this.classifier.addDocument(keyword, category));
      });
      this.classifier.train();

      this.transactionTypeClassifier = new natural.BayesClassifier();
      Object.entries(this.transactionTypeKeywords).forEach(([type, keywords]) => {
        keywords.forEach(keyword => this.transactionTypeClassifier.addDocument(keyword, type));
      });
      this.transactionTypeClassifier.train();
    } catch (error) {
      logger.error('Failed to initialize classifiers:', error);
    }
  }

  resetLearning() {
    this.categoryKeywords = this.initializeCategoryKeywords();
    this.transactionTypeKeywords = this.initializeTransactionTypeKeywords();
    this.learnedCategoryKeywords = new Map();
    this.learnedTransactionTypeKeywords = new Map();
    this.initializeClassifiers();
  }

  classifyByKeywords(text) {
    let bestMatch = 'other';
    let maxScore = 0;

    for (const [category, keywords] of Object.entries(this.categoryKeywords)) {
      let score = 0;
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          score += 1;
        }
      }

      if (score > maxScore) {
        maxScore = score;
        bestMatch = category;
      }
    }

    return maxScore > 0 ? bestMatch : 'unknown';
  }

  resolveTransactionType(transaction, text) {
    const existingType = this.normalizeTransactionType(transaction.transactionType);
    if (existingType) {
      const confidence = this.calculateKeywordConfidence(text, this.transactionTypeKeywords[existingType]);
      const needsReview = confidence < this.learningConfig.minTransactionTypeConfidence;
      const suggestion = needsReview ? this.inferTransactionType(text).value : null;
      return {
        value: existingType,
        confidence,
        source: 'provided',
        needsReview,
        reasons: needsReview ? ['Low transaction type confidence'] : [],
        suggestion
      };
    }
    return this.inferTransactionType(text);
  }

  resolveCategory(transaction, text, fallbackTransactionType) {
    const existingCategory = this.normalizeCategory(transaction.category);
    if (existingCategory) {
      const confidence = this.calculateKeywordConfidence(text, this.categoryKeywords[existingCategory]);
      const needsReview = confidence < this.learningConfig.minCategoryConfidence;
      const suggestion = needsReview ? this.inferCategory(text).value : null;
      return {
        value: existingCategory,
        confidence,
        source: 'provided',
        needsReview,
        reasons: needsReview ? ['Low category confidence'] : [],
        suggestion
      };
    }

    const inferred = this.inferCategory(text);
    if (inferred.value !== 'unknown' && inferred.confidence >= this.learningConfig.minCategoryConfidence) {
      return inferred;
    }

    const fallbackCategory = this.fallbackCategoryFromType(fallbackTransactionType);
    return {
      value: fallbackCategory || 'other',
      confidence: Math.max(inferred.confidence, this.learningConfig.documentRequestThreshold),
      source: fallbackCategory ? 'fallback' : 'unknown',
      needsReview: true,
      reasons: ['Unclear category from description'],
      suggestion: inferred.value !== 'unknown' ? inferred.value : null
    };
  }

  inferTransactionType(text) {
    if (!text) {
      return {
        value: 'other',
        confidence: 0,
        source: 'fallback',
        needsReview: true,
        reasons: ['Missing transaction description']
      };
    }

    const candidates = this.getClassifierCandidates(this.transactionTypeClassifier, text);
    const top = candidates[0];
    const runnerUp = candidates[1];
    const confidence = this.calculateCandidateConfidence(top, runnerUp);
    const label = top?.label || 'other';

    if (!this.isValidTransactionType(label) || confidence < this.learningConfig.minTransactionTypeConfidence) {
      return {
        value: 'other',
        confidence,
        source: 'classifier',
        needsReview: true,
        reasons: ['Unclear transaction type'],
        suggestion: label
      };
    }

    return {
      value: label,
      confidence,
      source: 'classifier',
      needsReview: false,
      reasons: []
    };
  }

  inferCategory(text) {
    if (!text) {
      return {
        value: 'unknown',
        confidence: 0,
        source: 'fallback',
        needsReview: true,
        reasons: ['Missing transaction description']
      };
    }

    const keywordCategory = this.classifyByKeywords(text);
    const keywordConfidence = this.calculateClassificationConfidence(text, keywordCategory);
    const candidates = this.getClassifierCandidates(this.classifier, text);
    const top = candidates[0];
    const runnerUp = candidates[1];
    const classifierConfidence = this.calculateCandidateConfidence(top, runnerUp);

    let chosenCategory = keywordCategory;
    let confidence = keywordConfidence;
    let source = 'keywords';

    if (classifierConfidence > keywordConfidence && top?.label) {
      chosenCategory = top.label;
      confidence = classifierConfidence;
      source = 'classifier';
    }

    return {
      value: chosenCategory,
      confidence,
      source,
      needsReview: chosenCategory === 'unknown' || confidence < this.learningConfig.minCategoryConfidence,
      reasons: chosenCategory === 'unknown' || confidence < this.learningConfig.minCategoryConfidence
        ? ['Low classification confidence']
        : []
    };
  }

  buildDocumentRequest(transaction, options = {}) {
    const hasDocuments = Array.isArray(options.documents) && options.documents.length > 0;
    const hasDocumentSummary = Boolean(options.documentSummary);
    if (hasDocuments || hasDocumentSummary) {
      return null;
    }

    const reasons = [];
    const classification = transaction.processingMetadata?.classification;
    if (classification?.transactionType?.needsReview) {
      reasons.push('Transaction type could not be determined confidently');
    }
    if (classification?.category?.needsReview) {
      reasons.push('Transaction category could not be determined confidently');
    }
    if (transaction.validationErrors?.length) {
      reasons.push('Transaction data is incomplete or invalid');
    }

    const amount = Number(transaction.amount) || 0;
    const threshold = options?.thresholds?.highValueAmount
      ?? options?.highValueAmountThreshold
      ?? options?.context?.orchestrationOptions?.thresholds?.highValueAmount
      ?? this.learningConfig.highValueAmountThreshold;
    if (amount >= threshold && threshold > 0) {
      reasons.push(`High-value transaction (${amount}) requires supporting documents`);
    }

    if (reasons.length === 0) {
      return null;
    }

    const userPrompt =
      'We are not fully confident in how this transaction should be classified for carbon accounting. ' +
      'Please confirm the activity type (e.g. fuel, electricity, raw material, transport) or upload a supporting invoice, bill, or receipt.';

    return {
      transactionId: transaction._id || transaction.sourceId || null,
      message: 'Please upload invoices, bills, or receipts to verify this transaction.',
      userPrompt,
      requestedDocuments: ['invoice', 'bill', 'receipt', 'bank_statement'],
      reasons
    };
  }

  learnFromTransactions(transactions = [], options = {}) {
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return { categoriesLearned: 0, transactionTypesLearned: 0 };
    }
    if (options.learningEnabled === false) {
      return { categoriesLearned: 0, transactionTypesLearned: 0 };
    }

    let categoriesLearned = 0;
    let transactionTypesLearned = 0;
    let categoryDirty = false;
    let typeDirty = false;

    transactions.forEach(transaction => {
      const text = this.buildTransactionText(transaction);
      if (!text) {
        return;
      }

      const isManual = transaction.source === 'manual';
      const confidence = transaction.metadata?.confidence || 1;
      const shouldLearn = isManual || confidence >= this.learningConfig.learningConfidence;
      if (!shouldLearn) {
        return;
      }

      const category = this.normalizeCategory(transaction.category);
      if (category) {
        const added = this.addLearnedKeywords(
          category,
          text,
          this.categoryKeywords,
          this.learnedCategoryKeywords,
          this.learningConfig.maxLearnedKeywordsPerCategory
        );
        if (added > 0) {
          categoriesLearned += added;
          categoryDirty = true;
        }
      }

      const transactionType = this.normalizeTransactionType(transaction.transactionType);
      if (transactionType) {
        const added = this.addLearnedKeywords(
          transactionType,
          text,
          this.transactionTypeKeywords,
          this.learnedTransactionTypeKeywords,
          this.learningConfig.maxLearnedKeywordsPerType
        );
        if (added > 0) {
          transactionTypesLearned += added;
          typeDirty = true;
        }
      }
    });

    try {
      if (categoryDirty) {
        this.classifier = new natural.BayesClassifier();
        Object.entries(this.categoryKeywords).forEach(([category, keywords]) => {
          keywords.forEach(keyword => this.classifier.addDocument(keyword, category));
        });
        this.classifier.train();
      }
      if (typeDirty) {
        this.transactionTypeClassifier = new natural.BayesClassifier();
        Object.entries(this.transactionTypeKeywords).forEach(([type, keywords]) => {
          keywords.forEach(keyword => this.transactionTypeClassifier.addDocument(keyword, type));
        });
        this.transactionTypeClassifier.train();
      }
    } catch (error) {
      logger.error('Failed to update classifier learning:', error);
    }

    return { categoriesLearned, transactionTypesLearned };
  }

  addLearnedKeywords(key, text, targetMap, learnedMap, maxSize) {
    const tokens = this.extractKeywords(text);
    if (tokens.length === 0) {
      return 0;
    }

    const normalizedKey = key.toLowerCase();
    if (!targetMap[normalizedKey]) {
      targetMap[normalizedKey] = [];
    }
    if (!learnedMap.has(normalizedKey)) {
      learnedMap.set(normalizedKey, new Set());
    }

    const learnedSet = learnedMap.get(normalizedKey);
    let added = 0;

    tokens.forEach(token => {
      if (learnedSet.has(token) || targetMap[normalizedKey].includes(token)) {
        return;
      }
      if (learnedSet.size >= maxSize) {
        return;
      }
      learnedSet.add(token);
      targetMap[normalizedKey].push(token);
      added += 1;
    });

    return added;
  }

  extractKeywords(text) {
    if (!text) return [];
    const tokens = this.tokenizer.tokenize(text.toLowerCase());
    return tokens
      .map(token => token.replace(/[^\w]/g, ''))
      .filter(token => token.length >= 3 && !this.stopWords.has(token))
      .filter(token => !/^\d+$/.test(token))
      .map(token => this.stemmer.stem(token));
  }

  buildTransactionText(transaction) {
    const vendorName = typeof transaction.vendor === 'string'
      ? transaction.vendor
      : transaction.vendor?.name;
    return [
      transaction.description,
      vendorName,
      transaction.metadata?.originalText
    ].filter(Boolean).join(' ').toLowerCase();
  }

  classifySubcategory(text, category) {
    const subcategoryMap = carbonCategoryTaxonomy.getSubcategoryKeywordMap();
    const normalizedCategory = carbonCategoryTaxonomy.normalizeTransactionCategory(category);

    if (!subcategoryMap[normalizedCategory]) return null;

    for (const [subcategory, keywords] of Object.entries(subcategoryMap[normalizedCategory])) {
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          return carbonCategoryTaxonomy.normalizeSubcategory(subcategory);
        }
      }
    }

    return null;
  }

  applyMsmeContext(transaction, text, options = {}) {
    const contextInput = options.msmeData || options.msmeProfile || options.context;

    // If no MSME profile context but mobile classification provides industry, use it as fallback
    if (!contextInput && transaction.metadata?.mobileClassification?.industry) {
      const mobileIndustry = transaction.metadata.mobileClassification;
      transaction.processingMetadata = {
        ...(transaction.processingMetadata || {}),
        sectorProcessContext: {
          sector: mobileIndustry.industry,
          sectorLabel: mobileIndustry.industryLabel || null,
          confidence: mobileIndustry.industryConfidence || 0,
          source: 'mobile_classification'
        }
      };
      return;
    }

    if (!contextInput) {
      return;
    }

    const classificationContext = buildMsmeClassificationContext(contextInput);
    if (!classificationContext) {
      return;
    }

    const matches = findContextMatches(text, classificationContext);
    transaction.classificationContext = {
      ...classificationContext,
      matchedProcess: matches.processMatch,
      matchedMachinery: matches.machineryMatch,
      matchedProducts: matches.productMatches
    };

    if ((!transaction.subcategory || transaction.subcategory === 'general') && matches.processMatch) {
      transaction.subcategory = matches.processMatch;
    } else if ((!transaction.subcategory || transaction.subcategory === 'general') && matches.machineryMatch) {
      transaction.subcategory = matches.machineryMatch;
    }

    transaction.processingMetadata = {
      ...(transaction.processingMetadata || {}),
      sectorProcessContext: {
        sector: classificationContext.sector,
        matchedProcess: matches.processMatch,
        matchedMachinery: matches.machineryMatch,
        matchedProducts: matches.productMatches
      }
    };
  }

  async applyVerifiedRagClassification(transaction, text, options = {}) {
    const normalizedCategory = String(transaction.category || '').toLowerCase();
    const normalizedSubcategory = String(transaction.subcategory || '').toLowerCase();
    const classificationMeta = transaction.processingMetadata?.classification?.category || {};
    const needsRagResolution = (
      normalizedCategory === 'other' ||
      normalizedCategory === 'unknown' ||
      normalizedSubcategory === 'general' ||
      classificationMeta?.needsReview
    );

    if (!needsRagResolution) {
      return;
    }

    const msmeContext = options.msmeData || options.msmeProfile || options.context || {};
    const ragResult = verifiedKnowledgeRagService.classifyUnknownTransaction({
      text,
      businessDomain: transaction.businessDomain || msmeContext.businessDomain || 'other',
      transactionType: transaction.transactionType || 'other',
      parameterType: 'transaction',
      candidateLocation: transaction.location?.state || transaction.location?.region || transaction.state || ''
    });

    if (!ragResult) {
      return;
    }

    transaction.category = ragResult.category || transaction.category;
    transaction.subcategory = ragResult.subcategory || transaction.subcategory || 'general';
    transaction.transactionType = ragResult.transactionType || transaction.transactionType;
    if (ragResult.locationInference?.region) {
      transaction.region = transaction.region || ragResult.locationInference.region;
      transaction.location = {
        ...(transaction.location || {}),
        region: transaction.location?.region || ragResult.locationInference.region
      };
    }

    const confidence = Number(ragResult.confidence);
    if (Number.isFinite(confidence)) {
      transaction.confidence = Math.max(Number(transaction.confidence) || 0, confidence);
    }

    transaction.classificationContext = {
      ...(transaction.classificationContext || {}),
      ragClassification: {
        category: ragResult.category,
        subcategory: ragResult.subcategory,
        parameterType: ragResult.parameterType,
        normalizedLabel: ragResult.normalizedLabel,
        confidence: ragResult.confidence,
        retrievalMethod: ragResult.retrievalMethod,
        matchedKeywords: ragResult.matchedKeywords,
        verifiedSource: ragResult.verifiedSource,
        referenceNote: ragResult.referenceNote,
        emissionFactor: ragResult.emissionFactor
      }
    };

    transaction.processingMetadata = {
      ...(transaction.processingMetadata || {}),
      classification: {
        ...(transaction.processingMetadata?.classification || {}),
        category: {
          ...(transaction.processingMetadata?.classification?.category || {}),
          source: 'verified_source_rag',
          needsReview: false,
          reasons: []
        }
      },
      verifiedRag: {
        status: 'resolved',
        confidence: ragResult.confidence,
        category: ragResult.category,
        subcategory: ragResult.subcategory,
        verifiedSource: ragResult.verifiedSource
      }
    };

    transaction.metadata = {
      ...(transaction.metadata || {}),
      ragClassification: {
        retrievalMethod: ragResult.retrievalMethod,
        normalizedLabel: ragResult.normalizedLabel,
        verifiedSource: ragResult.verifiedSource,
        emissionFactor: ragResult.emissionFactor,
        matchedKeywords: ragResult.matchedKeywords
      }
    };
  }

  calculateClassificationConfidence(text, category) {
    const keywords = this.categoryKeywords[category] || [];
    if (keywords.length === 0) return 0;
    const matches = keywords.filter(keyword => text.includes(keyword)).length;
    return Math.min(matches / keywords.length, 1);
  }

  isValidCategory(category) {
    return carbonCategoryTaxonomy.isValidTransactionCategory(category);
  }

  isValidTransactionType(transactionType) {
    return this.validTransactionTypes.has(String(transactionType || '').toLowerCase());
  }

  normalizeCategory(category) {
    if (category === undefined || category === null || String(category).trim() === '') {
      return null;
    }
    const normalized = carbonCategoryTaxonomy.normalizeTransactionCategory(category);
    return this.isValidCategory(normalized) ? normalized : null;
  }

  normalizeTransactionType(transactionType) {
    const normalized = String(transactionType || '').toLowerCase();
    return this.isValidTransactionType(normalized) ? normalized : null;
  }

  calculateKeywordConfidence(text, keywords = []) {
    if (!text || keywords.length === 0) {
      return 0;
    }
    const matches = keywords.filter(keyword => text.includes(keyword)).length;
    return Math.min(matches / keywords.length, 1);
  }

  fallbackCategoryFromType(transactionType) {
    const normalized = this.normalizeTransactionType(transactionType);
    const map = {
      purchase: 'raw_materials',
      sale: 'other',
      expense: 'other',
      utility: 'energy',
      transport: 'transportation',
      investment: 'other',
      other: 'other'
    };
    return normalized ? map[normalized] : null;
  }

  getClassifierCandidates(classifier, text) {
    try {
      if (!classifier) return [];
      const candidates = classifier.getClassifications(text || '');
      return candidates.sort((a, b) => b.value - a.value);
    } catch (error) {
      logger.error('Failed to get classifier candidates:', error);
      return [];
    }
  }

  calculateCandidateConfidence(top, runnerUp) {
    if (!top || typeof top.value !== 'number') {
      return 0;
    }
    if (!runnerUp || typeof runnerUp.value !== 'number') {
      return Math.min(1, top.value);
    }
    const total = top.value + runnerUp.value;
    return total > 0 ? Math.min(1, top.value / total) : 0;
  }

  async getVendorSustainabilityData(vendor) {
    // Placeholder for vendor sustainability data lookup
    // In a real implementation, this would query a database or API
    const sustainabilityDatabase = {
      'green energy corp': { isGreen: true, greenScore: 85, certifications: ['ISO 14001'] },
      'eco materials ltd': { isGreen: true, greenScore: 90, certifications: ['FSC', 'GOTS'] },
      'sustainable solutions': { isGreen: true, greenScore: 80, certifications: ['LEED'] }
    };

    const vendorKey = vendor.toLowerCase();
    return sustainabilityDatabase[vendorKey] || null;
  }

  extractLocationData(description) {
    // Simple location extraction - in real implementation, use NLP libraries
    const locationKeywords = ['km', 'miles', 'distance', 'from', 'to', 'near', 'location'];
    const hasLocation = locationKeywords.some(keyword => description.includes(keyword));

    if (hasLocation) {
      return {
        hasLocation: true,
        extracted: this.extractDistance(description)
      };
    }

    return null;
  }

  extractDistance(description) {
    const distanceMatch = description.match(/(\d+)\s*(km|miles|m)/i);
    if (distanceMatch) {
      return {
        value: parseInt(distanceMatch[1]),
        unit: distanceMatch[2].toLowerCase()
      };
    }
    return null;
  }

  extractMaterialType(description) {
    const materialTypes = ['steel', 'aluminum', 'plastic', 'wood', 'concrete', 'fabric', 'paper', 'glass'];

    for (const material of materialTypes) {
      if (description.includes(material)) {
        return material;
      }
    }

    return null;
  }

  extractEnergySource(description) {
    const energySources = {
      'solar': ['solar', 'pv', 'photovoltaic'],
      'wind': ['wind', 'turbine'],
      'hydro': ['hydro', 'water'],
      'grid': ['grid', 'electricity', 'power'],
      'diesel': ['diesel'],
      'petrol': ['petrol', 'gasoline'],
      'cng': ['cng', 'compressed natural gas'],
      'coal': ['coal']
    };

    for (const [source, keywords] of Object.entries(energySources)) {
      for (const keyword of keywords) {
        if (description.includes(keyword)) {
          return source;
        }
      }
    }

    return null;
  }
}

module.exports = new DataProcessorAgent();