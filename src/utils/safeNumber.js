const { roundTo } = require('./roundTo');

const safeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const safeRound = (value, decimals = 2) => roundTo(safeNumber(value, 0), decimals);

const isFiniteNumber = (value) => Number.isFinite(Number(value));

module.exports = {
  safeNumber,
  safeRound,
  isFiniteNumber
};
