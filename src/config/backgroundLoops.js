/**
 * Controls optional background timers (simulated metrics, placeholder optimization loops).
 * In production these are off by default to reduce idle CPU; enable explicitly when needed.
 */

const isTrue = value => {
  const v = String(value ?? '').toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
};

const isFalse = value => {
  const v = String(value ?? '').toLowerCase();
  return v === 'false' || v === '0' || v === 'no';
};

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Simulated monitoring in enhancedMonitoringService / dataFlowOptimizationService.
 */
const shouldRunSimulatedMonitoringTimers = () => {
  if (isTrue(process.env.ENABLE_SIMULATED_MONITORING_TIMERS)) {
    return true;
  }
  if (isFalse(process.env.ENABLE_SIMULATED_MONITORING_TIMERS)) {
    return false;
  }
  if (isTrue(process.env.DISABLE_BACKGROUND_SIMULATION_LOOPS)) {
    return false;
  }
  return !isProduction();
};

/**
 * Placeholder predictive scaling / load balancing / perf loops in agentOptimizationService.
 */
const shouldRunAgentOptimizationBackgroundLoops = () => {
  if (isTrue(process.env.ENABLE_AGENT_OPTIMIZATION_LOOPS)) {
    return true;
  }
  if (isFalse(process.env.ENABLE_AGENT_OPTIMIZATION_LOOPS)) {
    return false;
  }
  if (isTrue(process.env.DISABLE_AGENT_OPTIMIZATION_LOOPS)) {
    return false;
  }
  return !isProduction();
};

/**
 * Cache cleanup and real-time monitoring loops (duplicate detection, carbon monitoring).
 */
const shouldRunMaintenanceTimers = () => {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }
  if (isTrue(process.env.ENABLE_MAINTENANCE_TIMERS)) {
    return true;
  }
  if (isFalse(process.env.ENABLE_MAINTENANCE_TIMERS)) {
    return false;
  }
  return !isProduction();
};

module.exports = {
  shouldRunSimulatedMonitoringTimers,
  shouldRunAgentOptimizationBackgroundLoops,
  shouldRunMaintenanceTimers
};
