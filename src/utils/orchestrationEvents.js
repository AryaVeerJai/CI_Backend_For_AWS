const logger = require('./logger');

/**
 * Emit orchestration manager events without failing the caller.
 * @param {object} eventService - orchestrationManagerEventService instance
 * @param {string} eventType
 * @param {object} [payload]
 * @param {string} [source]
 */
const emitOrchestrationEvent = (eventService, eventType, payload = {}, source = 'orchestration') => {
  if (!eventService || typeof eventService.emitEvent !== 'function') {
    return;
  }
  try {
    eventService.emitEvent(eventType, payload, source);
  } catch (error) {
    const { clientErrorPayload } = require('./httpErrors');
    logger.warn('Failed to emit orchestration manager event', {
      eventType,
      source,
      ...clientErrorPayload(error)
    });
  }
};

const createOrchestrationEventEmitter = (eventService, defaultSource) => (
  eventType,
  payload = {},
  source = defaultSource
) => emitOrchestrationEvent(eventService, eventType, payload, source);

module.exports = {
  emitOrchestrationEvent,
  createOrchestrationEventEmitter
};
