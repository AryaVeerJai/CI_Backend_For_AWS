const mongoose = require('mongoose');
const logger = require('./logger');
const { clearAllManagedIntervals } = require('./intervalRegistry');
const { closeSocketServer } = require('./socketServer');

let shuttingDown = false;

const registerGracefulShutdown = (server) => {
  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully`);

    clearAllManagedIntervals();

    try {
      await closeSocketServer();
    } catch (error) {
      logger.error('Error closing Socket.IO during shutdown:', error);
    }

    if (server && typeof server.close === 'function') {
      await new Promise((resolve) => {
        server.close(() => resolve());
      });
    }

    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
      }
    } catch (error) {
      logger.error('Error closing MongoDB connection during shutdown:', error);
    }

    process.exit(0);
  };

  process.once('SIGTERM', () => {
    shutdown('SIGTERM').catch((error) => {
      logger.error('Shutdown error:', error);
      process.exit(1);
    });
  });

  process.once('SIGINT', () => {
    shutdown('SIGINT').catch((error) => {
      logger.error('Shutdown error:', error);
      process.exit(1);
    });
  });
};

module.exports = {
  registerGracefulShutdown
};
