const { clearAllManagedIntervals } = require('./src/utils/intervalRegistry');

module.exports = async () => {
  clearAllManagedIntervals();
  if (global.__MONGO_MEMORY_SERVER__) {
    await global.__MONGO_MEMORY_SERVER__.stop();
  }
};
