// Quick script to view stored mobile carbon assessment data
const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/carbon-intelligence';

async function main() {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB:', MONGO_URI);

    const db = mongoose.connection.db;

    // Count all assessments
    const totalCount = await db.collection('carbonassessments').countDocuments();
    const mobileCount = await db.collection('carbonassessments').countDocuments({ source: 'mobile' });
    console.log(`\n📊 Total assessments: ${totalCount}`);
    console.log(`📱 Mobile assessments: ${mobileCount}\n`);

    // Fetch mobile assessments
    const assessments = await db.collection('carbonassessments')
        .find({ source: 'mobile' })
        .sort({ createdAt: -1 })
        .toArray();

    if (assessments.length === 0) {
        console.log('⚠️  No mobile carbon assessments found yet.');
        console.log('   Run a carbon assessment from the mobile app first!\n');
    } else {
        assessments.forEach((a, i) => {
            console.log(`─── Assessment ${i + 1} ───`);
            console.log(`  ID:            ${a._id}`);
            console.log(`  User ID:       ${a.userId}`);
            console.log(`  Total CO₂:     ${a.totalCO2Emissions} kg`);
            console.log(`  Carbon Score:   ${a.carbonScore}/100`);
            console.log(`  Transactions:   ${a.transactionCount}`);
            console.log(`  Total Amount:   ₹${a.totalAmount?.toLocaleString()}`);
            console.log(`  Status:        ${a.status}`);
            console.log(`  Created:       ${a.createdAt}`);
            if (a.mobileBreakdown) {
                console.log(`  Categories:    ${Object.keys(a.mobileBreakdown).join(', ')}`);
            }
            if (a.recommendations?.length) {
                console.log(`  Recommendations: ${a.recommendations.length}`);
                a.recommendations.forEach(r => {
                    console.log(`    - [${r.priority}] ${r.title} (${r.potentialCO2Reduction} kg CO₂ reduction)`);
                });
            }
            console.log('');
        });
    }

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
