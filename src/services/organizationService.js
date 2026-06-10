const Organization = require('../models/Organization');
const MSME = require('../models/MSME');
const Enterprise = require('../models/Enterprise');
const logger = require('../utils/logger');

const linkProfileToOrganization = async (organizationId, segment, profileId) => {
  const update =
    segment === 'msme'
      ? { msmeProfileId: profileId }
      : { enterpriseProfileId: profileId };
  await Organization.findByIdAndUpdate(organizationId, { $set: update });
};

const createOrganizationForMsme = async (userId, msme) => {
  const organization = await Organization.create({
    userId,
    segment: 'msme',
    legalName: msme.companyName,
    msmeProfileId: msme._id,
    industry: msme.industry,
    primaryIdentifiers: {
      udyam: msme.udyamRegistrationNumber,
      gst: msme.gstNumber,
      pan: msme.panNumber
    }
  });

  await MSME.findByIdAndUpdate(msme._id, { organizationId: organization._id });
  return organization;
};

const createOrganizationForEnterprise = async (userId, enterprise) => {
  const organization = await Organization.create({
    userId,
    segment: 'enterprise',
    legalName: enterprise.companyName,
    enterpriseProfileId: enterprise._id,
    industry: enterprise.industry,
    primaryIdentifiers: {
      cin: enterprise.cinNumber,
      gst: enterprise.gstNumber,
      pan: enterprise.panNumber
    }
  });

  await Enterprise.findByIdAndUpdate(enterprise._id, { organizationId: organization._id });
  return organization;
};

const ensureOrganizationForUser = async ({ userId, role, msmeId, enterpriseId }) => {
  let organization = await Organization.findOne({ userId });

  if (organization) {
    const updates = {};
    if (msmeId && !organization.msmeProfileId) {
      updates.msmeProfileId = msmeId;
    }
    if (enterpriseId && !organization.enterpriseProfileId) {
      updates.enterpriseProfileId = enterpriseId;
    }
    if (Object.keys(updates).length > 0) {
      organization = await Organization.findByIdAndUpdate(
        organization._id,
        { $set: updates },
        { new: true }
      );
    }

    if (msmeId) {
      await MSME.updateOne(
        { _id: msmeId, organizationId: { $exists: false } },
        { $set: { organizationId: organization._id } }
      );
    }
    if (enterpriseId) {
      await Enterprise.updateOne(
        { _id: enterpriseId, organizationId: { $exists: false } },
        { $set: { organizationId: organization._id } }
      );
    }

    return organization;
  }

  if (role === 'msme' && msmeId) {
    const msme = await MSME.findById(msmeId);
    if (msme) {
      organization = await createOrganizationForMsme(userId, msme);
      logger.info('Backfilled organization for MSME profile', {
        organizationId: organization._id.toString(),
        msmeId: msmeId.toString()
      });
      return organization;
    }
  }

  if (role === 'enterprise' && enterpriseId) {
    const enterprise = await Enterprise.findById(enterpriseId);
    if (enterprise) {
      organization = await createOrganizationForEnterprise(userId, enterprise);
      logger.info('Backfilled organization for enterprise profile', {
        organizationId: organization._id.toString(),
        enterpriseId: enterpriseId.toString()
      });
      return organization;
    }
  }

  return null;
};

const resolveOrganizationContext = async (userContext) => {
  const organization = await ensureOrganizationForUser({
    userId: userContext.userId,
    role: userContext.role,
    msmeId: userContext.msmeId,
    enterpriseId: userContext.enterpriseId
  });

  if (!organization) {
    return {
      organizationId: null,
      segment: userContext.role === 'enterprise' ? 'enterprise' : 'msme',
      msmeId: userContext.msmeId || null,
      enterpriseId: userContext.enterpriseId || null
    };
  }

  return {
    organizationId: organization._id,
    segment: organization.segment,
    msmeId: userContext.msmeId || organization.msmeProfileId || null,
    enterpriseId: userContext.enterpriseId || organization.enterpriseProfileId || null,
    legalName: organization.legalName
  };
};

module.exports = {
  createOrganizationForMsme,
  createOrganizationForEnterprise,
  ensureOrganizationForUser,
  resolveOrganizationContext,
  linkProfileToOrganization
};
