const MB = 1024 * 1024;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const formatMegabytesLabel = (bytes) => {
  const mb = bytes / MB;
  return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
};

/**
 * Resolve upload size limits from environment variables.
 * Used by backend (UPLOAD_*) and web (REACT_APP_UPLOAD_*).
 */
function getUploadLimitsFromEnv(env = {}) {
  const maxFileMb = parsePositiveInt(
    env.UPLOAD_MAX_FILE_MB ?? env.REACT_APP_UPLOAD_MAX_FILE_MB,
    10
  );
  const bulkMaxFiles = parsePositiveInt(env.UPLOAD_BULK_MAX_FILES, 20);
  const dataProcessorMaxFileMb = parsePositiveInt(env.DATA_PROCESSOR_MAX_FILE_MB, 5);
  const maxFileBytes = maxFileMb * MB;
  const dataProcessorMaxFileBytes = dataProcessorMaxFileMb * MB;
  const defaultRequestBodyMb =
    Math.ceil((bulkMaxFiles * maxFileMb * 11) / 10) + 2;
  const maxRequestBodyMb = parsePositiveInt(env.UPLOAD_MAX_REQUEST_BODY_MB, defaultRequestBodyMb);
  const maxRequestBodyBytes = maxRequestBodyMb * MB;
  const nginxClientMaxBodySize = `${maxRequestBodyMb}m`;
  const expressBodyLimitMb = parsePositiveInt(env.EXPRESS_BODY_LIMIT_MB, 10);

  return {
    maxFileMb,
    maxFileBytes,
    maxFileSizeLabel: formatMegabytesLabel(maxFileBytes),
    bulkMaxFiles,
    maxRequestBodyMb,
    maxRequestBodyBytes,
    nginxClientMaxBodySize,
    dataProcessorMaxFileMb,
    dataProcessorMaxFileBytes,
    dataProcessorMaxFileSizeLabel: formatMegabytesLabel(dataProcessorMaxFileBytes),
    expressBodyLimitMb,
    expressJsonLimit: `${expressBodyLimitMb}mb`,
    expressUrlencodedLimit: `${expressBodyLimitMb}mb`,
  };
}

function buildMaxFileSizeError(maxFileBytes) {
  return `File size must be less than ${formatMegabytesLabel(maxFileBytes)}`;
}

module.exports = {
  MB,
  parsePositiveInt,
  formatMegabytesLabel,
  getUploadLimitsFromEnv,
  buildMaxFileSizeError,
};
