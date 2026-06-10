/**
 * Development Test Script for AI Agents
 * Usage: node src/scripts/devTestAgents.js
 */

const mongoose = require('mongoose');
const AIAgent = require('../models/AIAgent');
const AIWorkflow = require('../models/AIWorkflow');
const aiAgentService = require('../services/aiAgentService');
const carbonAnalyzerAgent = require('../services/agents/carbonAnalyzerAgent');
require('dotenv').config();

// Test transactions with all required fields
const testTransactions = [
    {
        description: 'Electricity Bill',
        amount: 15000,
        category: 'energy',
        subcategory: 'grid',
        date: new Date(),
        sustainability: { isGreen: false, greenScore: 0 }
    },
    {
        description: 'Diesel Fuel for Generator',
        amount: 8000,
        category: 'energy',
        subcategory: 'diesel',
        date: new Date(),
        sustainability: { isGreen: false, greenScore: 0 }
    },
    {
        description: 'Office Supplies Paper',
        amount: 2500,
        category: 'raw_materials',
        subcategory: 'paper',
        date: new Date(),
        sustainability: { isGreen: true, greenScore: 30 }
    },
    {
        description: 'Company Fleet Transportation',
        amount: 5000,
        category: 'transportation',
        subcategory: 'diesel',
        date: new Date(),
        sustainability: { isGreen: false, greenScore: 0 }
    },
    {
        description: 'Water Bill',
        amount: 2000,
        category: 'water',
        date: new Date(),
        sustainability: { isGreen: false, greenScore: 0 }
    }
];

const testMsmeData = {
    _id: new mongoose.Types.ObjectId(),
    companyName: 'Test Manufacturing Co.',
    industry: 'manufacturing',
    numberOfEmployees: 75,
    annualRevenue: 5000000
};

// Logging
const log = (msg, type = 'info') => {
    const colors = { info: '\x1b[36m', success: '\x1b[32m', error: '\x1b[31m', warn: '\x1b[33m', reset: '\x1b[0m' };
    console.log(`${colors[type]}${msg}${colors.reset}`);
};

async function seedAgents() {
    log('\n=== SEEDING AI AGENTS ===', 'info');

    const agentTypes = [
        { name: 'Carbon Analyzer Agent', type: 'carbon_analyzer', description: 'Analyzes carbon footprint', capabilities: ['transaction_analysis', 'emission_calculation'] },
        { name: 'Recommendation Engine Agent', type: 'recommendation_engine', description: 'Generates recommendations', capabilities: ['sustainability_recommendations'] },
        { name: 'Data Processor Agent', type: 'data_processor', description: 'Processes data', capabilities: ['data_cleaning'] },
        { name: 'Anomaly Detector Agent', type: 'anomaly_detector', description: 'Detects anomalies', capabilities: ['pattern_analysis'] }
    ];

    const agents = [];
    for (const agentData of agentTypes) {
        let agent = await AIAgent.findOne({ name: agentData.name });
        if (!agent) {
            agent = await AIAgent.create({
                ...agentData,
                status: 'active',
                isActive: true,
                configuration: { model: 'v1', parameters: {}, thresholds: {} },
                performance: { tasksCompleted: 0, successRate: 100, averageResponseTime: 0, lastActivity: new Date(), errorCount: 0 }
            });
            log(`  Created: ${agent.name}`, 'success');
        } else {
            log(`  Exists: ${agent.name}`, 'warn');
        }
        agents.push(agent);
    }
    return agents;
}

async function seedWorkflow(agents) {
    log('\n=== SEEDING WORKFLOW ===', 'info');

    const carbonAnalyzer = agents.find(a => a.type === 'carbon_analyzer');
    const recommendationEngine = agents.find(a => a.type === 'recommendation_engine');

    let workflow = await AIWorkflow.findOne({ name: 'Test Workflow' });
    if (!workflow) {
        workflow = await AIWorkflow.create({
            name: 'Test Workflow',
            description: 'Test workflow for carbon analysis',
            trigger: { type: 'manual' },
            steps: [
                { stepId: 'step_1', agentId: carbonAnalyzer._id, taskType: 'carbon_analysis', dependencies: [] },
                { stepId: 'step_2', agentId: recommendationEngine._id, taskType: 'generate_recommendations', dependencies: ['step_1'] }
            ],
            status: 'active',
            isActive: true
        });
        log(`  Created workflow: ${workflow.name}`, 'success');
    } else {
        log(`  Workflow exists: ${workflow.name}`, 'warn');
    }
    return workflow;
}

async function testRegisterAgents(agents) {
    log('\n=== TEST 1: REGISTER AGENTS ===', 'info');

    for (const agent of agents) {
        await aiAgentService.registerAgent(agent);
        log(`  Registered: ${agent.name} (${agent.type})`, 'success');
    }
    log(`  Total registered: ${aiAgentService.agents.size}`, 'info');
    return true;
}

async function testCreateTask(agents) {
    log('\n=== TEST 2: CREATE TASK ===', 'info');

    const carbonAnalyzer = agents.find(a => a.type === 'carbon_analyzer');
    const task = await aiAgentService.createTask({
        agentId: carbonAnalyzer._id,
        msmeId: testMsmeData._id,
        taskType: 'carbon_analysis',
        input: { transactions: testTransactions, msmeData: testMsmeData },
        parameters: { includeScope3: true }
    });

    log(`  Task created: ${task.taskId}`, 'success');
    log(`  Status: ${task.status}, Agent: ${task.agentId}`, 'info');
    return task;
}

async function testCarbonAnalyzerDirect() {
    log('\n=== TEST 3: DIRECT CARBON ANALYZER ===', 'info');

    const analysis = await carbonAnalyzerAgent.analyzeTransactions(testTransactions, testMsmeData);

    log(`  Analysis completed`, 'success');
    log(`  Total Emissions: ${analysis.totalEmissions?.toFixed(2) || 'N/A'} kg CO2`, 'info');
    log(`  Categories: ${JSON.stringify(analysis.categoryBreakdown || {})}`, 'info');

    if (analysis.scopeBreakdown) {
        log(`  Scope 1: ${analysis.scopeBreakdown.scope1?.toFixed(2) || 0} kg`, 'info');
        log(`  Scope 2: ${analysis.scopeBreakdown.scope2?.toFixed(2) || 0} kg`, 'info');
        log(`  Scope 3: ${analysis.scopeBreakdown.scope3?.toFixed(2) || 0} kg`, 'info');
    }

    const score = carbonAnalyzerAgent.calculateCarbonScore(analysis, testMsmeData);
    log(`  Carbon Score: ${JSON.stringify(score)}`, 'info');

    const recommendations = carbonAnalyzerAgent.generateRecommendations(analysis, testMsmeData);
    log(`  Recommendations (${recommendations.length}):`, 'info');
    recommendations.slice(0, 3).forEach((r, i) => {
        log(`     ${i + 1}. ${r.title || r.description || JSON.stringify(r)}`, 'info');
    });

    return analysis;
}

async function testSustainabilityAssessment() {
    log('\n=== TEST 4: SUSTAINABILITY ASSESSMENT ===', 'info');

    const carbonData = {
        totalEmissions: 125.5,
        energyUsage: { electricity: 15000, diesel: 500 },
        wasteGenerated: 200,
        waterUsage: 5000
    };

    const assessment = await carbonAnalyzerAgent.assessSustainability(testMsmeData, carbonData);
    log(`  Assessment completed`, 'success');
    log(`  Overall Score: ${assessment.overallScore || 'N/A'}`, 'info');
    log(`  Categories: ${JSON.stringify(assessment.categoryScores || {})}`, 'info');

    return assessment;
}

async function testWorkflowExecution(workflow) {
    log('\n=== TEST 5: WORKFLOW EXECUTION ===', 'info');

    try {
        const execution = await aiAgentService.executeWorkflow(
            workflow._id,
            testMsmeData._id,
            { transactions: testTransactions, msmeData: testMsmeData }
        );

        log(`  Workflow executed: ${execution.executionId}`, 'success');
        log(`  Status: ${execution.status}`, 'info');
        log(`  Steps: ${execution.steps.map(s => `${s.stepId}:${s.status}`).join(', ')}`, 'info');
        return execution;
    } catch (error) {
        log(`  Workflow failed: ${error.message}`, 'error');
        return null;
    }
}

async function testMultiAgentWorkflow(workflow) {
    log('\n=== TEST 6: MULTI-AGENT WORKFLOW ===', 'info');

    try {
        const execution = await aiAgentService.executeMultiAgentWorkflow(
            workflow._id,
            testMsmeData._id,
            { transactions: testTransactions, msmeData: testMsmeData, parallelExecution: true }
        );

        log(`  Multi-agent workflow executed: ${execution.executionId}`, 'success');
        log(`  Status: ${execution.status}`, 'info');
        log(`  Duration: ${execution.duration || 'N/A'}ms`, 'info');
        log(`  Coordination: ${JSON.stringify(execution.coordination || {})}`, 'info');
        return execution;
    } catch (error) {
        log(`  Multi-agent workflow failed: ${error.message}`, 'error');
        return null;
    }
}

// Main
async function main() {
    console.clear();
    log('AI AGENTS DEVELOPMENT TEST SUITE', 'info');
    log('='.repeat(50), 'info');
    log(`Started: ${new Date().toISOString()}`, 'info');

    try {
        log('\n=== CONNECTING TO DATABASE ===', 'info');
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/carbon-intelligence';
        await mongoose.connect(mongoUri);
        log(`  Connected to MongoDB`, 'success');

        const agents = await seedAgents();
        const workflow = await seedWorkflow(agents);

        await testRegisterAgents(agents);
        await testCreateTask(agents);
        await testCarbonAnalyzerDirect();
        await testSustainabilityAssessment();
        await testWorkflowExecution(workflow);
        await testMultiAgentWorkflow(workflow);

        log('\n=== TEST SUMMARY ===', 'info');
        log('  All tests completed!', 'success');

    } catch (error) {
        log(`\nFATAL ERROR: ${error.message}`, 'error');
        console.error(error.stack);
    } finally {
        await mongoose.connection.close();
        log('\n  Database connection closed', 'success');
        log(`Completed: ${new Date().toISOString()}`, 'info');
    }
}

main();
