const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireMsmePlanFeature } = require('../middleware/enforceMsmePlanLimits');
const UserIncentiveProfile = require('../models/UserIncentiveProfile');
const MSME = require('../models/MSME');
const CarbonAssessment = require('../models/CarbonAssessment');
const mongoose = require('mongoose');

const DEFAULT_INCENTIVE_REWARDS = [
  {
    rewardId: 'reward-carbon-report',
    title: 'Carbon report export',
    description: 'Unlock a branded PDF export of your latest carbon assessment',
    cost: 200,
    category: 'reporting',
    available: true
  },
  {
    rewardId: 'reward-assessment-credit',
    title: 'Extra assessment credit',
    description: 'Run one additional carbon assessment this month',
    cost: 350,
    category: 'assessment',
    available: true
  },
  {
    rewardId: 'reward-green-badge',
    title: 'Green MSME badge',
    description: 'Display a verified sustainability badge on your profile',
    cost: 500,
    category: 'recognition',
    available: true
  }
];

const buildLeaderboard = async (limit = 5) => {
  const leaderboard = await UserIncentiveProfile.find({})
    .sort({ totalPoints: -1, level: -1, updatedAt: 1 })
    .limit(limit)
    .populate('userId', 'email');

  const msmeByUser = await MSME.find({
    userId: { $in: leaderboard.map(item => item.userId?._id || item.userId).filter(Boolean) }
  }).select('userId companyName');
  const msmeMap = new Map(msmeByUser.map(item => [item.userId.toString(), item.companyName]));

  return leaderboard.map((entry, index) => ({
    rank: index + 1,
    companyName: msmeMap.get(entry.userId.toString()) || entry.userId?.email || 'MSME',
    points: entry.totalPoints,
    level: entry.level
  }));
};

const getProfile = async (userId) => {
  let profile = await UserIncentiveProfile.findOne({ userId });
  if (!profile) {
    profile = await UserIncentiveProfile.create({
      userId,
      rewards: DEFAULT_INCENTIVE_REWARDS
    });
  } else if (!profile.rewards || profile.rewards.length === 0) {
    profile.rewards = DEFAULT_INCENTIVE_REWARDS;
    await profile.save();
  }
  return profile;
};

const buildStats = async (userId) => {
  const normalizedUserId = String(userId);
  const objectUserId = mongoose.Types.ObjectId.isValid(normalizedUserId)
    ? new mongoose.Types.ObjectId(normalizedUserId)
    : null;
  const profile = await getProfile(normalizedUserId);
  const msme = await MSME.findOne({ userId: objectUserId || normalizedUserId }).select('_id companyName');
  const assessmentOrConditions = objectUserId
    ? [{ userId: objectUserId }, { userId: normalizedUserId }]
    : [{ userId: normalizedUserId }];
  if (msme?._id) {
    assessmentOrConditions.push({ msmeId: msme._id });
  }
  const assessmentMatch = { $or: assessmentOrConditions };

  const [assessmentCount, completedTaskCount, implementedRecommendations] = await Promise.all([
    CarbonAssessment.countDocuments(assessmentMatch),
    profile.dailyTasks.filter(task => task.completed).length,
    CarbonAssessment.aggregate([
      { $match: assessmentMatch },
      { $unwind: '$recommendations' },
      { $match: { 'recommendations.isImplemented': true } },
      { $count: 'total' }
    ])
  ]);

  const leaderboard = await buildLeaderboard(5);
  const targetCompanyName = msme?.companyName || null;
  const currentRank = targetCompanyName
    ? leaderboard.findIndex(item => item.companyName === targetCompanyName)
    : -1;
  const rank = currentRank >= 0 ? currentRank + 1 : null;

  const achievements = [
    {
      id: 'achv_assessments',
      title: 'Carbon Warrior',
      description: 'Complete 10 carbon footprint assessments',
      points: 100,
      completed: assessmentCount >= 10,
      progress: assessmentCount,
      maxProgress: 10
    },
    {
      id: 'achv_tasks',
      title: 'Task Champion',
      description: 'Complete 20 daily sustainability tasks',
      points: 75,
      completed: completedTaskCount >= 20,
      progress: completedTaskCount,
      maxProgress: 20
    },
    {
      id: 'achv_reco',
      title: 'Recommendation Follower',
      description: 'Implement 5 recommendations',
      points: 120,
      completed: (implementedRecommendations[0]?.total || 0) >= 5,
      progress: implementedRecommendations[0]?.total || 0,
      maxProgress: 5
    }
  ];

  try {
    const adeetieService = require('../services/adeetieEligibilityService');
    const msmeForAdeetie = msme || await MSME.findOne({ userId: objectUserId || normalizedUserId }).select('_id manufacturingProfile companyType udyamRegistrationNumber gstNumber industry businessDomain');
    if (msmeForAdeetie) {
      const adeetieEligibility = adeetieService.evaluateEligibility(msmeForAdeetie);
      const adeetieReadiness = await adeetieService.computeReadinessScore(msmeForAdeetie);
      achievements.push(
        {
          id: 'achv_adeetie_ready',
          title: 'ADEETIE Ready',
          description: 'Meet ADEETIE pre-eligibility (Udyam, sector, cluster)',
          points: 150,
          completed: adeetieEligibility.isEligible,
          progress: adeetieEligibility.isEligible ? 1 : 0,
          maxProgress: 1
        },
        {
          id: 'achv_adeetie_savings',
          title: 'Energy Savings Pathway',
          description: 'Reach 10% estimated energy savings for ADEETIE',
          points: 200,
          completed: adeetieReadiness.estimatedEnergySavingsPercent >= adeetieReadiness.minRequiredSavingsPercent,
          progress: adeetieReadiness.estimatedEnergySavingsPercent,
          maxProgress: adeetieReadiness.minRequiredSavingsPercent
        }
      );
    }
  } catch {
    // ADEETIE achievements are optional if service unavailable
  }

  return {
    userStats: {
      totalPoints: profile.totalPoints,
      level: profile.level,
      nextLevelPoints: profile.nextLevelPoints,
      currentLevelPoints: profile.currentLevelPoints,
      achievementsUnlocked: achievements.filter(item => item.completed).length,
      totalAchievements: achievements.length,
      streak: profile.streak,
      carbonSaved: profile.carbonSaved,
      rank
    },
    achievements,
    rewards: profile.rewards
  };
};

const buildDailyTasks = async (userId) => {
  const profile = await getProfile(userId);
  if (!profile.dailyTasks || profile.dailyTasks.length === 0) {
    profile.dailyTasks = [
      {
        taskId: 'upload-transactions',
        title: 'Upload transaction data',
        description: 'Upload latest transactions for carbon analysis',
        points: 25,
        category: 'data',
        completed: false
      },
      {
        taskId: 'run-assessment',
        title: 'Complete assessment',
        description: 'Run one carbon assessment this week',
        points: 40,
        category: 'assessment',
        completed: false
      },
      {
        taskId: 'implement-reco',
        title: 'Implement recommendation',
        description: 'Mark one recommendation as implemented',
        points: 30,
        category: 'action',
        completed: false
      }
    ];
    await profile.save();
  }
  return profile.dailyTasks;
};

const { handleFinanceOverview } = require('./financeOverviewHandler');

// @route   GET /api/incentives/finance-overview
// @desc    Structured finance & incentives eligibility from emissions achievements
// @access  Private
router.get('/finance-overview', auth, handleFinanceOverview);

// @route   GET /api/incentives
// @desc    List gamification incentives (rewards, stats, daily tasks)
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const [stats, dailyTasks, leaderboard] = await Promise.all([
      buildStats(req.user.userId),
      buildDailyTasks(req.user.userId),
      buildLeaderboard(5)
    ]);
    const profile = await getProfile(req.user.userId);

    res.json({
      success: true,
      data: {
        incentives: (profile.rewards || []).map((reward) => ({
          id: reward.rewardId,
          title: reward.title,
          description: reward.description,
          cost: reward.cost,
          category: reward.category,
          available: reward.available
        })),
        ...stats,
        dailyTasks,
        leaderboard
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching incentives'
    });
  }
});

const redeemReward = async (req, res) => {
  try {
    const rewardId = req.body?.rewardId;
    const profile = await getProfile(req.user.userId);

    const reward = profile.rewards.find((r) => r.rewardId === rewardId);
    if (!reward) {
      return res.status(404).json({
        success: false,
        message: 'Reward not found'
      });
    }

    if (!reward.available) {
      return res.status(400).json({
        success: false,
        message: 'Reward is not available'
      });
    }

    if (reward.cost > profile.totalPoints) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient points'
      });
    }

    profile.totalPoints -= reward.cost;
    while (profile.totalPoints >= profile.nextLevelPoints) {
      profile.level += 1;
      profile.currentLevelPoints = profile.nextLevelPoints;
      profile.nextLevelPoints = profile.currentLevelPoints + 1000;
    }
    profile.recentActivities.push({
      type: 'reward_redeemed',
      title: 'Reward redeemed',
      description: reward.title,
      points: -reward.cost
    });
    await profile.save();

    return res.json({
      success: true,
      message: 'Reward redeemed successfully',
      data: {
        userStats: {
          totalPoints: profile.totalPoints,
          level: profile.level,
          nextLevelPoints: profile.nextLevelPoints,
          currentLevelPoints: profile.currentLevelPoints
        },
        redeemedReward: reward
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error redeeming reward'
    });
  }
};

// @route   POST /api/incentives/:incentiveId/claim
// @desc    Claim (redeem) an incentive reward using points
// @access  Private
router.post('/:incentiveId/claim', auth, requireMsmePlanFeature('greenFinance'), async (req, res) => {
  req.body = { ...(req.body || {}), rewardId: req.params.incentiveId };
  return redeemReward(req, res);
});

// Get user stats and achievements
router.get('/stats', auth, async (req, res) => {
  try {
    const data = await buildStats(req.user.userId);
    res.json({
      success: true,
      data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching user stats'
    });
  }
});

// Redeem a reward
router.post('/redeem', auth, requireMsmePlanFeature('greenFinance'), redeemReward);

// Update achievement progress
router.post('/achievements/:achievementId/progress', auth, async (req, res) => {
  try {
    const { achievementId } = req.params;
    const { progress = 0 } = req.body;
    const profile = await getProfile(req.user.userId);
    const task = profile.dailyTasks.find(item => item.taskId === achievementId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (progress > 0 && !task.completed) {
      task.completed = true;
      task.completedAt = new Date();
      profile.totalPoints += task.points;
      profile.recentActivities.push({
        type: 'task_completed',
        title: 'Task completed',
        description: task.title,
        points: task.points
      });
      await profile.save();
    }

    res.json({
      success: true,
      message: 'Task progress updated',
      data: {
        task,
        userStats: {
          totalPoints: profile.totalPoints,
          level: profile.level
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating achievement progress'
    });
  }
});

// Get leaderboard
router.get('/leaderboard', auth, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));
    const leaderboard = await buildLeaderboard(limit);

    res.json({
      success: true,
      data: leaderboard
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching leaderboard'
    });
  }
});

// Get daily tasks
router.get('/daily-tasks', auth, async (req, res) => {
  try {
    const tasks = await buildDailyTasks(req.user.userId);

    res.json({
      success: true,
      data: tasks
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching daily tasks'
    });
  }
});

// Complete daily task
router.post('/daily-tasks/:taskId/complete', auth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const profile = await getProfile(req.user.userId);
    const task = profile.dailyTasks.find(item => item.taskId === taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (!task.completed) {
      task.completed = true;
      task.completedAt = new Date();
      profile.totalPoints += task.points;
      profile.streak += 1;
      profile.recentActivities.push({
        type: 'task_completed',
        title: 'Task completed',
        description: task.title,
        points: task.points
      });
      await profile.save();
    }

    res.json({
      success: true,
      message: 'Task completed successfully',
      data: {
        pointsEarned: task.points,
        userStats: {
          totalPoints: profile.totalPoints,
          streak: profile.streak,
          level: profile.level
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error completing task'
    });
  }
});

module.exports = router;