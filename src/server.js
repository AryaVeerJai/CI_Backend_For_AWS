const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const https = require('https');
const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('./config/database');
const { getJwtSecret } = require('./utils/jwt');
const logger = require('./utils/logger');
const { registerGracefulShutdown } = require('./utils/gracefulShutdown');
const { attachSocketServer, bridgeOrchestrationEvents } = require('./utils/socketServer');
const aiAgentRuntimeState = require('./services/aiAgentRuntimeState');
const aiAgentService = require('./services/aiAgentService');
const orchestrationManagerEventService = require('./services/orchestrationManagerEventService');
const realTimeMonitoring = require('./services/realTimeMonitoringInstance');
const enhancedMonitoringService = require('./services/enhancedMonitoringService');
const dataFlowOptimizationService = require('./services/dataFlowOptimizationService');
const { buildVersionMetadata } = require('./config/version');
const uploadLimits = require('./config/uploadLimits');
const uploadErrorHandler = require('./middleware/uploadErrorHandler');

// Import routes
const authRoutes = require('./routes/auth');
const msmeRoutes = require('./routes/msme');
const enterpriseRoutes = require('./routes/enterprise');
const organizationRoutes = require('./routes/organization');
const transactionRoutes = require('./routes/transactions');
const accountingRoutes = require('./routes/accounting');
const carbonRoutes = require('./routes/carbon');
const carbonTradingRoutes = require('./routes/carbonTrading');
const smsRoutes = require('./routes/sms');
const emailRoutes = require('./routes/email');
const analyticsRoutes = require('./routes/analytics');
const adminRoutes = require('./routes/admin');
const incentivesRoutes = require('./routes/incentives');
const financeRoutes = require('./routes/finance');
const reportingRoutes = require('./routes/reporting');
const aiAgentRoutes = require('./routes/ai-agents');
const orchestrationManagerRoutes = require('./routes/orchestration-manager');
const bankRoutes = require('./routes/banks');
const greenLoanRoutes = require('./routes/greenLoans');
const carbonForecastingRoutes = require('./routes/carbonForecasting');
const carbonCreditsRoutes = require('./routes/carbonCredits');
const giftSchemeRoutes = require('./routes/giftSchemes');
const giftApplicationRoutes = require('./routes/giftApplications');
const adeetieRoutes = require('./routes/adeetie');
const fuelPricesRoutes = require('./routes/fuelPrices');
const dataProcessorRoutes = require('./routes/dataProcessor');
const adminMsmeRoutes = require('./routes/adminMSME');
const documentRoutes = require('./routes/documents');
const dataPrivacyRoutes = require('./routes/dataPrivacy');
const recommendationRoutes = require('./routes/recommendations');
const complianceHubRoutes = require('./routes/complianceHub');
const billingRoutes = require('./routes/billing');
const { webhookRouter: billingWebhookRouter } = require('./routes/billing');
const razorpayCheckoutRoutes = require('./routes/razorpayCheckout');
const publicApiRoutes = require('./routes/publicApi');
const partnerPortalRoutes = require('./routes/partnerPortal');
const partnerAccountRoutes = require('./routes/partnerAccount');

const app = express();
const PORT = process.env.PORT || 5000;
const versionMetadata = buildVersionMetadata();

const LOCAL_DEV_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
];

const parseCorsOrigins = () => {
  const configuredOrigins = process.env.CORS_ALLOWED_ORIGINS;
  let origins = [];

  if (typeof configuredOrigins === 'string' && configuredOrigins.trim().length > 0) {
    origins = configuredOrigins
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean);
  } else if (process.env.FRONTEND_URL) {
    origins = [process.env.FRONTEND_URL];
  } else {
    origins = ['https://carbonintelligence.sustainow.in'];
  }

  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    return [...new Set([...origins, ...LOCAL_DEV_CORS_ORIGINS])];
  }

  return origins;
};

const isHttpsEnabled = String(process.env.HTTPS_ENABLED || 'false').toLowerCase() === 'true';

const resolveTlsFilePath = filePath => (
  path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
);

const buildHttpsOptions = () => {
  const keyPath = process.env.SSL_KEY_PATH;
  const certPath = process.env.SSL_CERT_PATH;
  const caPath = process.env.SSL_CA_PATH;

  if (!keyPath || !certPath) {
    throw new Error('HTTPS is enabled but SSL_KEY_PATH or SSL_CERT_PATH is missing.');
  }

  const httpsOptions = {
    key: fs.readFileSync(resolveTlsFilePath(keyPath)),
    cert: fs.readFileSync(resolveTlsFilePath(certPath))
  };

  if (caPath) {
    httpsOptions.ca = fs.readFileSync(resolveTlsFilePath(caPath));
  }

  if (process.env.SSL_PASSPHRASE) {
    httpsOptions.passphrase = process.env.SSL_PASSPHRASE;
  }

  return httpsOptions;
};

// Fail fast when auth cannot issue or verify tokens
try {
  getJwtSecret();
} catch (jwtError) {
  logger.error(jwtError.message);
  process.exit(1);
}

// Register orchestration manager listeners
orchestrationManagerEventService.registerExternalListeners({
  realTimeMonitoring,
  enhancedMonitoringService,
  dataFlowOptimizationService
});

app.use(cors({
  origin: parseCorsOrigins(),
  credentials: true
}));

app.options('*', cors());

// Security middleware
app.use(helmet());
app.use(compression());

// Rate limiting (configurable; default is high enough for document polling + dashboard reads)
const parseLimitEnv = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.floor(numeric);
};

const limiter = rateLimit({
  windowMs: parseLimitEnv(process.env.API_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: parseLimitEnv(process.env.API_RATE_LIMIT_MAX_PER_WINDOW, 600),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
  skip: (req) => req.path === '/version',
});
app.use('/api/', limiter);

// Razorpay webhook requires raw body for signature verification
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }), billingWebhookRouter);

// Body parsing middleware (multipart uploads use multer; nginx must allow UPLOAD_MAX_REQUEST_BODY_MB)
app.use(express.json({ limit: uploadLimits.expressJsonLimit }));
app.use(express.urlencoded({ extended: true, limit: uploadLimits.expressUrlencodedLimit }));

// Request logging (skip high-frequency health checks to reduce log I/O and CPU)
app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/api/version') {
    return next();
  }
  logger.info(`${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  const mongoConnected = mongoose.connection.readyState === 1;
  const aiAgents = aiAgentRuntimeState.getSnapshot();
  const payload = {
    status: mongoConnected ? 'OK' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: versionMetadata.apiVersion,
    baselineCodebaseVersion: versionMetadata.baselineCodebaseVersion,
    dependencies: {
      mongodb: mongoConnected ? 'up' : 'down',
      aiAgents: aiAgents.status,
      socketIo: process.env.NODE_ENV === 'test' ? 'disabled' : 'enabled'
    },
    aiAgents
  };
  res.status(200).json(payload);
});

// Baseline version metadata endpoint
app.get('/api/version', (req, res) => {
  res.status(200).json({
    success: true,
    data: versionMetadata
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/msme', msmeRoutes);
app.use('/api/enterprise', enterpriseRoutes);
app.use('/api/organization', organizationRoutes);
app.use('/api/transactions', transactionRoutes);
// Canonical mount; same router is nested at /api/transactions/accounting for resilient Data connectors routing
app.use('/api/accounting', accountingRoutes);
app.use('/api/carbon', carbonRoutes);
app.use('/api/carbon/trading', carbonTradingRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/incentives', incentivesRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/reporting', reportingRoutes);
// Legacy alias — older clients and docs referenced /api/reports
app.use('/api/reports', reportingRoutes);
app.use('/api/ai-agents', aiAgentRoutes);
app.use('/api/orchestration-manager', orchestrationManagerRoutes);
app.use('/api/banks', bankRoutes);
app.use('/api/green-loans', greenLoanRoutes);
app.use('/api/carbon-forecasting', carbonForecastingRoutes);
app.use('/api/carbon-credits', carbonCreditsRoutes);
app.use('/api/gift-schemes', giftSchemeRoutes);
app.use('/api/gift-applications', giftApplicationRoutes);
app.use('/api/adeetie', adeetieRoutes);
app.use('/api/fuel-prices', fuelPricesRoutes);
app.use('/api/data-processor', dataProcessorRoutes);
app.use('/api/admin/msme', adminMsmeRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/data-privacy', dataPrivacyRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/compliance-hub', complianceHubRoutes);
// Legacy alias — older clients and proxies referenced /api/compliance/*
app.use('/api/compliance', complianceHubRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/v1', publicApiRoutes);
app.use('/api/partner-portal', partnerPortalRoutes);
app.use('/api/partner-account', partnerAccountRoutes);
app.use('/api', razorpayCheckoutRoutes);
app.use("/api/ai-carbon-analysis", require("./routes/ai-carbon-analysis"));

// Upload / multer errors (413 for oversized files)
app.use(uploadErrorHandler);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

const startServer = async () => {
  await connectDB();

  try {
    await aiAgentService.initialize();
  } catch (error) {
    logger.error('Failed to initialize AI Agent Service:', error);
  }

  const corsOrigins = parseCorsOrigins();
  let httpServer;
  if (isHttpsEnabled) {
    try {
      const httpsOptions = buildHttpsOptions();
      httpServer = https.createServer(httpsOptions, app).listen(PORT, () => {
        logger.info(`HTTPS server running on port ${PORT}`);
        logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      });
    } catch (error) {
      logger.error('Failed to start HTTPS server:', error.message);
      process.exit(1);
    }
  } else {
    httpServer = app.listen(PORT, () => {
      logger.info(`HTTP server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  }

  attachSocketServer(httpServer, corsOrigins);
  bridgeOrchestrationEvents(orchestrationManagerEventService);
  registerGracefulShutdown(httpServer);
};

// Start server only if not in test environment
if (process.env.NODE_ENV !== 'test') {
  startServer().catch((error) => {
    logger.error('Failed to start server:', error);
    process.exit(1);
  });
}

module.exports = app;