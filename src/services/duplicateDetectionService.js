const { shouldRunMaintenanceTimers } = require('../config/backgroundLoops');
const { setManagedInterval } = require('../utils/intervalRegistry');

class DuplicateDetectionService {
  constructor() {
    // Time window for duplicate detection (10 seconds)
    this.duplicateWindowMs = 10 * 1000;
    // Expanded window for cross-channel (SMS/document/email) duplicate checks
    this.crossChannelWindowMs = 30 * 24 * 60 * 60 * 1000;
    
    // Similarity thresholds
    this.thresholds = {
      exactMatch: 1.0,        // 100% similarity
      nearMatch: 0.85,        // 85% similarity
      fuzzyMatch: 0.70        // 70% similarity
    };
    this.crossChannelThresholds = {
      exactMatch: 0.92,
      nearMatch: 0.84,
      fuzzyMatch: 0.76
    };
    
    // Cache for recent transactions to avoid database queries
    this.recentTransactionsCache = new Map();
    
    // Clean up cache every 5 minutes
    if (shouldRunMaintenanceTimers()) {
      setManagedInterval(() => {
        this.cleanupCache();
      }, 5 * 60 * 1000);
    }
  }

  /**
   * Detect if a transaction is a duplicate within the time window
   * @param {Object} transaction - New transaction to check
   * @param {string} msmeId - MSME ID
   * @param {Object} options - Duplicate detection options
   * @returns {Object} - Duplicate detection result
   */
  async detectDuplicate(transaction, msmeId, options = {}) {
    const detection = {
      isDuplicate: false,
      duplicateType: null,
      similarityScore: 0,
      matchedTransaction: null,
      reasons: []
    };

    try {
      const normalizedDate = this.normalizeDate(transaction?.date);
      const transactionForDetection = {
        ...transaction,
        date: normalizedDate
      };

      // Same-channel quick duplicate detection (low-latency cache path).
      const sameChannelTransactions = await this.getRecentTransactions(
        msmeId,
        normalizedDate,
        this.duplicateWindowMs
      );
      const sameChannelDetection = this.evaluateSameChannelDuplicates(
        transactionForDetection,
        sameChannelTransactions
      );

      if (sameChannelDetection.isDuplicate) {
        return sameChannelDetection;
      }

      // Cross-channel duplicate detection (SMS vs document upload/email/manual).
      if (options.includeCrossChannel !== false) {
        const crossChannelTransactions = await this.getRecentTransactions(
          msmeId,
          normalizedDate,
          options.crossChannelWindowMs || this.crossChannelWindowMs,
          { useCache: false }
        );
        const crossChannelDetection = this.evaluateCrossChannelDuplicates(
          transactionForDetection,
          crossChannelTransactions
        );
        if (crossChannelDetection.isDuplicate) {
          return crossChannelDetection;
        }
      }

      // Cache the transaction for future duplicate detection
      this.cacheTransaction(msmeId, transactionForDetection);

    } catch (error) {
      console.error('Duplicate detection error:', error);
      // If there's an error, don't mark as duplicate to avoid false positives
    }

    return detection;
  }

  /**
   * Get recent transactions within the duplicate detection window
   * @param {string} msmeId - MSME ID
   * @param {Date} transactionDate - Transaction date
   * @param {number} windowMs - Duplicate window in milliseconds
   * @param {Object} options - Query options
   * @returns {Array} - Recent transactions
   */
  async getRecentTransactions(msmeId, transactionDate, windowMs = this.duplicateWindowMs, options = {}) {
    const normalizedDate = this.normalizeDate(transactionDate);
    const effectiveWindowMs = Number.isFinite(windowMs) && windowMs > 0
      ? windowMs
      : this.duplicateWindowMs;
    const useCache = options.useCache !== false && effectiveWindowMs <= this.duplicateWindowMs;
    const cacheKey = this.buildCacheKey(msmeId, normalizedDate, effectiveWindowMs);

    if (useCache && this.recentTransactionsCache.has(cacheKey)) {
      const cached = this.recentTransactionsCache.get(cacheKey);
      const windowStart = new Date(normalizedDate.getTime() - effectiveWindowMs);
      const windowEnd = new Date(normalizedDate.getTime() + effectiveWindowMs);

      return cached.filter(tx => {
        const txDate = this.normalizeDate(tx.date);
        return txDate >= windowStart && txDate <= windowEnd;
      });
    }

    // Query database for recent transactions
    const Transaction = require('../models/Transaction');
    const windowStart = new Date(normalizedDate.getTime() - effectiveWindowMs);
    const windowEnd = new Date(normalizedDate.getTime() + effectiveWindowMs);

    const recentTransactions = await Transaction.find({
      msmeId,
      date: {
        $gte: windowStart,
        $lte: windowEnd
      },
      isDuplicate: { $ne: true } // Exclude already marked duplicates
    }).sort({ date: -1 });

    // Cache the results
    if (useCache) {
      this.recentTransactionsCache.set(cacheKey, recentTransactions);
    }

    return recentTransactions;
  }

  buildCacheKey(msmeId, transactionDate, windowMs = this.duplicateWindowMs) {
    const normalizedDate = this.normalizeDate(transactionDate);
    return `${msmeId}_${normalizedDate.toISOString().split('T')[0]}_${windowMs}`;
  }

  normalizeDate(dateValue) {
    const parsed = dateValue instanceof Date ? dateValue : new Date(dateValue || Date.now());
    if (Number.isNaN(parsed.getTime())) {
      return new Date();
    }
    return parsed;
  }

  evaluateSameChannelDuplicates(transaction, recentTransactions = []) {
    let bestMatch = null;
    let highestSimilarity = 0;
    let duplicateType = null;

    for (const recentTx of recentTransactions) {
      if (transaction.source && recentTx.source && transaction.source !== recentTx.source) {
        continue;
      }
      const similarity = this.calculateSimilarity(transaction, recentTx);
      const resolvedType = this.resolveDuplicateType(similarity, this.thresholds);
      if (resolvedType && similarity > highestSimilarity) {
        highestSimilarity = similarity;
        bestMatch = recentTx;
        duplicateType = resolvedType;
      }
    }

    if (!bestMatch || !duplicateType) {
      return {
        isDuplicate: false,
        duplicateType: null,
        similarityScore: highestSimilarity,
        matchedTransaction: null,
        reasons: []
      };
    }

    return {
      isDuplicate: true,
      duplicateType,
      similarityScore: highestSimilarity,
      matchedTransaction: bestMatch,
      reasons: [`${duplicateType.charAt(0).toUpperCase()}${duplicateType.slice(1)} match found`]
    };
  }

  evaluateCrossChannelDuplicates(transaction, recentTransactions = []) {
    let bestMatch = null;
    let bestEvidence = null;
    let bestDuplicateType = null;

    for (const recentTx of recentTransactions) {
      if (!recentTx) continue;
      if (transaction.source && recentTx.source && transaction.source === recentTx.source) {
        continue;
      }

      const evidence = this.calculateCrossChannelEvidence(transaction, recentTx);
      const duplicateType = this.resolveCrossChannelDuplicateType(evidence);
      if (!duplicateType) {
        continue;
      }

      if (!bestEvidence || evidence.score > bestEvidence.score) {
        bestEvidence = evidence;
        bestMatch = recentTx;
        bestDuplicateType = duplicateType;
      }
    }

    if (!bestMatch || !bestEvidence || !bestDuplicateType) {
      return {
        isDuplicate: false,
        duplicateType: null,
        similarityScore: 0,
        matchedTransaction: null,
        reasons: []
      };
    }

    return {
      isDuplicate: true,
      duplicateType: bestDuplicateType,
      similarityScore: bestEvidence.score,
      matchedTransaction: bestMatch,
      reasons: this.buildCrossChannelReasons(transaction, bestMatch, bestEvidence)
    };
  }

  resolveDuplicateType(similarity, thresholds = this.thresholds) {
    if (similarity >= thresholds.exactMatch) return 'exact';
    if (similarity >= thresholds.nearMatch) return 'near';
    if (similarity >= thresholds.fuzzyMatch) return 'fuzzy';
    return null;
  }

  calculateCrossChannelEvidence(transaction1, transaction2) {
    const amountSimilarity = (transaction1.amount && transaction2.amount)
      ? this.calculateAmountSimilarity(Number(transaction1.amount), Number(transaction2.amount))
      : 0;
    const vendorSimilarity = (transaction1.vendor && transaction2.vendor)
      ? this.calculateVendorSimilarity(transaction1.vendor, transaction2.vendor)
      : 0;
    const descriptionSimilarity = (transaction1.description && transaction2.description)
      ? this.calculateTextSimilarity(transaction1.description, transaction2.description)
      : 0;
    const categorySimilarity = (transaction1.category && transaction2.category && transaction1.category === transaction2.category)
      ? 1
      : 0;
    const dateSimilarity = this.calculateDateSimilarity(transaction1.date, transaction2.date);
    const referenceMatch = this.hasReferenceMatch(transaction1, transaction2);

    const components = [
      { key: 'amount', value: amountSimilarity, weight: 0.35 },
      { key: 'vendor', value: vendorSimilarity, weight: 0.25 },
      { key: 'description', value: descriptionSimilarity, weight: 0.2 },
      { key: 'date', value: dateSimilarity, weight: 0.15 },
      { key: 'category', value: categorySimilarity, weight: 0.05 }
    ].filter(component => component.value > 0);

    const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
    const weightedScore = totalWeight > 0
      ? components.reduce((sum, component) => sum + (component.value * component.weight), 0) / totalWeight
      : 0;

    let score = weightedScore;
    if (referenceMatch) {
      score = Math.min(1, score + 0.12);
    }
    if (amountSimilarity >= 0.95 && (vendorSimilarity >= 0.8 || descriptionSimilarity >= 0.85)) {
      score = Math.min(1, score + 0.08);
    }

    return {
      score,
      weightedScore,
      amountSimilarity,
      vendorSimilarity,
      descriptionSimilarity,
      categorySimilarity,
      dateSimilarity,
      referenceMatch
    };
  }

  resolveCrossChannelDuplicateType(evidence = {}) {
    const hasStrongAnchor = evidence.referenceMatch ||
      (evidence.amountSimilarity >= 0.95 &&
        (evidence.vendorSimilarity >= 0.8 || evidence.descriptionSimilarity >= 0.85));
    const hasTemporalProximity = evidence.referenceMatch || evidence.dateSimilarity >= 0.5;

    if (!hasStrongAnchor || !hasTemporalProximity) {
      return null;
    }

    if (
      evidence.score >= this.crossChannelThresholds.exactMatch &&
      (evidence.referenceMatch || evidence.dateSimilarity >= 0.7)
    ) {
      return 'exact';
    }
    if (
      evidence.score >= this.crossChannelThresholds.nearMatch &&
      (evidence.referenceMatch || evidence.dateSimilarity >= 0.6)
    ) {
      return 'near';
    }
    if (
      evidence.score >= this.crossChannelThresholds.fuzzyMatch &&
      evidence.amountSimilarity >= 0.9 &&
      (evidence.referenceMatch || evidence.dateSimilarity >= 0.7)
    ) {
      return 'fuzzy';
    }
    return null;
  }

  calculateDateSimilarity(date1, date2) {
    if (!date1 || !date2) return 0;
    const normalized1 = this.normalizeDate(date1);
    const normalized2 = this.normalizeDate(date2);
    const daysDiff = Math.abs(normalized1 - normalized2) / (1000 * 60 * 60 * 24);
    if (daysDiff <= 1) return 1;
    return Math.max(0, 1 - (daysDiff / 30));
  }

  hasReferenceMatch(transaction1 = {}, transaction2 = {}) {
    const references1 = this.extractReferenceTokens(transaction1);
    const references2 = this.extractReferenceTokens(transaction2);
    if (references1.size === 0 || references2.size === 0) {
      return false;
    }
    for (const reference of references1) {
      if (references2.has(reference)) {
        return true;
      }
    }
    return false;
  }

  extractReferenceTokens(transaction = {}) {
    const values = [
      transaction.sourceId,
      transaction.referenceNumber,
      transaction.metadata?.referenceNumber,
      transaction.metadata?.extractedData?.referenceNumber,
      transaction.metadata?.extractedData?.reference
    ];

    const tokens = new Set();
    values.forEach(value => {
      if (!value) return;
      const normalized = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (normalized.length >= 4) {
        tokens.add(normalized);
      }
    });

    return tokens;
  }

  buildCrossChannelReasons(transaction, matchedTransaction, evidence = {}) {
    const reasons = [];
    const sourceA = transaction.source || 'unknown_source';
    const sourceB = matchedTransaction?.source || 'unknown_source';
    reasons.push(`Cross-channel ${evidence.referenceMatch ? 'reference' : 'transaction'} match (${sourceA} ↔ ${sourceB})`);

    if (evidence.referenceMatch) {
      reasons.push('Reference identifier matched');
    }
    if (evidence.amountSimilarity >= 0.95) {
      reasons.push('Amount closely matched');
    }
    if (evidence.vendorSimilarity >= 0.8) {
      reasons.push('Vendor closely matched');
    }
    if (evidence.descriptionSimilarity >= 0.8) {
      reasons.push('Description closely matched');
    }

    return reasons;
  }

  /**
   * Calculate similarity between two transactions
   * @param {Object} transaction1 - First transaction
   * @param {Object} transaction2 - Second transaction
   * @returns {number} - Similarity score (0-1)
   */
  calculateSimilarity(transaction1, transaction2) {
    const weights = {
      amount: 0.3,
      description: 0.25,
      vendor: 0.2,
      category: 0.15,
      source: 0.1
    };

    let totalScore = 0;
    let totalWeight = 0;

    // Amount similarity
    if (transaction1.amount && transaction2.amount) {
      const amountSimilarity = this.calculateAmountSimilarity(transaction1.amount, transaction2.amount);
      totalScore += amountSimilarity * weights.amount;
      totalWeight += weights.amount;
    }

    // Description similarity
    if (transaction1.description && transaction2.description) {
      const descriptionSimilarity = this.calculateTextSimilarity(
        transaction1.description, 
        transaction2.description
      );
      totalScore += descriptionSimilarity * weights.description;
      totalWeight += weights.description;
    }

    // Vendor similarity
    if (transaction1.vendor && transaction2.vendor) {
      const vendorSimilarity = this.calculateVendorSimilarity(transaction1.vendor, transaction2.vendor);
      totalScore += vendorSimilarity * weights.vendor;
      totalWeight += weights.vendor;
    }

    // Category similarity
    if (transaction1.category && transaction2.category) {
      const categorySimilarity = transaction1.category === transaction2.category ? 1 : 0;
      totalScore += categorySimilarity * weights.category;
      totalWeight += weights.category;
    }

    // Source similarity
    if (transaction1.source && transaction2.source) {
      const sourceSimilarity = transaction1.source === transaction2.source ? 1 : 0;
      totalScore += sourceSimilarity * weights.source;
      totalWeight += weights.source;
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  /**
   * Calculate amount similarity
   * @param {number} amount1 - First amount
   * @param {number} amount2 - Second amount
   * @returns {number} - Similarity score (0-1)
   */
  calculateAmountSimilarity(amount1, amount2) {
    if (amount1 === amount2) return 1;
    
    const diff = Math.abs(amount1 - amount2);
    const avg = (amount1 + amount2) / 2;
    if (avg === 0) return 0;
    const relativeDiff = diff / avg;
    
    // If amounts are very close (within 1%), consider them similar
    if (relativeDiff <= 0.01) return 0.95;
    
    // If amounts are close (within 5%), consider them somewhat similar
    if (relativeDiff <= 0.05) return 0.8;
    
    // If amounts are reasonably close (within 20%), consider them somewhat similar
    if (relativeDiff <= 0.20) return 0.6;
    
    return 0;
  }

  /**
   * Calculate text similarity using Jaccard similarity
   * @param {string} text1 - First text
   * @param {string} text2 - Second text
   * @returns {number} - Similarity score (0-1)
   */
  calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    if (text1 === text2) return 1;

    // Normalize text
    const normalize = (text) => text.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const normalized1 = normalize(text1);
    const normalized2 = normalize(text2);

    // Create word sets
    const words1 = new Set(normalized1.split(/\s+/).filter(w => w.length > 0));
    const words2 = new Set(normalized2.split(/\s+/).filter(w => w.length > 0));

    // Calculate Jaccard similarity
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Calculate vendor similarity
   * @param {Object} vendor1 - First vendor
   * @param {Object} vendor2 - Second vendor
   * @returns {number} - Similarity score (0-1)
   */
  calculateVendorSimilarity(vendor1, vendor2) {
    if (!vendor1 || !vendor2) return 0;

    let totalScore = 0;
    let totalWeight = 0;

    // Name similarity
    if (vendor1.name && vendor2.name) {
      const nameSimilarity = this.calculateTextSimilarity(vendor1.name, vendor2.name);
      totalScore += nameSimilarity * 0.6;
      totalWeight += 0.6;
    }

    // Category similarity
    if (vendor1.category && vendor2.category) {
      const categorySimilarity = vendor1.category === vendor2.category ? 1 : 0;
      totalScore += categorySimilarity * 0.4;
      totalWeight += 0.4;
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  /**
   * Cache a transaction for future duplicate detection
   * @param {string} msmeId - MSME ID
   * @param {Object} transaction - Transaction to cache
   */
  cacheTransaction(msmeId, transaction) {
    const cacheKey = this.buildCacheKey(msmeId, transaction.date, this.duplicateWindowMs);
    
    if (!this.recentTransactionsCache.has(cacheKey)) {
      this.recentTransactionsCache.set(cacheKey, []);
    }
    
    const cached = this.recentTransactionsCache.get(cacheKey);
    cached.push(transaction);
    
    // Keep only recent transactions (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const filtered = cached.filter(tx => this.normalizeDate(tx.date) > oneDayAgo);
    this.recentTransactionsCache.set(cacheKey, filtered);
  }

  /**
   * Clean up old cache entries
   */
  cleanupCache() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    for (const [key, transactions] of this.recentTransactionsCache.entries()) {
      const filtered = transactions.filter(tx => this.normalizeDate(tx.date) > oneDayAgo);
      if (filtered.length === 0) {
        this.recentTransactionsCache.delete(key);
      } else {
        this.recentTransactionsCache.set(key, filtered);
      }
    }
  }

  /**
   * Get duplicate detection statistics for an MSME
   * @param {string} msmeId - MSME ID
   * @param {Date} startDate - Start date for analysis
   * @param {Date} endDate - End date for analysis
   * @returns {Object} - Duplicate statistics
   */
  async getDuplicateStatistics(msmeId, startDate, endDate) {
    const Transaction = require('../models/Transaction');
    
    const query = {
      isDuplicate: true
    };

    if (msmeId) {
      query.msmeId = msmeId;
    }
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const duplicateTransactions = await Transaction.find(query);
    
    const statistics = {
      totalDuplicateTransactions: duplicateTransactions.length,
      duplicatesByType: {},
      duplicatesBySource: {},
      duplicatesByCategory: {},
      duplicateTrend: {},
      averageSimilarityScore: 0
    };

    let totalSimilarity = 0;

    // Analyze duplicate transactions
    duplicateTransactions.forEach(transaction => {
      // By type
      const type = transaction.duplicateType || 'unknown';
      statistics.duplicatesByType[type] = (statistics.duplicatesByType[type] || 0) + 1;

      // By source
      const source = transaction.source;
      statistics.duplicatesBySource[source] = (statistics.duplicatesBySource[source] || 0) + 1;

      // By category
      const category = transaction.category;
      statistics.duplicatesByCategory[category] = (statistics.duplicatesByCategory[category] || 0) + 1;

      // Trend by month
      const month = transaction.date.toISOString().substring(0, 7);
      statistics.duplicateTrend[month] = (statistics.duplicateTrend[month] || 0) + 1;

      // Similarity score
      if (transaction.similarityScore) {
        totalSimilarity += transaction.similarityScore;
      }
    });

    // Calculate average similarity score
    statistics.averageSimilarityScore = duplicateTransactions.length > 0 ? 
      totalSimilarity / duplicateTransactions.length : 0;

    return statistics;
  }

  /**
   * Mark a transaction as duplicate
   * @param {string} transactionId - Transaction ID
   * @param {Object} duplicateInfo - Duplicate detection information
   * @returns {Object} - Updated transaction
   */
  async markAsDuplicate(transactionId, duplicateInfo) {
    const Transaction = require('../models/Transaction');
    
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      throw new Error('Transaction not found');
    }

    transaction.isDuplicate = true;
    transaction.duplicateType = duplicateInfo.duplicateType;
    transaction.similarityScore = duplicateInfo.similarityScore;
    transaction.matchedTransactionId = duplicateInfo.matchedTransaction?._id;
    transaction.duplicateReasons = duplicateInfo.reasons;

    await transaction.save();
    return transaction;
  }
}

module.exports = new DuplicateDetectionService();