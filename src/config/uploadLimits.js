const {
  getUploadLimitsFromEnv,
  buildMaxFileSizeError,
  formatMegabytesLabel,
} = require('../../../shared/uploadLimits');

const uploadLimits = getUploadLimitsFromEnv(process.env);

module.exports = {
  ...uploadLimits,
  buildMaxFileSizeError: () => buildMaxFileSizeError(uploadLimits.maxFileBytes),
  buildDataProcessorMaxFileSizeError: () =>
    buildMaxFileSizeError(uploadLimits.dataProcessorMaxFileBytes),
  formatMegabytesLabel,
};
