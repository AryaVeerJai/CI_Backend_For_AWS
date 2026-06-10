/**
 * Seed script: creates a test user + MSME record + carbon data.
 *
 * Usage:  node seed_demo_user.js
 *
 * Demo credentials:
 *   Email:    test@carbonintel.com
 *   Password: test123456
 */
const mongoose = require('mongoose');
const { signJwt } = require('./src/utils/jwt');
require('dotenv').config();

const User = require('./src/models/User');
const MSME = require('./src/models/MSME');
const CarbonAssessment = require('./src/models/CarbonAssessment');
const Transaction = require('./src/models/Transaction');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/carbon-intelligence';

const DEMO_EMAIL = 'test@carbonintel.com';
const DEMO_PASSWORD = 'test123456';

async function seed() {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // ─── 1. Create or reuse User ──────────────────────────────────────────────
    let user = await User.findOne({ email: DEMO_EMAIL });
    if (user) {
        console.log(`👤 User already exists: ${user._id}`);
    } else {
        user = await User.create({
            email: DEMO_EMAIL,
            password: DEMO_PASSWORD,   // auto-hashed by pre-save hook
            role: 'msme',
            isActive: true,
            profile: { firstName: 'Test', lastName: 'User', phone: '9876543210' },
        });
        console.log(`👤 User created: ${user._id}`);
    }

    // ─── 2. Create or reuse MSME ──────────────────────────────────────────────
    let msme = await MSME.findOne({ userId: user._id });
    if (msme) {
        console.log(`🏭 MSME already exists: ${msme._id}`);
    } else {
        msme = await MSME.create({
            userId: user._id,
            companyName: 'Green Test Industries Pvt Ltd',
            companyType: 'small',
            industry: 'Manufacturing',
            businessDomain: 'manufacturing',
            establishmentYear: 2015,
            gstNumber: '27AAPCS1751H1ZO',   // valid format, dummy
            panNumber: 'AAPCS1751H',
            contact: {
                email: DEMO_EMAIL,
                phone: '9876543210',
                address: { street: '12 Industrial Area', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
            },
            business: {
                // API validations and onboarding expect turnover in crores.
                annualTurnover: 5,
                numberOfEmployees: 25,
                manufacturingUnits: 1,
                primaryProducts: 'Metal components and assemblies',
            },
            environmentalCompliance: {
                hasEnvironmentalClearance: true,
                hasPollutionControlBoard: true,
                hasWasteManagement: false,
            },
        });
        console.log(`🏭 MSME created: ${msme._id}`);
    }

    // ─── 3. Clear old demo data ───────────────────────────────────────────────
    const deletedA = await CarbonAssessment.deleteMany({ msmeId: msme._id });
    const deletedT = await Transaction.deleteMany({ msmeId: msme._id });
    console.log(`🗑️  Cleared ${deletedA.deletedCount} assessments, ${deletedT.deletedCount} transactions\n`);

    // ─── 4. Insert sample transactions ───────────────────────────────────────
    const now = new Date();
    const txns = [
        {
            msmeId: msme._id, source: 'sms', sourceId: 'sms_001', transactionType: 'expense', amount: 12500, currency: 'INR',
            description: 'Electricity bill payment BESCOM', vendor: { name: 'BESCOM', category: 'utilities' },
            category: 'energy', subcategory: 'electricity', date: new Date(now - 2 * 24 * 3600 * 1000),
            carbonFootprint: { co2Emissions: 10.25, emissionFactor: 0.82, calculationMethod: 'spend_based', dataSource: 'ai_calculated' },
            sustainability: { isGreen: false, greenScore: 30 }, isProcessed: true, processedAt: now
        },

        {
            msmeId: msme._id, source: 'sms', sourceId: 'sms_002', transactionType: 'expense', amount: 5000, currency: 'INR',
            description: 'Diesel Pump BPCL fuel purchase', vendor: { name: 'BPCL', category: 'fuel' },
            category: 'transportation', subcategory: 'diesel', date: new Date(now - 3 * 24 * 3600 * 1000),
            carbonFootprint: { co2Emissions: 13.4, emissionFactor: 2.68, calculationMethod: 'spend_based', dataSource: 'ai_calculated' },
            sustainability: { isGreen: false, greenScore: 20 }, isProcessed: true, processedAt: now
        },

        {
            msmeId: msme._id, source: 'sms', sourceId: 'sms_003', transactionType: 'expense', amount: 8200, currency: 'INR',
            description: 'Raw materials purchase steel vendor', vendor: { name: 'Steel Mart', category: 'materials' },
            category: 'raw_materials', subcategory: 'steel', date: new Date(now - 5 * 24 * 3600 * 1000),
            carbonFootprint: { co2Emissions: 15.17, emissionFactor: 1.85, calculationMethod: 'spend_based', dataSource: 'ai_calculated' },
            sustainability: { isGreen: false, greenScore: 35 }, isProcessed: true, processedAt: now
        },

        {
            msmeId: msme._id, source: 'sms', sourceId: 'sms_004', transactionType: 'expense', amount: 3000, currency: 'INR',
            description: 'Water tanker for factory use', vendor: { name: 'AquaSupply', category: 'water' },
            category: 'water', subcategory: 'tanker', date: new Date(now - 7 * 24 * 3600 * 1000),
            carbonFootprint: { co2Emissions: 1.2, emissionFactor: 0.0004, calculationMethod: 'spend_based', dataSource: 'ai_calculated' },
            sustainability: { isGreen: false, greenScore: 55 }, isProcessed: true, processedAt: now
        },

        {
            msmeId: msme._id, source: 'sms', sourceId: 'sms_005', transactionType: 'expense', amount: 1800, currency: 'INR',
            description: 'Waste disposal service monthly', vendor: { name: 'CleanCity', category: 'waste' },
            category: 'waste_management', subcategory: 'solid', date: new Date(now - 8 * 24 * 3600 * 1000),
            carbonFootprint: { co2Emissions: 0.9, emissionFactor: 0.5, calculationMethod: 'spend_based', dataSource: 'ai_calculated' },
            sustainability: { isGreen: true, greenScore: 70 }, isProcessed: true, processedAt: now
        },
    ];

    await Transaction.insertMany(txns);
    console.log(`📑 Inserted ${txns.length} transactions\n`);

    const totalCO2 = txns.reduce((s, t) => s + t.carbonFootprint.co2Emissions, 0);  // ~40.92

    // ─── 5. Insert CarbonAssessments (3 months) ──────────────────────────────
    const assessments = [
        {
            msmeId: msme._id, userId: user._id,
            assessmentType: 'mobile', source: 'mobile', status: 'completed',
            totalCO2Emissions: totalCO2, carbonScore: 78,
            transactionCount: txns.length, totalAmount: txns.reduce((s, t) => s + t.amount, 0),
            period: { startDate: new Date(now.getFullYear(), now.getMonth(), 1), endDate: now },
            mobileBreakdown: {
                energy: { co2: 10.25, count: 1, amount: 12500 },
                transportation: { co2: 13.4, count: 1, amount: 5000 },
                raw_materials: { co2: 15.17, count: 1, amount: 8200 },
                water: { co2: 1.2, count: 1, amount: 3000 },
                waste_management: { co2: 0.9, count: 1, amount: 1800 },
            },
            recommendations: [
                { category: 'energy', title: 'Switch to LED lighting', description: 'Replace fluorescent bulbs with LEDs to cut electricity use by 60%.', priority: 'high', potentialCO2Reduction: 3.5, implementationCost: 15000, paybackPeriod: 6, isImplemented: false, status: 'pending' },
                { category: 'transportation', title: 'Optimise delivery routes', description: 'Use route planning tools to reduce fuel consumption by 20%.', priority: 'high', potentialCO2Reduction: 2.7, implementationCost: 5000, paybackPeriod: 3, isImplemented: false, status: 'pending' },
                { category: 'raw_materials', title: 'Source locally', description: 'Procure materials from local vendors to slash transport emissions.', priority: 'medium', potentialCO2Reduction: 1.5, implementationCost: 0, paybackPeriod: 0, isImplemented: false, status: 'pending' },
            ],
            createdAt: new Date(now - 1 * 24 * 3600 * 1000),
        },
        {
            msmeId: msme._id, userId: user._id,
            assessmentType: 'mobile', source: 'mobile', status: 'completed',
            totalCO2Emissions: 52.3, carbonScore: 74,
            transactionCount: 38, totalAmount: 72100,
            period: {
                startDate: new Date(now.getFullYear(), now.getMonth() - 1, 1),
                endDate: new Date(now.getFullYear(), now.getMonth(), 0),
            },
            mobileBreakdown: {
                energy: { co2: 20.1, count: 10, amount: 24000 },
                transportation: { co2: 18.4, count: 12, amount: 19500 },
                raw_materials: { co2: 8.7, count: 8, amount: 14300 },
                water: { co2: 3.8, count: 4, amount: 6800 },
                waste_management: { co2: 1.3, count: 4, amount: 7500 },
            },
            recommendations: [],
            createdAt: new Date(now - 32 * 24 * 3600 * 1000),
        },
        {
            msmeId: msme._id, userId: user._id,
            assessmentType: 'mobile', source: 'mobile', status: 'completed',
            totalCO2Emissions: 68.8, carbonScore: 65,
            transactionCount: 56, totalAmount: 112300,
            period: {
                startDate: new Date(now.getFullYear(), now.getMonth() - 2, 1),
                endDate: new Date(now.getFullYear(), now.getMonth() - 1, 0),
            },
            mobileBreakdown: {
                energy: { co2: 28.3, count: 18, amount: 38000 },
                transportation: { co2: 22.1, count: 16, amount: 31200 },
                raw_materials: { co2: 12.9, count: 10, amount: 21500 },
                water: { co2: 4.5, count: 6, amount: 12600 },
                waste_management: { co2: 1.0, count: 6, amount: 9000 },
            },
            recommendations: [],
            createdAt: new Date(now - 62 * 24 * 3600 * 1000),
        },
    ];

    for (const data of assessments) {
        const doc = new CarbonAssessment(data);
        doc.createdAt = data.createdAt;
        await doc.save();
    }
    console.log(`📊 Inserted ${assessments.length} carbon assessments (3 months of trend data)\n`);

    // ─── 6. Generate JWT ──────────────────────────────────────────────────────
    const token = signJwt(
        { userId: user._id, msmeId: msme._id, email: user.email, role: user.role },
        { expiresIn: '30d' }
    );

    console.log('═══════════════════════════════════════════════');
    console.log('  TEST USER CREDENTIALS');
    console.log('═══════════════════════════════════════════════');
    console.log(`  Email    : ${DEMO_EMAIL}`);
    console.log(`  Password : ${DEMO_PASSWORD}`);
    console.log(`  MSME ID  : ${msme._id}`);
    console.log('═══════════════════════════════════════════════\n');
    console.log('🔑 JWT Token (30 days):');
    console.log(token);
    console.log('\n📱 Login in the mobile app with the credentials above.');
    console.log('   The Dashboard should immediately show:');
    console.log(`   • Carbon Score : 78`);
    console.log(`   • kg CO₂       : ${totalCO2.toFixed(1)} kg this month`);
    console.log(`   • Transactions : ${txns.length}`);
    console.log(`   • Monthly trend: 3-month chart (65 → 74 → 78)\n`);

    await mongoose.disconnect();
    console.log('✅ Done!');
}

seed().catch(err => {
    console.error('❌ Seed error:', err.message);
    process.exit(1);
});
