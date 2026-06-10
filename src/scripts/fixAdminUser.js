const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function fixAdminUser() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/carbon-intelligence');
        console.log('Connected to MongoDB');

        // Find and update admin user directly in database
        const db = mongoose.connection.db;
        const usersCollection = db.collection('users');

        // Delete any existing admin users
        await usersCollection.deleteMany({ email: 'carbonintelligence@sustainow.in' });
        console.log('Deleted existing admin users');

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('admin123', salt);

        // Insert admin user directly
        const result = await usersCollection.insertOne({
            email: 'carbonintelligence@sustainow.in',
            password: hashedPassword,
            role: 'admin',
            profile: {
                firstName: 'System',
                lastName: 'Administrator'
            },
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        console.log('✅ Admin user created successfully!');
        console.log('-----------------------------------');
        console.log('Email: carbonintelligence@sustainow.in');
        console.log('Password: admin123');
        console.log('Role: admin');
        console.log('ID:', result.insertedId);
        console.log('-----------------------------------');

        // Verify the user
        const adminUser = await usersCollection.findOne({ email: 'carbonintelligence@sustainow.in' });
        console.log('\n✓ Verification:');
        console.log('  Email:', adminUser.email);
        console.log('  Role:', adminUser.role);
        console.log('  Has Password:', !!adminUser.password);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

fixAdminUser();
