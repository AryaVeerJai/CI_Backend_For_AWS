const mongoose = require('mongoose');
const UserBillingProfile = require('../models/UserBillingProfile');
const billingService = require('../services/billingService');

describe('billingService profile upsert (MongoDB)', () => {
  const userId = new mongoose.Types.ObjectId();
  const msmeId = new mongoose.Types.ObjectId();

  afterEach(async () => {
    await UserBillingProfile.deleteMany({ userId });
  });

  it('getOrCreateBillingProfile upserts with msmeId without path conflict', async () => {
    const created = await billingService.getOrCreateBillingProfile({
      userId,
      msmeId,
      role: 'msme'
    });

    expect(created).toBeTruthy();
    expect(String(created.msmeId)).toBe(String(msmeId));

    const updated = await billingService.getOrCreateBillingProfile({
      userId,
      msmeId,
      role: 'msme'
    });

    expect(String(updated.msmeId)).toBe(String(msmeId));
    expect(await UserBillingProfile.countDocuments({ userId })).toBe(1);
  });
});
