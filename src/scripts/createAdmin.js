const mongoose = require('mongoose');
require('dotenv').config();
const { ensureDefaultAdminUser, DEFAULT_ADMIN_EMAIL } = require('../services/adminBootstrap');

async function createAdmin() {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/carbon-intelligence'
    );
    console.log('Connected to MongoDB');

    const result = await ensureDefaultAdminUser();

    console.log('✅ Admin user is ready');
    console.log('-----------------------------------');
    console.log('Email:', DEFAULT_ADMIN_EMAIL);
    console.log('Password:', process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin123');
    console.log('Result:', result);
    console.log('-----------------------------------');
    console.log('⚠️  IMPORTANT: Change the password after first login!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
    process.exit(1);
  }
}

createAdmin();
