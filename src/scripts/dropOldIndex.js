// Script to drop the old udyogAadharNumber index
const mongoose = require('mongoose');

async function dropOldIndex() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/carbon-intelligence');

        const db = mongoose.connection.db;
        const collection = db.collection('msmes');

        // Get all indexes
        const indexes = await collection.indexes();
        console.log('Current indexes:', indexes);

        // Drop the udyogAadharNumber index if it exists
        try {
            await collection.dropIndex('udyogAadharNumber_1');
            console.log('Successfully dropped udyogAadharNumber_1 index');
        } catch (error) {
            console.log('Index udyogAadharNumber_1 does not exist or already dropped');
        }

        // Optionally, drop all MSME records to start fresh
        // Uncomment the line below if you want to delete all existing MSME records
        // await collection.deleteMany({});
        // console.log('Deleted all MSME records');

        console.log('Done!');
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

dropOldIndex();
