const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const MSME = require('../models/MSME');
const Enterprise = require('../models/Enterprise');
const PartnerApplication = require('../models/PartnerApplication');
const {
  sanitizePartnerForResponse,
  generateApiKey
} = require('../services/partnerApiService');
const logger = require('../utils/logger');
const crypto = require('crypto');
const sendEmail = require('../utils/sendEmail');
const registrationOtpService = require('../services/registrationOtpService');
const { signJwt, verifyJwt } = require('../utils/jwt');
const auth = require('../middleware/auth');
const { normalizeAdminEmail } = require('../services/adminBootstrap');

const normalizeAuthEmail = (email) => normalizeAdminEmail(email);

const parseLimitEnv = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.floor(numeric);
};

const isJwtUnauthorizedError = (error) => (
  Boolean(error) && (
    error.name === 'TokenExpiredError' ||
    error.name === 'JsonWebTokenError' ||
    error.name === 'NotBeforeError'
  )
);

const registrationOtpRequestLimiter = rateLimit({
  windowMs: parseLimitEnv(process.env.REGISTRATION_OTP_REQUEST_WINDOW_MS, 10 * 60 * 1000),
  max: parseLimitEnv(process.env.REGISTRATION_OTP_REQUEST_MAX_PER_WINDOW, 10),
  message: {
    success: false,
    message: 'Too many OTP requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const registrationOtpVerifyLimiter = rateLimit({
  windowMs: parseLimitEnv(process.env.REGISTRATION_OTP_VERIFY_WINDOW_MS, 10 * 60 * 1000),
  max: parseLimitEnv(process.env.REGISTRATION_OTP_VERIFY_MAX_PER_WINDOW, 20),
  message: {
    success: false,
    message: 'Too many OTP verification attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// @route   POST /api/auth/register/request-otp
// @desc    Request OTP for registration (email + mobile)
// @access  Public
router.post('/register/request-otp', registrationOtpRequestLimiter, [
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone')
    .isString()
    .withMessage('Valid mobile number is required')
    .trim()
    .isLength({ min: 10 })
    .withMessage('Valid mobile number is required')
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

    const email = normalizeAuthEmail(req.body.email);
    const { phone } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    const result = await registrationOtpService.requestOtp({ email, phone });
    if (!result.otpRequired) {
      return res.json({
        success: true,
        message: 'OTP verification is disabled for testing',
        data: result
      });
    }

    return res.json({
      success: true,
      message: 'OTP sent to your email and mobile number',
      data: result
    });
  } catch (error) {
    logger.error('Request registration OTP error:', error);
    const isValidationError = [
      'No OTP channel is enabled',
      'Valid email is required',
      'Valid mobile number is required',
      'Maximum OTP resend attempts exceeded. Please try again later.',
      'OTP session is temporarily locked. Please retry later.'
    ].includes(error.message) || (typeof error.message === 'string' && error.message.startsWith('Please wait '));
    return res.status(isValidationError ? 400 : 500).json({
      success: false,
      message: isValidationError ? error.message : 'Failed to send OTP'
    });
  }
});

// @route   POST /api/auth/register/verify-otp
// @desc    Verify registration OTP (email + mobile)
// @access  Public
router.post('/register/verify-otp', registrationOtpVerifyLimiter, [
  body('sessionId').notEmpty().withMessage('OTP session id is required'),
  body('emailOtp').optional().isString().withMessage('Email OTP must be a string'),
  body('mobileOtp').optional().isString().withMessage('Mobile OTP must be a string')
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

    const { sessionId, emailOtp, mobileOtp } = req.body;

    if (!registrationOtpService.isOtpEnabled()) {
      return res.json({
        success: true,
        message: 'OTP verification is disabled for testing',
        data: {
          otpRequired: false,
          verified: true,
          emailVerified: true,
          mobileVerified: true
        }
      });
    }

    if (!emailOtp && !mobileOtp) {
      return res.status(400).json({
        success: false,
        message: 'At least one OTP value is required for verification'
      });
    }

    const verificationResult = await registrationOtpService.verifyOtp({
      sessionId,
      emailOtp,
      mobileOtp
    });

    if (!verificationResult.verified) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP. Please check email and mobile OTP values.',
        data: verificationResult
      });
    }

    return res.json({
      success: true,
      message: 'Email and mobile OTP verified successfully',
      data: verificationResult
    });
  } catch (error) {
    const isVerificationError = [
      'Invalid or expired OTP session',
      'Invalid OTP values provided',
      'Email OTP is required',
      'Mobile OTP is required',
      'OTP session is temporarily locked. Please retry later.',
      'OTP verification attempts exceeded. Please request a new OTP.'
    ].includes(error.message);

    logger.error('Verify registration OTP error:', error);
    return res.status(isVerificationError ? 400 : 500).json({
      success: false,
      message: isVerificationError ? error.message : 'Failed to verify OTP'
    });
  }
});

// @route   POST /api/auth/register
// @desc    Register user
// @access  Public
router.post('/register', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('otpSessionId')
    .optional()
    .isString()
    .withMessage('OTP session id must be a string'),
  body('role')
    .optional()
    .isString()
    .withMessage('Role must be a string')
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

    const email = normalizeAuthEmail(req.body.email);
    const { password, profile, otpSessionId } = req.body;
    const role = req.body.role || 'msme';

    if (!['msme', 'enterprise', 'partner'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Only msme, enterprise, or partner roles are allowed for public registration'
      });
    }

    // Prevent privilege escalation through public registration.
    if (role === 'admin' || role === 'view') {
      return res.status(403).json({
        success: false,
        message: 'Admin accounts cannot be created via public registration'
      });
    }

    const partnerProfile = req.body.partnerProfile || {};
    if (role === 'partner') {
      const organizationName = String(partnerProfile.organizationName || '').trim();
      const organizationType = String(partnerProfile.organizationType || 'integration_partner').trim();
      const allowedOrgTypes = [
        'government_accredited_auditor',
        'bank_incentives_partner',
        'verification_agency',
        'integration_partner',
        'other'
      ];

      if (!organizationName) {
        return res.status(400).json({
          success: false,
          message: 'Organization name is required for partner registration'
        });
      }

      if (!allowedOrgTypes.includes(organizationType)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid partner organization type'
        });
      }
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    if (registrationOtpService.isOtpEnabled()) {
      if (!profile?.phone) {
        return res.status(400).json({
          success: false,
          message: 'Phone number is required for OTP verified registration'
        });
      }

      if (!otpSessionId) {
        return res.status(400).json({
          success: false,
          message: 'OTP verification is required before registration'
        });
      }

      try {
        await registrationOtpService.consumeVerifiedSessionForRegistration({
          sessionId: otpSessionId,
          email,
          phone: profile.phone
        });
      } catch (otpError) {
        return res.status(400).json({
          success: false,
          message: otpError.message
        });
      }
    }

    const user = new User({
      email,
      password,
      role,
      profile: profile || {}
    });

    // Registration creates only the user. MSME onboarding is handled separately.
    await user.save();

    let partnerApplication = null;
    if (role === 'partner') {
      const organizationName = String(partnerProfile.organizationName || '').trim();
      const organizationType = String(partnerProfile.organizationType || 'integration_partner').trim();
      const billingPlanByOrgType = {
        bank_incentives_partner: 'bank_platform',
        government_accredited_auditor: 'auditor',
        verification_agency: 'verification_agency',
        integration_partner: 'integration_partner',
        other: 'api_starter'
      };
      const { prefix, hash } = generateApiKey();
      const webhookSecret = crypto.randomBytes(16).toString('hex');

      partnerApplication = await PartnerApplication.create({
        name: organizationName,
        organizationType,
        organizationName,
        contactEmail: email,
        apiKeyPrefix: prefix,
        apiKeyHash: hash,
        scopes: ['msme:read', 'carbon:read'],
        linkedUserId: user._id,
        webhookSecret,
        billingPlanId: billingPlanByOrgType[organizationType] || 'api_starter',
        notes: 'Self-registered via public partner registration'
      });
    }

    // Generate JWT token
    const payload = {
      userId: user._id,
      email: user.email,
      role: user.role
    };

    const token = signJwt(payload, {
      expiresIn: '7d'
    });

    logger.info(`User registered successfully: ${email}`, {
      userId: user._id,
      role
    });

    res.status(201).json({
      success: true,
      message: role === 'partner'
        ? 'Partner account registered successfully'
        : 'User registered successfully',
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          profile: user.profile
        },
        partner: partnerApplication ? sanitizePartnerForResponse(partnerApplication) : null,
        onboardingRequired: role === 'msme' || role === 'enterprise'
      }
    });

  } catch (error) {
    logger.error('User registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
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

    const email = normalizeAuthEmail(req.body.email);
    const { password } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (!user.hasBcryptPassword()) {
      await user.upgradeLegacyPassword(password);
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Update last login without re-validating the full document
    await User.updateOne({ _id: user._id }, { $set: { lastLogin: new Date() } });
    user.lastLogin = new Date();

    // Resolve org profiles for all roles to avoid role/profile mismatch.
    const msmeData = await MSME.findOne({ userId: user._id });
    const enterpriseData = await Enterprise.findOne({ userId: user._id });

    let partnerData = null;
    if (user.role === 'partner') {
      const partnerApplication = await PartnerApplication.findOne({
        linkedUserId: user._id,
        isActive: true
      });

      if (!partnerApplication) {
        return res.status(403).json({
          success: false,
          message: 'No active partner application is linked to this account'
        });
      }

      partnerData = sanitizePartnerForResponse(partnerApplication);
    }

    // Generate JWT token
    const payload = {
      userId: String(user._id),
      email: user.email,
      role: user.role
    };

    const token = signJwt(payload, {
      expiresIn: '7d'
    });

    logger.info(`User logged in successfully: ${user.email}`, {
      userId: user._id,
      role: user.role
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          profile: user.profile,
          lastLogin: user.lastLogin
        },
        onboardingRequired: (user.role === 'msme' && !msmeData)
          || (user.role === 'enterprise' && !enterpriseData),
        msme: msmeData ? {
          id: msmeData._id,
          companyName: msmeData.companyName,
          companyType: msmeData.companyType,
          industry: msmeData.industry,
          carbonScore: msmeData.carbonScore
        } : null,
        enterprise: enterpriseData ? {
          id: enterpriseData._id,
          companyName: enterpriseData.companyName,
          listingStatus: enterpriseData.listingStatus,
          industry: enterpriseData.industry,
          carbonScore: enterpriseData.carbonScore
        } : null,
        partner: partnerData
      }
    });

  } catch (error) {
    logger.error('User login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token, authorization denied'
      });
    }

    let decoded;
    try {
      decoded = verifyJwt(token);
    } catch (verificationError) {
      return res.status(401).json({
        success: false,
        message: 'Token is not valid'
      });
    }
    
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token is not valid'
      });
    }

    const msmeData = await MSME.findOne({ userId: user._id });
    const enterpriseData = await Enterprise.findOne({ userId: user._id });

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          profile: user.profile,
          lastLogin: user.lastLogin
        },
        onboardingRequired: (user.role === 'msme' && !msmeData)
          || (user.role === 'enterprise' && !enterpriseData),
        msme: msmeData ? {
          id: msmeData._id,
          companyName: msmeData.companyName,
          companyType: msmeData.companyType,
          industry: msmeData.industry,
          carbonScore: msmeData.carbonScore
        } : null,
        enterprise: enterpriseData ? {
          id: enterpriseData._id,
          companyName: enterpriseData.companyName,
          listingStatus: enterpriseData.listingStatus,
          industry: enterpriseData.industry,
          carbonScore: enterpriseData.carbonScore
        } : null
      }
    });

  } catch (error) {
    logger.error('Get user error:', error);
    if (isJwtUnauthorizedError(error)) {
      return res.status(401).json({
        success: false,
        message: 'Token is not valid'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// @route   POST /api/auth/refresh
// @desc    Refresh JWT token
// @access  Private
router.post('/refresh', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    let decoded;
    try {
      decoded = verifyJwt(token);
    } catch (verificationError) {
      return res.status(401).json({
        success: false,
        message: 'Token is not valid'
      });
    }
    
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token is not valid'
      });
    }

    // Generate new JWT token
    const payload = {
      userId: user._id,
      email: user.email,
      role: user.role
    };

    const newToken = signJwt(payload, {
      expiresIn: '7d'
    });

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        token: newToken
      }
    });

  } catch (error) {
    logger.error('Token refresh error:', error);
    if (isJwtUnauthorizedError(error)) {
      return res.status(401).json({
        success: false,
        message: 'Token is not valid'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Send password reset email
// @access  Public
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Valid email is required')
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

    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If that email exists, a password reset link has been sent'
      }); 
      // Don't reveal if email exists for security
    }

    // Generate token
    const resetToken = crypto.randomBytes(32).toString('hex');

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 1000 * 60 * 15; // 15 minutes
    await user.save();

    const frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl) {
      logger.error('Forgot password requested but FRONTEND_URL is not configured');
      return res.status(500).json({
        success: false,
        message: 'Password reset is temporarily unavailable'
      });
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      logger.error('Forgot password requested but email credentials are not configured');
      return res.status(500).json({
        success: false,
        message: 'Password reset is temporarily unavailable'
      });
    }

    const resetUrl = `${frontendUrl.replace(/\/$/, '')}/reset-password?token=${resetToken}`;

    await sendEmail({
      to: email,
      subject: "Password Reset Request",
      html: `
    <p>You requested a password reset.</p>
    <p>Click the link below to reset your password:</p>
    <a href="${resetUrl}">
      Reset Password
    </a>
    <p>This link expires in 15 minutes.</p>
  `
    });

    logger.info(`Password reset email sent: ${email}`);

    res.json({
      success: true,
      message: 'Password reset link sent to email'
    });

  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});



// @route   PATCH /api/auth/profile
// @desc    Update authenticated user profile (name, phone)
// @access  Private
router.patch('/profile', auth, [
  body('firstName').optional().trim().isLength({ min: 1 }).withMessage('First name cannot be empty'),
  body('lastName').optional().trim().isLength({ min: 1 }).withMessage('Last name cannot be empty'),
  body('phone').optional().trim()
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

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { firstName, lastName, phone } = req.body;
    if (firstName !== undefined) {
      user.profile = user.profile || {};
      user.profile.firstName = String(firstName).trim();
    }
    if (lastName !== undefined) {
      user.profile = user.profile || {};
      user.profile.lastName = String(lastName).trim();
    }
    if (phone !== undefined) {
      user.profile = user.profile || {};
      user.profile.phone = String(phone).trim();
    }

    await user.save();

    return res.json({
      success: true,
      message: 'Profile updated',
      data: {
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          profile: user.profile
        }
      }
    });
  } catch (error) {
    logger.error('Update user profile error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// @route   POST /api/auth/change-password
// @desc    Change password for authenticated user
// @access  Private
router.post('/change-password', auth, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
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

    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    user.password = newPassword;
    await user.save();

    logger.info(`Password changed for user: ${user.email}`);

    res.json({
      success: true,
      message: 'Password updated successfully'
    });
  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password using token
// @access  Public
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Token is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
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

    const { token, password } = req.body;

    // Find user with valid token
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    // Update password
    user.password = password;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;

    await user.save();

    logger.info(`Password reset successful: ${user.email}`);

    res.json({
      success: true,
      message: 'Password has been reset successfully'
    });

  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});


module.exports = router;