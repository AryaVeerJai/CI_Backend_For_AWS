const mongoose = require('mongoose');

const userIncentiveProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME',
    required: false
  },
  totalPoints: {
    type: Number,
    default: 0,
    min: 0
  },
  level: {
    type: Number,
    default: 1,
    min: 1
  },
  nextLevelPoints: {
    type: Number,
    default: 1000,
    min: 0
  },
  currentLevelPoints: {
    type: Number,
    default: 0,
    min: 0
  },
  achievementsUnlocked: {
    type: Number,
    default: 0,
    min: 0
  },
  streak: {
    type: Number,
    default: 0,
    min: 0
  },
  lastTaskCompletedAt: Date,
  lastActiveDate: Date,
  completedTaskIds: [{
    type: String
  }],
  redeemedRewards: [{
    rewardId: String,
    title: String,
    cost: Number,
    redeemedAt: {
      type: Date,
      default: Date.now
    }
  }],
  carbonSaved: {
    type: Number,
    default: 0,
    min: 0
  },
  dailyTasks: [{
    taskId: String,
    title: String,
    description: String,
    points: {
      type: Number,
      default: 0
    },
    category: String,
    completed: {
      type: Boolean,
      default: false
    },
    completedAt: Date
  }],
  rewards: [{
    rewardId: String,
    title: String,
    description: String,
    cost: {
      type: Number,
      default: 0
    },
    available: {
      type: Boolean,
      default: true
    },
    category: String
  }],
  recentActivities: [{
    type: {
      type: String
    },
    title: String,
    description: String,
    points: Number,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

userIncentiveProfileSchema.index({ totalPoints: -1, updatedAt: 1 });

module.exports = mongoose.model('UserIncentiveProfile', userIncentiveProfileSchema);
