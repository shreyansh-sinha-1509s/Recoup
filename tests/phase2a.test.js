/**
 * Recoup Phase 2A — Dedicated Automated Test Suite
 * Validating the Complete Insufficient Funds Recovery Path (TEST A through TEST F)
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Configure isolated test environment
const testDbPath = path.join(__dirname, 'test_phase2a.sqlite');
if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
}
process.env.DB_PATH = testDbPath;
process.env.PORT = '3003';

const db = require('../db/database');
const { evaluateGuardrails } = require('../guardrails/policy');
const { getAuditTrail } = require('../services/audit');
const { processTransactionRecovery } = require('../services/recovery');
const app = require('../server');
const http = require('node:http');

async function runPhase2ATests() {
    console.log('===============================================================');
    console.log('  RECOUP PHASE 2A: COMPLETE INSUFFICIENT FUNDS RECOVERY TESTS  ');
    console.log('===============================================================\n');

    // Setup Test Batch Header
    const batchId = 'batch_phase2a_test';
    const nowIso = new Date().toISOString();
    db.run(
        `INSERT INTO batches (id, status, total_count, total_amount, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [batchId, 'PENDING', 6, 36000, nowIso, nowIso]
    );

    // =========================================================================
    // TEST A: insufficient_funds, retry_count = 0 -> recovery action allowed
    // =========================================================================
    console.log('--- TEST A: insufficient_funds (retry_count = 0) -> Allowed ---');
    const txAId = 'txn_test_A';
    db.run(`
        INSERT INTO transactions (id, batch_id, payment_id, customer_name, customer_email, customer_contact, amount, currency, status, failure_category, failure_code, retry_count, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [txAId, batchId, 'pay_test_A', 'Aarav Sharma', 'aarav@example.com', '+919800000001', 4500, 'INR', 'FAILED', 'insufficient_funds', 'BAD_REQUEST_ERROR / payment.failed.insufficient_funds', 0, 2, nowIso, nowIso]);

    const txA = db.get('SELECT * FROM transactions WHERE id = ?', [txAId]);
    const guardrailA = evaluateGuardrails(txA);
    assert.strictEqual(guardrailA.authorized, true, 'TEST A: Guardrail should authorize first attempt');
    assert.strictEqual(guardrailA.decision, 'SCHEDULE_RETRY');
    assert.strictEqual(guardrailA.currentRetry, 1);
    assert.strictEqual(guardrailA.retryDelayHours, 24);

    const resultA = await processTransactionRecovery(txAId);
    assert.strictEqual(resultA.status, 'RECOVERED');
    assert.strictEqual(resultA.recoveredAmount, 4500);

    const auditA = getAuditTrail(txAId);
    const stepsA = auditA.map(a => a.step);
    assert(stepsA.includes('GUARDRAIL_CHECK'));
    assert(stepsA.includes('EXECUTED'));
    assert(stepsA.includes('VERIFIED'));
    assert(stepsA.includes('RECOVERED'));
    console.log('✓ TEST A PASSED: First retry (0/2) authorized, scheduled +24h, executed, verified, and recovered.\n');

    // =========================================================================
    // TEST B: insufficient_funds, retry_count = 1 -> second recovery action allowed
    // =========================================================================
    console.log('--- TEST B: insufficient_funds (retry_count = 1) -> Second Action Allowed ---');
    const txBId = 'txn_test_B';
    db.run(`
        INSERT INTO transactions (id, batch_id, payment_id, customer_name, customer_email, customer_contact, amount, currency, status, failure_category, failure_code, retry_count, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [txBId, batchId, 'pay_test_B', 'Diya Verma', 'diya@example.com', '+919800000002', 6200, 'INR', 'FAILED', 'insufficient_funds', 'BAD_REQUEST_ERROR / payment.failed.insufficient_funds', 1, 2, nowIso, nowIso]);

    const txB = db.get('SELECT * FROM transactions WHERE id = ?', [txBId]);
    const guardrailB = evaluateGuardrails(txB);
    assert.strictEqual(guardrailB.authorized, true, 'TEST B: Guardrail should authorize second attempt');
    assert.strictEqual(guardrailB.decision, 'SCHEDULE_RETRY');
    assert.strictEqual(guardrailB.currentRetry, 2);

    const resultB = await processTransactionRecovery(txBId);
    assert.strictEqual(resultB.status, 'RECOVERED');
    assert.strictEqual(resultB.recoveredAmount, 6200);

    const auditB = getAuditTrail(txBId);
    const stepsB = auditB.map(a => a.step);
    assert(stepsB.includes('GUARDRAIL_CHECK'));
    assert(stepsB.includes('EXECUTED'));
    assert(stepsB.includes('VERIFIED'));
    assert(stepsB.includes('RECOVERED'));
    console.log('✓ TEST B PASSED: Second retry (1/2) authorized, executed, verified, and recovered.\n');

    // =========================================================================
    // TEST C: insufficient_funds, retry_count = 2 -> blocked/escalated, no provider action
    // =========================================================================
    console.log('--- TEST C: insufficient_funds (retry_count = 2) -> Blocked/Escalated (No Provider Action) ---');
    const txCId = 'txn_test_C';
    db.run(`
        INSERT INTO transactions (id, batch_id, payment_id, customer_name, customer_email, customer_contact, amount, currency, status, failure_category, failure_code, retry_count, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [txCId, batchId, 'pay_test_C', 'Rohan Patel', 'rohan@example.com', '+919800000003', 3800, 'INR', 'FAILED', 'insufficient_funds', 'BAD_REQUEST_ERROR / payment.failed.insufficient_funds', 2, 2, nowIso, nowIso]);

    const txC = db.get('SELECT * FROM transactions WHERE id = ?', [txCId]);
    const guardrailC = evaluateGuardrails(txC);
    assert.strictEqual(guardrailC.authorized, false, 'TEST C: Guardrail must NOT authorize when retry_count >= 2');
    assert.strictEqual(guardrailC.decision, 'ESCALATE');
    assert.strictEqual(guardrailC.guardrailTriggered, 'MAX_RETRIES_EXCEEDED');

    const resultC = await processTransactionRecovery(txCId);
    assert.strictEqual(resultC.status, 'ESCALATED');
    assert.strictEqual(resultC.recoveredAmount, 0);

    const attemptsC = db.query('SELECT * FROM payment_attempts WHERE transaction_id = ?', [txCId]);
    assert.strictEqual(attemptsC.length, 0, 'TEST C: No provider payment attempt should be created');

    const auditC = getAuditTrail(txCId);
    const stepsC = auditC.map(a => a.step);
    assert(stepsC.includes('GUARDRAIL_CHECK'));
    assert(stepsC.includes('ESCALATED'));
    assert(!stepsC.includes('EXECUTED'), 'TEST C: EXECUTED must not exist in audit trail');
    assert(!stepsC.includes('VERIFIED'), 'TEST C: VERIFIED must not exist in audit trail');
    assert(!stepsC.includes('RECOVERED'), 'TEST C: RECOVERED must not exist in audit trail');
    console.log('✓ TEST C PASSED: Guardrail blocked 3rd attempt before execution. Case safely escalated.\n');

    // =========================================================================
    // TEST D: Provider/test-mode execution fails -> NOT recovered, audit failure, safe escalation/fallback
    // =========================================================================
    console.log('--- TEST D: Provider execution fails -> NOT recovered, audit failure logged, safe fallback ---');
    const txDId = 'txn_test_D';
    db.run(`
        INSERT INTO transactions (id, batch_id, payment_id, customer_name, customer_email, customer_contact, amount, currency, status, failure_category, failure_code, retry_count, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [txDId, batchId, 'pay_exec_fail_D', 'Ananya Iyer', 'ananya@example.com', '+919800000004', 5200, 'INR', 'FAILED', 'insufficient_funds', 'BAD_REQUEST_ERROR / payment.failed.insufficient_funds', 0, 2, nowIso, nowIso]);

    const resultD = await processTransactionRecovery(txDId);
    assert.strictEqual(resultD.status, 'SCHEDULED', 'First execution failure should remain scheduled for next window');
    assert.strictEqual(resultD.recoveredAmount, 0, 'No revenue recovered on execution failure');

    const auditD = getAuditTrail(txDId);
    const execStepD = auditD.find(a => a.step === 'EXECUTED');
    assert(execStepD, 'EXECUTED step must exist');
    assert.strictEqual(execStepD.actor, 'RAZORPAY');
    assert.strictEqual(execStepD.action, 'Execution Failed');
    assert(!auditD.find(a => a.step === 'VERIFIED'), 'VERIFIED step must not run if execution failed');
    assert(!auditD.find(a => a.step === 'RECOVERED'), 'RECOVERED must not exist');
    console.log('✓ TEST D PASSED: Execution dispatch failed, verifier not called, fallback scheduled, revenue=0.\n');

    // =========================================================================
    // TEST E: Execution succeeds -> Verification succeeds -> RECOVERED
    // =========================================================================
    console.log('--- TEST E: Execution succeeds -> Verification succeeds -> RECOVERED ---');
    const txEId = 'txn_test_E';
    db.run(`
        INSERT INTO transactions (id, batch_id, payment_id, customer_name, customer_email, customer_contact, amount, currency, status, failure_category, failure_code, retry_count, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [txEId, batchId, 'pay_success_E', 'Vikram Gupta', 'vikram@example.com', '+919800000005', 7500, 'INR', 'FAILED', 'insufficient_funds', 'BAD_REQUEST_ERROR / payment.failed.insufficient_funds', 0, 2, nowIso, nowIso]);

    const resultE = await processTransactionRecovery(txEId);
    assert.strictEqual(resultE.status, 'RECOVERED');
    assert.strictEqual(resultE.recoveredAmount, 7500);

    const auditE = getAuditTrail(txEId);
    const executedE = auditE.find(a => a.step === 'EXECUTED');
    const verifiedE = auditE.find(a => a.step === 'VERIFIED');
    const recoveredE = auditE.find(a => a.step === 'RECOVERED');
    assert(executedE, 'Executed event missing');
    assert(executedE.result.includes('Retry attempt dispatched via Razorpay Test Mode simulation'), 'EXECUTED result must state Test Mode simulation when mode is RAZORPAY_TEST_MODE');
    assert(verifiedE, 'Verified event missing');
    assert(recoveredE, 'Recovered event missing');
    assert.strictEqual(verifiedE.actor, 'VERIFIER');
    assert.strictEqual(recoveredE.actor, 'SYSTEM');
    console.log('✓ TEST E PASSED: Execution dispatched via Test Mode simulation, verifier confirmed CAPTURED, transaction RECOVERED.\n');

    // =========================================================================
    // TEST F: Execution succeeds -> Verification does NOT confirm payment -> NOT RECOVERED
    // =========================================================================
    console.log('--- TEST F: Execution succeeds -> Verification declines -> NOT RECOVERED ---');
    const txFId = 'txn_test_F';
    // Starting with retry_count = 1 so the failed verification pushes it to max retry limit -> ESCALATED
    db.run(`
        INSERT INTO transactions (id, batch_id, payment_id, customer_name, customer_email, customer_contact, amount, currency, status, failure_category, failure_code, retry_count, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [txFId, batchId, 'pay_verify_fail_F', 'Pooja Deshmukh', 'pooja@example.com', '+919800000006', 8800, 'INR', 'FAILED', 'insufficient_funds', 'BAD_REQUEST_ERROR / payment.failed.insufficient_funds', 1, 2, nowIso, nowIso]);

    const resultF = await processTransactionRecovery(txFId);
    assert.strictEqual(resultF.status, 'ESCALATED', 'Second failed retry verification must escalate');
    assert.strictEqual(resultF.recoveredAmount, 0, 'No revenue should be marked recovered');

    const updatedTxF = db.get('SELECT * FROM transactions WHERE id = ?', [txFId]);
    assert.strictEqual(updatedTxF.status, 'ESCALATED');
    assert.strictEqual(updatedTxF.recovered_amount, 0);

    const auditF = getAuditTrail(txFId);
    const executedF = auditF.find(a => a.step === 'EXECUTED');
    const verifiedF = auditF.find(a => a.step === 'VERIFIED');
    const escalatedF = auditF.find(a => a.step === 'ESCALATED');
    assert(executedF, 'EXECUTED step must exist (dispatch succeeded)');
    assert(verifiedF, 'VERIFIED step must exist (verification checked)');
    assert.strictEqual(verifiedF.actor, 'VERIFIER');
    assert(verifiedF.result.includes('failed') || verifiedF.result.includes('Declined'), 'Verification failure must be noted');
    assert(escalatedF, 'ESCALATED step must exist');
    assert(!auditF.find(a => a.step === 'RECOVERED'), 'CRITICAL: Transaction must NOT be marked RECOVERED');
    console.log('✓ TEST F PASSED: Execution succeeded (pay_retry ref created), verification declined, transaction NOT RECOVERED, safely escalated.\n');

    // =========================================================================
    // TEST HTTP APIs & LIVE METRICS
    // =========================================================================
    console.log('--- Validating Live HTTP APIs & Dynamic Metrics ---');
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(3003, resolve));

    // 1. Check GET /api/results
    const resResults = await fetch('http://localhost:3003/api/results');
    const jsonResults = await resResults.json();
    assert.strictEqual(jsonResults.success, true);
    assert.strictEqual(jsonResults.metrics.revenue_at_risk, 36000, 'Revenue at risk must equal sum of all transactions');
    assert.strictEqual(jsonResults.metrics.eligible_revenue, 36000, 'Eligible revenue must include all retry-eligible cases');
    assert.strictEqual(jsonResults.metrics.recovered_revenue, 18200, 'Recovered revenue must only count verified recovered cases');
    assert.strictEqual(jsonResults.metrics.recovery_rate, 50.6, 'Recovery rate must equal recovered/eligible * 100');
    assert.notStrictEqual(jsonResults.metrics.eligible_revenue, jsonResults.metrics.recovered_revenue, 'Eligible revenue must NOT equal recovered revenue when there are failed/escalated cases');
    assert.strictEqual(jsonResults.metrics.recovered_cases, 3, 'Expected 3 recovered cases');
    assert.strictEqual(jsonResults.metrics.escalated_cases, 2, 'Expected 2 escalated cases (Tx C and Tx F)');
    assert.strictEqual(jsonResults.metrics.pending_cases, 1, 'Expected 1 pending/scheduled case (Tx D)');
    console.log(`✓ Metrics: At Risk=₹${jsonResults.metrics.revenue_at_risk.toLocaleString('en-IN')}, Eligible=₹${jsonResults.metrics.eligible_revenue.toLocaleString('en-IN')}, Recovered=₹${jsonResults.metrics.recovered_revenue.toLocaleString('en-IN')}, Rate=${jsonResults.metrics.recovery_rate}%`);
    console.log(`✓ Metric Cases Breakdown: ${jsonResults.metrics.recovered_cases} Recovered, ${jsonResults.metrics.escalated_cases} Escalated, ${jsonResults.metrics.pending_cases} Pending.`);

    // 2. Check GET /api/results/:id for full chronological audit trail
    const resDetail = await fetch(`http://localhost:3003/api/results/${txEId}`);
    const jsonDetail = await resDetail.json();
    assert.strictEqual(jsonDetail.success, true);
    assert.strictEqual(jsonDetail.transaction.id, 'pay_success_E');
    assert(jsonDetail.audit_trail.length >= 6);
    console.log(`✓ Single Case Audit Trail for ${txEId}:`);
    jsonDetail.audit_trail.forEach(step => {
        console.log(`   [${step.step}] ${step.actor} (${step.t}): ${step.head} -> ${step.body}`);
    });

    // 3. Check GET /api/guardrails
    const resGuardrails = await fetch('http://localhost:3003/api/guardrails');
    const jsonGuardrails = await resGuardrails.json();
    assert.strictEqual(jsonGuardrails.success, true);
    assert.strictEqual(jsonGuardrails.count, 7);
    console.log(`✓ Guardrails API returned ${jsonGuardrails.count} active deterministic policies.`);

    await new Promise(resolve => server.close(resolve));
    console.log('\n===============================================================');
    console.log('  ALL PHASE 2A TESTS (TEST A THROUGH TEST F) PASSED CLEANLY!  ');
    console.log('===============================================================');
}

runPhase2ATests().catch(err => {
    console.error('PHASE 2A TEST FAILED:', err);
    process.exit(1);
});
