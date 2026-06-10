const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-ci';
process.env.DISABLE_BACKGROUND_SIMULATION_LOOPS = 'true';
process.env.DISABLE_AGENT_OPTIMIZATION_LOOPS = 'true';

beforeAll(async () => {
  const uri = process.env.MONGODB_URI;
  if (uri && mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
});
