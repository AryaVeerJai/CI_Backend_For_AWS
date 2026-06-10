const User = require('../models/User');
const logger = require('../utils/logger');

const DEFAULT_ADMIN_EMAIL = (
  process.env.BOOTSTRAP_ADMIN_EMAIL || 'carbonintelligence@sustainow.in'
).trim().toLowerCase();

const DEFAULT_ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin123';

const normalizeAdminEmail = (email) => String(email || '').trim().toLowerCase();

const isPortalAdminRole = (role) => role === 'admin' || role === 'view';

/**
 * When other admins already exist, still repair the designated bootstrap account
 * so the default admin portal credentials remain usable.
 */
const repairDesignatedBootstrapAdmin = async (existingUser, email) => {
  if (!existingUser) {
    return { repaired: false, reason: 'designated_admin_missing' };
  }

  let needsSave = false;

  if (!isPortalAdminRole(existingUser.role)) {
    existingUser.role = 'admin';
    needsSave = true;
  }

  if (existingUser.isActive === false) {
    existingUser.isActive = true;
    needsSave = true;
  }

  const passwordMatches = await existingUser.comparePassword(DEFAULT_ADMIN_PASSWORD);
  const shouldSyncPassword = process.env.BOOTSTRAP_ADMIN_SYNC_PASSWORD === 'true';

  if (!passwordMatches && shouldSyncPassword) {
    existingUser.password = DEFAULT_ADMIN_PASSWORD;
    needsSave = true;
  }

  if (!needsSave) {
    return { repaired: false, email };
  }

  await existingUser.save();
  logger.warn(`Repaired designated bootstrap admin account ${email} for portal access.`);
  return { repaired: true, email };
};

/**
 * Ensures at least one active admin account exists and that the designated
 * bootstrap admin email can sign in to the admin portal.
 */
const ensureDefaultAdminUser = async () => {
  const email = normalizeAdminEmail(DEFAULT_ADMIN_EMAIL);
  const activeAdminCount = await User.countDocuments({ role: 'admin', isActive: true });
  const existingUser = await User.findOne({ email });

  if (activeAdminCount > 0) {
    return repairDesignatedBootstrapAdmin(existingUser, email);
  }

  if (existingUser) {
    existingUser.role = 'admin';
    existingUser.isActive = true;
    existingUser.password = DEFAULT_ADMIN_PASSWORD;
    await existingUser.save();
    logger.warn(
      `No active admin accounts found. Promoted existing user ${email} to admin.`
    );
    return { created: false, promoted: true, email };
  }

  await User.create({
    email,
    password: DEFAULT_ADMIN_PASSWORD,
    role: 'admin',
    profile: {
      firstName: 'System',
      lastName: 'Administrator',
    },
    isActive: true,
  });

  logger.warn(
    `No active admin accounts found. Created default admin ${email}. `
    + 'Change the password immediately after first login.'
  );

  return { created: true, email };
};

module.exports = {
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD,
  ensureDefaultAdminUser,
  normalizeAdminEmail,
  repairDesignatedBootstrapAdmin,
};
