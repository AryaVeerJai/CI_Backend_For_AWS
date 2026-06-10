const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../config/database');
const carbonCreditsService = require('../services/carbonCreditsService');
const logger = require('../utils/logger');

async function initializeCarbonCredits() {
  try {
    // Connect to database
    await connectDB();
    logger.info('Connected to database');

    // Initialize carbon credits pool
    const pool = await carbonCreditsService.initializePool();
    logger.info('Carbon credits pool initialized:', {
      poolId: pool.poolId,
      totalCreditsAvailable: pool.totalCreditsAvailable,
      currentPricePerCredit: pool.currentPricePerCredit
    });

    // Set initial price
    await pool.addPriceHistory(50, 0); // ₹50 per credit
    logger.info('Initial price set: ₹50 per credit');

    // Run initial aggregation if there are assessments
    try {
      const result = await carbonCreditsService.aggregateAndAllocateCredits('monthly');
      if (result.success) {
        logger.info('Initial carbon credits aggregation completed:', {
          totalCO2Reduced: result.data.totalCO2Reduced,
          totalCreditsAllocated: result.data.totalCreditsAllocated,
          msmeCount: result.data.msmeCount
        });
      } else {
        logger.info('No carbon assessments found for initial aggregation');
      }
    } catch (error) {
      logger.warn('Initial aggregation failed (this is normal if no assessments exist):', error.message);
    }

    logger.info('Carbon credits system initialization completed successfully');
    process.exit(0);

  } catch (error) {
    logger.error('Error initializing carbon credits system:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  initializeCarbonCredits();
}

module.exports = initializeCarbonCredits;