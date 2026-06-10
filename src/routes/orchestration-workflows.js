/**
 * Unified workflow routes mounted under /api/orchestration-manager/workflows.
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

const aiWorkflowRoutes = require('./ai-workflows');
const multiAgentWorkflowRoutes = require('./multi-agent-workflows');
const optimizedAiAgentRoutes = require('./optimized-ai-agents');

router.use((req, res, next) => {
  res.set('X-Orchestration-Canonical-Path', `/api/orchestration-manager/workflows${req.path}`);
  next();
});

router.use('/ai', aiWorkflowRoutes);
router.use('/multi-agent', multiAgentWorkflowRoutes);
router.use('/optimized', optimizedAiAgentRoutes);

// @route   GET /api/orchestration-manager/workflows
// @desc    Workflow surface index (canonical entry)
// @access  Private
router.get('/', auth, (req, res) => {
  res.json({
    success: true,
    data: {
      canonicalBase: '/api/orchestration-manager/workflows',
      surfaces: {
        ai: '/api/orchestration-manager/workflows/ai',
        multiAgent: '/api/orchestration-manager/workflows/multi-agent',
        optimized: '/api/orchestration-manager/workflows/optimized'
      }
    }
  });
});

module.exports = router;
