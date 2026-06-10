const logger = require('../utils/logger');
const MSME = require('../models/MSME');
const MSG91Client = require('./msg91Client');

function parseBoolean(value) {
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
}

const NOTIFICATION_TYPES = Object.freeze({
  PROGRESS: 'progress',
  CARBON_SCORE: 'carbon_score',
  RECOMMENDATIONS: 'recommendations',
  INCENTIVES: 'incentives',
  CARBON_FOOTPRINT: 'carbon_footprint',
  ALERT: 'alert',
  CUSTOM: 'custom'
});

class MSMENotificationService {
  constructor({ msg91Client, msmeModel, notificationsEnabled } = {}) {
    this.msg91Client = msg91Client || new MSG91Client();
    this.msmeModel = msmeModel || MSME;
    const resolvedNotificationsEnabled = typeof notificationsEnabled === 'undefined'
      ? parseBoolean(process.env.MSG91_NOTIFICATIONS_ENABLED)
      : parseBoolean(notificationsEnabled);
    this.notificationsEnabled = resolvedNotificationsEnabled;

    if (!this.notificationsEnabled) {
      logger.warn('MSG91 notifications are disabled; SMS dispatch will be skipped');
    }
  }

  getSupportedTypes() {
    return Object.values(NOTIFICATION_TYPES);
  }

  async sendNotification(type, msmeId, payload = {}) {
    switch (type) {
      case NOTIFICATION_TYPES.PROGRESS:
        return this.sendProgressUpdate(msmeId, payload);
      case NOTIFICATION_TYPES.CARBON_SCORE:
        return this.sendCarbonScoreUpdate(msmeId, payload);
      case NOTIFICATION_TYPES.RECOMMENDATIONS:
        return this.sendRecommendationSummary(msmeId, payload);
      case NOTIFICATION_TYPES.INCENTIVES:
        return this.sendIncentiveAlert(msmeId, payload);
      case NOTIFICATION_TYPES.CARBON_FOOTPRINT:
        return this.sendCarbonFootprintSummary(msmeId, payload);
      case NOTIFICATION_TYPES.ALERT:
        return this.sendCarbonAlert(msmeId, payload);
      case NOTIFICATION_TYPES.CUSTOM:
        return this.sendCustomNotification(msmeId, payload.message, payload.options);
      default:
        throw new Error(`Unsupported notification type: ${type}`);
    }
  }

  async sendProgressUpdate(msmeId, {
    milestone,
    status,
    eta,
    nextSteps = [],
    notes
  } = {}) {
    const { msme, context } = await this.getMSMEData(msmeId);
    const nextStepsText = this.formatList(nextSteps, 3);
    const message = [
      `Hi ${context.companyName},`,
      `Progress update: ${milestone || 'workflow milestone'} is ${status || 'in progress'}.`,
      eta ? `Estimated completion: ${eta}.` : null,
      nextStepsText ? `Next steps: ${nextStepsText}.` : null,
      notes ? `Notes: ${notes}` : null,
      'Keep up the momentum towards sustainable operations!'
    ].filter(Boolean).join(' ');

    return this.dispatch(msme, message, { type: NOTIFICATION_TYPES.PROGRESS });
  }

  async sendCarbonScoreUpdate(msmeId, {
    score,
    previousScore,
    benchmark,
    insights = []
  } = {}) {
    const { msme, context } = await this.getMSMEData(msmeId);
    const currentScore = score ?? context.carbonScore ?? 'N/A';
    const delta = this.calculateDelta(currentScore, previousScore);
    const insightsText = this.formatList(insights, 2);
    const message = [
      `Hello ${context.companyName},`,
      `Your latest carbon score is ${currentScore}.`,
      delta ? `Change since last update: ${delta}.` : null,
      benchmark ? `Industry benchmark: ${benchmark}.` : null,
      insightsText ? `Insights: ${insightsText}.` : null,
      'Stay focused on reducing emissions and boosting sustainability.'
    ].filter(Boolean).join(' ');

    return this.dispatch(msme, message, { type: NOTIFICATION_TYPES.CARBON_SCORE });
  }

  async sendRecommendationSummary(msmeId, {
    recommendations = [],
    priority,
    reviewDate
  } = {}) {
    const { msme, context } = await this.getMSMEData(msmeId);
    const recommendationText = this.formatList(recommendations, 3) || 'Review new sustainability recommendations in the portal.';
    const message = [
      `Hi ${context.companyName},`,
      `Top recommendations${priority ? ` (${priority} priority)` : ''}: ${recommendationText}.`,
      reviewDate ? `Next review on ${reviewDate}.` : null,
      'Implement actions to improve your carbon efficiency.'
    ].filter(Boolean).join(' ');

    return this.dispatch(msme, message, { type: NOTIFICATION_TYPES.RECOMMENDATIONS });
  }

  async sendIncentiveAlert(msmeId, {
    incentiveName,
    eligibility,
    deadline,
    benefit
  } = {}) {
    const { msme, context } = await this.getMSMEData(msmeId);
    const message = [
      `Hello ${context.companyName},`,
      incentiveName ? `${incentiveName} is now available for you.` : 'A new sustainability incentive is available.',
      eligibility ? `Eligibility: ${eligibility}.` : null,
      benefit ? `Benefit: ${benefit}.` : null,
      deadline ? `Apply before ${deadline}.` : 'Apply soon to maximise benefits.',
      'Visit the portal to submit your application.'
    ].filter(Boolean).join(' ');

    return this.dispatch(msme, message, { type: NOTIFICATION_TYPES.INCENTIVES });
  }

  async sendCarbonFootprintSummary(msmeId, {
    period,
    totalCO2,
    reduction,
    target,
    highlight
  } = {}) {
    const { msme, context } = await this.getMSMEData(msmeId);
    const message = [
      `Hi ${context.companyName},`,
      `Carbon footprint summary${period ? ` for ${period}` : ''}: ${totalCO2 ?? 'N/A'} tCO₂e.`,
      reduction ? `Reduction achieved: ${reduction}.` : null,
      target ? `Target: ${target}.` : null,
      highlight ? `Highlight: ${highlight}.` : null,
      'Track detailed metrics in the app and continue reducing emissions.'
    ].filter(Boolean).join(' ');

    return this.dispatch(msme, message, { type: NOTIFICATION_TYPES.CARBON_FOOTPRINT });
  }

  async sendCarbonAlert(msmeId, {
    metric,
    value,
    threshold,
    severity = 'medium',
    action
  } = {}) {
    const { msme, context } = await this.getMSMEData(msmeId);
    const message = [
      `Alert for ${context.companyName}:`,
      `${metric || 'Carbon metric'} at ${value ?? 'N/A'} (threshold ${threshold ?? 'N/A'}).`,
      `Severity: ${severity}.`,
      action ? `Recommended action: ${action}.` : 'Please review and take corrective measures.'
    ].filter(Boolean).join(' ');

    return this.dispatch(msme, message, { type: NOTIFICATION_TYPES.ALERT });
  }

  async sendCustomNotification(msmeId, message, options = {}) {
    if (!message) {
      throw new Error('Message is required for custom notifications');
    }

    const { msme } = await this.getMSMEData(msmeId);

    const metadata = {
      ...options,
      type: options?.type || NOTIFICATION_TYPES.CUSTOM
    };

    return this.dispatch(msme, message, metadata);
  }

  async dispatch(msme, message, metadata = {}) {
    if (!msme.contact?.phone) {
      throw new Error(`MSME ${msme._id} does not have a registered phone number`);
    }

    if (!this.notificationsEnabled) {
      logger.info('Skipping MSME SMS notification because MSG91 notifications are disabled', {
        msmeId: msme._id,
        phone: msme.contact.phone,
        type: metadata.type || 'unknown'
      });

      return {
        msmeId: msme._id,
        phone: msme.contact.phone,
        type: metadata.type,
        response: null,
        skipped: true,
        reason: 'notifications_disabled'
      };
    }

    const response = await this.msg91Client.sendMessage({
      to: msme.contact.phone,
      message
    });

    logger.info('MSME SMS notification sent', {
      msmeId: msme._id,
      phone: msme.contact.phone,
      type: metadata.type || 'unknown'
    });

    return {
      msmeId: msme._id,
      phone: msme.contact.phone,
      type: metadata.type,
      response,
      skipped: false
    };
  }

  async getMSMEData(msmeId) {
    const msme = await this.msmeModel.findById(msmeId).select('companyName carbonScore contact.phone');

    if (!msme) {
      throw new Error(`MSME not found for id ${msmeId}`);
    }

    const context = {
      companyName: msme.companyName || 'MSME Partner',
      carbonScore: msme.carbonScore ?? null
    };

    return { msme, context };
  }

  formatList(items, limit) {
    if (!items || items.length === 0) {
      return '';
    }

    const sanitized = items
      .map(item => (typeof item === 'string' ? item.trim() : item))
      .filter(Boolean);

    if (sanitized.length === 0) {
      return '';
    }

    const limited = limit ? sanitized.slice(0, limit) : sanitized;
    const suffix = sanitized.length > limited.length ? '…' : '';

    return `${limited.join('; ')}${suffix}`;
  }

  calculateDelta(current, previous) {
    if (current == null || previous == null || Number.isNaN(Number(current)) || Number.isNaN(Number(previous))) {
      return '';
    }

    const delta = Number(current) - Number(previous);

    if (delta === 0) {
      return 'no change';
    }

    const direction = delta > 0 ? '↑' : '↓';
    return `${direction} ${Math.abs(delta).toFixed(2)}`;
  }
}

module.exports = {
  MSMENotificationService,
  NOTIFICATION_TYPES
};
