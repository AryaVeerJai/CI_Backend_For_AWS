/**
 * Shared SMS classification patterns for mobile pipeline and backend spam detection.
 * Single source of truth for OTP/promotional filters and transaction signals.
 */

const RE_DEBIT_CREDIT = /\b(debited|credited|withdrawn|deposited|transferred|paid\s*to|received\s*from|sent\s*to)\b/i;
const RE_ACCOUNT_INFO = /\b(a\/c\s*[x*]+\d+|acct?\s*[x*]+\d+|available\s*bal|avl\s*bal|current\s*bal|closing\s*bal|statement)\b/i;
const RE_TXN_REF = /\b(upi\s*ref|imps\s*ref|neft\s*ref|txn\s*id|ref\s*no|transaction\s*id)\b/i;
const RE_EMI_PAYMENT = /\b(emi\s*of\s*rs|emi\s*paid|emi\s*due|loan\s*emi|emi\s*amount|auto\s*debit|mandate)\b/i;
const RE_BILL_PAYMENT = /\b(bill\s*paid|payment\s*successful|payment\s*received|payment\s*confirmed|recharge\s*successful)\b/i;
const RE_EXPENSE = /\b(fuel|diesel|petrol|electricity|kwh|invoice|dispatch|vendor|supplier|material|purchase\s*order)\b/i;

const RE_OTP = /\b(otp|one[-\s]?time\s*password|verification\s*code|auth\s*code|code\s*is\s*\d{4,8}|your\s*otp|otp\s*for|valid\s*for\s*\d+\s*min|do\s*not\s*share|pin\s*is)\b/i;
const RE_PROMOTIONAL = /\b(offer|discount|sale|deal|cashback|coupon|promo|off\s*on|flat\s*\d+%|upto\s*\d+%|limited\s*time|exclusive|special\s*price|shop\s*now|buy\s*now|order\s*now)\b/i;
const RE_MARKETING = /\b(new\s*launch|introducing|check\s*out|visit\s*store|download\s*app|install\s*now|subscribe|follow\s*us|like\s*us)\b/i;
const RE_ALERTS = /\b(reminder|due\s*date|upcoming|scheduled|expiring|renewal|kyc\s*update|update\s*kyc|link\s*pan|verify)\b/i;
const RE_DELIVERY = /\b(out\s*for\s*delivery|delivered|shipped|dispatched|arriving|in\s*transit|track\s*your|order\s*status)\b/i;
const RE_SERVICE = /\b(subscription|plan\s*activated|plan\s*expired|data\s*balance|validity|recharged|activated|deactivated)\b/i;

const SMS_SPAM_PATTERNS = [
  RE_OTP,
  RE_PROMOTIONAL,
  RE_MARKETING,
  RE_ALERTS,
  RE_DELIVERY,
  RE_SERVICE
];

function isOtpOrPromotionalSpam(text) {
  const t = (text || '').trim();
  if (!t) return true;
  return RE_OTP.test(t) || RE_PROMOTIONAL.test(t);
}

function matchesSmsSpamPattern(text) {
  const t = (text || '').trim();
  if (!t) return true;
  return SMS_SPAM_PATTERNS.some((pattern) => pattern.test(t));
}

function isImportantTransactionSms(text) {
  const t = (text || '').trim();
  if (!t) return false;
  return (
    RE_DEBIT_CREDIT.test(t)
    || RE_ACCOUNT_INFO.test(t)
    || RE_TXN_REF.test(t)
    || RE_EMI_PAYMENT.test(t)
    || RE_BILL_PAYMENT.test(t)
    || RE_EXPENSE.test(t)
  );
}

function scoreSmsSpamSignals(text) {
  const t = (text || '').trim();
  if (!t) return { score: 1, signals: ['empty'] };

  const signals = [];
  if (RE_OTP.test(t)) signals.push('otp');
  if (RE_PROMOTIONAL.test(t)) signals.push('promotional');
  if (RE_MARKETING.test(t)) signals.push('marketing');
  if (RE_ALERTS.test(t)) signals.push('alert');
  if (RE_DELIVERY.test(t)) signals.push('delivery');
  if (RE_SERVICE.test(t)) signals.push('service');

  const score = Math.min(1, signals.length * 0.25);
  return { score, signals };
}

module.exports = {
  RE_DEBIT_CREDIT,
  RE_ACCOUNT_INFO,
  RE_TXN_REF,
  RE_EMI_PAYMENT,
  RE_BILL_PAYMENT,
  RE_EXPENSE,
  RE_OTP,
  RE_PROMOTIONAL,
  RE_MARKETING,
  RE_ALERTS,
  RE_DELIVERY,
  RE_SERVICE,
  SMS_SPAM_PATTERNS,
  isOtpOrPromotionalSpam,
  matchesSmsSpamPattern,
  isImportantTransactionSms,
  scoreSmsSpamSignals
};
