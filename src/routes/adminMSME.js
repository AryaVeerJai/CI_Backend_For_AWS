const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const MSME = require('../models/MSME');
const User = require('../models/User');
const CarbonAssessment = require('../models/CarbonAssessment');
const Recommendation = require('../models/Recommendation');
const Transaction = require('../models/Transaction');
const Document = require('../models/Document');
const UserIncentiveProfile = require('../models/UserIncentiveProfile');
const auth = require('../middleware/auth');
const logger = require('../utils/logger');
const { calculateMsmePayment } = require('../services/paymentPricingService');

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// All routes require authentication and admin/view privileges
router.use(auth);
router.use(auth.requireRole('admin', 'view'));

const requireAdminWrite = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Admin write privileges required.'
        });
    }
    return next();
};

// @route   GET /api/admin/msme/statistics
// @desc    Get admin dashboard statistics
// @access  Admin/View
router.get('/statistics', async (req, res) => {
    try {
        const totalMSMEs = await MSME.countDocuments();
        const verifiedMSMEs = await MSME.countDocuments({ status: 'verified' });
        const flaggedMSMEs = await MSME.countDocuments({ status: 'flagged' });
        const pendingMSMEs = await MSME.countDocuments({ status: 'pending' });
        const suspendedMSMEs = await MSME.countDocuments({ status: 'suspended' });

        const totalUsers = await User.countDocuments();
        const msmeUsers = await User.countDocuments({ role: 'msme' });

        // Get recent registrations (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const recentRegistrations = await MSME.countDocuments({
            createdAt: { $gte: sevenDaysAgo }
        });

        res.json({
            success: true,
            data: {
                msme: {
                    total: totalMSMEs,
                    verified: verifiedMSMEs,
                    flagged: flaggedMSMEs,
                    pending: pendingMSMEs,
                    suspended: suspendedMSMEs,
                    recentRegistrations
                },
                users: {
                    total: totalUsers,
                    msme: msmeUsers
                }
            }
        });
    } catch (error) {
        logger.error('Error fetching admin statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            ...clientErrorPayload(error)
        });
    }
});

// @route   GET /api/admin/msme/list
// @desc    Get list of all MSMEs with pagination and filtering
// @access  Admin/View
router.get('/list', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        // Build filter query
        const filter = {};

        if (req.query.status) {
            filter.status = req.query.status;
        }

        if (req.query.industry) {
            filter.industry = req.query.industry;
        }

        if (req.query.search) {
            const safeSearch = escapeRegExp(String(req.query.search));
            filter.$or = [
                { companyName: { $regex: safeSearch, $options: 'i' } },
                { gstNumber: { $regex: safeSearch, $options: 'i' } },
                { panNumber: { $regex: safeSearch, $options: 'i' } },
                { 'contact.email': { $regex: safeSearch, $options: 'i' } }
            ];
        }

        // Get MSMEs with user information
        const msmes = await MSME.find(filter)
            .populate('userId', 'email profile createdAt lastLogin')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const total = await MSME.countDocuments(filter);
        const pages = Math.ceil(total / limit);

        res.json({
            success: true,
            data: {
                msmes,
                pagination: {
                    total,
                    page,
                    pages,
                    limit
                }
            }
        });
    } catch (error) {
        logger.error('Error fetching MSME list:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            ...clientErrorPayload(error)
        });
    }
});

// @route   GET /api/admin/msme/:id
// @desc    Get detailed MSME information
// @access  Admin/View
router.get('/:id', async (req, res) => {
    try {
        const msme = await MSME.findById(req.params.id)
            .populate('userId', 'email profile createdAt lastLogin isActive')
            .populate('adminNotes.addedBy', 'email profile.firstName profile.lastName')
            .populate('flaggedBy', 'profile.firstName profile.lastName')
            .lean();

        if (!msme) {
            return res.status(404).json({
                success: false,
                message: 'MSME not found'
            });
        }

        const [
            latestAssessment,
            recommendations,
            transactions,
            uploadedBills,
            benefitsProfile,
            totalRecommendations,
            recommendationStatusSummary,
            totalTransactions,
            totalBills,
            recentAssessments,
            totalAssessments
        ] = await Promise.all([
            CarbonAssessment.findOne({ msmeId: msme._id }).sort({ createdAt: -1 }).lean(),
            Recommendation.find({ msmeId: msme._id })
                .sort({ createdAt: -1 })
                .limit(20)
                .lean(),
            Transaction.find({ msmeId: msme._id })
                .sort({ date: -1 })
                .limit(20)
                .lean(),
            Document.find({
                msmeId: msme._id,
                documentType: { $in: ['bill', 'invoice', 'receipt', 'statement'] }
            })
                .sort({ createdAt: -1 })
                .limit(20)
                .lean(),
            UserIncentiveProfile.findOne({
                $or: [
                    { msmeId: msme._id },
                    { userId: msme.userId?._id || msme.userId }
                ]
            }).lean(),
            Recommendation.countDocuments({ msmeId: msme._id }),
            Recommendation.aggregate([
                { $match: { msmeId: msme._id } },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            Transaction.countDocuments({ msmeId: msme._id }),
            Document.countDocuments({
                msmeId: msme._id,
                documentType: { $in: ['bill', 'invoice', 'receipt', 'statement'] }
            }),
            CarbonAssessment.find({ msmeId: msme._id })
                .sort({ createdAt: -1 })
                .limit(20)
                .select('assessmentType status carbonScore totalCO2Emissions period createdAt')
                .lean(),
            CarbonAssessment.countDocuments({ msmeId: msme._id })
        ]);

        const paymentSummary = req.user.role === 'admin'
            ? calculateMsmePayment({
                msme,
                totalTransactions,
                totalCO2Emissions: latestAssessment?.totalCO2Emissions || 0
            })
            : null;

        const manufacturingWorkflow = msme.business?.manufacturingWorkflow || {};
        const latestWorkflowEstimate = manufacturingWorkflow.latestEstimate || {};
        const emissionsTotal = latestAssessment?.totalCO2Emissions
            ?? latestWorkflowEstimate.totalCO2Emissions
            ?? 0;

        const recommendationsByStatus = recommendationStatusSummary.reduce((acc, item) => {
            const key = item._id || 'pending';
            acc[key] = item.count || 0;
            return acc;
        }, {});

        const operationsSnapshot = {
            unitsCount: manufacturingWorkflow.units?.length || 0,
            processesCount: manufacturingWorkflow.processes?.length || 0,
            employeesCount: manufacturingWorkflow.employees?.length || 0,
            supplyChainPartnersCount: manufacturingWorkflow.supplyChain?.length || 0,
            workflowLocked: Boolean(manufacturingWorkflow.isLocked),
            latestEstimate: {
                totalCO2Emissions: latestWorkflowEstimate.totalCO2Emissions || 0,
                machineryEmissions: latestWorkflowEstimate.machineryEmissions || 0,
                rawMaterialEmissions: latestWorkflowEstimate.rawMaterialEmissions || 0,
                packagingMaterialEmissions: latestWorkflowEstimate.packagingMaterialEmissions || 0,
                commuteEmissions: latestWorkflowEstimate.commuteEmissions || 0,
                supplyChainEmissions: latestWorkflowEstimate.supplyChainEmissions || 0,
                scope3Emissions: latestWorkflowEstimate.scope3Emissions || 0
            },
            lastEstimatedAt: manufacturingWorkflow.lastEstimatedAt || null
        };

        const reportEndpointDefinitions = [
            {
                key: 'brsr',
                label: 'BRSR',
                endpoint: '/api/reporting/brsr',
                available: totalTransactions > 0,
                description: totalTransactions > 0
                    ? 'Business responsibility reporting data is available.'
                    : 'Limited transaction data for BRSR reporting.'
            },
            {
                key: 'cbam',
                label: 'CBAM',
                endpoint: '/api/reporting/cbam',
                available: msme.businessDomain === 'export_import',
                description: msme.businessDomain === 'export_import'
                    ? 'Priority CBAM reporting for export/import operations.'
                    : 'Optional for non export/import MSMEs.'
            },
            {
                key: 'iso-14064',
                label: 'ISO 14064',
                endpoint: '/api/reporting/iso-14064',
                available: totalAssessments > 0,
                description: totalAssessments > 0
                    ? 'GHG inventory reporting is ready.'
                    : 'Pending carbon assessment data.'
            },
            {
                key: 'iso-14067',
                label: 'ISO 14067',
                endpoint: '/api/reporting/iso-14067',
                available: totalAssessments > 0,
                description: totalAssessments > 0
                    ? 'Product carbon footprint reporting is ready.'
                    : 'Pending carbon assessment data.'
            }
        ];

        const reportingOverview = {
            availableReports: totalAssessments,
            latestAssessmentDate: recentAssessments[0]?.createdAt || null,
            latestReportContext: [
                recentAssessments[0]?.assessmentType,
                recentAssessments[0]?.status
            ].filter(Boolean).join(' · ') || 'N/A',
            endpoints: reportEndpointDefinitions
        };

        res.json({
            success: true,
            data: {
                msme,
                viewData: {
                    carbonEmissions: {
                        totalCO2Emissions: emissionsTotal,
                        assessmentType: latestAssessment?.assessmentType || 'N/A',
                        assessmentStatus: latestAssessment?.status || 'N/A',
                        period: latestAssessment?.period || {},
                        esgScopes: latestAssessment?.esgScopes || {},
                        updatedAt: latestAssessment?.createdAt || msme.updatedAt
                    },
                    recommendations: {
                        total: totalRecommendations,
                        byStatus: recommendationsByStatus,
                        items: recommendations
                    },
                    carbonScore: {
                        current: latestAssessment?.carbonScore ?? msme.carbonScore ?? 0,
                        previous: latestAssessment?.benchmarks?.previousAssessment ?? null,
                        industryAverage: latestAssessment?.benchmarks?.industryAverage ?? null,
                        bestInClass: latestAssessment?.benchmarks?.bestInClass ?? null,
                        scoreBreakdown: latestAssessment?.scoreBreakdown || {},
                        updatedAt: latestAssessment?.createdAt || msme.lastCarbonAssessment || msme.updatedAt
                    },
                    benefits: {
                        totalPoints: benefitsProfile?.totalPoints ?? 0,
                        level: benefitsProfile?.level ?? 1,
                        nextLevelPoints: benefitsProfile?.nextLevelPoints ?? 0,
                        achievementsUnlocked: benefitsProfile?.achievementsUnlocked ?? 0,
                        carbonSaved: benefitsProfile?.carbonSaved ?? 0,
                        streak: benefitsProfile?.streak ?? 0,
                        recentActivities: benefitsProfile?.recentActivities || []
                    },
                    profile: {
                        companyName: msme.companyName,
                        companyType: msme.companyType,
                        industry: msme.industry,
                        businessDomain: msme.businessDomain,
                        establishmentYear: msme.establishmentYear,
                        contact: msme.contact || {},
                        compliance: msme.environmentalCompliance || {},
                        user: msme.userId || {}
                    },
                    operations: operationsSnapshot,
                    reporting: reportingOverview,
                    paymentSummary,
                    billsUploaded: uploadedBills,
                    transactionsStored: transactions
                }
            }
        });
    } catch (error) {
        logger.error('Error fetching MSME details:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            ...clientErrorPayload(error)
        });
    }
});

// @route   PUT /api/admin/msme/:id/status
// @desc    Update MSME status (verify, flag, suspend)
// @access  Admin only
router.put('/:id/status', requireAdminWrite, async (req, res) => {
    try {
        const { status, note } = req.body;

        // Validate status
        const validStatuses = ['pending', 'verified', 'flagged', 'suspended'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
            });
        }

        const msme = await MSME.findById(req.params.id);

        if (!msme) {
            return res.status(404).json({
                success: false,
                message: 'MSME not found'
            });
        }

        // Update status
        msme.status = status;

        // If flagging, record who flagged and when
        if (status === 'flagged') {
            msme.flaggedAt = new Date();
            msme.flaggedBy = req.user.userId;
        }

        // Add admin note if provided
        if (note) {
            msme.adminNotes = msme.adminNotes || [];
            msme.adminNotes.push({
                note,
                addedBy: req.user.userId,
                addedAt: new Date()
            });
        }

        await msme.save();

        logger.info(`MSME ${msme.companyName} status updated to ${status} by admin ${req.user.email}`);

        res.json({
            success: true,
            message: `MSME status updated to ${status}`,
            data: { msme }
        });
    } catch (error) {
        logger.error('Error updating MSME status:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            ...clientErrorPayload(error)
        });
    }
});

// @route   DELETE /api/admin/msme/:id
// @desc    Delete MSME and optionally the associated user account
// @access  Admin only
router.delete('/:id', requireAdminWrite, async (req, res) => {
    try {
        const { deleteUser } = req.query;  // ?deleteUser=true to also delete user account

        const msme = await MSME.findById(req.params.id);

        if (!msme) {
            return res.status(404).json({
                success: false,
                message: 'MSME not found'
            });
        }

        const userId = msme.userId;
        const companyName = msme.companyName;

        // Delete MSME
        await MSME.findByIdAndDelete(req.params.id);

        // Optionally delete user account
        if (deleteUser === 'true') {
            await User.findByIdAndDelete(userId);
            logger.info(`MSME ${companyName} and associated user account deleted by admin ${req.user.email}`);
        } else {
            logger.info(`MSME ${companyName} deleted by admin ${req.user.email}`);
        }

        res.json({
            success: true,
            message: `MSME deleted successfully${deleteUser === 'true' ? ' (including user account)' : ''}`
        });
    } catch (error) {
        logger.error('Error deleting MSME:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            ...clientErrorPayload(error)
        });
    }
});

// @route   POST /api/admin/msme/:id/note
// @desc    Add admin note to MSME
// @access  Admin only
router.post('/:id/note', requireAdminWrite, async (req, res) => {
    try {
        const { note } = req.body;

        if (!note || !note.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Note is required'
            });
        }

        const msme = await MSME.findById(req.params.id);

        if (!msme) {
            return res.status(404).json({
                success: false,
                message: 'MSME not found'
            });
        }

        msme.adminNotes = msme.adminNotes || [];
        msme.adminNotes.push({
            note: note.trim(),
            addedBy: req.user.userId,
            addedAt: new Date()
        });

        await msme.save();

        res.json({
            success: true,
            message: 'Note added successfully',
            data: { msme }
        });
    } catch (error) {
        logger.error('Error adding admin note:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            ...clientErrorPayload(error)
        });
    }
});

module.exports = router;
