/**
 * Backfill Organization records and organizationId on profiles and operational data.
 * Usage: node src/scripts/backfillOrganizations.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const MSME = require('../models/MSME');
const Enterprise = require('../models/Enterprise');
const Organization = require('../models/Organization');
const Transaction = require('../models/Transaction');
const Document = require('../models/Document');
const CarbonAssessment = require('../models/CarbonAssessment');
const {
  createOrganizationForMsme,
  createOrganizationForEnterprise
} = require('../services/organizationService');

const MODELS_WITH_ORG = [Transaction, Document, CarbonAssessment];

const backfillProfiles = async () => {
  const msmeProfiles = await MSME.find({ organizationId: { $exists: false } });
  for (const msme of msmeProfiles) {
    const existing = await Organization.findOne({ userId: msme.userId });
    if (existing) {
      await MSME.findByIdAndUpdate(msme._id, { organizationId: existing._id });
      continue;
    }
    await createOrganizationForMsme(msme.userId, msme);
  }

  const enterpriseProfiles = await Enterprise.find({ organizationId: { $exists: false } });
  for (const enterprise of enterpriseProfiles) {
    const existing = await Organization.findOne({ userId: enterprise.userId });
    if (existing) {
      await Enterprise.findByIdAndUpdate(enterprise._id, { organizationId: existing._id });
      continue;
    }
    await createOrganizationForEnterprise(enterprise.userId, enterprise);
  }
};

const backfillOperationalData = async () => {
  const organizations = await Organization.find({}).lean();

  for (const org of organizations) {
    const scope = { organizationId: org._id };
    const legacyMsmeId = org.msmeProfileId;

    for (const Model of MODELS_WITH_ORG) {
      const filter = legacyMsmeId
        ? { msmeId: legacyMsmeId, organizationId: { $exists: false } }
        : { organizationId: { $exists: false }, _id: null };

      if (!legacyMsmeId) {
        continue;
      }

      await Model.updateMany(filter, { $set: scope });
    }
  }
};

const run = async () => {
  await connectDB();
  await backfillProfiles();
  await backfillOperationalData();
  console.log('Organization backfill completed');
  await mongoose.connection.close();
};

run().catch(async (error) => {
  console.error('Organization backfill failed:', error);
  await mongoose.connection.close();
  process.exit(1);
});
