/**
 * PAT (Perform, Achieve and Trade) agent — energy intensity guidance for designated consumers.
 */
const {
  DC_SECTORS,
  isDesignatedConsumer,
  computePatEnergyMetrics
} = require('../../../../shared/patEnergyMetrics');

const buildPatGuidance = (enterpriseProfile = {}, options = {}) => {
  const sectorKey = String(enterpriseProfile.sector || enterpriseProfile.industry || '')
    .toLowerCase()
    .replace(/\s+/g, '_');
  const isDesignated = isDesignatedConsumer(enterpriseProfile);
  const patMetrics = options.transactions
    ? computePatEnergyMetrics({
      transactions: options.transactions,
      enterpriseProfile,
      productionOutput: options.productionOutput,
      productionUnit: options.productionUnit
    })
    : null;

  return {
    scheme: 'BEE_PAT',
    designatedConsumer: isDesignated,
    sector: sectorKey || 'general',
    metrics: isDesignated
      ? ['specific_energy_consumption', 'baseline_year_normalization', 'escert_trading_readiness', 'toe', 'sec']
      : ['voluntary_energy_intensity_tracking', 'toe'],
    patEnergyMetrics: patMetrics,
    recommendations: isDesignated
      ? [
        'Align facility-level energy data with PAT baseline documentation',
        'Map fuel and grid electricity to BEE sector norms (toe and SEC)',
        'Prepare for ESCert verification cycles'
      ]
      : [
        'Track energy intensity voluntarily to anticipate future PAT inclusion',
        'Link DISCOM and fuel invoices to facility meters via data connectors'
      ]
  };
};

module.exports = {
  DC_SECTORS,
  buildPatGuidance,
  computePatEnergyMetrics,
  async execute(task = {}) {
    const { input = {} } = task;
    return buildPatGuidance(input.enterpriseProfile || input, {
      transactions: input.transactions,
      productionOutput: input.productionOutput,
      productionUnit: input.productionUnit
    });
  }
};
