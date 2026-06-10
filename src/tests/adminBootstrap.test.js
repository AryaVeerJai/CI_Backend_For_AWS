const mongoose = require('mongoose');
const User = require('../models/User');
const {
  ensureDefaultAdminUser,
  DEFAULT_ADMIN_EMAIL,
} = require('../services/adminBootstrap');

describe('ensureDefaultAdminUser', () => {
  beforeEach(async () => {
    await User.deleteMany({});
  });

  test('creates default admin when none exist', async () => {
    const result = await ensureDefaultAdminUser();

    expect(result.created).toBe(true);
    const admin = await User.findOne({ email: DEFAULT_ADMIN_EMAIL });
    expect(admin?.role).toBe('admin');
    expect(admin?.isActive).toBe(true);
    expect(await admin.comparePassword('admin123')).toBe(true);
  });

  test('does nothing when an active admin already exists and no designated account', async () => {
    await User.create({
      email: 'other-admin@example.com',
      password: 'secret123',
      role: 'admin',
      isActive: true,
    });

    const result = await ensureDefaultAdminUser();
    const defaultAdmin = await User.findOne({ email: DEFAULT_ADMIN_EMAIL });

    expect(result.reason).toBe('designated_admin_missing');
    expect(defaultAdmin).toBeNull();
  });

  test('promotes designated email from msme to admin when other admins exist', async () => {
    await User.create({
      email: 'other-admin@example.com',
      password: 'secret123',
      role: 'admin',
      isActive: true,
    });
    await User.create({
      email: DEFAULT_ADMIN_EMAIL,
      password: 'admin123',
      role: 'msme',
      isActive: true,
    });

    const result = await ensureDefaultAdminUser();
    const admin = await User.findOne({ email: DEFAULT_ADMIN_EMAIL });

    expect(result.repaired).toBe(true);
    expect(admin?.role).toBe('admin');
    expect(await admin.comparePassword('admin123')).toBe(true);
  });

  test('reactivates inactive designated admin when other admins exist', async () => {
    await User.create({
      email: 'other-admin@example.com',
      password: 'secret123',
      role: 'admin',
      isActive: true,
    });
    await User.create({
      email: DEFAULT_ADMIN_EMAIL,
      password: 'admin123',
      role: 'admin',
      isActive: false,
    });

    const result = await ensureDefaultAdminUser();
    const admin = await User.findOne({ email: DEFAULT_ADMIN_EMAIL });

    expect(result.repaired).toBe(true);
    expect(admin?.isActive).toBe(true);
  });

  test('promotes existing non-admin account when no admins exist', async () => {
    await User.create({
      email: DEFAULT_ADMIN_EMAIL,
      password: 'old-password',
      role: 'msme',
      isActive: true,
    });

    const result = await ensureDefaultAdminUser();
    const admin = await User.findOne({ email: DEFAULT_ADMIN_EMAIL });

    expect(result.promoted).toBe(true);
    expect(admin?.role).toBe('admin');
    expect(await admin.comparePassword('admin123')).toBe(true);
  });
});
