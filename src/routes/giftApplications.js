const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const GIFTApplication = require('../models/GIFTApplication');
const GIFTScheme = require('../models/GIFTScheme');
const MSME = require('../models/MSME');
const logger = require('../utils/logger');

// @route   GET /api/gift-applications
// @desc    Get MSME's GIFT applications
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const msme = await MSME.findOne({ userId: req.user.userId });
    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const query = { msmeId: msme._id };
    if (status) {
      query.status = status;
    }

    const applications = await GIFTApplication.find(query)
      .populate('schemeId', 'schemeName schemeCode category benefits')
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
    logger.error('Get GIFT applications error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/gift-applications/:id
// @desc    Get specific GIFT application
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const application = await GIFTApplication.findById(req.params.id)
      .populate('msmeId', 'companyName companyType industry business')
      .populate('schemeId', 'schemeName schemeCode category benefits eligibilityCriteria')
      .populate('reviewDetails.reviewedBy', 'name email');

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'GIFT application not found'
      });
    }

    // Check if user owns this application or is admin
    const msme = await MSME.findOne({ userId: req.user.userId });
    if (application.msmeId._id.toString() !== msme._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: application
    });

  } catch (error) {
    logger.error('Get GIFT application error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/gift-applications
// @desc    Create new GIFT application
// @access  Private
router.post('/', [
  auth,
  body('schemeId').isMongoId().withMessage('Valid scheme ID is required'),
  body('projectDetails.projectName').notEmpty().withMessage('Project name is required'),
  body('projectDetails.projectDescription').notEmpty().withMessage('Project description is required'),
  body('projectDetails.projectCategory').isIn(['technology', 'energy', 'environment', 'manufacturing', 'innovation', 'digital'])
    .withMessage('Valid project category is required'),
  body('projectDetails.projectValue').isNumeric().withMessage('Project value must be a number'),
  body('projectDetails.expectedCarbonReduction').isNumeric().withMessage('Expected carbon reduction must be a number'),
  body('projectDetails.projectDuration').isInt().withMessage('Project duration must be an integer'),
  body('projectDetails.startDate').isISO8601().withMessage('Valid start date is required'),
  body('projectDetails.endDate').isISO8601().withMessage('Valid end date is required'),
  body('financialDetails.totalProjectCost').isNumeric().withMessage('Total project cost must be a number'),
  body('financialDetails.requestedIncentiveAmount').isNumeric().withMessage('Requested incentive amount must be a number'),
  body('financialDetails.ownContribution').isNumeric().withMessage('Own contribution must be a number')
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

    const msme = await MSME.findOne({ userId: req.user.userId });
    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const scheme = await GIFTScheme.findById(req.body.schemeId);
    if (!scheme) {
      return res.status(404).json({
        success: false,
        message: 'GIFT scheme not found'
      });
    }

    // Check if scheme is active
    if (scheme.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'GIFT scheme is not active'
      });
    }

    // Check if scheme is within validity period
    const now = new Date();
    if (now < scheme.startDate || now > scheme.endDate) {
      return res.status(400).json({
        success: false,
        message: 'GIFT scheme is not currently accepting applications'
      });
    }

    // Check if MSME already has an application for this scheme
    const existingApplication = await GIFTApplication.findOne({
      msmeId: msme._id,
      schemeId: req.body.schemeId,
      status: { $in: ['draft', 'submitted', 'under_review', 'approved'] }
    });

    if (existingApplication) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active application for this scheme'
      });
    }

    const application = new GIFTApplication({
      msmeId: msme._id,
      schemeId: req.body.schemeId,
      projectDetails: req.body.projectDetails,
      financialDetails: req.body.financialDetails,
      documents: req.body.documents || [],
      milestones: req.body.milestones || []
    });

    await application.save();

    logger.info(`GIFT application created: ${application._id}`, {
      userId: req.user.userId,
      msmeId: msme._id,
      schemeId: req.body.schemeId,
      applicationNumber: application.applicationNumber
    });

    res.status(201).json({
      success: true,
      message: 'GIFT application created successfully',
      data: application
    });

  } catch (error) {
    logger.error('Create GIFT application error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PUT /api/gift-applications/:id
// @desc    Update GIFT application
// @access  Private
router.put('/:id', [
  auth,
  body('projectDetails.projectName').optional().notEmpty().withMessage('Project name cannot be empty'),
  body('projectDetails.projectDescription').optional().notEmpty().withMessage('Project description cannot be empty'),
  body('projectDetails.projectValue').optional().isNumeric().withMessage('Project value must be a number'),
  body('financialDetails.totalProjectCost').optional().isNumeric().withMessage('Total project cost must be a number'),
  body('financialDetails.requestedIncentiveAmount').optional().isNumeric().withMessage('Requested incentive amount must be a number')
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

    const application = await GIFTApplication.findById(req.params.id);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'GIFT application not found'
      });
    }

    const msme = await MSME.findOne({ userId: req.user.userId });
    if (application.msmeId.toString() !== msme._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Only allow updates if application is in draft status
    if (application.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Application cannot be updated after submission'
      });
    }

    // Update allowed fields
    const allowedFields = [
      'projectDetails', 'financialDetails', 'documents', 'milestones'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        application[field] = req.body[field];
      }
    });

    await application.save();

    logger.info(`GIFT application updated: ${application._id}`, {
      userId: req.user.userId,
      updatedFields: Object.keys(req.body)
    });

    res.json({
      success: true,
      message: 'GIFT application updated successfully',
      data: application
    });

  } catch (error) {
    logger.error('Update GIFT application error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/gift-applications/:id/submit
// @desc    Submit GIFT application
// @access  Private
router.post('/:id/submit', auth, async (req, res) => {
  try {
    const application = await GIFTApplication.findById(req.params.id);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'GIFT application not found'
      });
    }

    const msme = await MSME.findOne({ userId: req.user.userId });
    if (application.msmeId.toString() !== msme._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (application.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Application has already been submitted'
      });
    }

    // Validate required fields
    if (!application.projectDetails.projectName || 
        !application.projectDetails.projectDescription ||
        !application.financialDetails.totalProjectCost ||
        !application.financialDetails.requestedIncentiveAmount) {
      return res.status(400).json({
        success: false,
        message: 'Please complete all required fields before submitting'
      });
    }

    application.status = 'submitted';
    await application.save();

    logger.info(`GIFT application submitted: ${application._id}`, {
      userId: req.user.userId,
      applicationNumber: application.applicationNumber
    });

    res.json({
      success: true,
      message: 'GIFT application submitted successfully',
      data: application
    });

  } catch (error) {
    logger.error('Submit GIFT application error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PUT /api/gift-applications/:id/status
// @desc    Update GIFT application status (Admin only)
// @access  Private (Admin)
router.put('/:id/status', [
  auth,
  body('status').isIn(['under_review', 'approved', 'rejected', 'disbursed', 'completed', 'cancelled'])
    .withMessage('Valid status is required'),
  body('reviewComments').optional().notEmpty().withMessage('Review comments cannot be empty'),
  body('reviewScore').optional().isNumeric().withMessage('Review score must be a number'),
  body('approvedAmount').optional().isNumeric().withMessage('Approved amount must be a number')
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

    const application = await GIFTApplication.findById(req.params.id);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'GIFT application not found'
      });
    }

    const oldStatus = application.status;
    application.status = req.body.status;

    // Update review details
    if (req.body.reviewComments || req.body.reviewScore !== undefined) {
      application.reviewDetails = {
        ...application.reviewDetails,
        reviewedBy: req.user.userId,
        reviewedAt: new Date(),
        reviewComments: req.body.reviewComments || application.reviewDetails.reviewComments,
        reviewScore: req.body.reviewScore !== undefined ? req.body.reviewScore : application.reviewDetails.reviewScore
      };
    }

    // Update disbursement details
    if (req.body.status === 'disbursed' && req.body.approvedAmount) {
      application.disbursementDetails = {
        ...application.disbursementDetails,
        approvedAmount: req.body.approvedAmount,
        disbursedAmount: req.body.approvedAmount,
        disbursementDate: new Date(),
        disbursementMethod: req.body.disbursementMethod || 'bank_transfer',
        disbursementReference: req.body.disbursementReference || `GIFT-${Date.now()}`
      };
    }

    // Set rejection reason if rejected
    if (req.body.status === 'rejected' && req.body.rejectionReason) {
      application.reviewDetails.rejectionReason = req.body.rejectionReason;
    }

    await application.save();

    logger.info(`GIFT application status updated: ${application._id}`, {
      userId: req.user.userId,
      oldStatus,
      newStatus: req.body.status,
      applicationNumber: application.applicationNumber
    });

    res.json({
      success: true,
      message: 'GIFT application status updated successfully',
      data: application
    });

  } catch (error) {
    logger.error('Update GIFT application status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;
