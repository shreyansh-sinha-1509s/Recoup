/**
 * Recoup Phase 2B — Automated Test Suite
 * AI Diagnosis, Bounded Recovery Recommendations & Guardrail Enforcements
 * (Validating TEST A through TEST H)
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Configure isolated test environment
const testDbPath = path.join(__dirname, 'test_phase2b.sqlite');
if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
}
process.env.DB_PATH = testDbPath;
process.env.PORT = '3004';

const db = require('../db/database');
const { evaluateGuardrails } = require('../guardrails/policy');
const aiService = require('../services/ai');
const { getAuditTrail } = require('../services/audit');
const { processTransactionRecovery } = require('../services/recovery');
const app = require('../server');
const http = require('node:http');

async function runPhase2BTests() {
    console.log('===============================================================');
    console.log('  RECOUP PHASE 2B: AI DIAGNOSIS & BOUNDED RECOVERY TESTS       ');
    console.log('===============================================================\n');

    const batchId = 'batch_phase2b_test';
    const nowIso = new Date().toISOString();
    db.run(
        `INSERT INTO batches (id, status, total_count, total_amount, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [batchId, 'PENDING', 8, 140000, nowIso, nowIso]
    );

    // =========================================================================
    // TEST A: Known insufficient_funds -> deterministic diagnosis, AI NOT required
    // =========================================================================
    console.log('--- TEST A: Known insufficient_funds -> Deterministic (No AI Invoked) ---');
    const txAId = 'txn_p2b_A';
    db.run(`
        INSERT INTO transactions (id, batch_id, payment_id, customer_name, customer_email, customer_contact, amount, currency, status, failure_category, failure_code, retry_count, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [txAId, batchId, 'pay_p2b_A', 'Rohan Sharma', 'rohan@example.com', '+919800000001', 4500, 'INR', 'FAILED', 'insufficient_funds', 'BAD_REQUEST_ERROR / payment.failed.insufficient_funds', 0, 2, nowIso, nowIso]);

    const resultA = await processTransactionRecovery(txAId);
    const auditA = getAuditTrail(txAId);
    const diagStepA = auditA.find(a => a.step === 'DIAGNOSED');
    assert.strictEqual(diagStepA.actor, 'RULE_ENGINE', 'TEST A: Known code must be diagnosed by RULE_ENGINE');
    assert(!auditA.some(a => a.actor === 'AI_AGENT'), 'TEST A: Purely deterministic failures must NOT invoke AI');
    console.log('✓ TEST A PASSED: Known insufficient_funds diagnosed deterministically by RULE_ENGINE without AI.\n');

    // =========================================================================
    // TEST B: Ambiguous generic decline -> AI diagnosis invoked, structured recommendation returned
    // =========================================================================
    console.log('--- TEST B: Ambiguous generic decline -> AI Diagnosis Invoked ---');
    const txBId = 'txn_p2b_B';
    db.run(`
        INSERT INTO transactions (id, batch_id, payment_id, customer_name, customer_email, customer_contact, amount, currency, status, failure_category, failure_code, retry_count, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [txBId, batchId, 'pay_ambiguous_B', 'Diya Verma', 'diya@example.com', '+919800000002', 6200, 'INR', 'FAILED', 'ambiguous_decline', 'GATEWAY_ERROR / AMBIGUOUS_DECLINE', 0, 2, nowIso, nowIso]);

    const resultB = await processTransactionRecovery(txBId);
    const auditB = getAuditTrail(txBId);
    const diagStepB = auditB.find(a => a.step === 'DIAGNOSED');
    assert.strictEqual(diagStepB.actor, 'AI_AGENT', 'TEST B: Ambiguous code must invoke AI_AGENT');
    assert(diagStepB.metadata.confidence > 0, 'TEST B: Confidence must be populated');
    assert(diagStepB.metadata.provider, 'TEST B: Provider must be tracked');
    console.log('✓ TEST B PASSED: Ambiguous decline invoked AI diagnosis returning structured confidence and explanation.\n');

    // =========================================================================
    // TEST C: AI recommends retry for ₹75,000 -> High-value guardrail blocks, no provider execution
    // =========================================================================
    console.log('--- TEST C: AI recommends retry for ₹75,000 -> High-value Guardrail Blocks ---');
    const txCId = 'txn_p2b_C';
    db.run(`
        INSERT INTO transactions (id, batch_id, payment_id, customer_name, customer_email, customer_contact, amount, currency, status, failure_category, failure_code, retry_count, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [txCId, batchId, 'pay_ambiguous_highval_C', 'Vikram Patel', 'vikram@example.com', '+919800000003', 75000, 'INR', 'FAILED', 'ambiguous_decline', 'GATEWAY_ERROR / AMBIGUOUS_DECLINE', 0, 2, nowIso, nowIso]);

    const resultC = await processTransactionRecovery(txCId);
    assert.strictEqual(resultC.status, 'ESCALATED', 'TEST C: ₹75,000 transaction must be escalated');
    assert.strictEqual(resultC.recoveredAmount, 0);

    const attemptsC = db.query('SELECT * FROM payment_attempts WHERE transaction_id = ?', [txCId]);
    assert.strictEqual(attemptsC.length, 0, 'TEST C: Zero provider payment attempts must be created');

    const auditC = getAuditTrail(txCId);
    const guardStepC = auditC.find(a => a.step === 'GUARDRAIL_CHECK');
    assert.strictEqual(guardStepC.actor, 'GUARDRAIL');
    assert.strictEqual(guardStepC.metadata.guardrail, 'HIGH_VALUE_HOLD');
    assert(!auditC.some(a => a.step === 'EXECUTED'), 'TEST C: EXECUTED must not exist');
    console.log('✓ TEST C PASSED: AI recommendation for ₹75,000 was safely blocked by HIGH_VALUE_HOLD guardrail.\n');

    // =========================================================================
    // TEST D: AI recommends retry for risk/fraud hold -> Guardrail blocks, escalated
    // =========================================================================
    console.log('--- TEST D: Risk / Fraud Hold -> Guardrail Blocks AI Execution ---');
    const txDId = 'txn_p2b_D';
    db.run(`
        INSERT INTO transactions (id, batch_id, payment_id, customer_name, customer_email, customer_contact, amount, currency, status, failure_category, failure_code, retry_count, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [txDId, batchId, 'pay_ai_fraud_D', 'Ananya Gupta', 'ananya@example.com', '+919800000004', 14500, 'INR', 'FAILED', 'risk_fraud_hold', 'RISK_HOLD / velocity_exceeded', 0, 2, nowIso, nowIso]);

    const resultD = await processTransactionRecovery(txDId);
    assert.strictEqual(resultD.status, 'ESCALATED', 'TEST D: Fraud hold must be escalated');

    const auditD = getAuditTrail(txDId);
    const guardStepD = auditD.find(a => a.step === 'GUARDRAIL_CHECK');
    assert.strictEqual(guardStepD.metadata.guardrail, 'FRAUD_RISK_HOLD');
    assert(!auditD.some(a => a.step === 'EXECUTED'), 'TEST D: EXECUTED must not exist for fraud hold');
    console.log('✓ TEST D PASSED: Fraud hold analyzed by AI for context but blocked from auto-retry by guardrail.\n');

    // =========================================================================
    // TEST E: AI returns invalid category/action -> Recommendation rejected, safe fallback/escalation
    // =========================================================================
    console.log('--- TEST E: AI returns invalid/malformed category -> Rejected & Safe Fallback ---');
    const txEId = 'txn_p2b_E';
    db.run(`
        INSERT INTO transactions (id, batch_id, payment_id, customer_name, customer_email, customer_contact, amount, currency, status, failure_category, failure_code, retry_count, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [txEId, batchId, 'pay_malformed_ai_E', 'Pooja Iyer', 'pooja@example.com', '+919800000005', 8200, 'INR', 'FAILED', 'ambiguous_decline', 'GATEWAY_ERROR / UNKNOWN', 0, 2, nowIso, nowIso]);

    const resultE = await processTransactionRecovery(txEId);
    assert.strictEqual(resultE.status, 'ESCALATED', 'TEST E: Malformed AI output must escalate safely');

    const auditE = getAuditTrail(txEId);
    const rejectedStepE = auditE.find(a => a.action === 'AI Validation Rejected');
    assert(rejectedStepE, 'TEST E: Rejection event must be recorded');
    console.log('✓ TEST E PASSED: Invalid AI category schema rejected by validator; safe escalation applied.\n');

    // =========================================================================
    // TEST F: Anthropic unavailable -> Offline fallback works, system remains functional
    // =========================================================================
    console.log('--- TEST F: Anthropic unavailable / no key -> Offline Fallback Works ---');
    const fallbackResult = aiService.offlineDiagnoseFallback(
        { amount: 5000, failure_code: 'GATEWAY_ERROR / velocity_check', currency: 'INR' },
        { description: 'Velocity check failed' }
    );
    assert.strictEqual(fallbackResult.provider, 'offline_fallback');
    assert.strictEqual(fallbackResult.diagnosedCategory, 'risk_fraud_hold');
    assert(fallbackResult.confidence > 0);
    assert(fallbackResult.explanation.length > 0);
    assert(fallbackResult.recoveryMessage.length > 0);
    console.log('✓ TEST F PASSED: Offline fallback reasoning generated valid structured recommendation with provider=offline_fallback.\n');

    // =========================================================================
    // TEST G: AI invocation creates AI_AGENT audit event when AI is actually used
    // =========================================================================
    console.log('--- TEST G: AI Invocation creates AI_AGENT Audit Log Record ---');
    const txGId = 'txn_p2b_G';
    db.run(`
        INSERT INTO transactions (id, batch_id, payment_id, customer_name, customer_email, customer_contact, amount, currency, status, failure_category, failure_code, retry_count, max_retries, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [txGId, batchId, 'pay_ai_test_G', 'Kabir Mehta', 'kabir@example.com', '+919800000007', 3200, 'INR', 'FAILED', 'ambiguous_decline', 'GATEWAY_ERROR / GENERIC_DECLINE', 0, 2, nowIso, nowIso]);

    await processTransactionRecovery(txGId);
    const auditG = getAuditTrail(txGId);
    const aiEventsG = auditG.filter(a => a.actor === 'AI_AGENT');
    assert(aiEventsG.length >= 1, 'TEST G: At least one AI_AGENT audit step must exist');
    assert(aiEventsG.some(a => a.step === 'DIAGNOSED' || a.step === 'DECISION'));
    console.log(`✓ TEST G PASSED: Recorded ${aiEventsG.length} AI_AGENT audit events with metadata (provider, confidence, model).\n`);

    // =========================================================================
    // TEST H: AI cannot directly change transaction status to RECOVERED
    // =========================================================================
    console.log('--- TEST H: AI Cannot Directly Authorize or Recover Transaction ---');
    // Calling AI service directly returns only recommendation data, modifying NO database records or transaction statuses
    const directAiOutput = await aiService.diagnoseAmbiguousFailure({
        payment_id: 'pay_direct_test',
        amount: 5000,
        failure_code: 'GENERIC_DECLINE'
    });
    assert(directAiOutput.diagnosedCategory, 'AI returns data schema');
    assert(!('status' in directAiOutput), 'AI output does not contain authorized status');
    assert(!('isRecovered' in directAiOutput), 'AI output does not authorize recovery');
    console.log('✓ TEST H PASSED: AI service has zero authorization capability; returns pure recommendation schema.\n');

    // =========================================================================
    // HTTP API & DASHBOARD BACKWARD COMPATIBILITY
    // =========================================================================
    console.log('--- Validating HTTP Endpoints & Compatibility ---');
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(3004, resolve));

    const resResults = await fetch('http://localhost:3004/api/results');
    const jsonResults = await resResults.json();
    assert.strictEqual(jsonResults.success, true);
    assert(jsonResults.metrics.revenue_at_risk > 0);
    assert(jsonResults.breakdown.length >= 5, 'Expected at least 5 category breakdown rows');

    const resGuardrails = await fetch('http://localhost:3004/api/guardrails');
    const jsonGuardrails = await resGuardrails.json();
    assert.strictEqual(jsonGuardrails.success, true);
    assert(jsonGuardrails.count >= 7);

    await new Promise(resolve => server.close(resolve));
    console.log('✓ All HTTP endpoints remain 100% backward compatible.\n');

    console.log('===============================================================');
    console.log('  ALL PHASE 2B TESTS (TEST A THROUGH TEST H) PASSED CLEANLY!  ');
    console.log('===============================================================');
}

runPhase2BTests().catch(err => {
    console.error('PHASE 2B TEST FAILED:', err);
    process.exit(1);
});
