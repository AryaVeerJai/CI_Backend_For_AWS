/**
 * Canonical letter grades, labels, and colors for carbon scores (0–100).
 * Used by backend, mobile, and AI analysis routes.
 */

const LETTER_GRADE_THRESHOLDS = Object.freeze([
  { min: 90, grade: 'A+' },
  { min: 80, grade: 'A' },
  { min: 70, grade: 'B+' },
  { min: 60, grade: 'B' },
  { min: 50, grade: 'C+' },
  { min: 40, grade: 'C' },
  { min: 30, grade: 'D' },
  { min: 0, grade: 'F' }
]);

const SCORE_LABEL_THRESHOLDS = Object.freeze([
  { min: 80, label: 'Excellent' },
  { min: 60, label: 'Good' },
  { min: 40, label: 'Average' },
  { min: 20, label: 'Poor' },
  { min: 0, label: 'Critical' }
]);

const GRADE_COLORS = Object.freeze({
  'A+': '#2E7D32',
  A: '#4CAF50',
  'B+': '#558B2F',
  B: '#8BC34A',
  'C+': '#F9A825',
  C: '#FF9800',
  D: '#EF6C00',
  F: '#C62828'
});

const normalizeScore = (score) => {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  // Legacy AI scorers returned 0–1 fractions.
  if (numeric > 0 && numeric <= 1) {
    return Math.max(0, Math.min(100, Math.round(numeric * 100)));
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const getRating = (score) => {
  const normalized = normalizeScore(score);
  const match = LETTER_GRADE_THRESHOLDS.find((entry) => normalized >= entry.min);
  return match ? match.grade : 'F';
};

const getScoreLabel = (score) => {
  const normalized = normalizeScore(score);
  const match = SCORE_LABEL_THRESHOLDS.find((entry) => normalized >= entry.min);
  return match ? match.label : 'Critical';
};

const getScoreColor = (score) => {
  const normalized = normalizeScore(score);
  if (normalized >= 80) return GRADE_COLORS['A+'];
  if (normalized >= 60) return GRADE_COLORS.B;
  if (normalized >= 40) return GRADE_COLORS['C+'];
  if (normalized >= 20) return GRADE_COLORS.D;
  return GRADE_COLORS.F;
};

const getGradeColor = (grade) => GRADE_COLORS[grade] || '#757575';

module.exports = {
  LETTER_GRADE_THRESHOLDS,
  SCORE_LABEL_THRESHOLDS,
  GRADE_COLORS,
  normalizeScore,
  getRating,
  getScoreLabel,
  getScoreColor,
  getGradeColor
};
