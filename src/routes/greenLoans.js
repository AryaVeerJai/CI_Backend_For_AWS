const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const GreenLoan = require('../models/GreenLoan');
const Bank = require('../models/Bank');
const MSME = require('../models/MSME');
const CarbonAssessment = require('../models/CarbonAssessment');
const carbonCalculationService = require('../services/carbonCalculationService');
const logger = require('../utils/logger');
const adeetieService = require('../services/adeetieEligibilityService');

// @route   POST /api/green-loans/eligibility-check
// @desc    Check loan eligibility for MSME
// @access  Private
router.post('/eligibility-check', [
  auth,
  auth.requireMSMEProfile,
  auth.requireRole('msme'),
  body('bankId').isMongoId().withMessage('Valid bank ID is required'),
  body('loanAmount').isNumeric().withMessage('Loan amount must be a number'),
  body('purpose').notEmpty().withMessage('Loan purpose is required')
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

    const { bankId, loanAmount, purpose } = req.body;

    // Get MSME data
    const msme = await MSME.findOne({ userId: req.user.userId });
    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    // Get bank data
    const bank = await Bank.findById(bankId);
    if (!bank) {
      return res.status(404).json({
        success: false,
        message: 'Bank not found'
      });
    }

    // Get latest carbon assessment
    const latestAssessment = await CarbonAssessment.findOne({ msmeId: msme._id })
      .sort({ createdAt: -1 });

    if (!latestAssessment) {
      return res.status(400).json({
        success: false,
        message: 'Carbon assessment required for loan eligibility'
      });
    }

    // Calculate eligibility
    const eligibility = calculateLoanEligibility(msme, bank, latestAssessment, loanAmount, purpose);

    const purposeText = String(purpose || '').toLowerCase();
    const isEnergyPurpose = /energy|efficien|adeetie|solar|ee\b|green/.test(purposeText);
    if (isEnergyPurpose) {
      const adeetieEligibility = adeetieService.evaluateEligibility(msme, { loanAmount });
      if (adeetieEligibility.isEligible) {
        const subvention = adeetieService.calculateSubvention({
          loanAmount,
          companyType: msme.companyType,
          nominalInterestRatePercent: eligibility.suggestedInterestRate || 12,
          tenureYears: 3
        });
        eligibility.adeetie = {
          eligible: true,
          subventionRatePercent: adeetieEligibility.subventionRatePercent,
          subvention,
          effectiveInterestRatePercent: subvention.effectiveInterestRatePercent,
          totalSubventionInr: subvention.totalSubventionInr,
          portalUrl: adeetieEligibility.links.portal
        };
        if (subvention.effectiveInterestRatePercent < eligibility.suggestedInterestRate) {
          eligibility.suggestedInterestRate = subvention.effectiveInterestRatePercent;
        }
      } else {
        eligibility.adeetie = {
          eligible: false,
          missingFields: adeetieEligibility.missingFields,
          portalUrl: adeetieEligibility.links.portal
        };
      }
    }

    res.json({
      success: true,
      data: eligibility
    });

  } catch (error) {
    logger.error('Loan eligibility check error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/green-loans/apply
// @desc    Apply for green loan
// @access  Private
router.post('/apply', [
  auth,
  auth.requireMSMEProfile,
  auth.requireRole('msme'),
  body('bankId').isMongoId().withMessage('Valid bank ID is required'),
  body('loanAmount').isNumeric().withMessage('Loan amount must be a number'),
  body('purpose').notEmpty().withMessage('Loan purpose is required'),
  body('description').notEmpty().withMessage('Description is required'),
  body('expectedCarbonReduction').isNumeric().withMessage('Expected carbon reduction must be a number'),
  body('expectedPaybackPeriod').isNumeric().withMessage('Expected payback period must be a number')
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

    const { bankId, loanAmount, purpose, description, expectedCarbonReduction, expectedPaybackPeriod, documents = [] } = req.body;

    // Get MSME data
    const msme = await MSME.findOne({ userId: req.user.userId });
    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    // Get bank data
    const bank = await Bank.findById(bankId);
    if (!bank) {
      return res.status(404).json({
        success: false,
        message: 'Bank not found'
      });
    }

    // Get latest carbon assessment
    const latestAssessment = await CarbonAssessment.findOne({ msmeId: msme._id })
      .sort({ createdAt: -1 });

    if (!latestAssessment) {
      return res.status(400).json({
        success: false,
        message: 'Carbon assessment required for loan application'
      });
    }

    // Check if MSME already has a pending or active loan with this bank
    const existingLoan = await GreenLoan.findOne({
      msmeId: msme._id,
      bankId: bankId,
      status: { $in: ['draft', 'submitted', 'under_review', 'approved', 'disbursed', 'active'] }
    });

    if (existingLoan) {
      return res.status(400).json({
        success: false,
        message: 'You already have a loan application or active loan with this bank'
      });
    }

    // Calculate loan terms
    const loanTerms = calculateLoanTerms(msme, bank, latestAssessment, loanAmount);

    // Create loan application
    const greenLoan = new GreenLoan({
      msmeId: msme._id,
      bankId: bankId,
      loanApplication: {
        loanAmount,
        purpose,
        description,
        expectedCarbonReduction,
        expectedPaybackPeriod,
        documents
      },
      carbonAssessment: {
        currentCarbonScore: latestAssessment.carbonScore,
        currentCO2Emissions: latestAssessment.totalCO2Emissions,
        carbonSavings: latestAssessment.carbonSavings || {
          totalSavings: 0,
          periodSavings: 0,
          savingsPercentage: 0
        },
        esgScopes: latestAssessment.esgScopes
      },
      loanTerms,
      status: 'submitted'
    });

    await greenLoan.save();

    logger.info(`Green loan application created: ${greenLoan._id}`, {
      msmeId: msme._id,
      bankId: bankId,
      loanAmount
    });

    res.status(201).json({
      success: true,
      message: 'Loan application submitted successfully',
      data: greenLoan
    });

  } catch (error) {
    logger.error('Green loan application error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/green-loans/my-loans
// @desc    Get MSME's loan applications
// @access  Private
router.get('/my-loans', auth, auth.requireMSMEProfile, auth.requireRole('msme'), async (req, res) => {
  try {
    const msme = await MSME.findOne({ userId: req.user.userId });
    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const { status, page = 1, limit = 10 } = req.query;
    
    const query = { msmeId: msme._id };
    if (status) {
      query.status = status;
    }

    const loans = await GreenLoan.find(query)
      .populate('bankId', 'bankName bankCode contact.email contact.phone')
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
    logger.error('Get MSME loans error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/green-loans/:id
// @desc    Get loan details
// @access  Private
router.get('/:id', auth, auth.requireMSMEProfile, async (req, res) => {
  try {
    const loan = await GreenLoan.findById(req.params.id)
      .populate('msmeId', 'companyName companyType industry business.annualTurnover contact')
      .populate('bankId', 'bankName bankCode contact greenLoanPolicy');

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    // Check if user has access to this loan
    const msme = await MSME.findOne({ userId: req.user.userId });
    if (!msme || loan.msmeId._id.toString() !== msme._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: loan
    });

  } catch (error) {
    logger.error('Get loan details error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PUT /api/green-loans/:id/status
// @desc    Update loan status (Bank only)
// @access  Private
router.put('/:id/status', [
  auth,
  auth.requireRole('admin'),
  body('status').isIn(['under_review', 'approved', 'rejected', 'disbursed']).withMessage('Invalid status'),
  body('reviewComments').optional().isString(),
  body('rejectionReason').optional().isString()
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

    const { status, reviewComments, rejectionReason, approvedAmount, interestRate, tenure } = req.body;

    const loan = await GreenLoan.findById(req.params.id);
    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    // Update loan status and review details
    loan.status = status;
    loan.reviewDetails = {
      reviewedBy: req.user.userId,
      reviewedAt: new Date(),
      reviewComments,
      rejectionReason
    };

    // If approved, update loan terms
    if (status === 'approved' && approvedAmount && interestRate && tenure) {
      loan.loanTerms.approvedAmount = approvedAmount;
      loan.loanTerms.interestRate = interestRate;
      loan.loanTerms.tenure = tenure;
      loan.loanTerms.emiAmount = calculateEMI(approvedAmount, interestRate, tenure);
      
      // Generate repayment schedule
      loan.repaymentSchedule = generateRepaymentSchedule(approvedAmount, interestRate, tenure);
    }

    await loan.save();

    logger.info(`Loan status updated: ${loan._id}`, {
      status,
      reviewedBy: req.user.userId
    });

    res.json({
      success: true,
      message: 'Loan status updated successfully',
      data: loan
    });

  } catch (error) {
    logger.error('Update loan status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...clientErrorPayload(error)
    });
  }
});

// Helper functions
function calculateLoanEligibility(msme, bank, assessment, loanAmount, purpose) {
  const eligibility = {
    isEligible: false,
    reasons: [],
    score: 0,
    maxLoanAmount: 0,
    suggestedInterestRate: 0,
    carbonScoreDiscount: 0
  };

  // Check carbon score requirement
  if (assessment.carbonScore < bank.greenLoanPolicy.minCarbonScore) {
    eligibility.reasons.push(`Carbon score ${assessment.carbonScore} is below minimum requirement of ${bank.greenLoanPolicy.minCarbonScore}`);
  } else {
    eligibility.score += 30;
  }

  // Check loan amount range
  if (loanAmount < bank.greenLoanPolicy.minLoanAmount) {
    eligibility.reasons.push(`Loan amount ₹${loanAmount} is below minimum of ₹${bank.greenLoanPolicy.minLoanAmount}`);
  } else if (loanAmount > bank.greenLoanPolicy.maxLoanAmount) {
    eligibility.reasons.push(`Loan amount ₹${loanAmount} exceeds maximum of ₹${bank.greenLoanPolicy.maxLoanAmount}`);
  } else {
    eligibility.score += 20;
    eligibility.maxLoanAmount = Math.min(loanAmount, bank.greenLoanPolicy.maxLoanAmount);
  }

  // Check MSME verification
  if (!msme.isVerified) {
    eligibility.reasons.push('MSME profile not verified');
  } else {
    eligibility.score += 20;
  }

  // Check environmental compliance
  const complianceScore = Object.values(msme.environmentalCompliance).filter(Boolean).length;
  if (complianceScore >= 2) {
    eligibility.score += 15;
  } else {
    eligibility.reasons.push('Insufficient environmental compliance measures');
  }

  // Check carbon savings history
  if (assessment.carbonSavings && assessment.carbonSavings.savingsPercentage > 10) {
    eligibility.score += 15;
  } else {
    eligibility.reasons.push('Insufficient carbon reduction history');
  }

  // Calculate carbon score discount
  const carbonScoreDiscounts = bank.greenLoanPolicy.carbonScoreDiscounts || [];
  for (const discount of carbonScoreDiscounts) {
    if (assessment.carbonScore >= discount.scoreRange.min && assessment.carbonScore <= discount.scoreRange.max) {
      eligibility.carbonScoreDiscount = discount.discountPercentage;
      break;
    }
  }

  // Calculate suggested interest rate
  const baseRate = bank.greenLoanPolicy.interestRateRange.min;
  const maxRate = bank.greenLoanPolicy.interestRateRange.max;
  const rateRange = maxRate - baseRate;
  const scoreFactor = eligibility.score / 100;
  eligibility.suggestedInterestRate = baseRate + (rateRange * (1 - scoreFactor)) - eligibility.carbonScoreDiscount;

  // Determine eligibility
  eligibility.isEligible = eligibility.score >= 60 && eligibility.reasons.length === 0;

  return eligibility;
}

function calculateLoanTerms(msme, bank, assessment, loanAmount) {
  const baseRate = bank.greenLoanPolicy.interestRateRange.min;
  const maxRate = bank.greenLoanPolicy.interestRateRange.max;
  
  // Calculate carbon score discount
  let carbonScoreDiscount = 0;
  const carbonScoreDiscounts = bank.greenLoanPolicy.carbonScoreDiscounts || [];
  for (const discount of carbonScoreDiscounts) {
    if (assessment.carbonScore >= discount.scoreRange.min && assessment.carbonScore <= discount.scoreRange.max) {
      carbonScoreDiscount = discount.discountPercentage;
      break;
    }
  }

  // Calculate final interest rate
  const finalRate = Math.max(baseRate - carbonScoreDiscount, baseRate * 0.5);

  // Calculate tenure (default to 36 months)
  const tenure = Math.min(36, bank.greenLoanPolicy.tenureRange.max);

  // Calculate EMI
  const emiAmount = calculateEMI(loanAmount, finalRate, tenure);

  return {
    approvedAmount: loanAmount,
    interestRate: finalRate,
    tenure,
    emiAmount,
    carbonScoreDiscount,
    finalInterestRate: finalRate
  };
}

function calculateEMI(principal, annualRate, months) {
  const monthlyRate = annualRate / 100 / 12;
  const emi = (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) / 
              (Math.pow(1 + monthlyRate, months) - 1);
  return Math.round(emi);
}

function generateRepaymentSchedule(principal, annualRate, months) {
  const monthlyRate = annualRate / 100 / 12;
  const emi = calculateEMI(principal, annualRate, months);
  const schedule = [];
  
  let remainingPrincipal = principal;
  const startDate = new Date();
  
  for (let i = 1; i <= months; i++) {
    const interestAmount = remainingPrincipal * monthlyRate;
    const principalAmount = emi - interestAmount;
    remainingPrincipal -= principalAmount;
    
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i);
    
    schedule.push({
      installmentNumber: i,
      dueDate,
      principalAmount: Math.round(principalAmount),
      interestAmount: Math.round(interestAmount),
      totalAmount: emi,
      status: 'pending',
      lateFee: 0
    });
  }
  
  return schedule;
}

module.exports = router;