/**
 * Tracks setInterval handles so they can be cleared on graceful shutdown or in tests.
 */
const managedIntervals = new Set();

const setManagedInterval = (callback, ms) => {
  const handle = setInterval(callback, ms);
  managedIntervals.add(handle);
  return handle;
};

const clearManagedInterval = (handle) => {
  if (handle) {
    clearInterval(handle);
    managedIntervals.delete(handle);
  }
};

const clearAllManagedIntervals = () => {
  for (const handle of managedIntervals) {
    clearInterval(handle);
  }
  managedIntervals.clear();
};

module.exports = {
  setManagedInterval,
  clearManagedInterval,
  clearAllManagedIntervals
};
