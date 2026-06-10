const roundTo = (value, decimals = 2) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const base = 10 ** decimals;
  return Math.round(numeric * base) / base;
};

module.exports = { roundTo };
