/**
 * Seed script: creates an MSME profile for the demo user.
 * Usage: node seed_msme_profile.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const MSME = require('./src/models/MSME');
const User = require('./src/models/User');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/carbon-intelligence';
const DEMO_EMAIL = 'demo@carbonintel.com';

async function seed() {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const user = await User.findOne({ email: DEMO_EMAIL });
    if (!user) {
        console.error('❌ Demo user not found. Run seed_demo_user.js first.');
        process.exit(1);
    }

    // Remove old MSME profile for this user
    await MSME.deleteMany({ userId: user._id });

    const msme = await MSME.create({
        userId: user._id,
        companyName: 'Green Craft Industries',
        companyType: 'small',
        industry: 'Manufacturing',
        businessDomain: 'manufacturing',
        establishmentYear: 2015,
        udyamRegistrationNumber: 'UDYAM-MH-12-0001234',
        gstNumber: '27AABCG1234A1Z5',
        panNumber: 'AABCG1234A',
        contact: {
            email: DEMO_EMAIL,
            phone: '+91-9876543210',
            address: {
                street: '42, Industrial Area, Phase 2',
                city: 'Pune',
                state: 'Maharashtra',
                pincode: '411019',
                country: 'India',
            },
        },
        business: {
            annualTurnover: 12000000,
            numberOfEmployees: 48,
            manufacturingUnits: 1,
            primaryProducts: 'Handicraft goods, eco-friendly packaging, bamboo products',
        },
        environmentalCompliance: {
            hasEnvironmentalClearance: true,
            hasPollutionControlBoard: true,
            hasWasteManagement: false,
        },
        isVerified: true,
        verificationDate: new Date('2024-06-15'),
        carbonScore: 68,
        lastCarbonAssessment: new Date(),
    });

    console.log('🏭 MSME profile created:');
    console.log(`   ID:           ${msme._id}`);
    console.log(`   Company:      ${msme.companyName}`);
    console.log(`   Type:         ${msme.companyType}`);
    console.log(`   GST:          ${msme.gstNumber}`);
    console.log(`   PAN:          ${msme.panNumber}`);
    console.log(`   Employees:    ${msme.business.numberOfEmployees}`);
    console.log(`   Carbon Score: ${msme.carbonScore}`);

    await mongoose.disconnect();
    console.log('\n✅ Done!');
}

seed().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
