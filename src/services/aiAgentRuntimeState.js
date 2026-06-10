let status = 'pending';
let agentCount = 0;
let lastError = null;
let initializedAt = null;

const setReady = (count = 0) => {
  status = 'ready';
  agentCount = count;
  lastError = null;
  initializedAt = new Date().toISOString();
};

const setDegraded = (error) => {
  status = 'degraded';
  lastError = error?.message || String(error || 'unknown error');
  initializedAt = initializedAt || new Date().toISOString();
};

const getSnapshot = () => ({
  status,
  agentCount,
  lastError,
  initializedAt
});

const isReady = () => status === 'ready';

module.exports = {
  setReady,
  setDegraded,
  getSnapshot,
  isReady
};
