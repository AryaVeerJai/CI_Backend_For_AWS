/**
 * Canonical MSME carbon score (backend, mobile, document bulk, agents).
 * Intensity = kg CO₂ per ₹1,000 spent.
 */

const DOMAIN_SCORE_ADJUSTMENTS = Object.freeze({
  manufacturing: -5,
  trading: 0,
  services: 5,
  export_import: -3,
  retail: 0,
  wholesale: 0,
  e_commerce: -2,
  consulting: 10,
  logistics: -8,
  agriculture: 3,
  handicrafts: 5,
  food_processing: -3,
  textiles: -5,
  electronics: -2,
  automotive: -8,
  construction: -10,
  healthcare: 2,
  education: 8,
  tourism: 0,
  other: 0
});

const toFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const scoreFromIntensity = (intensity) => {
  if (intensity <= 0.5) return 95;
  if (intensity <= 1) return 90;
  if (intensity <= 2) return 85;
  if (intensity <= 5) return 78;
  if (intensity <= 10) return 70;
  if (intensity <= 20) return 60;
  if (intensity <= 50) return 45;
  return Math.max(10, 45 - Math.log10(intensity / 50) * 20);
};

/**
 * Share of energy emissions from renewable/solar subcategories (0–1).
 */
const computeRenewableEnergyRatio = (assessment = {}, msmeData = {}) => {
  const profile = msmeData.manufacturingProfile || {};
  const compliance = msmeData.environmentalCompliance || {};
  const rawShare = profile.renewableEnergyShare
    ?? profile.renewableEnergyRatio
    ?? compliance.renewableEnergyShare
    ?? compliance.renewableEnergyRatio;
  if (rawShare != null && Number.isFinite(Number(rawShare))) {
    const numeric = Number(rawShare);
    return numeric > 1 ? Math.min(1, numeric / 100) : Math.max(0, numeric);
  }

  const energy = assessment.breakdown?.energy || {};
  const total = toFiniteNumber(energy.total, 0);
  const renewable = toFiniteNumber(energy.renewable, 0);
  if (total > 0 && renewable > 0) {
    return Math.min(1, renewable / total);
  }
  return 0;
};

/**
 * Share of waste emissions attributed to recycling subcategory (0–1).
 */
const computeWasteRecyclingRatio = (assessment = {}, msmeData = {}) => {
  const compliance = msmeData.environmentalCompliance || {};
  const rawRate = compliance.wasteRecyclingRate ?? compliance.recyclingRate;
  if (rawRate != null && Number.isFinite(Number(rawRate))) {
    const numeric = Number(rawRate);
    return numeric > 1 ? Math.min(1, numeric / 100) : Math.max(0, numeric);
  }

  const waste = assessment.breakdown?.waste || {};
  const total = toFiniteNumber(waste.total, 0);
  const recycled = toFiniteNumber(waste.recycled, 0);
  if (total > 0 && recycled > 0) {
    return Math.min(1, recycled / total);
  }
  return 0;
};

const getDomainScoreAdjustments = (businessDomain) =>
  DOMAIN_SCORE_ADJUSTMENTS[businessDomain] ?? 0;

/**
 * Spend basis for intensity (kg CO₂ per ₹1,000). Avoids treating missing spend as ₹1,
 * which would collapse scores when emissions exist.
 */
const resolveAssessmentSpend = (assessment = {}, msmeData = {}) => {
  const fromAssessment = toFiniteNumber(
    assessment.totalSpend ?? assessment.totalAmount,
    0
  );
  if (fromAssessment > 0) {
    return fromAssessment;
  }

  const turnover = toFiniteNumber(
    msmeData.annualTurnover ?? msmeData.financials?.annualTurnoverInr,
    0
  );
  if (turnover > 0) {
    return turnover;
  }

  const totalEmissions = toFiniteNumber(assessment.totalCO2Emissions, 0);
  if (totalEmissions > 0) {
    return 100000;
  }

  return 1;
};

const calculateCarbonScore = (assessment = {}, msmeData = {}) => {
  const totalEmissions = toFiniteNumber(assessment.totalCO2Emissions, 0);
  const safeSpend = resolveAssessmentSpend(assessment, msmeData);

  const intensity = (totalEmissions / safeSpend) * 1000;
  let score = scoreFromIntensity(intensity);

  score += getDomainScoreAdjustments(msmeData.businessDomain);

  const compliance = msmeData.environmentalCompliance || {};
  if (compliance.hasEnvironmentalClearance) score += 3;
  if (compliance.hasPollutionControlBoard) score += 3;
  if (compliance.hasWasteManagement) score += 3;
  if (computeRenewableEnergyRatio(assessment, msmeData) > 0.5) score += 5;
  if (computeWasteRecyclingRatio(assessment, msmeData) > 0.7) score += 3;

  const manufacturingProfile = msmeData.manufacturingProfile || {};
  const esgMaturity = String(manufacturingProfile.esgMaturityLevel || '').toLowerCase();
  if (esgMaturity.includes('advanced') || esgMaturity.includes('mature')) score += 3;
  if (esgMaturity.includes('basic')) score += 1;

  const digitalization = String(manufacturingProfile.digitalizationLevel || '').toLowerCase();
  if (digitalization.includes('high') || digitalization.includes('advanced')) score += 2;
  if (digitalization.includes('low')) score -= 1;

  const carbonAccounting = String(manufacturingProfile.carbonAccountingPractice || '').toLowerCase();
  if (carbonAccounting.includes('none')) score -= 2;
  if (carbonAccounting.includes('advanced') || carbonAccounting.includes('full')) score += 2;

  const certifications = Array.isArray(manufacturingProfile.certifications)
    ? manufacturingProfile.certifications.map((cert) => String(cert).toLowerCase())
    : [];
  if (certifications.some((cert) => cert.includes('iso 14001') || cert.includes('iso14001'))) {
    score += 3;
  }
  if (certifications.some((cert) => cert.includes('iso 9001') || cert.includes('iso9001'))) {
    score += 1;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
};

module.exports = {
  DOMAIN_SCORE_ADJUSTMENTS,
  toFiniteNumber,
  scoreFromIntensity,
  computeRenewableEnergyRatio,
  computeWasteRecyclingRatio,
  getDomainScoreAdjustments,
  resolveAssessmentSpend,
  calculateCarbonScore
};
