const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Bank = require('../models/Bank');
const GreenLoan = require('../models/GreenLoan');
const MSME = require('../models/MSME');
const CarbonAssessment = require('../models/CarbonAssessment');
const logger = require('../utils/logger');

// @route   GET /api/banks
// @desc    Get all active banks
// @access  Public
router.get('/', async (req, res) => {
  try {
    const banks = await Bank.find({ isActive: true })
      .select('-__v')
      .sort({ bankName: 1 });

    res.json({
      success: true,
      data: banks
    });

  } catch (error) {
    logger.error('Get banks error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/banks/:id
// @desc    Get bank by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const bank = await Bank.findById(req.params.id);

    if (!bank) {
      return res.status(404).json({
        success: false,
        message: 'Bank not found'
      });
    }

    res.json({
      success: true,
      data: bank
    });

  } catch (error) {
    logger.error('Get bank by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/banks
// @desc    Create new bank
// @access  Private (Admin only)
router.post('/', [
  auth,
  body('bankName').notEmpty().withMessage('Bank name is required'),
  body('bankCode').notEmpty().withMessage('Bank code is required'),
  body('contact.email').isEmail().withMessage('Valid email is required'),
  body('contact.phone').notEmpty().withMessage('Phone is required'),
  body('greenLoanPolicy.minCarbonScore').isNumeric().withMessage('Min carbon score must be a number'),
  body('greenLoanPolicy.maxLoanAmount').isNumeric().withMessage('Max loan amount must be a number'),
  body('greenLoanPolicy.minLoanAmount').isNumeric().withMessage('Min loan amount must be a number')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    // Check if bank code already exists
    const existingBank = await Bank.findOne({ bankCode: req.body.bankCode });
    if (existingBank) {
      return res.status(400).json({
        success: false,
        message: 'Bank code already exists'
      });
    }

    const bank = new Bank(req.body);
    await bank.save();

    logger.info(`Bank created: ${bank._id}`, {
      bankName: bank.bankName,
      bankCode: bank.bankCode
    });

    res.status(201).json({
      success: true,
      message: 'Bank created successfully',
      data: bank
    });

  } catch (error) {
    logger.error('Create bank error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PUT /api/banks/:id
// @desc    Update bank
// @access  Private (Admin only)
router.put('/:id', [
  auth,
  body('bankName').optional().notEmpty().withMessage('Bank name cannot be empty'),
  body('contact.email').optional().isEmail().withMessage('Valid email is required'),
  body('contact.phone').optional().notEmpty().withMessage('Phone cannot be empty')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const bank = await Bank.findById(req.params.id);
    if (!bank) {
      return res.status(404).json({
        success: false,
        message: 'Bank not found'
      });
    }

    // Update allowed fields
    const allowedFields = ['bankName', 'contact', 'greenLoanPolicy', 'isActive'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        if (typeof req.body[field] === 'object' && !Array.isArray(req.body[field])) {
          bank[field] = { ...bank[field], ...req.body[field] };
        } else {
          bank[field] = req.body[field];
        }
      }
    });

    await bank.save();

    logger.info(`Bank updated: ${bank._id}`, {
      updatedFields: Object.keys(req.body)
    });

    res.json({
      success: true,
      message: 'Bank updated successfully',
      data: bank
    });

  } catch (error) {
    logger.error('Update bank error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/banks/:id/loans
// @desc    Get loans for a specific bank
// @access  Private (Bank only)
router.get('/:id/loans', auth, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const query = { bankId: req.params.id };
    if (status) {
      query.status = status;
    }

    const loans = await GreenLoan.find(query)
      .populate('msmeId', 'companyName companyType industry business.annualTurnover')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await GreenLoan.countDocuments(query);

    res.json({
      success: true,
      data: {
        loans,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    logger.error('Get bank loans error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/banks/:id/statistics
// @desc    Get bank statistics
// @access  Private (Bank only)
router.get('/:id/statistics', auth, async (req, res) => {
  try {
    const bankId = req.params.id;

    // Total loans
    const totalLoans = await GreenLoan.countDocuments({ bankId });
    
    // Loans by status
    const loansByStatus = await GreenLoan.aggregate([
      { $match: { bankId: mongoose.Types.ObjectId(bankId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Total loan amount
    const totalLoanAmount = await GreenLoan.aggregate([
      { $match: { bankId: mongoose.Types.ObjectId(bankId) } },
      { $group: { _id: null, total: { $sum: '$loanApplication.loanAmount' } } }
    ]);

    // Average carbon score of loan applicants
    const avgCarbonScore = await GreenLoan.aggregate([
      { $match: { bankId: mongoose.Types.ObjectId(bankId) } },
      { $group: { _id: null, average: { $avg: '$carbonAssessment.currentCarbonScore' } } }
    ]);

    // Monthly loan applications
    const monthlyApplications = await GreenLoan.aggregate([
      { $match: { bankId: mongoose.Types.ObjectId(bankId) } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$loanApplication.loanAmount' }
        }
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 }
    ]);

    const statistics = {
      totalLoans,
      loansByStatus: loansByStatus.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      totalLoanAmount: totalLoanAmount[0]?.total || 0,
      averageCarbonScore: avgCarbonScore[0]?.average || 0,
      monthlyApplications
    };

    res.json({
      success: true,
      data: statistics
    });

  } catch (error) {
    logger.error('Get bank statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;