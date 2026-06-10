const request = require('supertest');
const AIAgent = require('../models/AIAgent');
const AITask = require('../models/AITask');

jest.mock('../middleware/auth', () => {
  const middleware = (req, res, next) => {
    req.user = {
      role: 'admin',
      msmeId: '507f1f77bcf86cd799439012',
      userId: '507f1f77bcf86cd799439011',
      email: 'admin@test.com'
    };
    next();
  };
  const allow = (req, res, next) => next();
  middleware.requireRole = () => allow;
  middleware.requireMSMEProfile = allow;
  middleware.requireOrganizationProfile = allow;
  middleware.requireOperationalProfile = allow;
  middleware.requireEnterpriseProfile = allow;
  return middleware;
});

const app = require('../server');

// Mock the AI Agent Service
jest.mock('../services/aiAgentService', () => ({
  initialize: jest.fn().mockResolvedValue(true),
  registerAgent: jest.fn().mockResolvedValue(true),
  createTask: jest.fn().mockResolvedValue({
    taskId: 'test_task_123',
    status: 'pending',
    agentId: '507f1f77bcf86cd799439011',
    msmeId: '507f1f77bcf86cd799439012'
  }),
  executeWorkflow: jest.fn().mockResolvedValue({
    executionId: 'test_execution_123',
    status: 'running'
  })
}));

describe('AI Agents API', () => {
  let authToken;
  let testAgent;

  beforeAll(async () => {
    // Create a test agent
    await AIAgent.deleteMany({});
    testAgent = new AIAgent({
      name: 'Test Carbon Analyzer',
      type: 'carbon_analyzer',
      description: 'Test agent for carbon analysis',
      capabilities: ['carbon_analysis'],
      status: 'active',
      isActive: true
    });
    await testAgent.save();
    await new AIAgent({
      name: 'Test Recommendation Engine',
      type: 'recommendation_engine',
      description: 'Test agent for recommendations',
      capabilities: ['recommendation_generation'],
      status: 'active',
      isActive: true
    }).save();
    await new AIAgent({
      name: 'Test Data Processor',
      type: 'data_processor',
      description: 'Test agent for data processing',
      capabilities: ['data_processing'],
      status: 'active',
      isActive: true
    }).save();

    // Mock authentication token
    authToken = 'mock_jwt_token';
  }, 30000);

  afterAll(async () => {
    await AIAgent.deleteMany({});
    await AITask.deleteMany({});
  }, 30000);

  describe('GET /api/ai-agents', () => {
    test('should get all AI agents', async () => {
      const response = await request(app)
        .get('/api/ai-agents')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('should filter agents by type', async () => {
      const response = await request(app)
        .get('/api/ai-agents?type=carbon_analyzer')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.every(agent => agent.type === 'carbon_analyzer')).toBe(true);
    });

    test('should filter agents by status', async () => {
      const response = await request(app)
        .get('/api/ai-agents?status=active')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.every(agent => agent.status === 'active')).toBe(true);
    });
  });

  describe('GET /api/ai-agents/:id', () => {
    test('should get single AI agent', async () => {
      const response = await request(app)
        .get(`/api/ai-agents/${testAgent._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data._id).toBe(testAgent._id.toString());
    });

    test('should return 404 for non-existent agent', async () => {
      const response = await request(app)
        .get('/api/ai-agents/507f1f77bcf86cd799439999')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('AI agent not found');
    });
  });

  describe('POST /api/ai-agents', () => {
    test('should create new AI agent', async () => {
      const agentData = {
        name: 'New Test Agent',
        type: 'recommendation_engine',
        description: 'Test recommendation agent',
        capabilities: ['recommendation_generation'],
        configuration: {
          model: 'test_model',
          parameters: {}
        }
      };

      const response = await request(app)
        .post('/api/ai-agents')
        .set('Authorization', `Bearer ${authToken}`)
        .send(agentData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe(agentData.name);
      expect(response.body.data.type).toBe(agentData.type);
    });

    test('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/ai-agents')
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/ai-agents/:id', () => {
    test('should update AI agent', async () => {
      const updateData = {
        description: 'Updated test agent description',
        configuration: {
          model: 'updated_model'
        }
      };

      const response = await request(app)
        .put(`/api/ai-agents/${testAgent._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.description).toBe(updateData.description);
    });

    test('should return 404 for non-existent agent', async () => {
      const response = await request(app)
        .put('/api/ai-agents/507f1f77bcf86cd799439999')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ description: 'Updated' })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/ai-agents/:id/tasks', () => {
    test('should create task for AI agent', async () => {
      const taskData = {
        taskType: 'carbon_analysis',
        input: { test: 'data' },
        priority: 'high'
      };

      const response = await request(app)
        .post(`/api/ai-agents/${testAgent._id}/tasks`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(taskData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.taskId).toBe('test_task_123');
    });

    test('should return 404 for non-existent agent', async () => {
      const response = await request(app)
        .post('/api/ai-agents/507f1f77bcf86cd799439999/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ taskType: 'test' })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/ai-agents/:id/tasks', () => {
    test('should get tasks for AI agent', async () => {
      const response = await request(app)
        .get(`/api/ai-agents/${testAgent._id}/tasks`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.tasks).toBeDefined();
      expect(response.body.data.pagination).toBeDefined();
    });
  });

  describe('GET /api/ai-agents/:id/performance', () => {
    test('should get AI agent performance metrics', async () => {
      const response = await request(app)
        .get(`/api/ai-agents/${testAgent._id}/performance`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.tasksCompleted).toBeDefined();
      expect(response.body.data.successRate).toBeDefined();
    });

    test('should return 404 for non-existent agent', async () => {
      const response = await request(app)
        .get('/api/ai-agents/507f1f77bcf86cd799439999/performance')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/ai-agents/analyze-carbon', () => {
    test('should create carbon analysis task', async () => {
      const analysisData = {
        transactions: [
          {
            category: 'energy',
            amount: 1000,
            description: 'Electricity bill'
          }
        ],
        msmeData: {
          industry: 'manufacturing',
          employeeCount: 50
        }
      };

      const response = await request(app)
        .post('/api/ai-agents/analyze-carbon')
        .set('Authorization', `Bearer ${authToken}`)
        .send(analysisData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.taskId).toBe('test_task_123');
      expect(response.body.data.status).toBe('pending');
    });

    test('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/ai-agents/analyze-carbon')
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Transactions data is required');
    });
  });

  describe('POST /api/ai-agents/generate-recommendations', () => {
    test('should create recommendation generation task', async () => {
      const recommendationData = {
        carbonData: {
          breakdown: {
            energy: { total: 500 }
          }
        }
      };

      const response = await request(app)
        .post('/api/ai-agents/generate-recommendations')
        .set('Authorization', `Bearer ${authToken}`)
        .send(recommendationData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.taskId).toBe('test_task_123');
    });
  });

  describe('POST /api/ai-agents/process-data', () => {
    test('should create data processing task', async () => {
      const processingData = {
        transactions: [
          {
            description: 'Raw material purchase',
            amount: 5000,
            vendor: 'Material Supplier'
          }
        ]
      };

      const response = await request(app)
        .post('/api/ai-agents/process-data')
        .set('Authorization', `Bearer ${authToken}`)
        .send(processingData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.taskId).toBe('test_task_123');
    });

    test('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/ai-agents/process-data')
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Transactions data is required');
    });
  });
});