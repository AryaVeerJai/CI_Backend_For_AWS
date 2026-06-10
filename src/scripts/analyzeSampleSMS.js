const xlsx = require('xlsx');
const path = require('path');

// Read the sample SMS file
const filePath = path.join(__dirname, '../../samplesms.xlsx');
const wb = xlsx.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(ws);

console.log('=== SAMPLE SMS DATA ANALYSIS ===\n');
console.log('Total rows:', data.length);
console.log('Columns:', Object.keys(data[0] || {}));
console.log('\n--- All SMS samples ---\n');

// Analyze each message and categorize
const categories = {};
const senders = {};

data.forEach((row, i) => {
    const text = (row.text || row.Text || row.TEXT || '').toLowerCase();
    const sender = row.senderAddress || row.SenderAddress || row.sender || '';

    // Track senders
    senders[sender] = (senders[sender] || 0) + 1;

    console.log(`${i + 1}. [${sender}]`);
    console.log(`   ${text}`);

    // Try to identify category
    let category = 'unknown';
    if (text.includes('electricity') || text.includes('power') || text.includes('msedcl') || text.includes('tata power')) {
        category = 'energy_electricity';
    } else if (text.includes('diesel') || text.includes('petrol') || text.includes('fuel') || text.includes('bpcl') || text.includes('hpcl') || text.includes('iocl')) {
        category = 'energy_fuel';
    } else if (text.includes('water') || text.includes('jal')) {
        category = 'water';
    } else if (text.includes('transport') || text.includes('freight') || text.includes('shipping') || text.includes('delivery') || text.includes('courier')) {
        category = 'transportation';
    } else if (text.includes('steel') || text.includes('aluminium') || text.includes('aluminum') || text.includes('plastic') || text.includes('raw material')) {
        category = 'raw_materials';
    } else if (text.includes('waste') || text.includes('disposal') || text.includes('recycl')) {
        category = 'waste_management';
    } else if (text.includes('recharge') || text.includes('prepaid') || text.includes('mobile')) {
        category = 'telecom';
    } else if (text.includes('credited') || text.includes('debited') || text.includes('transfer') || text.includes('upi') || text.includes('imps') || text.includes('neft')) {
        category = 'banking_transaction';
    } else if (text.includes('otp') || text.includes('verification') || text.includes('code')) {
        category = 'otp_verification';
    } else if (text.includes('order') || text.includes('amazon') || text.includes('flipkart') || text.includes('shopping')) {
        category = 'ecommerce';
    } else if (text.includes('zomato') || text.includes('swiggy') || text.includes('food')) {
        category = 'food_delivery';
    }

    categories[category] = (categories[category] || 0) + 1;
    console.log(`   → Category: ${category}`);
    console.log('');
});

console.log('\n=== CATEGORY SUMMARY ===');
Object.entries(categories).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count} messages`);
});

console.log('\n=== SENDER SUMMARY ===');
Object.entries(senders).sort((a, b) => b[1] - a[1]).forEach(([sender, count]) => {
    console.log(`  ${sender}: ${count} messages`);
});
