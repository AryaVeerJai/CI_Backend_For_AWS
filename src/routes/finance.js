const express = require('express');
const auth = require('../middleware/auth');
const { handleFinanceOverview } = require('./financeOverviewHandler');

const router = express.Router();

// @route   GET /api/finance/overview
// @desc    Legacy alias for structured finance & incentives eligibility overview
// @access  Private
router.get('/overview', auth, handleFinanceOverview);

module.exports = router;
