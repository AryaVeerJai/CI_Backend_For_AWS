const express = require('express');
const fuelPriceService = require('../services/fuelPriceService');
const logger = require('../utils/logger');

const router = express.Router();

// @route   GET /api/fuel-prices
// @desc    Get current location-wise fuel prices from PPAC (Govt. of India)
// @access  Public
router.get('/', async (req, res) => {
  try {
    const { location, days, refresh } = req.query;

    const data = await fuelPriceService.getFuelPrices({
      location,
      days: days === undefined ? undefined : Number.parseInt(days, 10),
      forceRefresh: refresh === 'true'
    });

    res.json({
      success: true,
      data
    });
  } catch (error) {
    logger.error('Fuel prices API error', {
      message: error.message,
      stack: error.stack
    });

    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Unable to fetch fuel prices'
    });
  }
});

module.exports = router;
