const { Server } = require('socket.io');
const { verifyJwt } = require('./jwt');
const logger = require('./logger');

let io = null;

const attachSocketServer = (httpServer, corsOrigins = []) => {
  if (!httpServer || io) {
    return io;
  }

  const origins = Array.isArray(corsOrigins) ? corsOrigins : [corsOrigins].filter(Boolean);

  io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: origins.length > 0 ? origins : true,
      credentials: true
    }
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      socket.data.user = verifyJwt(token);
      return next();
    } catch (error) {
      return next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.user?.userId?.toString?.() || socket.data.user?.userId;
    if (userId) {
      socket.join(`user:${userId}`);
    }
    socket.emit('connected', { ok: true, userId: userId || null });
    logger.info('Socket.IO client connected', { socketId: socket.id, userId });
  });

  logger.info('Socket.IO server attached');
  return io;
};

const bridgeOrchestrationEvents = (orchestrationManagerEventService) => {
  if (!orchestrationManagerEventService?.on) {
    return;
  }
  orchestrationManagerEventService.on('orchestrationEvent', (event) => {
    if (!io) {
      return;
    }
    io.emit('orchestration:event', event);
    const msmeId = event?.msmeId?.toString?.() || event?.msmeId;
    if (msmeId) {
      io.to(`msme:${msmeId}`).emit('orchestration:event', event);
    }
  });
};

const closeSocketServer = async () => {
  if (!io) {
    return;
  }
  await new Promise((resolve) => {
    io.close(() => resolve());
  });
  io = null;
};

const getSocketServer = () => io;

module.exports = {
  attachSocketServer,
  bridgeOrchestrationEvents,
  closeSocketServer,
  getSocketServer
};
