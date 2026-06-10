const express = require('express');
const { clientErrorPayload } = require('../utils/httpErrors');
const router = express.Router();
const auth = require('../middleware/auth');
const Recommendation = require('../models/Recommendation');
const CarbonAssessment = require('../models/CarbonAssessment');
const logger = require('../utils/logger');

// GET /api/recommendations/stats - Recommendation effectiveness stats
// MUST be defined before /:id route
router.get('/stats', auth, async (req, res) => {
  try {
    const msmeId = req.user.msmeId;
    if (!msmeId) {
      return res.status(404).json({ success: false, message: 'MSME profile not found' });
    }

    const allRecs = await Recommendation.find({ msmeId }).lean();
    const completed = allRecs.filter(r => r.status === 'completed');
    const rated = allRecs.filter(r => r.userFeedback?.rating);

    const totalPotential = completed.reduce((s, r) => s + (r.potentialCO2Reduction || 0), 0);
    const totalActual = completed.reduce((s, r) => s + (r.actualCO2Saved || 0), 0);

    const stats = {
      total: allRecs.length,
      byStatus: {
        pending: allRecs.filter(r => r.status === 'pending').length,
        in_progress: allRecs.filter(r => r.status === 'in_progress').length,
        completed: completed.length,
        dismissed: allRecs.filter(r => r.status === 'dismissed').length
      },
      byPriority: {
        high: allRecs.filter(r => r.priority === 'high').length,
        medium: allRecs.filter(r => r.priority === 'medium').length,
        low: allRecs.filter(r => r.priority === 'low').length
      },
      totalPotentialCO2Reduction: allRecs.reduce((sum, r) => sum + (r.potentialCO2Reduction || 0), 0),
      totalActualCO2Saved: totalActual,
      totalImplementationCost: allRecs.reduce((sum, r) => sum + (r.implementationCost || 0), 0),
      completionRate: allRecs.length > 0
        ? parseFloat((completed.length / allRecs.length * 100).toFixed(1))
        : 0,
      averageFeedbackRating: rated.length > 0
        ? parseFloat((rated.reduce((sum, r) => sum + r.userFeedback.rating, 0) / rated.length).toFixed(1))
        : null,
      effectivenessRatio: totalPotential > 0
        ? parseFloat((totalActual / totalPotential * 100).toFixed(1))
        : null
    };

    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('Get recommendation stats error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', ...clientErrorPayload(error) });
  }
});

// GET /api/recommendations - List recommendations with filters
router.get('/', auth, async (req, res) => {
  try {
    const { status, priority, category, limit = 20, page = 1 } = req.query;
    const msmeId = req.user.msmeId;
    if (!msmeId) {
      return res.status(404).json({ success: false, message: 'MSME profile not found' });
    }

    const query = { msmeId };
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (category) query.category = category;

    const total = await Recommendation.countDocuments(query);
    const recommendations = await Recommendation.find(query)
      .sort({ priority: 1, createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('assessmentId', 'totalCO2Emissions carbonScore period')
      .lean();

    res.json({
      success: true,
      data: {
        recommendations,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
          total
        }
      }
    });
  } catch (error) {
    logger.error('Get recommendations error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', ...clientErrorPayload(error) });
  }
});

// POST /api/recommendations - Generate recommendations from latest assessment
router.post('/', auth, async (req, res) => {
  try {
    const msmeId = req.user.msmeId;
    if (!msmeId) {
      return res.status(404).json({ success: false, message: 'MSME profile not found' });
    }

    const { assessmentId, source = 'assessment' } = req.body;

    let assessment;
    if (assessmentId) {
      assessment = await CarbonAssessment.findOne({ _id: assessmentId, msmeId });
    } else {
      assessment = await CarbonAssessment.findOne({ msmeId })
        .sort({ 'period.startDate': -1 });
    }

    if (!assessment) {
      return res.status(404).json({ success: false, message: 'No carbon assessment found' });
    }

    const recommendations = [];
    for (const rec of (assessment.recommendations || [])) {
      const existing = await Recommendation.findOne({
        msmeId,
        assessmentId: assessment._id,
        title: rec.title
      });

      if (!existing) {
        const recommendation = new Recommendation({
          msmeId,
          assessmentId: assessment._id,
          category: rec.category,
          title: rec.title,
          description: rec.description,
          priority: rec.priority,
          potentialCO2Reduction: rec.potentialCO2Reduction,
          implementationCost: rec.implementationCost,
          paybackPeriod: rec.paybackPeriod,
          status: rec.isImplemented ? 'completed' : 'pending',
          source
        });
        await recommendation.save();
        recommendations.push(recommendation);
      }
    }

    logger.info(`Generated ${recommendations.length} recommendations for MSME: ${msmeId}`);

    res.status(201).json({
      success: true,
      message: `${recommendations.length} recommendations generated`,
      data: recommendations
    });
  } catch (error) {
    logger.error('Generate recommendations error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', ...clientErrorPayload(error) });
  }
});

// PUT /api/recommendations/:id - Update recommendation status
router.put('/:id', auth, async (req, res) => {
  try {
    const msmeId = req.user.msmeId;
    if (!msmeId) {
      return res.status(404).json({ success: false, message: 'MSME profile not found' });
    }

    const { status, actualCO2Saved, userFeedback, implementationDate, completionDate } = req.body;

    const recommendation = await Recommendation.findOne({
      _id: req.params.id,
      msmeId
    });

    if (!recommendation) {
      return res.status(404).json({ success: false, message: 'Recommendation not found' });
    }

    if (status) recommendation.status = status;
    if (actualCO2Saved !== undefined) recommendation.actualCO2Saved = actualCO2Saved;
    if (userFeedback) {
      recommendation.userFeedback = {
        ...recommendation.userFeedback?.toObject?.() || {},
        ...userFeedback,
        submittedAt: new Date()
      };
    }
    if (implementationDate) recommendation.implementationDate = implementationDate;
    if (completionDate) recommendation.completionDate = completionDate;

    if (status === 'completed' && !completionDate) {
      recommendation.completionDate = new Date();
    }
    if (status === 'in_progress' && !implementationDate) {
      recommendation.implementationDate = new Date();
    }

    await recommendation.save();

    logger.info(`Recommendation updated: ${req.params.id}`, { msmeId, status });

    res.json({
      success: true,
      message: 'Recommendation updated successfully',
      data: recommendation
    });
  } catch (error) {
    logger.error('Update recommendation error:', error);
    res.status(500).json({ success: false, message: 'Internal server error', ...clientErrorPayload(error) });
  }
});

module.exports = router;
