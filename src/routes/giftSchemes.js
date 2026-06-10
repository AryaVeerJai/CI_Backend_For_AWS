const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const GIFTScheme = require('../models/GIFTScheme');
const GIFTApplication = require('../models/GIFTApplication');
const MSME = require('../models/MSME');
const logger = require('../utils/logger');
const { ADEETIE_SCHEME_CODE } = require('../config/adeetie');
const adeetieService = require('../services/adeetieEligibilityService');

// @route   GET /api/gift-schemes
// @desc    Get all active GIFT schemes
// @access  Public
router.get('/', async (req, res) => {
  try {
    const { category, status = 'active', page = 1, limit = 10 } = req.query;
    
    const query = { status };
    if (category) {
      query.category = category;
    }

    const schemes = await GIFTScheme.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await GIFTScheme.countDocuments(query);

    res.json({
      success: true,
      data: {
        schemes,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    logger.error('Get GIFT schemes error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/gift-schemes/:id
// @desc    Get specific GIFT scheme
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const scheme = await GIFTScheme.findById(req.params.id)
      .populate('createdBy', 'name email');

    if (!scheme) {
      return res.status(404).json({
        success: false,
        message: 'GIFT scheme not found'
      });
    }

    res.json({
      success: true,
      data: scheme
    });

  } catch (error) {
    logger.error('Get GIFT scheme error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/gift-schemes
// @desc    Create new GIFT scheme (Admin only)
// @access  Private (Admin)
router.post('/', [
  auth,
  body('schemeName').notEmpty().withMessage('Scheme name is required'),
  body('schemeCode').notEmpty().withMessage('Scheme code is required'),
  body('description').notEmpty().withMessage('Description is required'),
  body('category').isIn(['technology', 'energy', 'environment', 'manufacturing', 'innovation', 'digital'])
    .withMessage('Valid category is required'),
  body('eligibilityCriteria.minCarbonScore').isNumeric().withMessage('Min carbon score must be a number'),
  body('eligibilityCriteria.minAnnualTurnover').isNumeric().withMessage('Min annual turnover must be a number'),
  body('eligibilityCriteria.maxAnnualTurnover').isNumeric().withMessage('Max annual turnover must be a number'),
  body('benefits.incentiveType').isIn(['subsidy', 'grant', 'tax_benefit', 'loan_subsidy', 'equipment_subsidy'])
    .withMessage('Valid incentive type is required'),
  body('benefits.incentiveAmount').isNumeric().withMessage('Incentive amount must be a number'),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('endDate').isISO8601().withMessage('Valid end date is required')
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

    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
    }

    const scheme = new GIFTScheme({
      ...req.body,
      createdBy: req.user.userId
    });

    await scheme.save();

    logger.info(`GIFT scheme created: ${scheme._id}`, {
      userId: req.user.userId,
      schemeName: scheme.schemeName,
      schemeCode: scheme.schemeCode
    });

    res.status(201).json({
      success: true,
      message: 'GIFT scheme created successfully',
      data: scheme
    });

  } catch (error) {
    logger.error('Create GIFT scheme error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PUT /api/gift-schemes/:id
// @desc    Update GIFT scheme (Admin only)
// @access  Private (Admin)
router.put('/:id', [
  auth,
  body('schemeName').optional().notEmpty().withMessage('Scheme name cannot be empty'),
  body('description').optional().notEmpty().withMessage('Description cannot be empty'),
  body('category').optional().isIn(['technology', 'energy', 'environment', 'manufacturing', 'innovation', 'digital'])
    .withMessage('Valid category is required'),
  body('startDate').optional().isISO8601().withMessage('Valid start date is required'),
  body('endDate').optional().isISO8601().withMessage('Valid end date is required')
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

    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
    }

    const scheme = await GIFTScheme.findById(req.params.id);

    if (!scheme) {
      return res.status(404).json({
        success: false,
        message: 'GIFT scheme not found'
      });
    }

    // Update fields
    const allowedFields = [
      'schemeName', 'description', 'category', 'eligibilityCriteria',
      'benefits', 'applicationProcess', 'status', 'startDate', 'endDate'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        scheme[field] = req.body[field];
      }
    });

    scheme.lastModifiedBy = req.user.userId;
    await scheme.save();

    logger.info(`GIFT scheme updated: ${scheme._id}`, {
      userId: req.user.userId,
      updatedFields: Object.keys(req.body)
    });

    res.json({
      success: true,
      message: 'GIFT scheme updated successfully',
      data: scheme
    });

  } catch (error) {
    logger.error('Update GIFT scheme error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/gift-schemes/:id/eligibility
// @desc    Check MSME eligibility for GIFT scheme
// @access  Private
router.get('/:id/eligibility', auth, async (req, res) => {
  try {
    const scheme = await GIFTScheme.findById(req.params.id);
    
    if (!scheme) {
      return res.status(404).json({
        success: false,
        message: 'GIFT scheme not found'
      });
    }

    const msme = await MSME.findOne({ userId: req.user.userId });
    
    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    if (scheme.schemeCode === ADEETIE_SCHEME_CODE) {
      const loanAmount = req.query.loanAmount ? Number(req.query.loanAmount) : undefined;
      const adeetie = adeetieService.evaluateEligibility(msme, { loanAmount });
      const readiness = await adeetieService.computeReadinessScore(msme);
      return res.json({
        success: true,
        data: {
          isEligible: adeetie.isEligible,
          schemeCode: adeetie.schemeCode,
          adeetie,
          readinessScore: readiness.readinessScore,
          criteria: adeetie.criteria,
          links: adeetie.links
        }
      });
    }

    // Check eligibility criteria
    const eligibility = {
      isEligible: true,
      criteria: {
        carbonScore: {
          required: scheme.eligibilityCriteria.minCarbonScore,
          current: msme.carbonScore || 0,
          passed: (msme.carbonScore || 0) >= scheme.eligibilityCriteria.minCarbonScore
        },
        annualTurnover: {
          required: {
            min: scheme.eligibilityCriteria.minAnnualTurnover,
            max: scheme.eligibilityCriteria.maxAnnualTurnover
          },
          current: msme.business.annualTurnover,
          passed: msme.business.annualTurnover >= scheme.eligibilityCriteria.minAnnualTurnover &&
                  msme.business.annualTurnover <= scheme.eligibilityCriteria.maxAnnualTurnover
        },
        companyType: {
          required: scheme.eligibilityCriteria.companyTypes,
          current: msme.companyType,
          passed: scheme.eligibilityCriteria.companyTypes.includes(msme.companyType)
        },
        employees: {
          required: {
            min: scheme.eligibilityCriteria.minEmployees,
            max: scheme.eligibilityCriteria.maxEmployees
          },
          current: msme.business.numberOfEmployees,
          passed: msme.business.numberOfEmployees >= scheme.eligibilityCriteria.minEmployees &&
                  msme.business.numberOfEmployees <= scheme.eligibilityCriteria.maxEmployees
        }
      }
    };

    // Overall eligibility
    eligibility.isEligible = Object.values(eligibility.criteria).every(criterion => criterion.passed);

    res.json({
      success: true,
      data: eligibility
    });

  } catch (error) {
    logger.error('Check GIFT scheme eligibility error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/gift-schemes/:id/applications
// @desc    Get applications for specific GIFT scheme (Admin only)
// @access  Private (Admin)
router.get('/:id/applications', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
    }

    const { status, page = 1, limit = 10 } = req.query;
    
    const query = { schemeId: req.params.id };
    if (status) {
      query.status = status;
    }

    const applications = await GIFTApplication.find(query)
      .populate('msmeId', 'companyName companyType industry')
      .populate('schemeId', 'schemeName schemeCode')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await GIFTApplication.countDocuments(query);

    res.json({
      success: true,
      data: {
        applications,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    logger.error('Get GIFT scheme applications error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;
