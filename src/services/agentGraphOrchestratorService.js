const logger = require('../utils/logger');

class AgentGraphOrchestratorService {
  compileWorkflowGraph(steps = [], graphConfig = {}) {
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error('Workflow graph requires at least one step');
    }

    const nodes = {};
    const dependencySets = {};
    const edgeMap = new Map();
    const rawStepsById = new Map();

    steps.forEach((step, index) => {
      const stepId = step?.stepId;
      if (!stepId) {
        throw new Error(`Workflow step at index ${index} is missing stepId`);
      }
      if (nodes[stepId]) {
        throw new Error(`Duplicate workflow stepId detected: ${stepId}`);
      }

      const dependencies = Array.isArray(step.dependencies)
        ? [...new Set(step.dependencies.filter(Boolean))]
        : [];

      nodes[stepId] = {
        stepId,
        agentId: step.agentId,
        taskType: step.taskType,
        parameters: step.parameters || {},
        conditions: step.conditions || {},
        retryPolicy: step.retryPolicy || {},
        timeout: step.timeout,
        executionMode: step.executionMode || 'graph',
        routes: []
      };
      dependencySets[stepId] = new Set(dependencies);
      rawStepsById.set(stepId, step);

      dependencies.forEach((dependency) => {
        edgeMap.set(`${dependency}->${stepId}:dependency`, {
          from: dependency,
          to: stepId,
          kind: 'dependency'
        });
      });
    });

    Object.entries(dependencySets).forEach(([stepId, dependencySet]) => {
      dependencySet.forEach((dependency) => {
        if (!nodes[dependency]) {
          throw new Error(`Step "${stepId}" references missing dependency "${dependency}"`);
        }
      });
    });

    Object.keys(nodes).forEach((stepId) => {
      const routes = this.extractStepRoutes(rawStepsById.get(stepId));
      nodes[stepId].routes = routes;
    });

    if (Array.isArray(graphConfig?.edges)) {
      graphConfig.edges.forEach((edge) => {
        if (!edge?.from || !edge?.to || !nodes[edge.from]) {
          return;
        }
        nodes[edge.from].routes.push({
          to: edge.to,
          when: edge.when || edge.condition || null,
          default: Boolean(edge.default)
        });
      });
    }

    Object.entries(nodes).forEach(([stepId, node]) => {
      if (!Array.isArray(node.routes)) {
        return;
      }

      node.routes = node.routes
        .filter((route) => route?.to)
        .map((route) => ({
          to: route.to,
          when: route.when || null,
          default: Boolean(route.default)
        }));

      node.routes.forEach((route) => {
        if (!nodes[route.to]) {
          throw new Error(`Step "${stepId}" routes to unknown step "${route.to}"`);
        }
        dependencySets[route.to].add(stepId);
        edgeMap.set(`${stepId}->${route.to}:route`, {
          from: stepId,
          to: route.to,
          kind: 'route',
          when: route.when || null,
          default: route.default
        });
      });
    });

    const dependents = {};
    Object.keys(nodes).forEach((stepId) => {
      dependents[stepId] = new Set();
    });

    Object.entries(dependencySets).forEach(([stepId, dependencySet]) => {
      nodes[stepId].dependencies = [...dependencySet];
      dependencySet.forEach((dependency) => {
        dependents[dependency].add(stepId);
      });
    });

    const dependenciesIndex = {};
    Object.keys(nodes).forEach((stepId) => {
      const dependencies = nodes[stepId].dependencies || [];
      const dependentIds = [...dependents[stepId]];
      nodes[stepId].dependents = dependentIds;
      dependenciesIndex[stepId] = {
        dependencies,
        dependents: dependentIds
      };
    });

    const parallelGroups = this.buildParallelGroups(dependenciesIndex);
    const entryNodes = Object.keys(nodes).filter((stepId) => dependenciesIndex[stepId].dependencies.length === 0);
    const terminalNodes = Object.keys(nodes).filter((stepId) => dependenciesIndex[stepId].dependents.length === 0);

    return {
      nodes,
      edges: Array.from(edgeMap.values()),
      dependenciesIndex,
      entryNodes,
      terminalNodes,
      parallelGroups
    };
  }

  extractStepRoutes(step = {}) {
    const routes = [];
    const conditions = step.conditions || {};

    const routeDefinitions = Array.isArray(conditions.routes) ? conditions.routes : [];
    routeDefinitions.forEach((routeDefinition) => {
      if (typeof routeDefinition === 'string') {
        routes.push({ to: routeDefinition, when: null, default: false });
        return;
      }

      if (!routeDefinition || typeof routeDefinition !== 'object') {
        return;
      }

      routes.push({
        to: routeDefinition.to,
        when: routeDefinition.when || routeDefinition.condition || null,
        default: Boolean(routeDefinition.default)
      });
    });

    const appendNextRoutes = (nextValue) => {
      if (!nextValue) {
        return;
      }
      if (typeof nextValue === 'string') {
        routes.push({ to: nextValue, when: null, default: false });
        return;
      }
      if (Array.isArray(nextValue)) {
        nextValue.forEach((nextStepId) => {
          if (nextStepId) {
            routes.push({ to: nextStepId, when: null, default: false });
          }
        });
      }
    };

    appendNextRoutes(step.next);
    appendNextRoutes(conditions.next);

    return routes;
  }

  buildParallelGroups(dependenciesIndex) {
    const inDegree = {};
    Object.keys(dependenciesIndex).forEach((stepId) => {
      inDegree[stepId] = dependenciesIndex[stepId].dependencies.length;
    });

    let frontier = Object.keys(inDegree).filter((stepId) => inDegree[stepId] === 0).sort();
    const groups = [];
    let processedNodes = 0;

    while (frontier.length > 0) {
      const group = [...frontier];
      groups.push(group);
      processedNodes += group.length;

      const nextFrontier = [];
      group.forEach((stepId) => {
        const dependents = dependenciesIndex[stepId]?.dependents || [];
        dependents.forEach((dependentId) => {
          inDegree[dependentId] -= 1;
          if (inDegree[dependentId] === 0) {
            nextFrontier.push(dependentId);
          }
        });
      });

      frontier = [...new Set(nextFrontier)].sort();
    }

    if (processedNodes !== Object.keys(dependenciesIndex).length) {
      throw new Error('Workflow graph contains a cycle');
    }

    return groups;
  }

  async executeGraph({
    graph,
    initialState = {},
    runNode,
    options = {}
  }) {
    if (!graph || !graph.nodes || Object.keys(graph.nodes).length === 0) {
      throw new Error('A compiled graph is required for execution');
    }
    if (typeof runNode !== 'function') {
      throw new Error('runNode must be a function');
    }

    const startedAt = Date.now();
    let state = this.cloneValue(initialState);
    if (!this.isPlainObject(state)) {
      state = { value: state };
    }
    state.nodeOutputs = this.isPlainObject(state.nodeOutputs) ? state.nodeOutputs : {};

    const nodeStatuses = {};
    const nodeResults = {};
    const routeSelections = {};
    const trace = [];

    Object.keys(graph.nodes).forEach((stepId) => {
      nodeStatuses[stepId] = 'pending';
    });

    const continueOnNodeError = options.continueOnNodeError === true;
    const maxConcurrency = Number.isFinite(options.maxConcurrency) && options.maxConcurrency > 0
      ? Math.floor(options.maxConcurrency)
      : 1;
    let waveCount = 0;
    let aborted = false;

    while (this.hasPendingNodes(nodeStatuses) && !aborted) {
      const readyNodes = this.findReadyNodes(graph, nodeStatuses, routeSelections);
      if (readyNodes.length === 0) {
        break;
      }

      waveCount += 1;

      for (let cursor = 0; cursor < readyNodes.length && !aborted; cursor += maxConcurrency) {
        const batch = readyNodes.slice(cursor, cursor + maxConcurrency);
        const executions = await Promise.all(
          batch.map((stepId) => this.executeNodeWithRetry({
            stepId,
            node: graph.nodes[stepId],
            state,
            runNode,
            defaultNodeTimeoutMs: options.defaultNodeTimeoutMs
          }))
        );

        executions.forEach((executionResult) => {
          const { stepId } = executionResult;
          nodeStatuses[stepId] = executionResult.status;
          nodeResults[stepId] = {
            status: executionResult.status,
            attempts: executionResult.attempts,
            output: executionResult.output,
            error: executionResult.error || null,
            metadata: executionResult.metadata || null
          };

          if (executionResult.status === 'completed') {
            state.nodeOutputs[stepId] = executionResult.output;
            if (executionResult.statePatch) {
              state = this.mergeState(state, executionResult.statePatch);
            }
          }

          if (Array.isArray(executionResult.selectedRoutes)) {
            routeSelections[stepId] = executionResult.selectedRoutes;
          }

          trace.push({
            stepId,
            status: executionResult.status,
            attempts: executionResult.attempts,
            error: executionResult.error || null,
            timestamp: new Date().toISOString()
          });

          if (executionResult.status === 'failed' && !continueOnNodeError) {
            aborted = true;
          }
        });
      }
    }

    const unresolvedNodes = Object.keys(nodeStatuses)
      .filter((stepId) => nodeStatuses[stepId] === 'pending' || nodeStatuses[stepId] === 'running');

    unresolvedNodes.forEach((stepId) => {
      const failedDependencies = (graph.dependenciesIndex[stepId]?.dependencies || [])
        .filter((dependency) => nodeStatuses[dependency] === 'failed');

      nodeStatuses[stepId] = 'skipped';
      nodeResults[stepId] = {
        status: 'skipped',
        attempts: 0,
        output: null,
        error: failedDependencies.length > 0
          ? `Skipped because dependencies failed: ${failedDependencies.join(', ')}`
          : 'Skipped because dependencies were not resolved',
        metadata: {
          failedDependencies
        }
      };

      trace.push({
        stepId,
        status: 'skipped',
        attempts: 0,
        error: nodeResults[stepId].error,
        timestamp: new Date().toISOString()
      });
    });

    const completedCount = Object.values(nodeStatuses).filter((status) => status === 'completed').length;
    const failedCount = Object.values(nodeStatuses).filter((status) => status === 'failed').length;
    const skippedCount = Object.values(nodeStatuses).filter((status) => status === 'skipped').length;
    const durationMs = Date.now() - startedAt;

    return {
      status: failedCount > 0 && !continueOnNodeError ? 'failed' : 'completed',
      finalState: state,
      nodeStatuses,
      nodeResults,
      routeSelections,
      trace,
      metrics: {
        totalNodes: Object.keys(graph.nodes).length,
        completedNodes: completedCount,
        failedNodes: failedCount,
        skippedNodes: skippedCount,
        waves: waveCount,
        durationMs
      }
    };
  }

  findReadyNodes(graph, nodeStatuses, routeSelections) {
    const readyNodes = [];

    Object.keys(graph.nodes).forEach((stepId) => {
      if (nodeStatuses[stepId] !== 'pending') {
        return;
      }

      const dependencies = graph.dependenciesIndex[stepId]?.dependencies || [];
      const isReady = dependencies.every((dependencyId) => {
        const dependencyStatus = nodeStatuses[dependencyId];
        if (dependencyStatus === 'pending' || dependencyStatus === 'running' || dependencyStatus === 'failed') {
          return false;
        }

        const selectedRoutes = routeSelections[dependencyId];
        if (Array.isArray(selectedRoutes)) {
          if (selectedRoutes.length === 0) {
            return false;
          }
          if (!selectedRoutes.includes(stepId)) {
            return false;
          }
        }

        return true;
      });

      if (isReady) {
        readyNodes.push(stepId);
      }
    });

    return readyNodes.sort();
  }

  async executeNodeWithRetry({
    stepId,
    node,
    state,
    runNode,
    defaultNodeTimeoutMs
  }) {
    const runCondition = node.conditions?.runIf;
    if (!this.evaluateCondition(runCondition, state, { stepId, node })) {
      return {
        stepId,
        status: 'skipped',
        attempts: 0,
        output: null,
        statePatch: null,
        metadata: null,
        selectedRoutes: this.selectRoutes(node, state, null),
        error: null
      };
    }

    const maxRetries = Number.isFinite(node.retryPolicy?.maxRetries)
      ? node.retryPolicy.maxRetries
      : 0;
    const retryDelay = Number.isFinite(node.retryPolicy?.retryDelay)
      ? node.retryPolicy.retryDelay
      : 0;
    const timeoutMs = Number.isFinite(node.timeout)
      ? node.timeout
      : (Number.isFinite(defaultNodeTimeoutMs) ? defaultNodeTimeoutMs : null);

    let attempts = 0;
    let lastError = null;

    while (attempts <= maxRetries) {
      attempts += 1;

      try {
        const executionPromise = runNode({
          nodeId: stepId,
          stepId,
          node,
          state,
          attempt: attempts
        });

        const rawResult = timeoutMs && timeoutMs > 0
          ? await this.executeWithTimeout(executionPromise, timeoutMs, stepId)
          : await executionPromise;

        const normalized = this.normalizeNodeExecutionResult(rawResult, stepId);
        const selectedRoutes = this.selectRoutes(node, state, normalized.output);
        const statePatch = this.mergeState({
          lastCompletedNode: stepId,
          nodeOutputs: {
            [stepId]: normalized.output
          }
        }, normalized.statePatch || {});

        return {
          stepId,
          status: 'completed',
          attempts,
          output: normalized.output,
          statePatch,
          metadata: normalized.metadata,
          selectedRoutes,
          error: null
        };
      } catch (error) {
        lastError = error;

        if (attempts <= maxRetries) {
          if (retryDelay > 0) {
            await this.delay(retryDelay);
          }
          continue;
        }
      }
    }

    logger.warn('Graph node execution failed', {
      stepId,
      attempts,
      error: lastError?.message
    });

    return {
      stepId,
      status: 'failed',
      attempts,
      output: null,
      statePatch: null,
      metadata: null,
      selectedRoutes: this.selectRoutes(node, state, null, { error: lastError }),
      error: lastError?.message || 'Unknown graph node execution error'
    };
  }

  normalizeNodeExecutionResult(rawResult, stepId) {
    if (rawResult && typeof rawResult === 'object' &&
      (Object.prototype.hasOwnProperty.call(rawResult, 'output') ||
       Object.prototype.hasOwnProperty.call(rawResult, 'statePatch') ||
       Object.prototype.hasOwnProperty.call(rawResult, 'metadata'))) {
      return {
        output: rawResult.output,
        statePatch: rawResult.statePatch || {},
        metadata: rawResult.metadata || null
      };
    }

    return {
      output: rawResult,
      statePatch: {},
      metadata: null
    };
  }

  selectRoutes(node, state, output, extraContext = {}) {
    const routes = Array.isArray(node.routes) ? node.routes : [];
    if (routes.length === 0) {
      return null;
    }

    const matches = [];
    const defaults = [];

    routes.forEach((route) => {
      if (route.default) {
        defaults.push(route.to);
        return;
      }

      if (!route.when || this.evaluateCondition(route.when, state, {
        output,
        error: extraContext.error,
        node
      })) {
        matches.push(route.to);
      }
    });

    const selected = matches.length > 0 ? matches : defaults;
    return [...new Set(selected.filter(Boolean))];
  }

  evaluateCondition(condition, state, context = {}) {
    if (condition === undefined || condition === null) {
      return true;
    }

    if (typeof condition === 'boolean') {
      return condition;
    }

    if (Array.isArray(condition)) {
      return condition.every((item) => this.evaluateCondition(item, state, context));
    }

    if (typeof condition === 'string') {
      return Boolean(this.resolvePath(condition, state, context));
    }

    if (!this.isPlainObject(condition)) {
      return Boolean(condition);
    }

    if (Array.isArray(condition.all)) {
      return condition.all.every((item) => this.evaluateCondition(item, state, context));
    }

    if (Array.isArray(condition.any)) {
      return condition.any.some((item) => this.evaluateCondition(item, state, context));
    }

    if (Object.prototype.hasOwnProperty.call(condition, 'not')) {
      return !this.evaluateCondition(condition.not, state, context);
    }

    const operator = String(condition.operator || condition.op || 'eq').toLowerCase();
    const left = Object.prototype.hasOwnProperty.call(condition, 'path')
      ? this.resolvePath(condition.path, state, context)
      : (Object.prototype.hasOwnProperty.call(condition, 'leftPath')
        ? this.resolvePath(condition.leftPath, state, context)
        : condition.left);
    const right = Object.prototype.hasOwnProperty.call(condition, 'valuePath')
      ? this.resolvePath(condition.valuePath, state, context)
      : (Object.prototype.hasOwnProperty.call(condition, 'rightPath')
        ? this.resolvePath(condition.rightPath, state, context)
        : (Object.prototype.hasOwnProperty.call(condition, 'value')
          ? condition.value
          : condition.right));

    return this.compareValues(left, right, operator);
  }

  compareValues(left, right, operator) {
    switch (operator) {
      case 'eq':
      case 'equals':
      case '==':
        return left === right;
      case 'ne':
      case 'neq':
      case '!=':
        return left !== right;
      case 'gt':
      case '>':
        return Number(left) > Number(right);
      case 'gte':
      case '>=':
        return Number(left) >= Number(right);
      case 'lt':
      case '<':
        return Number(left) < Number(right);
      case 'lte':
      case '<=':
        return Number(left) <= Number(right);
      case 'in':
        return Array.isArray(right) && right.includes(left);
      case 'not_in':
        return Array.isArray(right) && !right.includes(left);
      case 'contains':
        return (Array.isArray(left) && left.includes(right)) ||
          (typeof left === 'string' && String(left).includes(String(right)));
      case 'exists':
        return left !== undefined && left !== null;
      case 'truthy':
        return Boolean(left);
      case 'falsy':
        return !left;
      case 'starts_with':
        return typeof left === 'string' && typeof right === 'string' && left.startsWith(right);
      case 'ends_with':
        return typeof left === 'string' && typeof right === 'string' && left.endsWith(right);
      default:
        return Boolean(left);
    }
  }

  resolvePath(path, state, context = {}) {
    if (!path || typeof path !== 'string') {
      return undefined;
    }

    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return undefined;
    }

    if (normalizedPath === 'state') {
      return state;
    }
    if (normalizedPath === 'output') {
      return context.output;
    }
    if (normalizedPath === 'error') {
      return context.error;
    }

    let root = state;
    let targetPath = normalizedPath;

    if (normalizedPath.startsWith('state.')) {
      root = state;
      targetPath = normalizedPath.slice('state.'.length);
    } else if (normalizedPath.startsWith('output.')) {
      root = context.output;
      targetPath = normalizedPath.slice('output.'.length);
    } else if (normalizedPath.startsWith('error.')) {
      root = context.error;
      targetPath = normalizedPath.slice('error.'.length);
    } else if (normalizedPath.startsWith('nodeOutputs.')) {
      root = state?.nodeOutputs;
      targetPath = normalizedPath.slice('nodeOutputs.'.length);
    } else if (normalizedPath.startsWith('context.')) {
      root = context;
      targetPath = normalizedPath.slice('context.'.length);
    }

    if (!targetPath) {
      return root;
    }

    return targetPath.split('.').reduce((accumulator, key) => {
      if (accumulator === null || accumulator === undefined) {
        return undefined;
      }
      return accumulator[key];
    }, root);
  }

  hasPendingNodes(nodeStatuses) {
    return Object.values(nodeStatuses).some((status) => status === 'pending' || status === 'running');
  }

  async executeWithTimeout(promise, timeoutMs, stepId) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Graph node timed out after ${timeoutMs}ms: ${stepId}`));
        }, timeoutMs);
      })
    ]);
  }

  async delay(durationMs) {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  mergeState(base, patch) {
    if (!this.isPlainObject(base) || !this.isPlainObject(patch)) {
      return this.cloneValue(patch);
    }

    const merged = { ...base };
    Object.entries(patch).forEach(([key, value]) => {
      if (this.isPlainObject(value) && this.isPlainObject(merged[key])) {
        merged[key] = this.mergeState(merged[key], value);
      } else {
        merged[key] = this.cloneValue(value);
      }
    });

    return merged;
  }

  cloneValue(value) {
    if (value === undefined) {
      return undefined;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      if (Array.isArray(value)) {
        return [...value];
      }
      if (this.isPlainObject(value)) {
        return { ...value };
      }
      return value;
    }
  }

  isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }
}

module.exports = new AgentGraphOrchestratorService();
module.exports.AgentGraphOrchestratorService = AgentGraphOrchestratorService;
