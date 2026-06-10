/**
 * Cross-platform toggles for carbon activity data sources shown in product UIs.
 * Email ingestion remains available on the API but is hidden/disabled in clients by default.
 */
const parseEnabledFlag = (raw) => {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return null;
};

const resolveEmailDataSourceUiEnabled = () => {
  const fromReactEnv = parseEnabledFlag(
    typeof process !== 'undefined' ? process.env?.REACT_APP_EMAIL_DATA_SOURCE_UI_ENABLED : null
  );
  if (fromReactEnv !== null) {
    return fromReactEnv;
  }

  const fromMobileEnv = parseEnabledFlag(
    typeof process !== 'undefined' ? process.env?.MOBILE_EMAIL_DATA_SOURCE_UI_ENABLED : null
  );
  if (fromMobileEnv !== null) {
    return fromMobileEnv;
  }

  const fromSharedEnv = parseEnabledFlag(
    typeof process !== 'undefined' ? process.env?.EMAIL_DATA_SOURCE_UI_ENABLED : null
  );
  if (fromSharedEnv !== null) {
    return fromSharedEnv;
  }

  return false;
};

const EMAIL_DATA_SOURCE_UI_ENABLED = resolveEmailDataSourceUiEnabled();

module.exports = {
  EMAIL_DATA_SOURCE_UI_ENABLED
};
