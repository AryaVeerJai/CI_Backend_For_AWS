jest.mock('../services/carbonCalculationService', () => ({
  calculateTransactionCarbonFootprint: jest.fn().mockReturnValue({
    co2Emissions: 50,
    emissionFactor: 0.5
  }),
  calculateTransactionCarbonFootprintForAgent: jest.fn().mockResolvedValue({
    co2Emissions: 50,
    emissionFactor: 0.5
  }),
  isScope1Emission: jest.fn().mockReturnValue(false),
  isScope2Emission: jest.fn().mockReturnValue(true),
  isScope3Emission: jest.fn().mockReturnValue(false)
}));

const aiAgentService = require('../services/aiAgentService');

// Mock the models
jest.mock('../models/AIAgent', () => {
  return jest.fn().mockImplementation(() => ({
    save: jest.fn().mockResolvedValue(true),
    findById: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn()
  }));
});

jest.mock('../models/AITask', () => {
  return jest.fn().mockImplementation(() => ({
    save: jest.fn().mockResolvedValue(true),
    findById: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn()
  }));
});

jest.mock('../models/AIWorkflow', () => {
  return jest.fn().mockImplementation(() => ({
    save: jest.fn().mockResolvedValue(true),
    findById: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn()
  }));
});

jest.mock('../models/AIExecution', () => {
  return jest.fn().mockImplementation(() => ({
    save: jest.fn().mockResolvedValue(true),
    findById: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn()
  }));
});

const AIAgent = require('../models/AIAgent');
const AITask = require('../models/AITask');
const AIWorkflow = require('../models/AIWorkflow');
const AIExecution = require('../models/AIExecution');

// Mock the logger
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));

describe('AI Agent Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Agent Registration', () => {
    test('should register agent successfully', async () => {
      const agentData = {
        _id: '507f1f77bcf86cd799439011',
        name: 'Test Agent',
        type: 'carbon_analyzer',
        capabilities: ['test_capability'],
        configuration: {},
        status: 'active',
        performance: {}
      };

      await aiAgentService.registerAgent(agentData);

      // Verify agent is registered in the service
      const registeredAgent = aiAgentService.agents.get(agentData._id.toString());
      expect(registeredAgent).toBeDefined();
      expect(registeredAgent.name).toBe(agentData.name);
      expect(registeredAgent.type).toBe(agentData.type);
    });
  });

  describe('Task Creation', () => {
    test("should create task successfully", async () => {
      const taskData = {
        agentId: "507f1f77bcf86cd799439011",
        msmeId: "507f1f77bcf86cd799439012",
        taskType: "carbon_analysis",
        input: { test: "data" }
      };

      // Mock AITask constructor and save
      const mockTask = {
        taskId: "test_task_id",
        ...taskData,
        status: "pending",
        save: jest.fn().mockResolvedValue(true)
      };

      AITask.mockImplementation(() => mockTask);

      const result = await aiAgentService.createTask(taskData);

      expect(result).toBeDefined();
      expect(result.taskId).toBe("test_task_id");
      expect(result.status).toBe("pending");
      expect(mockTask.save).toHaveBeenCalled();
    });
  });

  describe('Workflow Execution', () => {
    test('should execute workflow successfully', async () => {
      const workflowId = '507f1f77bcf86cd799439013';
      const msmeId = '507f1f77bcf86cd799439012';
      const triggerData = { test: 'trigger' };

      const mockWorkflow = {
        _id: workflowId,
        trigger: {
          type: 'manual'
        },
        steps: [
          {
            stepId: 'step1',
            agentId: '507f1f77bcf86cd799439011',
            taskType: 'carbon_analysis'
          }
        ]
      };

      const mockExecution = {
        executionId: 'test_execution_id',
        workflowId,
        msmeId,
        trigger: {
          type: 'manual',
          source: 'api',
          data: triggerData
        },
        steps: [],
        save: jest.fn().mockResolvedValue(true)
      };

      AIWorkflow.findById = jest.fn().mockResolvedValue(mockWorkflow);
      AIExecution.mockImplementation(() => mockExecution);

      const result = await aiAgentService.executeWorkflow(workflowId, msmeId, triggerData);

      expect(result).toBeDefined();
      expect(result.executionId).toBe('test_execution_id');
      expect(mockExecution.save).toHaveBeenCalled();
    });
  });

  describe('Agent Routing', () => {
    test('should route to carbon analyzer agent', async () => {
      const agent = {
        id: '507f1f77bcf86cd799439011',
        type: 'carbon_analyzer'
      };

      const task = {
        input: {
          transactions: [
            {
              category: 'energy',
              amount: 100,
              carbonFootprint: { co2Emissions: 50 }
            }
          ]
        }
      };

      const result = await aiAgentService.routeToAgent(agent, task);

      expect(result).toBeDefined();
      expect(result.totalEmissions).toBe(50);
    });

    test('should route to recommendation engine agent', async () => {
      const agent = {
        id: '507f1f77bcf86cd799439011',
        type: 'recommendation_engine'
      };

      const task = {
        input: {
          carbonData: {
            breakdown: {
              energy: { total: 600 }
            }
          }
        }
      };

      const result = await aiAgentService.routeToAgent(agent, task);

      expect(result).toBeDefined();
      expect(result.recommendations).toBeDefined();
      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    test('should route to data processor agent', async () => {
      const agent = {
        id: '507f1f77bcf86cd799439011',
        type: 'data_processor'
      };

      const task = {
        input: {
          transactions: [
            {
              description: 'Electricity bill payment',
              amount: 1000,
              vendor: 'Power Company'
            }
          ]
        }
      };

      const result = await aiAgentService.routeToAgent(agent, task);

      expect(result).toBeDefined();
      expect(result.cleaned).toBeDefined();
      expect(result.classified).toBeDefined();
      expect(result.enriched).toBeDefined();
      expect(result.validated).toBeDefined();
    });

    test('should route to verified source rag agent', async () => {
      const agent = {
        id: '507f1f77bcf86cd799439011',
        type: 'verified_source_rag'
      };

      const task = {
        input: {
          candidates: [
            {
              text: 'Monthly electricity bill payment',
              parameterType: 'transaction',
              transactionType: 'utility'
            }
          ],
          businessDomain: 'services',
          parameterType: 'transaction',
          transactionType: 'utility'
        }
      };

      const result = await aiAgentService.routeToAgent(agent, task);

      expect(result).toBeDefined();
      expect(result.totalItems).toBe(0);
      expect(result.resolvedItems).toBe(0);
      expect(Array.isArray(result.verifiedSources)).toBe(true);
    });
  });

  describe('Helper Methods', () => {
    test('should generate unique task ID', () => {
      const taskId1 = aiAgentService.generateTaskId();
      const taskId2 = aiAgentService.generateTaskId();

      expect(taskId1).toMatch(/^task_\d+_[a-z0-9]+$/);
      expect(taskId2).toMatch(/^task_\d+_[a-z0-9]+$/);
      expect(taskId1).not.toBe(taskId2);
    });

    test('should generate unique execution ID', () => {
      const executionId1 = aiAgentService.generateExecutionId();
      const executionId2 = aiAgentService.generateExecutionId();

      expect(executionId1).toMatch(/^exec_\d+_[a-z0-9]+$/);
      expect(executionId2).toMatch(/^exec_\d+_[a-z0-9]+$/);
      expect(executionId1).not.toBe(executionId2);
    });

    test('should calculate step order correctly', () => {
      const steps = [
        { stepId: 'step1', dependencies: [] },
        { stepId: 'step2', dependencies: ['step1'] },
        { stepId: 'step3', dependencies: ['step1', 'step2'] }
      ];

      const order = aiAgentService.calculateStepOrder(steps);

      expect(order).toEqual(['step1', 'step2', 'step3']);
    });

    test('should detect circular dependencies', () => {
      const steps = [
        { stepId: 'step1', dependencies: ['step2'] },
        { stepId: 'step2', dependencies: ['step1'] }
      ];

      expect(() => {
        aiAgentService.calculateStepOrder(steps);
      }).toThrow('Circular dependency detected');
    });
  });

  describe('Error Handling', () => {
    test('should handle agent not found error', async () => {
      const agent = null;
      const task = { input: {} };

      await expect(aiAgentService.routeToAgent(agent, task)).rejects.toThrow();
    });

    test('should handle unknown agent type', async () => {
      const agent = {
        id: '507f1f77bcf86cd799439011',
        type: 'unknown_type'
      };
      const task = { input: {} };

      await expect(aiAgentService.routeToAgent(agent, task)).rejects.toThrow('Unknown agent type');
    });
  });
});