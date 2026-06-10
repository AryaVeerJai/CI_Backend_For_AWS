const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const connectDB = require('./config/database');
const logger = require('./utils/logger');
const aiAgentService = require('./services/aiAgentService');
const orchestrationManagerEventService = require('./services/orchestrationManagerEventService');
const realTimeMonitoring = require('./services/realTimeMonitoringInstance');
const enhancedMonitoringService = require('./services/enhancedMonitoringService');
const dataFlowOptimizationService = require('./services/dataFlowOptimizationService');

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
const { buildVersionMetadata } = require('./config/version');

const app = express();
const PORT = process.env.PORT || 5000;
const versionMetadata = buildVersionMetadata();

// Connect to MongoDB
connectDB();

// Initialize AI Agent Service
aiAgentService.initialize().catch(error => {
  logger.error('Failed to initialize AI Agent Service:', error);
});

// Register orchestration manager listeners
orchestrationManagerEventService.registerExternalListeners({
  realTimeMonitoring,
  enhancedMonitoringService,
  dataFlowOptimizationService
});

app.use(cors({
  origin: [
    'http://3.109.203.124',
    'http://192.168.29.125:3000'
  ],
  credentials: true
}));

// CORS configuration
//app.use(cors({
  //origin: process.env.FRONTEND_URL || 'https://carbonintelligence.sustainow.in',
  //credentials: true
//}));

// ✅ ADD THIS LINE
app.options('*', cors());

// Security middleware
app.use(helmet());
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Razorpay webhook requires raw body for signature verification
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }), billingWebhookRouter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: versionMetadata.apiVersion,
    baselineCodebaseVersion: versionMetadata.baselineCodebaseVersion
  });
});

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
app.use('/api/compliance', complianceHubRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/v1', publicApiRoutes);
app.use('/api/partner-portal', partnerPortalRoutes);
app.use('/api/partner-account', partnerAccountRoutes);
app.use('/api', razorpayCheckoutRoutes);
app.use("/api/ai-carbon-analysis", require("./routes/ai-carbon-analysis"));

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Start server only if not in test environment
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

module.exports = app;