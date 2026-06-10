const MSME = require('../models/MSME');

const MSME_SELECT_FIELDS =
  '_id companyName companyType carbonScore isVerified business environmentalCompliance sustainabilitySettings manufacturingProfile udyamRegistrationNumber gstNumber industry businessDomain contact';

const handleFinanceOverview = async (req, res) => {
  try {
    const msme = await MSME.findOne({ userId: req.user.userId }).select(MSME_SELECT_FIELDS);
    if (!msme) {
      return res.status(404).json({
        success: false,
        message: 'MSME profile not found'
      });
    }

    const financeEligibilityService = require('../services/financeEligibilityService');
    const data = await financeEligibilityService.buildFinanceOverview(req.user.userId, msme);

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching finance overview'
    });
  }
};

module.exports = {
  handleFinanceOverview
};
