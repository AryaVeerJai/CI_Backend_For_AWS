const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { clientErrorPayload } = require('../utils/httpErrors');
const auth = require('../middleware/auth');
const User = require('../models/User');
const PartnerApplication = require('../models/PartnerApplication');
const {
  PARTNER_SCOPES,
  generateApiKey,
  sanitizePartnerForResponse
} = require('../services/partnerApiService');
const { buildPublicPartnerOpenApi } = require('../config/publicPartnerOpenApi');
const { INTEGRATION_CATALOG } = require('./publicApi');
const { getPartnerUsageSummary } = require('../services/partnerUsageService');
const {
  applyPartnerPlanDefaults,
  buildPartnerBillingActivation
} = require('../services/partnerBillingService');
const { listPartnerPlanCatalog } = require('../config/partnerPricingCatalog');
const logger = require('../utils/logger');

const router = express.Router();

router.use(auth);

const requireAdmin = auth.requireRole('admin');

// @route   GET /api/partner-portal/catalog
// @desc    Integration catalog (authenticated portal view)
// @access  Admin / View
router.get('/catalog', auth.requireRole('admin', 'view'), (req, res) => {
  res.json({
    success: true,
    data: {
      ...INTEGRATION_CATALOG,
      openapiPath: '/api/v1/public/openapi.json',
      portalNote: req.user.role === 'view'
        ? 'Use API keys provisioned for your organization. Contact Carbon Intelligence to request scopes.'
        : 'Admins can provision partner applications below.'
    }
  });
});

// @route   GET /api/partner-portal/openapi.json
// @access  Admin / View
router.get('/openapi.json', auth.requireRole('admin', 'view'), (req, res) => {
  res.json(buildPublicPartnerOpenApi('/api'));
});

// @route   GET /api/partner-portal/my-credentials
// @desc    View partner app linked to the signed-in view user
// @access  View role
router.get('/my-credentials', auth.requireRole('view'), async (req, res) => {
  try {
    const partner = await PartnerApplication.findOne({
      linkedUserId: req.user.userId,
      isActive: true
    }).lean();

    if (!partner) {
      return res.json({
        success: true,
        data: {
          linked: false,
          message: 'No API key is linked to this reviewer account. Ask your Carbon Intelligence administrator.'
        }
      });
    }

    return res.json({
      success: true,
      data: {
        linked: true,
        partner: sanitizePartnerForResponse(partner)
      }
    });
  } catch (error) {
    logger.error('Partner portal my-credentials error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load credentials',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/partner-portal/applications
// @access  Admin
router.get('/applications', requireAdmin, async (req, res) => {
  try {
    const applications = await PartnerApplication.find()
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: {
        applications: applications.map(sanitizePartnerForResponse),
        availableScopes: PARTNER_SCOPES,
        partnerPlanCatalog: listPartnerPlanCatalog()
      }
    });
  } catch (error) {
    logger.error('List partner applications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to list partner applications',
      ...clientErrorPayload(error)
    });
  }
});

// @route   POST /api/partner-portal/applications
// @access  Admin
router.post('/applications', [
  requireAdmin,
  body('name').notEmpty().withMessage('Application name is required'),
  body('organizationType')
    .optional()
    .isIn([
      'government_accredited_auditor',
      'bank_incentives_partner',
      'verification_agency',
      'integration_partner',
      'other'
    ]),
  body('scopes').optional().isArray(),
  body('scopes.*').optional().isIn(PARTNER_SCOPES),
  body('portalLogin.email').optional().isEmail(),
  body('portalLogin.password').optional().isLength({ min: 6 }),
  body('billingPlanId').optional().isString(),
  body('contractAnnualFeeInr').optional().isNumeric()
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

    const {
      name,
      organizationType = 'integration_partner',
      organizationName,
      contactEmail,
      scopes = ['msme:read', 'carbon:read'],
      linkedUserId,
      notes = '',
      portalLogin,
      billingPlanId = 'api_starter',
      contractAnnualFeeInr
    } = req.body;

    let resolvedLinkedUserId = linkedUserId || null;
    let portalLoginCredentials = null;

    if (portalLogin?.email && portalLogin?.password) {
      const loginEmail = String(portalLogin.email).toLowerCase().trim();
      const existing = await User.findOne({ email: loginEmail });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'Portal login email is already registered'
        });
      }

      const partnerUser = await User.create({
        email: loginEmail,
        password: String(portalLogin.password),
        role: 'partner',
        profile: {
          firstName: String(portalLogin.firstName || organizationName || name).trim(),
          lastName: String(portalLogin.lastName || '').trim()
        }
      });
      resolvedLinkedUserId = partnerUser._id;
      portalLoginCredentials = { email: loginEmail };
    }

    const { fullKey, prefix, hash } = generateApiKey();
    const webhookSecret = crypto.randomBytes(16).toString('hex');

    const partnerPayload = applyPartnerPlanDefaults({
      name: String(name).trim(),
      organizationType,
      organizationName: organizationName ? String(organizationName).trim() : undefined,
      contactEmail: contactEmail ? String(contactEmail).toLowerCase().trim() : undefined,
      apiKeyPrefix: prefix,
      apiKeyHash: hash,
      scopes: scopes.length ? scopes : ['msme:read'],
      linkedUserId: resolvedLinkedUserId,
      webhookSecret,
      billingPlanId: String(billingPlanId).trim(),
      contractAnnualFeeInr: contractAnnualFeeInr != null ? Number(contractAnnualFeeInr) : undefined,
      createdBy: req.user.userId,
      notes: String(notes).trim(),
      ...buildPartnerBillingActivation({ billingStatus: 'active' })
    });

    const partner = await PartnerApplication.create(partnerPayload);

    res.status(201).json({
      success: true,
      data: {
        partner: sanitizePartnerForResponse(partner),
        apiKey: fullKey,
        webhookSecret,
        portalLogin: portalLoginCredentials
      },
      message: portalLoginCredentials
        ? 'Partner application and portal login created. Store the API key securely — it will not be shown again.'
        : 'Partner application created. Store the API key securely — it will not be shown again.'
    });
  } catch (error) {
    logger.error('Create partner application error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create partner application',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/partner-portal/applications/:id/usage
// @access  Admin
router.get('/applications/:id/usage', requireAdmin, async (req, res) => {
  try {
    const partner = await PartnerApplication.findById(req.params.id);
    if (!partner) {
      return res.status(404).json({ success: false, message: 'Partner application not found' });
    }

    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 90);
    const summary = await getPartnerUsageSummary(partner, { days });

    res.json({
      success: true,
      data: {
        partner: sanitizePartnerForResponse(partner),
        ...summary
      }
    });
  } catch (error) {
    logger.error('Admin partner usage error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load partner usage',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PATCH /api/partner-portal/applications/:id
// @access  Admin
router.patch('/applications/:id', requireAdmin, async (req, res) => {
  try {
    const partner = await PartnerApplication.findById(req.params.id);
    if (!partner) {
      return res.status(404).json({ success: false, message: 'Partner application not found' });
    }

    const {
      isActive,
      scopes,
      webhookUrl,
      notes,
      rotateApiKey,
      billingPlanId,
      contractAnnualFeeInr,
      rateLimitTier,
      usageLimits,
      overageRates,
      billingStatus,
      contractPaidUntil,
      activateBilling
    } = req.body || {};

    if (typeof isActive === 'boolean') {
      partner.isActive = isActive;
    }
    if (Array.isArray(scopes)) {
      partner.scopes = scopes.filter((s) => PARTNER_SCOPES.includes(s));
    }
    if (billingPlanId !== undefined) {
      partner.billingPlanId = String(billingPlanId).trim();
    }
    if (contractAnnualFeeInr !== undefined) {
      partner.contractAnnualFeeInr = Number(contractAnnualFeeInr);
    }
    if (rateLimitTier !== undefined) {
      if (!['standard', 'elevated'].includes(rateLimitTier)) {
        return res.status(400).json({
          success: false,
          message: 'rateLimitTier must be standard or elevated'
        });
      }
      partner.rateLimitTier = rateLimitTier;
    }
    if (usageLimits && typeof usageLimits === 'object') {
      const numericFields = [
        'apiCallsPerMonth',
        'webhookEventsPerMonth',
        'reportPullsPerMonth',
        'msmeMonitoredPerYear'
      ];
      numericFields.forEach((field) => {
        if (usageLimits[field] !== undefined) {
          partner.usageLimits[field] = Number(usageLimits[field]);
        }
      });
    }
    if (overageRates && typeof overageRates === 'object') {
      const rateFields = ['perApiCallInr', 'perWebhookInr', 'perReportPullInr', 'perMsmeMonthInr'];
      rateFields.forEach((field) => {
        if (overageRates[field] !== undefined) {
          partner.overageRates[field] = Number(overageRates[field]);
        }
      });
    }
    if (billingStatus !== undefined) {
      if (!['pending', 'active', 'expired', 'suspended'].includes(billingStatus)) {
        return res.status(400).json({
          success: false,
          message: 'billingStatus must be pending, active, expired, or suspended'
        });
      }
      partner.billingStatus = billingStatus;
    }
    if (contractPaidUntil !== undefined) {
      partner.contractPaidUntil = contractPaidUntil ? new Date(contractPaidUntil) : null;
    }
    if (activateBilling === true) {
      const activation = buildPartnerBillingActivation({
        billingStatus: 'active',
        contractPaidUntil: contractPaidUntil ? new Date(contractPaidUntil) : null
      });
      partner.billingStatus = activation.billingStatus;
      partner.billingActivatedAt = activation.billingActivatedAt;
      partner.contractPaidUntil = activation.contractPaidUntil;
    }
    if (webhookUrl !== undefined) {
      const normalized = webhookUrl ? String(webhookUrl).trim() : null;
      if (normalized && !/^https:\/\//i.test(normalized)) {
        return res.status(400).json({
          success: false,
          message: 'webhookUrl must use HTTPS when provided'
        });
      }
      partner.webhookUrl = normalized;
    }
    if (notes !== undefined) {
      partner.notes = String(notes).trim();
    }

    let rotatedKey = null;
    if (rotateApiKey === true) {
      const { fullKey, prefix, hash } = generateApiKey();
      partner.apiKeyPrefix = prefix;
      partner.apiKeyHash = hash;
      rotatedKey = fullKey;
    }

    await partner.save();

    const payload = {
      success: true,
      data: { partner: sanitizePartnerForResponse(partner) },
      message: rotatedKey ? 'API key rotated. Store the new key securely.' : 'Partner application updated'
    };
    if (rotatedKey) {
      payload.data.apiKey = rotatedKey;
    }

    res.json(payload);
  } catch (error) {
    logger.error('Update partner application error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update partner application',
      ...clientErrorPayload(error)
    });
  }
});

module.exports = router;
