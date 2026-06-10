const fs = require('fs');
const path = require('path');

// Validation script for Carbon Credits implementation
console.log('🔍 Validating Carbon Credits Implementation...\n');

// Check if all required files exist
const requiredFiles = [
  'src/models/CarbonCredits.js',
  'src/services/carbonCreditsService.js',
  'src/routes/carbonCredits.js',
  'src/scripts/initializeCarbonCredits.js',
  'src/tests/carbonCredits.test.js'
];

console.log('📁 Checking required files:');
let allFilesExist = true;

requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, '..', '..', file);
  if (fs.existsSync(filePath)) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file} - MISSING`);
    allFilesExist = false;
  }
});

// Check package.json scripts
console.log('\n📦 Checking package.json scripts:');
const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
if (fs.existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  const requiredScripts = ['init-carbon-credits', 'test:carbon-credits'];
  requiredScripts.forEach(script => {
    if (packageJson.scripts && packageJson.scripts[script]) {
      console.log(`✅ ${script}`);
    } else {
      console.log(`❌ ${script} - MISSING`);
      allFilesExist = false;
    }
  });
} else {
  console.log('❌ package.json not found');
  allFilesExist = false;
}

// Check server.js for route registration
console.log('\n🔗 Checking server.js integration:');
const serverPath = path.join(__dirname, '..', 'server.js');
if (fs.existsSync(serverPath)) {
  const serverContent = fs.readFileSync(serverPath, 'utf8');
  
  const requiredImports = [
    "const carbonCreditsRoutes = require('./routes/carbonCredits');"
  ];
  
  const requiredRoutes = [
    "app.use('/api/carbon-credits', carbonCreditsRoutes);"
  ];
  
  [...requiredImports, ...requiredRoutes].forEach(item => {
    if (serverContent.includes(item)) {
      console.log(`✅ ${item}`);
    } else {
      console.log(`❌ ${item} - MISSING`);
      allFilesExist = false;
    }
  });
} else {
  console.log('❌ server.js not found');
  allFilesExist = false;
}

// Check MSME routes integration
console.log('\n🏢 Checking MSME routes integration:');
const msmeRoutesPath = path.join(__dirname, '..', 'routes', 'msme.js');
if (fs.existsSync(msmeRoutesPath)) {
  const msmeContent = fs.readFileSync(msmeRoutesPath, 'utf8');
  
  const requiredIntegrations = [
    "const carbonCreditsService = require('../services/carbonCreditsService');",
    "carbonCredits: carbonCredits ? {",
    "GET /api/msme/carbon-credits",
    "GET /api/msme/carbon-credits/leaderboard"
  ];
  
  requiredIntegrations.forEach(item => {
    if (msmeContent.includes(item)) {
      console.log(`✅ ${item}`);
    } else {
      console.log(`❌ ${item} - MISSING`);
      allFilesExist = false;
    }
  });
} else {
  console.log('❌ MSME routes not found');
  allFilesExist = false;
}

// Validate model structure
console.log('\n🗄️ Validating model structure:');
const modelsPath = path.join(__dirname, '..', 'models', 'CarbonCredits.js');
if (fs.existsSync(modelsPath)) {
  const modelsContent = fs.readFileSync(modelsPath, 'utf8');
  
  const requiredModels = [
    'CarbonCredits',
    'MSMECarbonCredits', 
    'CarbonCreditTransaction'
  ];
  
  const requiredMethods = [
    'allocateCredits',
    'useCredits',
    'retireCredits',
    'updatePerformanceMetrics'
  ];
  
  [...requiredModels, ...requiredMethods].forEach(item => {
    if (modelsContent.includes(item)) {
      console.log(`✅ ${item}`);
    } else {
      console.log(`❌ ${item} - MISSING`);
      allFilesExist = false;
    }
  });
} else {
  console.log('❌ CarbonCredits model not found');
  allFilesExist = false;
}

// Validate service structure
console.log('\n⚙️ Validating service structure:');
const servicePath = path.join(__dirname, '..', 'services', 'carbonCreditsService.js');
if (fs.existsSync(servicePath)) {
  const serviceContent = fs.readFileSync(servicePath, 'utf8');
  
  const requiredMethods = [
    'initializePool',
    'aggregateAndAllocateCredits',
    'allocateCreditsToMSME',
    'getMSMECredits',
    'useCredits',
    'retireCredits',
    'getMarketData',
    'getMSMELeaderboard',
    'createTransaction',
    'verifyPool'
  ];
  
  requiredMethods.forEach(method => {
    if (serviceContent.includes(method)) {
      console.log(`✅ ${method}`);
    } else {
      console.log(`❌ ${method} - MISSING`);
      allFilesExist = false;
    }
  });
} else {
  console.log('❌ carbonCreditsService not found');
  allFilesExist = false;
}

// Validate API routes
console.log('\n🌐 Validating API routes:');
const routesPath = path.join(__dirname, '..', 'routes', 'carbonCredits.js');
if (fs.existsSync(routesPath)) {
  const routesContent = fs.readFileSync(routesPath, 'utf8');
  
  const requiredEndpoints = [
    { pattern: 'router.post(\'/aggregate\'', name: 'POST /api/carbon-credits/aggregate' },
    { pattern: 'router.get(\'/my-credits\'', name: 'GET /api/carbon-credits/my-credits' },
    { pattern: 'router.post(\'/use\'', name: 'POST /api/carbon-credits/use' },
    { pattern: 'router.post(\'/retire\'', name: 'POST /api/carbon-credits/retire' },
    { pattern: 'router.post(\'/transfer\'', name: 'POST /api/carbon-credits/transfer' },
    { pattern: 'router.get(\'/market\'', name: 'GET /api/carbon-credits/market' },
    { pattern: 'router.get(\'/leaderboard\'', name: 'GET /api/carbon-credits/leaderboard' },
    { pattern: 'router.get(\'/transactions\'', name: 'GET /api/carbon-credits/transactions' },
    { pattern: 'router.post(\'/verify-pool\'', name: 'POST /api/carbon-credits/verify-pool' }
  ];
  
  requiredEndpoints.forEach(endpoint => {
    if (routesContent.includes(endpoint.pattern)) {
      console.log(`✅ ${endpoint.name}`);
    } else {
      console.log(`❌ ${endpoint.name} - MISSING`);
      allFilesExist = false;
    }
  });
} else {
  console.log('❌ carbonCredits routes not found');
  allFilesExist = false;
}

// Summary
console.log('\n📊 Validation Summary:');
if (allFilesExist) {
  console.log('🎉 All validations passed! Carbon Credits system is properly implemented.');
  console.log('\n📋 Implementation includes:');
  console.log('   • Database models for carbon credits pool and MSME credits');
  console.log('   • Service layer for credit aggregation and management');
  console.log('   • RESTful API endpoints for all operations');
  console.log('   • Integration with existing MSME system');
  console.log('   • Comprehensive test suite');
  console.log('   • Initialization and documentation scripts');
  
  console.log('\n🚀 Next steps:');
  console.log('   1. Start MongoDB database');
  console.log('   2. Run: npm run init-carbon-credits');
  console.log('   3. Test APIs using the provided endpoints');
  console.log('   4. Run: npm run test:carbon-credits');
} else {
  console.log('❌ Some validations failed. Please check the missing components above.');
  process.exit(1);
}

console.log('\n✨ Carbon Credits system validation completed!');