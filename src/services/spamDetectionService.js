const { scoreSmsSpamSignals } = require('../../../shared/smsSpamPatterns');

class SpamDetectionService {
  constructor() {
    this.scoreSmsSpamSignals = scoreSmsSpamSignals;

    // Spam patterns and keywords
    this.spamPatterns = {
      // Common spam keywords
      keywords: [
        'urgent', 'immediate', 'act now', 'limited time', 'exclusive offer',
        'congratulations', 'you have won', 'free money', 'guaranteed',
        'no risk', '100% free', 'click here', 'unsubscribe',
        'viagra', 'casino', 'lottery', 'winner', 'prize',
        'investment opportunity', 'make money fast', 'work from home',
        'debt consolidation', 'credit repair', 'loan approval'
      ],
      
      // Suspicious patterns
      patterns: [
        /[A-Z]{5,}/g, // Excessive caps
        /[!]{3,}/g,   // Multiple exclamation marks
        /[?]{3,}/g,   // Multiple question marks
        /\$\d+[KMB]/g, // Large money amounts
        /(.)\1{4,}/g,  // Repeated characters
        /https?:\/\/[^\s]+/g, // URLs
        /[0-9]{10,}/g  // Long number sequences
      ],
      
      // Suspicious senders
      suspiciousSenders: [
        'noreply', 'no-reply', 'donotreply', 'do-not-reply',
        'automated', 'system', 'notification', 'alert',
        'spam', 'junk', 'marketing', 'promo'
      ],
      
      // Suspicious domains
      suspiciousDomains: [
        'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
        'aol.com', 'live.com', 'msn.com'
      ]
    };
    
    // Thresholds for spam detection
    this.thresholds = {
      keywordWeight: 2,
      patternWeight: 3,
      senderWeight: 5,
      domainWeight: 3,
      spamThreshold: 10,
      confidenceThreshold: 0.7
    };
  }

  /**
   * Detect if a transaction is spam based on various factors
   * @param {Object} transaction - Transaction object
   * @param {Object} metadata - Additional metadata (sender, subject, etc.)
   * @returns {Object} - Detection result with score and reasons
   */
  detectSpam(transaction, metadata = {}) {
    const detection = {
      isSpam: false,
      score: 0,
      reasons: [],
      confidence: 0
    };

    // Check description for spam indicators
    const descriptionScore = this.analyzeText(transaction.description);
    detection.score += descriptionScore.score;
    detection.reasons.push(...descriptionScore.reasons);

    // Check vendor name for spam indicators
    if (transaction.vendor && transaction.vendor.name) {
      const vendorScore = this.analyzeText(transaction.vendor.name);
      detection.score += vendorScore.score;
      detection.reasons.push(...vendorScore.reasons);
    }

    // Check metadata for spam indicators
    if (metadata.sender) {
      const senderScore = this.analyzeSender(metadata.sender);
      detection.score += senderScore.score;
      detection.reasons.push(...senderScore.reasons);
    }

    if (metadata.subject) {
      const subjectScore = this.analyzeText(metadata.subject);
      detection.score += subjectScore.score;
      detection.reasons.push(...subjectScore.reasons);
    }

    // Check for suspicious amounts
    const amountScore = this.analyzeAmount(transaction.amount);
    detection.score += amountScore.score;
    detection.reasons.push(...amountScore.reasons);

    // Check for suspicious timing patterns
    const timingScore = this.analyzeTiming(transaction.date);
    detection.score += timingScore.score;
    detection.reasons.push(...timingScore.reasons);

    // Determine if it's spam
    detection.isSpam = detection.score >= this.thresholds.spamThreshold;
    detection.confidence = Math.min(1, detection.score / (this.thresholds.spamThreshold * 2));

    return detection;
  }

  /**
   * Analyze text content for spam indicators
   * @param {string} text - Text to analyze
   * @returns {Object} - Analysis result
   */
  analyzeText(text) {
    if (!text) return { score: 0, reasons: [] };

    const analysis = {
      score: 0,
      reasons: []
    };

    const lowerText = text.toLowerCase();

    const smsSignals = this.scoreSmsSpamSignals(text);
    if (smsSignals.signals.includes('otp') || smsSignals.signals.includes('promotional')) {
      analysis.score += this.thresholds.spamThreshold;
      analysis.reasons.push(`Shared SMS spam signals: ${smsSignals.signals.join(', ')}`);
    }

    // Check for spam keywords
    const keywordMatches = this.spamPatterns.keywords.filter(keyword => 
      lowerText.includes(keyword.toLowerCase())
    );
    analysis.score += keywordMatches.length * this.thresholds.keywordWeight;
    if (keywordMatches.length > 0) {
      analysis.reasons.push(`Contains spam keywords: ${keywordMatches.join(', ')}`);
    }

    // Check for suspicious patterns
    this.spamPatterns.patterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        analysis.score += matches.length * this.thresholds.patternWeight;
        analysis.reasons.push(`Contains suspicious pattern: ${pattern.source}`);
      }
    });

    // Check for excessive repetition
    const words = text.split(/\s+/);
    const wordCount = {};
    words.forEach(word => {
      wordCount[word.toLowerCase()] = (wordCount[word.toLowerCase()] || 0) + 1;
    });
    
    const repeatedWords = Object.entries(wordCount).filter(([word, count]) => count > 3);
    if (repeatedWords.length > 0) {
      analysis.score += repeatedWords.length * 2;
      analysis.reasons.push(`Excessive word repetition: ${repeatedWords.map(([word]) => word).join(', ')}`);
    }

    return analysis;
  }

  /**
   * Analyze sender information for spam indicators
   * @param {string} sender - Sender email or phone number
   * @returns {Object} - Analysis result
   */
  analyzeSender(sender) {
    const analysis = {
      score: 0,
      reasons: []
    };

    if (!sender) return analysis;

    const lowerSender = sender.toLowerCase();

    // Check for suspicious sender patterns
    const suspiciousSender = this.spamPatterns.suspiciousSenders.find(pattern => 
      lowerSender.includes(pattern)
    );
    if (suspiciousSender) {
      analysis.score += this.thresholds.senderWeight;
      analysis.reasons.push(`Suspicious sender pattern: ${suspiciousSender}`);
    }

    // Check for suspicious domains
    if (sender.includes('@')) {
      const domain = sender.split('@')[1];
      const suspiciousDomain = this.spamPatterns.suspiciousDomains.find(pattern => 
        domain.includes(pattern)
      );
      if (suspiciousDomain) {
        analysis.score += this.thresholds.domainWeight;
        analysis.reasons.push(`Suspicious domain: ${suspiciousDomain}`);
      }
    }

    // Check for random-looking sender names
    if (this.isRandomString(sender)) {
      analysis.score += 3;
      analysis.reasons.push('Random-looking sender name');
    }

    return analysis;
  }

  /**
   * Analyze transaction amount for spam indicators
   * @param {number} amount - Transaction amount
   * @returns {Object} - Analysis result
   */
  analyzeAmount(amount) {
    const analysis = {
      score: 0,
      reasons: []
    };

    if (!amount || amount <= 0) return analysis;

    // Check for suspiciously round amounts
    if (amount % 1000 === 0 && amount > 10000) {
      analysis.score += 2;
      analysis.reasons.push('Suspiciously round large amount');
    }

    // Check for very large amounts
    if (amount > 1000000) {
      analysis.score += 3;
      analysis.reasons.push('Very large transaction amount');
    }

    // Check for very small amounts (potential test transactions)
    if (amount < 10) {
      analysis.score += 1;
      analysis.reasons.push('Very small transaction amount');
    }

    return analysis;
  }

  /**
   * Analyze transaction timing for spam indicators
   * @param {Date} date - Transaction date
   * @returns {Object} - Analysis result
   */
  analyzeTiming(date) {
    const analysis = {
      score: 0,
      reasons: []
    };

    if (!date) return analysis;

    const now = new Date();
    const transactionDate = new Date(date);
    const timeDiff = now - transactionDate;

    // Check for future dates
    if (transactionDate > now) {
      analysis.score += 5;
      analysis.reasons.push('Future transaction date');
    }

    // Check for very old dates
    const daysDiff = timeDiff / (1000 * 60 * 60 * 24);
    if (daysDiff > 365) {
      analysis.score += 2;
      analysis.reasons.push('Very old transaction date');
    }

    // Check for suspicious time patterns (e.g., exactly midnight)
    const hours = transactionDate.getHours();
    const minutes = transactionDate.getMinutes();
    if (hours === 0 && minutes === 0) {
      analysis.score += 1;
      analysis.reasons.push('Transaction at exactly midnight');
    }

    return analysis;
  }

  /**
   * Check if a string appears to be randomly generated
   * @param {string} str - String to check
   * @returns {boolean} - True if appears random
   */
  isRandomString(str) {
    if (!str || str.length < 5) return false;

    // Check for high ratio of numbers to letters
    const numbers = (str.match(/\d/g) || []).length;
    const letters = (str.match(/[a-zA-Z]/g) || []).length;
    if (letters > 0 && numbers / letters > 2) {
      return true;
    }

    // Check for lack of vowels
    const vowels = (str.match(/[aeiouAEIOU]/g) || []).length;
    if (letters > 0 && vowels / letters < 0.2) {
      return true;
    }

    // Check for repeated character patterns
    const repeatedPattern = /(.)\1{2,}/g;
    if (repeatedPattern.test(str)) {
      return true;
    }

    return false;
  }

  /**
   * Get spam detection statistics for an MSME
   * @param {string} msmeId - MSME ID
   * @param {Date} startDate - Start date for analysis
   * @param {Date} endDate - End date for analysis
   * @returns {Object} - Spam statistics
   */
  async getSpamStatistics(msmeId, startDate, endDate) {
    const Transaction = require('../models/Transaction');
    
    const query = { isSpam: true };
    if (msmeId) {
      query.msmeId = msmeId;
    }
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const spamTransactions = await Transaction.find(query);
    
    const statistics = {
      totalSpamTransactions: spamTransactions.length,
      spamBySource: {},
      spamByCategory: {},
      commonSpamReasons: {},
      spamTrend: {}
    };

    // Analyze spam transactions
    spamTransactions.forEach(transaction => {
      // By source
      const source = transaction.source;
      statistics.spamBySource[source] = (statistics.spamBySource[source] || 0) + 1;

      // By category
      const category = transaction.category;
      statistics.spamByCategory[category] = (statistics.spamByCategory[category] || 0) + 1;

      // Common reasons
      if (transaction.spamReasons) {
        transaction.spamReasons.forEach(reason => {
          statistics.commonSpamReasons[reason] = (statistics.commonSpamReasons[reason] || 0) + 1;
        });
      }

      // Trend by month
      const month = transaction.date.toISOString().substring(0, 7);
      statistics.spamTrend[month] = (statistics.spamTrend[month] || 0) + 1;
    });

    return statistics;
  }
}

module.exports = new SpamDetectionService();