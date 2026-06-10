/**
 * Data Processor Agent Test Script
 * 
 * This script tests the Data Processor Agent with sample transaction data
 * similar to what you'd find in an Excel sheet or bank statement.
 * 
 * Now also supports unstructured SMS-like inputs for mobile-device style testing.
 * 
 * Usage: node src/scripts/testDataProcessor.js
 */

const mongoose = require('mongoose');
const dataProcessorAgent = require('../services/agents/dataProcessorAgent');
require('dotenv').config();

// ==========================================
// PREPROCESSING ADAPTER FOR UNSTRUCTURED INPUTS
// ==========================================
// Converts minimal SMS-like inputs to the format expected by DataProcessorAgent

/**
 * Preprocesses unstructured input into transaction format
 * @param {Object} input - Unstructured input object
 * @param {string} input.text - Raw transaction text (SMS, notification, etc.)
 * @param {string} [input.timestamp] - Optional date string
 * @param {string|number} [input.amount_hint] - Optional amount hint
 * @param {string} [input.vendor_hint] - Optional vendor/sender hint
 * @returns {Object} - Transaction object for DataProcessorAgent
 */
function preprocessUnstructuredInput(input) {
    // Lightweight cleaning of raw text
    const cleanText = (text) => {
        if (!text) return '';
        return text
            .toLowerCase()
            .trim()
            .replace(/[^\w\s₹.,/-]/g, ' ')  // Keep Rs, numbers, basic punctuation
            .replace(/\s+/g, ' ')            // Collapse multiple spaces
            .trim();
    };

    // Extract amount from text if not provided
    const extractAmount = (text, hint) => {
        if (hint !== undefined && hint !== null) {
            const numHint = typeof hint === 'string'
                ? parseFloat(hint.replace(/[^\d.-]/g, ''))
                : hint;
            if (!isNaN(numHint)) return numHint;
        }

        // Try to extract Rs/₹ amount from text
        const patterns = [
            /rs\.?\s*([\d,]+(?:\.\d{2})?)/i,     // Rs.600 or Rs 600
            /₹\s*([\d,]+(?:\.\d{2})?)/,          // ₹600
            /inr\s*([\d,]+(?:\.\d{2})?)/i,       // INR 600
            /amount[:\s]*([\d,]+(?:\.\d{2})?)/i, // amount: 600
            /received\s*([\d,]+(?:\.\d{2})?)/i   // received 600
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return parseFloat(match[1].replace(/,/g, ''));
            }
        }
        return null;
    };

    // Extract date from text or use hint
    const extractDate = (timestamp) => {
        if (!timestamp) return null;
        try {
            const date = new Date(timestamp);
            return isNaN(date.getTime()) ? null : date;
        } catch {
            return null;
        }
    };

    return {
        description: cleanText(input.text),
        amount: extractAmount(input.text, input.amount_hint),
        date: extractDate(input.timestamp),
        vendor: input.vendor_hint || null
    };
}

/**
 * Batch preprocess multiple unstructured inputs
 * @param {Array} inputs - Array of unstructured input objects
 * @returns {Array} - Array of transaction objects
 */
function preprocessBatch(inputs) {
    return inputs.map(preprocessUnstructuredInput);
}

// ==========================================
// SAMPLE UNSTRUCTURED SMS-LIKE INPUTS
// ==========================================
// Based on actual SMS transaction format from the uploaded CSV

const sampleUnstructuredInputs = [
    // Payment/Transaction SMS (Paytm style)
    {
        text: "Received Rs.600.00 in your a/c 91XXX1635 from One97 Communications Limited on 6-5-2022.Ref no: 5C05RA03uMMS. Query? Call 01204456456 -PPBL",
        timestamp: "2022-05-06T19:48:00",
        vendor_hint: "AX-PAYTMB"
    },
    // Recharge notification
    {
        text: "Extra Data, ONLY on Rs.2091 Recharge NOW with Rs299.& get EXTRA 500MB Data Daily, 299.2GB/Day + Unlimited Calls for 28 Days. Click bit.ly/V1Z1NAT",
        timestamp: "2022-05-07T19:48:00",
        vendor_hint: "VP-012223"
    },
    // Food order (Zomato style)
    {
        text: "+91 7098882 is your Zomato verification code. Enjoy :) - 1rqBy/MrHq",
        timestamp: "2022-05-07T19:48:00",
        vendor_hint: "JM-ZOMATO"
    },
    // Electricity bill payment
    {
        text: "Your electricity bill of Rs.2,500 for meter 12345678 has been generated. Due date 15-May-2022. Pay via UPI to avoid late fee.",
        timestamp: "2022-05-07T10:30:00",
        vendor_hint: "MSEDCL"
    },
    // Fuel purchase SMS
    {
        text: "Thank you for fueling at BPCL. Diesel purchase Rs.3,500 Liters: 35.5 Vehicle: MH12AB1234. Visit bfrpoints.com",
        timestamp: "2022-05-08T14:25:00",
        vendor_hint: "BPCL"
    },
    // Water bill
    {
        text: "Water bill Rs.750 for connection 987654 generated. Pay before 20-May to avoid disconnection. -Municipal Corp",
        timestamp: "2022-05-09T09:00:00",
        vendor_hint: "Municipal"
    },
    // Transport/logistics
    {
        text: "Your shipment AWB123456789 has been delivered. Freight charges Rs.1,200 paid via COD. -BlueDart",
        timestamp: "2022-05-10T16:45:00",
        vendor_hint: "BlueDart"
    },
    // Material purchase
    {
        text: "Order confirmed: Steel rods 100kg Rs.15,000 Order#78901. Delivery in 3 days. -TataSteel Dealers",
        timestamp: "2022-05-11T11:20:00",
        vendor_hint: "TataSteel"
    }
];

// ==========================================
// SAMPLE DATA - Like an Excel sheet
// ==========================================
// These are realistic messy transactions that need cleaning and classification

const sampleTransactions = [
    // Energy/Electricity transactions
    { description: "ELECTRICITY BILL - MARCH 2024  ", amount: "₹15,000.00", date: "2024-03-15", vendor: "MSEDCL  Mumbai" },
    { description: "Power bill payment - office", amount: 12500.50, date: "15-Mar-2024", vendor: "Tata Power Ltd." },

    // Fuel transactions
    { description: "DIESEL FUEL FOR GENERATOR ***", amount: "8000", date: "2024-03-10", vendor: "BPCL Petrol Pump" },
    { description: "petrol - company vehicle  fleet", amount: 5500, date: "2024-03-12", vendor: "HP Fuel Station" },
    { description: "CNG Gas Refill - Delivery Van", amount: 2000, date: "2024-03-14", vendor: "Indraprastha Gas" },

    // Water transactions
    { description: "Monthly water bill", amount: 3500, date: "2024-03-01", vendor: "Municipal Corporation Water Supply" },
    { description: "WATER TANKER SUPPLY  ", amount: 4500, date: "2024-03-20", vendor: "ABC Water Suppliers" },

    // Transportation
    { description: "Freight charges - 200 km transport", amount: 25000, date: "2024-03-08", vendor: "Blue Dart Logistics" },
    { description: "Shipping cost - export delivery", amount: 45000, date: "2024-03-18", vendor: "DHL Express" },
    { description: "truck rental - material transport", amount: 8000, date: "2024-03-22", vendor: "Local Transport Services" },

    // Raw Materials
    { description: "Steel rods purchase - 500 kg", amount: 75000, date: "2024-03-05", vendor: "Tata Steel Distributors" },
    { description: "Aluminum sheets - 100 units", amount: 42000, date: "2024-03-07", vendor: "Hindalco Metals" },
    { description: "Plastic raw material pellets", amount: 35000, date: "2024-03-09", vendor: "RIL Polymers" },
    { description: "Wood planks - furniture unit", amount: 18000, date: "2024-03-11", vendor: "Green Timber Co." },
    { description: "Paper and packaging material!!!", amount: 8500, date: "2024-03-13", vendor: "ITC Paperboards" },

    // Equipment & Maintenance
    { description: "New compressor machine purchase", amount: 125000, date: "2024-03-02", vendor: "Atlas Copco India" },
    { description: "EQUIPMENT MAINTENANCE - annual service", amount: 15000, date: "2024-03-25", vendor: "Service Pro Engineers" },
    { description: "machine repair & overhaul", amount: 22000, date: "2024-03-28", vendor: "Local Repair Shop" },

    // Waste Management
    { description: "Waste disposal - monthly", amount: 5500, date: "2024-03-30", vendor: "Clean City Waste Management" },
    { description: "RECYCLING PICKUP SERVICE", amount: 2500, date: "2024-03-29", vendor: "Eco Recyclers" },
    { description: "Hazardous waste disposal - chemicals", amount: 12000, date: "2024-03-31", vendor: "Safe Disposal Inc." },

    // Renewable/Green
    { description: "Solar panel maintenance", amount: 8000, date: "2024-03-15", vendor: "Green Energy Corp" },
    { description: "Wind energy subscription", amount: 5000, date: "2024-03-01", vendor: "Sustainable Solutions" },

    // Miscellaneous/Office
    { description: "Office supplies - general", amount: 3500, date: "2024-03-10", vendor: "Amazon Business" },
    { description: "Admin expenses - misc", amount: 2000, date: "2024-03-15", vendor: "Petty Cash" },

    // Edge cases
    { description: "", amount: null, date: "", vendor: "" },  // Empty record
    { description: "Unknown transaction #123", amount: 1500, date: "2024-03-20", vendor: "Unknown" },
    { description: "Future dated transaction", amount: 5000, date: "2025-12-31", vendor: "Test Vendor" },
    { description: "Very large amount - verify", amount: 2500000, date: "2024-03-15", vendor: "Large Purchase Corp" }
];

// ==========================================
// COLOR OUTPUT HELPERS
// ==========================================
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    white: '\x1b[37m'
};

const log = (msg, color = 'reset') => console.log(`${colors[color]}${msg}${colors.reset}`);
const divider = () => console.log('─'.repeat(80));
const header = (title) => {
    console.log('\n');
    log('═'.repeat(80), 'cyan');
    log(`  ${title}`, 'bright');
    log('═'.repeat(80), 'cyan');
};

// ==========================================
// TEST RUNNER
// ==========================================

// Test unstructured SMS-like inputs first
async function runUnstructuredTest() {
    header('📱 UNSTRUCTURED SMS INPUT TEST');
    log(`Testing with ${sampleUnstructuredInputs.length} SMS-like inputs\n`, 'white');

    // Preprocess unstructured inputs
    log('🔄 Preprocessing SMS-like inputs...', 'yellow');
    const preprocessedTransactions = preprocessBatch(sampleUnstructuredInputs);

    // Show preprocessing results
    log('\n  Preprocessing Results:', 'bright');
    divider();
    preprocessedTransactions.forEach((tx, i) => {
        const original = sampleUnstructuredInputs[i];
        log(`  ${i + 1}. SMS: "${original.text.substring(0, 50)}..."`, 'white');
        log(`     → description: "${tx.description.substring(0, 50)}..."`, 'cyan');
        log(`     → amount: ${tx.amount !== null ? `₹${tx.amount}` : 'null'}`, 'green');
        log(`     → vendor: ${tx.vendor || 'null'}`, 'magenta');
        console.log();
    });

    // Process through Data Processor Agent
    log('\n📥 Processing through Data Processor Agent...', 'yellow');
    const startTime = Date.now();
    const result = await dataProcessorAgent.processTransactions(preprocessedTransactions);
    const duration = Date.now() - startTime;
    log(`✅ Processing completed in ${duration}ms\n`, 'green');

    // Show classification results
    header('📊 SMS CLASSIFICATION RESULTS');
    log(`  Transactions Classified: ${result.statistics.successfullyClassified}/${result.statistics.totalProcessed}`, 'cyan');
    log(`  Classification Rate: ${((result.statistics.successfullyClassified / result.statistics.totalProcessed) * 100).toFixed(1)}%\n`, 'green');

    // Category breakdown
    const categoryGroups = {};
    result.classified.forEach(tx => {
        const cat = tx.category || 'unknown';
        if (!categoryGroups[cat]) categoryGroups[cat] = [];
        categoryGroups[cat].push(tx);
    });

    log('  Category Breakdown:', 'bright');
    Object.entries(categoryGroups).forEach(([category, txs]) => {
        const icon = {
            'energy': '⚡', 'water': '💧', 'transportation': '🚛',
            'raw_materials': '🏭', 'equipment': '⚙️', 'maintenance': '🔧',
            'waste_management': '🗑️', 'other': '📦', 'unknown': '❓'
        }[category] || '📦';
        log(`    ${icon} ${category}: ${txs.length}`, 'cyan');
    });

    // Show detailed results
    console.log('\n  Detailed Results:');
    divider();
    result.classified.forEach((tx, i) => {
        const original = sampleUnstructuredInputs[i];
        const status = tx.category !== 'unknown' ? '✅' : '⚠️';
        log(`  ${status} SMS #${i + 1} (${original.vendor_hint})`, tx.category !== 'unknown' ? 'green' : 'yellow');
        log(`     Category: ${tx.category || 'unknown'} | Subcategory: ${tx.subcategory || 'none'}`, 'white');
        log(`     Amount: ₹${tx.amount || 0} | Valid: ${result.validated[i]?.isValid ? 'Yes' : 'No'}`, 'cyan');
        console.log();
    });

    return result;
}

async function runTest() {
    console.clear();
    header('🔬 DATA PROCESSOR AGENT - COMPREHENSIVE TEST');
    log(`Started: ${new Date().toISOString()}`, 'cyan');

    try {
        // ========== PART 1: UNSTRUCTURED SMS TEST ==========
        const smsResult = await runUnstructuredTest();

        // ========== PART 2: STRUCTURED TRANSACTION TEST ==========
        header('📋 STRUCTURED TRANSACTION TEST');
        log(`Testing with ${sampleTransactions.length} Excel-like transactions\n`, 'white');

        // Process all transactions
        log('📥 Processing transactions through Data Processor Agent...', 'yellow');
        const startTime = Date.now();
        const result = await dataProcessorAgent.processTransactions(sampleTransactions);
        const duration = Date.now() - startTime;
        log(`✅ Processing completed in ${duration}ms\n`, 'green');

        // ========== STATISTICS ==========
        header('📊 PROCESSING STATISTICS');
        console.log(`
    Total Processed:          ${result.statistics.totalProcessed}
    Successfully Classified:  ${result.statistics.successfullyClassified}
    Enrichment Applied:       ${result.statistics.enrichmentApplied}
    Validation Errors:        ${result.statistics.validationErrors}
    
    Classification Rate:      ${((result.statistics.successfullyClassified / result.statistics.totalProcessed) * 100).toFixed(1)}%
    Enrichment Rate:          ${((result.statistics.enrichmentApplied / result.statistics.totalProcessed) * 100).toFixed(1)}%
    `);

        // ========== CLEANED DATA SAMPLES ==========
        header('🧹 CLEANED DATA (First 5 samples)');
        result.cleaned.slice(0, 5).forEach((tx, i) => {
            divider();
            log(`  Transaction ${i + 1}:`, 'bright');
            log(`    Original: "${sampleTransactions[i].description}"`, 'white');
            log(`    Cleaned:  "${tx.description || '(empty)'}"`, 'green');
            log(`    Amount:   ${sampleTransactions[i].amount} → ${tx.amount}`, 'cyan');
        });

        // ========== CLASSIFICATION RESULTS ==========
        header('🏷️  CLASSIFICATION RESULTS');

        // Group by category
        const categoryGroups = {};
        result.classified.forEach(tx => {
            const cat = tx.category || 'unknown';
            if (!categoryGroups[cat]) categoryGroups[cat] = [];
            categoryGroups[cat].push(tx);
        });

        console.log('\n  Category Breakdown:');
        console.log('  ─────────────────────────────────────────────────');
        Object.entries(categoryGroups).forEach(([category, txs]) => {
            const icon = {
                'energy': '⚡',
                'water': '💧',
                'transportation': '🚛',
                'raw_materials': '🏭',
                'equipment': '⚙️',
                'maintenance': '🔧',
                'waste_management': '🗑️',
                'other': '📦',
                'unknown': '❓'
            }[category] || '📦';

            log(`    ${icon} ${category.toUpperCase()}: ${txs.length} transactions`, 'cyan');
        });

        // Show detailed classification
        console.log('\n  Detailed Classification (First 10):');
        divider();
        result.classified.slice(0, 10).forEach((tx, i) => {
            const confidence = tx.confidence ? (tx.confidence * 100).toFixed(0) : 'N/A';
            log(`    ${i + 1}. "${tx.description?.substring(0, 35)}..."`, 'white');
            log(`       → Category: ${tx.category || 'unknown'} | Subcategory: ${tx.subcategory || 'none'} | Confidence: ${confidence}%`, 'green');
        });

        // ========== VALIDATION RESULTS ==========
        header('✅ VALIDATION RESULTS');

        const validTxs = result.validated.filter(tx => tx.isValid);
        const invalidTxs = result.validated.filter(tx => !tx.isValid);

        log(`\n  Valid Transactions:   ${validTxs.length} ✅`, 'green');
        log(`  Invalid Transactions: ${invalidTxs.length} ❌\n`, 'red');

        if (invalidTxs.length > 0) {
            log('  Validation Errors Found:', 'yellow');
            divider();
            invalidTxs.slice(0, 5).forEach((tx, i) => {
                log(`  ${i + 1}. "${tx.description || '(empty)'}" - Amount: ${tx.amount}`, 'white');
                tx.validationErrors.forEach(err => {
                    log(`      ⚠️  ${err}`, 'red');
                });
            });
        }

        // ========== SUMMARY ==========
        header('📋 FINAL SUMMARY');

        const smsClassified = smsResult.statistics.successfullyClassified;
        const smsTotal = smsResult.statistics.totalProcessed;

        console.log(`
    ┌─────────────────────────────────────────────────────────┐
    │  DATA PROCESSOR AGENT TEST RESULTS                      │
    ├─────────────────────────────────────────────────────────┤
    │  📱 SMS INPUTS                                          │
    │    Total SMS Processed:      ${smsTotal.toString().padStart(3)}                       │
    │    Successfully Classified:  ${smsClassified.toString().padStart(3)}                       │
    │    Classification Rate:      ${((smsClassified / smsTotal) * 100).toFixed(0).padStart(3)}%                      │
    ├─────────────────────────────────────────────────────────┤
    │  📋 STRUCTURED INPUTS                                   │
    │    Total Processed:          ${sampleTransactions.length.toString().padStart(3)}                       │
    │    Successfully Classified:  ${result.statistics.successfullyClassified.toString().padStart(3)}                       │
    │    Valid for Carbon Calc:    ${validTxs.length.toString().padStart(3)}                       │
    │    Classification Rate:      ${((result.statistics.successfullyClassified / result.statistics.totalProcessed) * 100).toFixed(0).padStart(3)}%                      │
    ├─────────────────────────────────────────────────────────┤
    │  Processing Time:            ${duration.toString().padStart(3)}ms                      │
    └─────────────────────────────────────────────────────────┘
    `);

        log('✅ ALL TESTS COMPLETED SUCCESSFULLY!', 'green');
        log(`\nCompleted: ${new Date().toISOString()}\n`, 'cyan');

        return { smsResult, structuredResult: result };

    } catch (error) {
        log(`\n❌ TEST FAILED: ${error.message}`, 'red');
        console.error(error.stack);
        return null;
    }
}

// Run the test
runTest().then(() => {
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
