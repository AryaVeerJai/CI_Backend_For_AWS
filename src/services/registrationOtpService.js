const crypto = require('crypto');
const MSG91Client = require('./msg91Client');
const RegistrationOtpSession = require('../models/RegistrationOtpSession');
const sendEmail = require('../utils/sendEmail');
const logger = require('../utils/logger');

const DEFAULT_OTP_LENGTH = 6;
const DEFAULT_OTP_TTL_SECONDS = 600;
const OTP_HASH_ALGORITHM = 'sha256';
const OTP_TEMPLATE = 'Your OTP for registration is {{OTP}}. It is valid for 10 minutes. Do not share this OTP.';

const parseBoolean = value => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  if (value == null) {
    return false;
  }

  return Boolean(value);
};

class RegistrationOtpService {
  constructor({
    otpSessionModel,
    smsClient,
    emailClient,
    loggerInstance
  } = {}) {
    this.otpSessionModel = otpSessionModel || RegistrationOtpSession;
    this.smsClient = smsClient || new MSG91Client();
    this.emailClient = emailClient || sendEmail;
    this.logger = loggerInstance || logger;
  }

  isOtpEnabled() {
    return parseBoolean(process.env.REGISTRATION_OTP_ENABLED || 'false');
  }

  isSmsChannelEnabled() {
    return parseBoolean(process.env.REGISTRATION_OTP_SMS_ENABLED || 'true');
  }

  isEmailChannelEnabled() {
    return parseBoolean(process.env.REGISTRATION_OTP_EMAIL_ENABLED || 'true');
  }

  getOtpTtlMs() {
    const ttlSeconds = Number(process.env.REGISTRATION_OTP_TTL_SECONDS || DEFAULT_OTP_TTL_SECONDS);
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      return DEFAULT_OTP_TTL_SECONDS * 1000;
    }
    return ttlSeconds * 1000;
  }

  getResendCooldownMs() {
    const cooldownSeconds = Number(process.env.REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS || 60);
    if (!Number.isFinite(cooldownSeconds) || cooldownSeconds < 0) {
      return 60 * 1000;
    }
    return cooldownSeconds * 1000;
  }

  getMaxResendAttempts() {
    const maxResends = Number(process.env.REGISTRATION_OTP_MAX_RESEND_ATTEMPTS || 3);
    if (!Number.isFinite(maxResends) || maxResends <= 0) {
      return 3;
    }
    return Math.floor(maxResends);
  }

  getMaxVerifyAttempts() {
    const maxAttempts = Number(process.env.REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS || 5);
    if (!Number.isFinite(maxAttempts) || maxAttempts <= 0) {
      return 5;
    }
    return Math.floor(maxAttempts);
  }

  getLockDurationMs() {
    const lockSeconds = Number(process.env.REGISTRATION_OTP_LOCK_DURATION_SECONDS || 900);
    if (!Number.isFinite(lockSeconds) || lockSeconds <= 0) {
      return 900 * 1000;
    }
    return lockSeconds * 1000;
  }

  resolveDate(value, fallback = null) {
    if (!value) {
      return fallback;
    }

    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) {
      return fallback;
    }

    return dateValue;
  }

  normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) {
      return '';
    }

    if (digits.length <= 10) {
      return digits;
    }

    return digits.slice(-10);
  }

  async requestOtp({ email, phone }) {
    if (!this.isOtpEnabled()) {
      return {
        otpRequired: false,
        reason: 'otp_disabled_for_testing'
      };
    }

    const normalizedPhone = this.normalizePhone(phone);
    const normalizedEmail = String(email || '').toLowerCase().trim();
    const emailRequired = this.isEmailChannelEnabled();
    const mobileRequired = this.isSmsChannelEnabled();

    if (!emailRequired && !mobileRequired) {
      throw new Error('No OTP channel is enabled');
    }

    if (!normalizedEmail) {
      throw new Error('Valid email is required');
    }

    if (!normalizedPhone) {
      throw new Error('Valid mobile number is required');
    }

    const now = new Date();
    const activeSession = await this.otpSessionModel.findOne({
      email: normalizedEmail,
      phone: normalizedPhone,
      consumedAt: null
    });

    if (this.isSessionLocked(activeSession, now)) {
      throw new Error('OTP session is temporarily locked. Please retry later.');
    }

    const activeSessionExpiresAt = this.resolveDate(activeSession?.expiresAt);
    if (activeSession && activeSessionExpiresAt && activeSessionExpiresAt > now) {
      const lastSentAt = this.resolveDate(
        activeSession.lastOtpSentAt || activeSession.updatedAt || activeSession.createdAt,
        new Date(0)
      );
      const cooldownMs = this.getResendCooldownMs();
      const elapsedMs = now.getTime() - lastSentAt.getTime();
      if (elapsedMs < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
        throw new Error(`Please wait ${remainingSeconds} seconds before requesting a new OTP.`);
      }

      if (Number(activeSession.resendCount || 0) >= this.getMaxResendAttempts()) {
        await this.lockSession(activeSession, 'resend_limit');
        throw new Error('Maximum OTP resend attempts exceeded. Please try again later.');
      }

      const emailOtp = activeSession.emailOtpRequired ? this.generateOtp() : null;
      const mobileOtp = activeSession.mobileOtpRequired ? this.generateOtp() : null;
      activeSession.emailOtpHash = this.hashOtp(emailOtp);
      activeSession.mobileOtpHash = this.hashOtp(mobileOtp);
      activeSession.emailVerified = false;
      activeSession.mobileVerified = false;
      activeSession.verifiedAt = null;
      activeSession.resendCount = Number(activeSession.resendCount || 0) + 1;
      activeSession.requestCount = Number(activeSession.requestCount || 0) + 1;
      activeSession.lastOtpSentAt = now;
      activeSession.expiresAt = new Date(Date.now() + this.getOtpTtlMs());
      await activeSession.save();

      await this.dispatchOtp({
        email: normalizedEmail,
        phone: normalizedPhone,
        emailOtp,
        mobileOtp,
        emailRequired: activeSession.emailOtpRequired,
        mobileRequired: activeSession.mobileOtpRequired
      });

      return {
        otpRequired: true,
        sessionId: activeSession.sessionId,
        expiresAt: activeSession.expiresAt,
        channels: {
          email: activeSession.emailOtpRequired,
          mobile: activeSession.mobileOtpRequired
        }
      };
    }

    const emailOtp = emailRequired ? this.generateOtp() : null;
    const mobileOtp = mobileRequired ? this.generateOtp() : null;
    const sessionId = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + this.getOtpTtlMs());

    await this.otpSessionModel.deleteMany({
      email: normalizedEmail,
      phone: normalizedPhone,
      consumedAt: null
    });

    const session = await this.otpSessionModel.create({
      sessionId,
      email: normalizedEmail,
      phone: normalizedPhone,
      emailOtpHash: this.hashOtp(emailOtp),
      mobileOtpHash: this.hashOtp(mobileOtp),
      emailOtpRequired: emailRequired,
      mobileOtpRequired: mobileRequired,
      requestCount: 1,
      resendCount: 0,
      verifyAttempts: 0,
      lastOtpSentAt: now,
      expiresAt
    });

    await this.dispatchOtp({
      email: normalizedEmail,
      phone: normalizedPhone,
      emailOtp,
      mobileOtp,
      emailRequired,
      mobileRequired
    });

    return {
      otpRequired: true,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      channels: {
        email: emailRequired,
        mobile: mobileRequired
      }
    };
  }

  async verifyOtp({ sessionId, emailOtp, mobileOtp }) {
    if (!this.isOtpEnabled()) {
      return {
        otpRequired: false,
        verified: true,
        emailVerified: true,
        mobileVerified: true
      };
    }

    const now = new Date();
    const session = await this.otpSessionModel.findOne({ sessionId, consumedAt: null });
    const sessionExpiresAt = this.resolveDate(session?.expiresAt);
    if (!session || !sessionExpiresAt || sessionExpiresAt < now) {
      throw new Error('Invalid or expired OTP session');
    }

    if (this.isSessionLocked(session, now)) {
      throw new Error('OTP session is temporarily locked. Please retry later.');
    }

    const emailPendingVerification = session.emailOtpRequired && !session.emailVerified;
    const mobilePendingVerification = session.mobileOtpRequired && !session.mobileVerified;

    if (emailPendingVerification && !emailOtp) {
      throw new Error('Email OTP is required');
    }

    if (mobilePendingVerification && !mobileOtp) {
      throw new Error('Mobile OTP is required');
    }

    const nextEmailVerified = session.emailOtpRequired
      ? (session.emailVerified || this.compareOtp(emailOtp, session.emailOtpHash))
      : true;
    const nextMobileVerified = session.mobileOtpRequired
      ? (session.mobileVerified || this.compareOtp(mobileOtp, session.mobileOtpHash))
      : true;

    session.emailVerified = nextEmailVerified;
    session.mobileVerified = nextMobileVerified;
    if (nextEmailVerified && nextMobileVerified) {
      session.verifiedAt = new Date();
      session.verifyAttempts = 0;
      session.lockedUntil = null;
      session.lockReason = null;
    } else {
      session.verifyAttempts = Number(session.verifyAttempts || 0) + 1;
      if (session.verifyAttempts >= this.getMaxVerifyAttempts()) {
        await this.lockSession(session, 'verify_limit');
        throw new Error('OTP verification attempts exceeded. Please request a new OTP.');
      }
    }

    await session.save();

    return {
      otpRequired: true,
      verified: nextEmailVerified && nextMobileVerified,
      emailVerified: nextEmailVerified,
      mobileVerified: nextMobileVerified,
      sessionId: session.sessionId
    };
  }

  async consumeVerifiedSessionForRegistration({ sessionId, email, phone }) {
    if (!this.isOtpEnabled()) {
      return null;
    }

    const normalizedPhone = this.normalizePhone(phone);
    const normalizedEmail = String(email || '').toLowerCase().trim();
    const session = await this.otpSessionModel.findOne({
      sessionId,
      email: normalizedEmail,
      phone: normalizedPhone,
      consumedAt: null
    });

    const sessionExpiresAt = this.resolveDate(session?.expiresAt);
    if (!session || !sessionExpiresAt || sessionExpiresAt < new Date()) {
      throw new Error('OTP verification session is invalid or expired');
    }

    const emailVerified = session.emailOtpRequired ? session.emailVerified : true;
    const mobileVerified = session.mobileOtpRequired ? session.mobileVerified : true;

    if (!emailVerified || !mobileVerified) {
      throw new Error('Email and mobile OTP verification is required');
    }

    session.consumedAt = new Date();
    await session.save();

    return session;
  }

  async dispatchOtp({ email, phone, emailOtp, mobileOtp, emailRequired, mobileRequired }) {
    const dispatchTasks = [];

    if (emailRequired) {
      dispatchTasks.push(this.sendEmailOtp(email, emailOtp));
    }

    if (mobileRequired) {
      dispatchTasks.push(this.sendSmsOtp(phone, mobileOtp));
    }

    if (dispatchTasks.length === 0) {
      throw new Error('No OTP channel is enabled');
    }

    await Promise.all(dispatchTasks);
  }

  async sendEmailOtp(email, otp) {
    const subject = 'Registration OTP Verification';
    const html = `
      <p>Your registration OTP is <strong>${otp}</strong>.</p>
      <p>This OTP is valid for 10 minutes and can only be used once.</p>
      <p>If you did not request this, please ignore this email.</p>
    `;

    await this.emailClient({
      to: email,
      subject,
      html
    });
  }

  async sendSmsOtp(phone, otp) {
    const airtelHeader = process.env.AIRTEL_DLT_SMS_HEADER || process.env.REGISTRATION_OTP_SMS_HEADER;
    const airtelTemplateId = process.env.AIRTEL_DLT_OTP_TEMPLATE_ID || process.env.REGISTRATION_OTP_SMS_TEMPLATE_ID;
    const template = process.env.AIRTEL_DLT_OTP_MESSAGE || process.env.REGISTRATION_OTP_SMS_TEMPLATE || OTP_TEMPLATE;
    const message = template
      .replace(/\{\{OTP\}\}/g, otp)
      .replace(/\{\{otp\}\}/g, otp);

    await this.smsClient.sendMessage({
      to: phone,
      message,
      templateId: airtelTemplateId,
      senderId: airtelHeader,
      variables: {
        OTP: otp,
        otp
      }
    });

    this.logger.info('Registration OTP SMS dispatched using DLT configuration', {
      phone,
      templateId: airtelTemplateId || null,
      senderId: airtelHeader || null
    });
  }

  generateOtp() {
    const length = Number(process.env.REGISTRATION_OTP_LENGTH || DEFAULT_OTP_LENGTH);
    const resolvedLength = Number.isFinite(length) && length >= 4 ? Math.min(length, 8) : DEFAULT_OTP_LENGTH;
    const min = 10 ** (resolvedLength - 1);
    const max = (10 ** resolvedLength) - 1;
    return String(crypto.randomInt(min, max + 1));
  }

  hashOtp(otp) {
    if (!otp) {
      return null;
    }
    return crypto.createHash(OTP_HASH_ALGORITHM).update(String(otp || '')).digest('hex');
  }

  compareOtp(rawOtp, hashedOtp) {
    if (!rawOtp || !hashedOtp) {
      return false;
    }
    return this.hashOtp(rawOtp) === hashedOtp;
  }

  isSessionLocked(session, now = new Date()) {
    if (!session?.lockedUntil) {
      return false;
    }
    return new Date(session.lockedUntil).getTime() > now.getTime();
  }

  async lockSession(session, lockReason) {
    if (!session) {
      return;
    }
    session.lockedUntil = new Date(Date.now() + this.getLockDurationMs());
    session.lockReason = lockReason || 'attempt_limit';
    await session.save();
  }
}

module.exports = new RegistrationOtpService();
module.exports.RegistrationOtpService = RegistrationOtpService;
