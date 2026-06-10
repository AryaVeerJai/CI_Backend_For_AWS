const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { ensureDefaultAdminUser } = require('../services/adminBootstrap');

const connectDB = async () => {
  const mongoUri =
    process.env.MONGODB_URI ||
    (process.env.NODE_ENV === 'test'
      ? 'mongodb://127.0.0.1:27017/carbon-intelligence-test'
      : 'mongodb://127.0.0.1:27017/carbon-intelligence');

  try {
    const conn = await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    logger.info(`MongoDB Connected: ${conn.connection.host}`);

    if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_ADMIN_BOOTSTRAP !== 'true') {
      try {
        await ensureDefaultAdminUser();
      } catch (bootstrapError) {
        logger.error('Default admin bootstrap failed:', bootstrapError);
      }
    }
  } catch (error) {
    logger.error('Database connection error:', error);
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
    throw error;
  }
};

module.exports = connectDB;
