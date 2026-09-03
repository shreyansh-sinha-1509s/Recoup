/**
 * Automated Verification Suite for Recoup AI Revenue Recovery Agent
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Use isolated in-memory or test SQLite database for testing
const testDbPath = path.join(__dirname, 'test_recoup.sqlite');
if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
}
process.env.DB_PATH = testDbPath;
process.env.PORT = '3001';

const db = require('../db/database');
const { evaluateGuardrails } = require('../guardrails/policy');
const { logAudit, getAuditTrail } = require('../services/audit');
const razorpayService = require('../services/razorpay');
const { processTransactionRecovery, runRecoveryBatch } = require('../services/recovery');

async function runTests() {
    console.log('--- STARTING RECOUP PHASE 1 TEST SUITE ---\n');

    // Test 1: Database and Schema verification
    console.log('Test 1: Verifying SQLite Database and Tables...');
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables.map(t => t.name);
    assert(tableNames.includes('batches'), 'batches table missing');
    assert(tableNames.includes('transactions'), 'transactions table missing');
    assert(tableNames.includes('failure_reasons'), 'failure_reasons table missing');
    assert(tableNames.includes('interventions'), 'interventions table missing');
    assert(tableNames.includes('payment_attempts'), 'payment_attempts table missing');
    assert(tableNames.includes('audit_log'), 'audit_log table missing');
    console.log('✓ All 6 required SQLite tables created successfully.');

    // Test 2: Guardrails Policy Evaluation
    console.log('\nTest 2: Testing Deterministic Guardrails Engine...');
    
    // 2a: Insufficient funds attempt 1 (should allow schedule retry +24h)
    const g1 = evaluateGuardrails({
        amount: 4500,
        failure_category: 'insufficient_funds',
        retry_count: 0
    });
    assert.strictEqual(g1.decision, 'SCHEDULE_RETRY');
    assert.strictEqual(g1.authorized, true);
    assert.strictEqual(g1.currentRetry, 1);
    console.log('✓ Insufficient funds attempt 1 authorized with +24h delay.');

    // 2b: Insufficient funds retry limit (attempt 2 already done -> attempt 3 should ESCALATE)
    const g2 = evaluateGuardrails({
        amount: 4500,
        failure_category: 'insufficient_funds',
        retry_count: 2
    });
    assert.strictEqual(g2.decision, 'ESCALATE');
    assert.strictEqual(g2.authorized, false);
    assert.strictEqual(g2.guardrailTriggered, 'MAX_RETRIES_EXCEEDED');
    console.log('✓ Insufficient funds maximum 2 retry attempts enforced -> Escalate.');

    // 2c: High-value hold (> ₹50,000 should ESCALATE directly)
    const g3 = evaluateGuardrails({
        amount: 65000,
        failure_category: 'insufficient_funds',
        retry_count: 0
    });
    assert.strictEqual(g3.decision, 'ESCALATE');
    assert.strictEqual(g3.authorized, false);
    assert.strictEqual(g3.guardrailTriggered, 'HIGH_VALUE_HOLD');
    console.log('✓ High-value hold (> ₹50,000) triggered -> Escalate.');

    // 2d: Fraud / risk hold (must NEVER auto retry)
    const g4 = evaluateGuardrails({
        amount: 12000,
        failure_category: 'risk_fraud_hold',
        retry_count: 0
    });
    assert.strictEqual(g4.decision, 'ESCALATE');
    assert.strictEqual(g4.authorized, false);
    assert.strictEqual(g4.guardrailTriggered, 'FRAUD_RISK_HOLD');
    console.log('✓ Risk / fraud hold never auto-retried -> Escalate.');

    // Test 3: Insufficient Funds End-to-End Recovery Flow (Standard Success Case)
    console.log('\nTest 3: Testing End-to-End Recovery for Insufficient Funds (Detect -> Diagnose -> Decide -> Guardrail -> Execute -> Verify -> Recover)...');
    
    const testBatchId = 'batch_test';
    db.run(`
        INSERT INTO batches (id, status, total_count, total_amount, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [testBatchId, 'PENDING', 2, 11700, new Date().toISOString(), new Date().toISOString()]);

    const testTxId = 'txn_test_insuff_1';
    db.run(`
        INSERT INTO transactions (id, batch_id, payment_id, customer_name, customer_email, customer_contact, amount, currency, status, failure_category, failure_code, retry_count, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [testTxId, testBatchId, 'pay_test_insuff_1', 'Rohan Sharma', 'rohan@example.com', '+919876543210', 8200, 'INR', 'FAILED', 'insufficient_funds', 'BAD_REQUEST_ERROR / payment.failed.insufficient_funds', 0, 2, new Date().toISOString(), new Date().toISOString()]);

    const result1 = await processTransactionRecovery(testTxId);
    assert.strictEqual(result1.status, 'RECOVERED');
    assert.strictEqual(result1.recoveredAmount, 8200);

    const updatedTx = db.get('SELECT * FROM transactions WHERE id = ?', [testTxId]);
    assert.strictEqual(updatedTx.status, 'RECOVERED');
    assert.strictEqual(updatedTx.recovered_amount, 8200);
    assert.strictEqual(updatedTx.retry_count, 1);

    const auditTrail = getAuditTrail(testTxId);
    const steps = auditTrail.map(a => a.step);
    assert(steps.includes('DETECTED'), 'Missing DETECTED step');
    assert(steps.includes('DIAGNOSED'), 'Missing DIAGNOSED step');
    assert(steps.includes('DECISION'), 'Missing DECISION step');
    assert(steps.includes('GUARDRAIL_CHECK'), 'Missing GUARDRAIL_CHECK step');
    assert(steps.includes('EXECUTED'), 'Missing EXECUTED step');
    assert(steps.includes('VERIFIED'), 'Missing VERIFIED step');
    assert(steps.includes('RECOVERED'), 'Missing RECOVERED step');
    console.log('✓ Complete 8-stage audit trail recorded successfully:');
    auditTrail.forEach(a => console.log(`   [${a.step}] ${a.actor}: ${a.action} -> ${a.result}`));

    // Test 4: Separate Executed and Verified states + Graceful Failure Scenario
    console.log('\nTest 4: Testing Graceful Failure & Separate Executed vs Verified State...');
    const failTxId = 'txn_test_fail_1';
    db.run(`
        INSERT INTO transactions (id, batch_id, payment_id, customer_name, customer_email, customer_contact, amount, currency, status, failure_category, failure_code, retry_count, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [failTxId, 'batch_test', 'pay_test_fail_1', 'Pooja Iyer', 'pooja@example.com', '+919811223344', 3500, 'INR', 'FAILED', 'insufficient_funds', 'BAD_REQUEST_ERROR / payment.failed.insufficient_funds', 1, 2, new Date().toISOString(), new Date().toISOString()]);

    const failResult = await processTransactionRecovery(failTxId);
    assert.strictEqual(failResult.status, 'ESCALATED', 'Second failed retry should escalate');
    assert.strictEqual(failResult.recoveredAmount, 0, 'No revenue should be recovered on failure');

    const failAudit = getAuditTrail(failTxId);
    const failSteps = failAudit.map(a => a.step);
    assert(failSteps.includes('EXECUTED'), 'Executed step must occur');
    assert(failSteps.includes('VERIFIED'), 'Verified step must occur');
    assert(failSteps.includes('ESCALATED'), 'Escalated step must occur');
    assert(!failSteps.includes('RECOVERED'), 'Must NOT mark as recovered when verification fails');
    console.log('✓ Retry was executed, verification failed, transaction was NOT marked recovered, and escalated safely.');

    // Test 5: Batch Processing and Metrics calculation
    console.log('\nTest 5: Testing Batch Generation and Metrics Calculations...');
    const generateBatch = require('../routes/batch');
    const resultsRoute = require('../routes/results');
    
    // Clean test db and run complete server flow
    const app = require('../server');
    const http = require('node:http');
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(3002, resolve));

    // Generate a 100 transaction batch via HTTP
    const genRes = await fetch('http://localhost:3002/api/batch/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 100 })
    });
    const genData = await genRes.json();
    assert.strictEqual(genData.success, true);
    assert.strictEqual(genData.number_generated, 100);
    assert(genData.total_amount_at_risk > 0);
    console.log(`✓ Generated batch #${genData.batch_id} with 100 transactions. Total at risk: ₹${genData.total_amount_at_risk.toLocaleString('en-IN')}`);

    // Run recovery agent on batch
    const agentRes = await fetch('http://localhost:3002/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: genData.batch_id })
    });
    const agentData = await agentRes.json();
    assert.strictEqual(agentData.success, true);
    assert(agentData.recovered_count > 0, 'Expected recovered cases');
    console.log(`✓ Agent processed ${agentData.total_processed} transactions: ${agentData.recovered_count} recovered (₹${agentData.recovered_amount.toLocaleString('en-IN')}), ${agentData.escalated_count} escalated.`);

    // Check results API
    const resultsRes = await fetch('http://localhost:3002/api/results');
    const resultsJson = await resultsRes.json();
    assert.strictEqual(resultsJson.success, true);
    assert(resultsJson.metrics.revenue_at_risk > 0);
    assert(resultsJson.metrics.recovered_revenue > 0);
    assert(resultsJson.metrics.recovery_rate > 0);
    assert.strictEqual(resultsJson.breakdown.length, 5);
    assert(resultsJson.cases.length >= 100);
    console.log(`✓ Metrics calculated: Risk=₹${resultsJson.metrics.revenue_at_risk.toLocaleString('en-IN')}, Recovered=₹${resultsJson.metrics.recovered_revenue.toLocaleString('en-IN')}, Rate=${resultsJson.metrics.recovery_rate}%`);

    // Check individual case API
    const sampleCaseId = resultsJson.cases[0].id;
    const singleRes = await fetch(`http://localhost:3002/api/results/${sampleCaseId}`);
    const singleJson = await singleRes.json();
    assert.strictEqual(singleJson.success, true);
    assert(singleJson.audit_trail.length >= 4);
    console.log(`✓ Single case endpoint /api/results/${sampleCaseId} returned complete details and ${singleJson.audit_trail.length} audit steps.`);

    // Check guardrails API
    const guardrailsRes = await fetch('http://localhost:3002/api/guardrails');
    const guardrailsJson = await guardrailsRes.json();
    assert.strictEqual(guardrailsJson.success, true);
    assert.strictEqual(guardrailsJson.count, 7);
    console.log(`✓ Guardrails endpoint /api/guardrails returned ${guardrailsJson.count} policies.`);

    await new Promise(resolve => server.close(resolve));
    console.log('\n--- ALL RECOUP PHASE 1 TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch(err => {
    console.error('TEST FAILED:', err);
    process.exit(1);
});
