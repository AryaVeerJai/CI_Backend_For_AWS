const { getHandler } = require('./agents/registry');
const logger = require('../utils/logger');

/**
 * Shared runtime for executing registered agent handlers with consistent coordination modes.
 */
class OrchestrationRuntimeService {
  async executeRegisteredAgentTasks(tasks = [], options = {}) {
    const {
      mode = 'sequential',
      continueOnError = true,
      passPreviousResults = false
    } = options;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return [];
    }

    const runTask = async (task, previousResults = null) => {
      const agentType = task.type || task.agentType;
      const input = task.input || {};
      const handler = getHandler(agentType);

      if (!handler) {
        return {
          agent: agentType,
          status: 'skipped',
          result: { skipped: true, reason: 'No handler registered' }
        };
      }

      try {
        const enrichedInput = passPreviousResults && previousResults != null
          ? { ...input, previousResults }
          : input;
        const result = await handler({ input: enrichedInput });
        return { agent: agentType, status: 'completed', result };
      } catch (error) {
        logger.warn(`Orchestration runtime agent ${agentType} failed:`, error.message);
        if (!continueOnError) {
          throw error;
        }
        return { agent: agentType, status: 'failed', error: error.message };
      }
    };

    if (mode === 'parallel') {
      return Promise.all(tasks.map((task) => runTask(task)));
    }

    const results = [];
    let previousResults = null;
    for (const task of tasks) {
      const outcome = await runTask(task, previousResults);
      results.push(outcome);
      if (outcome.status === 'completed') {
        previousResults = outcome.result;
      }
    }
    return results;
  }

  async executeCuratedPlan(curatedPlan, { buildTaskInput, continueOnError = true } = {}) {
    const stageResults = [];

    for (const stage of curatedPlan?.stages || []) {
      if (stage.skipped) {
        stageResults.push({
          stage: stage.stage,
          skipped: true,
          skipReason: stage.skipReason || null,
          results: []
        });
        continue;
      }

      const tasks = (stage.agents || []).map((agentType) => ({
        type: agentType,
        input: typeof buildTaskInput === 'function'
          ? buildTaskInput(agentType, stage, curatedPlan)
          : {}
      }));

      const results = await this.executeRegisteredAgentTasks(tasks, {
        mode: stage.coordinationMode || 'sequential',
        continueOnError,
        passPreviousResults: stage.coordinationMode === 'sequential'
      });

      stageResults.push({
        stage: stage.stage,
        coordinationMode: stage.coordinationMode || 'sequential',
        results
      });
    }

    return stageResults;
  }
}

module.exports = new OrchestrationRuntimeService();
