const MSME = require('../models/MSME');
const Transaction = require('../models/Transaction');
const CarbonAssessment = require('../models/CarbonAssessment');
const Document = require('../models/Document');
const UserBillingProfile = require('../models/UserBillingProfile');
const { calculateMsmePayment } = require('./paymentPricingService');

const startOfCurrentMonthUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
};

const getMsmePaymentQuote = async (msmeId) => {
  const msme = await MSME.findById(msmeId).lean();
  if (!msme) {
    return null;
  }

  const monthStart = startOfCurrentMonthUtc();

  const [totalTransactions, latestAssessment, documentsThisMonth, billingProfile] = await Promise.all([
    Transaction.countDocuments({ msmeId }),
    CarbonAssessment.findOne({ msmeId })
      .sort({ createdAt: -1 })
      .select('totalCO2Emissions')
      .lean(),
    Document.countDocuments({
      msmeId,
      createdAt: { $gte: monthStart }
    }),
    msme.userId
      ? UserBillingProfile.findOne({ userId: msme.userId }).select('status selectedPlanId').lean()
      : null
  ]);

  return calculateMsmePayment({
    msme,
    totalTransactions,
    totalCO2Emissions: latestAssessment?.totalCO2Emissions || 0,
    documentsThisMonth,
    billingStatus: billingProfile?.status || 'none',
    selectedPlanId: billingProfile?.selectedPlanId || null
  });
};

module.exports = {
  getMsmePaymentQuote
};
