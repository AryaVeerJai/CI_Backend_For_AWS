const express = require('express');
const mongoose = require('mongoose');
const { clientErrorPayload } = require('../utils/httpErrors');
const MSME = require('../models/MSME');
const CarbonAssessment = require('../models/CarbonAssessment');
const Transaction = require('../models/Transaction');
const partnerAuth = require('../middleware/partnerAuth');
const partnerRateLimit = require('../middleware/partnerRateLimit');
const enforcePartnerBilling = require('../middleware/enforcePartnerBilling');
const enforcePartnerUsageLimits = require('../middleware/enforcePartnerUsageLimits');
const recordPartnerApiUsage = require('../middleware/recordPartnerApiUsage');
const {
  PARTNER_SCOPES,
  API_KEY_PREFIX,
  sanitizePartnerForResponse,
  buildMsmePartnerSummary
} = require('../services/partnerApiService');
const { buildPublicPartnerOpenApi } = require('../config/publicPartnerOpenApi');
const { getPartnerUsageSummary } = require('../services/partnerUsageService');
const logger = require('../utils/logger');

const router = express.Router();

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const INTEGRATION_CATALOG = {
  version: 'v1',
  authentication: {
    type: 'api_key',
    headerOptions: ['X-API-Key', 'Authorization: Bearer <api_key>'],
    keyPrefix: API_KEY_PREFIX,
    note: 'Partner keys are issued by Carbon Intelligence administrators. Keys are shown once at creation.'
  },
  scopes: PARTNER_SCOPES.map((scope) => ({
    id: scope,
    description: {
      'msme:read': 'List and read MSME company summaries',
      'carbon:read': 'Read carbon assessment summaries',
      'reports:read': 'Read reporting readiness metadata',
      'transactions:summary': 'Read aggregated transaction metrics (no raw line items)',
      'webhooks:manage': 'Configure outbound webhook URL on the partner application'
    }[scope]
  })),
  endpoints: [
    { method: 'GET', path: '/api/v1/public/integration-catalog', access: 'public' },
    { method: 'GET', path: '/api/v1/public/openapi.json', access: 'public' },
    { method: 'GET', path: '/api/v1/partners/me', access: 'partner', scopes: [] },
    { method: 'GET', path: '/api/v1/partners/usage', access: 'partner', scopes: [] },
    { method: 'GET', path: '/api/v1/partners/msmes', access: 'partner', scopes: ['msme:read'] },
    { method: 'GET', path: '/api/v1/partners/msmes/:msmeId/carbon-summary', access: 'partner', scopes: ['carbon:read'] },
    { method: 'GET', path: '/api/v1/partners/msmes/:msmeId/reports/overview', access: 'partner', scopes: ['reports:read'] },
    { method: 'GET', path: '/api/v1/partners/msmes/:msmeId/transactions/summary', access: 'partner', scopes: ['transactions:summary'] },
    { method: 'PATCH', path: '/api/v1/partners/webhook', access: 'partner', scopes: ['webhooks:manage'] }
  ],
  supportEmail: process.env.PARTNER_API_SUPPORT_EMAIL || 'support@sustainow.in',
  partnershipPricing: {
    currency: 'INR',
    pricesExclusiveOfGst: true,
    summary:
      'Indicative partnership fees for banks, auditors, verification agencies, and integrators. Final quotes depend on cohort size and API volume.',
    models: [
      {
        id: 'bank_platform',
        partnerType: 'Bank / NBFC',
        annualFeeInr: { min: 500000, max: 5000000 },
        usageFeeLabel: '₹500 per green-loan origination file (optional)',
        msmeAccess: 'Subsidised or ₹0/month for programme MSMEs'
      },
      {
        id: 'anchor_enterprise',
        partnerType: 'Anchor enterprise',
        annualFeeInr: { min: 800000, max: 3500000 },
        usageFeeLabel: '₹75–₹150 per supplier / year',
        msmeAccess: 'Bundled in supplier programme'
      },
      {
        id: 'auditor',
        partnerType: 'Accredited auditor',
        annualFeeInr: { min: 200000, max: 800000 },
        msmeAccess: 'Read-only on client MSMEs'
      },
      {
        id: 'verification_agency',
        partnerType: 'Verification agency',
        annualFeeInr: { min: 150000, max: 600000 },
        usageFeeLabel: '₹250 per verification pack (optional)'
      },
      {
        id: 'integration_partner',
        partnerType: 'ERP / accounting integrator',
        annualFeeInr: { min: 300000, max: 1500000 },
        usageFeeLabel: '₹50 / MSME / month above bundle'
      },
      {
        id: 'api_starter',
        partnerType: 'API-only integrator',
        annualFeeInr: { min: 99000, max: 99000 }
      }
    ],
    apiUsageOverage: [
      { item: 'MSME accounts monitored', included: '500 / year', overage: '₹25 / MSME / month' },
      { item: 'API requests', included: '100,000 / month', overage: '₹0.15 / call' },
      { item: 'Webhook events', included: '10,000 / month', overage: '₹0.50 / event' },
      { item: 'Report readiness pulls', included: '2,000 / month', overage: '₹5 / pull' }
    ],
    contactEmail: process.env.PARTNER_COMMERCIAL_EMAIL || 'contact@sustainow.in'
  },
  portalPath: '/partners'
};

// @route   GET /api/v1/public/integration-catalog
// @desc    Public integration catalog for third-party developers
// @access  Public
router.get('/public/integration-catalog', (req, res) => {
  res.json({
    success: true,
    data: INTEGRATION_CATALOG
  });
});

// @route   GET /api/v1/public/openapi.json
// @desc    OpenAPI document for partner/public endpoints
// @access  Public
router.get('/public/openapi.json', (req, res) => {
  res.json(buildPublicPartnerOpenApi('/api'));
});

const partnersRouter = express.Router();
partnersRouter.use(partnerAuth);
partnersRouter.use(partnerRateLimit);
partnersRouter.use(enforcePartnerBilling);
partnersRouter.use(enforcePartnerUsageLimits);
partnersRouter.use(recordPartnerApiUsage);

// @route   GET /api/v1/partners/me
// @desc    Partner application profile for the authenticated API key
// @access  Partner API key
partnersRouter.get('/me', (req, res) => {
  res.json({
    success: true,
    data: sanitizePartnerForResponse(req.partner)
  });
});

// @route   GET /api/v1/partners/usage
// @desc    Current usage, quotas, and indicative billing for the authenticated API key
// @access  Partner API key
partnersRouter.get('/usage', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 90);
    const summary = await getPartnerUsageSummary(req.partner, { days });

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    logger.error('Partner usage API error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load partner usage summary',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/v1/partners/msmes
// @desc    Paginated MSME summaries for partner integrations
// @access  Partner API key (msme:read)
partnersRouter.get('/msmes', partnerAuth.requirePartnerScope('msme:read'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) {
      filter.status = String(req.query.status);
    }
    if (req.query.search) {
      const safeSearch = escapeRegExp(String(req.query.search));
      filter.companyName = { $regex: safeSearch, $options: 'i' };
    }

    const [msmes, total] = await Promise.all([
      MSME.find(filter)
        .select('companyName industry status businessDomain locationState locationCity locationCountry updatedAt')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      MSME.countDocuments(filter)
    ]);

    const msmeIds = msmes.map((m) => m._id);
    const assessments = await CarbonAssessment.find({ msmeId: { $in: msmeIds } })
      .sort({ createdAt: -1 })
      .lean();

    const latestByMsme = new Map();
    assessments.forEach((row) => {
      const key = String(row.msmeId);
      if (!latestByMsme.has(key)) {
        latestByMsme.set(key, row);
      }
    });

    res.json({
      success: true,
      data: {
        items: msmes.map((msme) => buildMsmePartnerSummary(msme, latestByMsme.get(String(msme._id)))),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1
        }
      }
    });
  } catch (error) {
    logger.error('Partner list MSMEs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to list MSME summaries',
      ...clientErrorPayload(error)
    });
  }
});

const loadMsmeOr404 = async (msmeId, res) => {
  if (!mongoose.Types.ObjectId.isValid(msmeId)) {
    res.status(400).json({ success: false, message: 'Invalid MSME id' });
    return null;
  }
  const msme = await MSME.findById(msmeId)
    .select('companyName industry status businessDomain location updatedAt')
    .lean();
  if (!msme) {
    res.status(404).json({ success: false, message: 'MSME not found' });
    return null;
  }
  return msme;
};

// @route   GET /api/v1/partners/msmes/:msmeId/carbon-summary
// @access  Partner API key (carbon:read)
partnersRouter.get('/msmes/:msmeId/carbon-summary', partnerAuth.requirePartnerScope('carbon:read'), async (req, res) => {
  try {
    const msme = await loadMsmeOr404(req.params.msmeId, res);
    if (!msme) return;

    const latestAssessment = await CarbonAssessment.findOne({ msmeId: msme._id })
      .sort({ createdAt: -1 })
      .select('assessmentType status carbonScore totalCO2Emissions period esgScopes createdAt')
      .lean();

    res.json({
      success: true,
      data: {
        msme: buildMsmePartnerSummary(msme, latestAssessment),
        assessment: latestAssessment || null
      }
    });
  } catch (error) {
    logger.error('Partner carbon summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch carbon summary',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/v1/partners/msmes/:msmeId/reports/overview
// @access  Partner API key (reports:read)
partnersRouter.get('/msmes/:msmeId/reports/overview', partnerAuth.requirePartnerScope('reports:read'), async (req, res) => {
  try {
    const msme = await loadMsmeOr404(req.params.msmeId, res);
    if (!msme) return;

    const [totalAssessments, totalTransactions, recentAssessments] = await Promise.all([
      CarbonAssessment.countDocuments({ msmeId: msme._id }),
      Transaction.countDocuments({ msmeId: msme._id }),
      CarbonAssessment.find({ msmeId: msme._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('assessmentType status carbonScore totalCO2Emissions createdAt')
        .lean()
    ]);

    res.json({
      success: true,
      data: {
        msmeId: msme._id,
        companyName: msme.companyName,
        reports: [
          { type: 'BRSR', status: totalTransactions > 0 ? 'ready' : 'limited_data' },
          { type: 'ISO 14064', status: totalAssessments > 0 ? 'ready' : 'pending_data' },
          { type: 'CBAM', status: msme.businessDomain === 'export_import' ? 'priority' : 'optional' }
        ],
        recentAssessments
      }
    });
  } catch (error) {
    logger.error('Partner reports overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reports overview',
      ...clientErrorPayload(error)
    });
  }
});

// @route   GET /api/v1/partners/msmes/:msmeId/transactions/summary
// @access  Partner API key (transactions:summary)
partnersRouter.get('/msmes/:msmeId/transactions/summary', partnerAuth.requirePartnerScope('transactions:summary'), async (req, res) => {
  try {
    const msme = await loadMsmeOr404(req.params.msmeId, res);
    if (!msme) return;

    const [totalCount, amountAgg, categoryAgg] = await Promise.all([
      Transaction.countDocuments({ msmeId: msme._id }),
      Transaction.aggregate([
        { $match: { msmeId: msme._id } },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$amount' },
            avgAmount: { $avg: '$amount' }
          }
        }
      ]),
      Transaction.aggregate([
        { $match: { msmeId: msme._id } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
    ]);

    const totals = amountAgg[0] || { totalAmount: 0, avgAmount: 0 };

    res.json({
      success: true,
      data: {
        msmeId: msme._id,
        companyName: msme.companyName,
        totalTransactions: totalCount,
        totalAmount: totals.totalAmount || 0,
        averageAmount: totals.avgAmount || 0,
        topCategories: categoryAgg.map((row) => ({
          category: row._id || 'uncategorized',
          count: row.count
        }))
      }
    });
  } catch (error) {
    logger.error('Partner transaction summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction summary',
      ...clientErrorPayload(error)
    });
  }
});

// @route   PATCH /api/v1/partners/webhook
// @access  Partner API key (webhooks:manage)
partnersRouter.patch('/webhook', partnerAuth.requirePartnerScope('webhooks:manage'), async (req, res) => {
  try {
    const { webhookUrl } = req.body || {};
    if (webhookUrl !== null && webhookUrl !== undefined) {
      const normalized = String(webhookUrl).trim();
      if (normalized && !/^https:\/\//i.test(normalized)) {
        return res.status(400).json({
          success: false,
          message: 'webhookUrl must use HTTPS when provided'
        });
      }
      req.partner.webhookUrl = normalized || null;
    }

    await req.partner.save();

    res.json({
      success: true,
      data: {
        webhookUrl: req.partner.webhookUrl,
        configured: Boolean(req.partner.webhookUrl)
      },
      message: 'Webhook configuration updated'
    });
  } catch (error) {
    logger.error('Partner webhook update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update webhook',
      ...clientErrorPayload(error)
    });
  }
});

router.use('/partners', partnersRouter);

module.exports = router;
module.exports.INTEGRATION_CATALOG = INTEGRATION_CATALOG;
