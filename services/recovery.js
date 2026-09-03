const db = require('../db/database');
const { evaluateGuardrails } = require('../guardrails/policy');
const razorpayService = require('./razorpay');
const aiService = require('./ai');
const { logAudit } = require('./audit');

/**
 * Process a single failed transaction through the 8-stage Recoup pipeline:
 * Detect -> Diagnose -> Decide -> Guardrail -> Execute -> Verify -> Recover -> Audit
 */
async function processTransactionRecovery(transactionId) {
    const tx = db.get('SELECT * FROM transactions WHERE id = ?', [transactionId]);
    if (!tx) {
        throw new Error(`Transaction ${transactionId} not found`);
    }

    const txId = tx.id;
    const nowIso = new Date().toISOString();

    // 1. DETECT
    logAudit({
        transactionId: txId,
        step: 'DETECTED',
        actor: 'SYSTEM',
        action: 'Payment failure detected',
        result: `Detected failed payment ${tx.payment_id} for ₹${tx.amount.toLocaleString('en-IN')}. Failure code: ${tx.failure_code}.`,
        metadata: { payment_id: tx.payment_id, amount: tx.amount, failure_code: tx.failure_code }
    });

    // 2. DIAGNOSE & 3. DECIDE
    let diagnosedCategory = tx.failure_category;
    let diagnosisExplanation = '';
    let proposedAction = '';
    let confidence = 1.0;
    let isAiUsed = false;

    // Check if this failure requires AI reasoning vs deterministic routing
    const requiresAiDiagnosis = Boolean(
        tx.force_ai_diagnosis ||
        tx.failure_category === 'risk_fraud_hold' ||
        tx.failure_category === 'ambiguous_decline' ||
        (tx.failure_code && (
            tx.failure_code.includes('AMBIGUOUS') ||
            tx.failure_code.includes('GENERIC') ||
            tx.failure_code.includes('RISK_HOLD')
        )) ||
        (tx.payment_id && (
            tx.payment_id.includes('ambiguous') ||
            tx.payment_id.includes('ai_test') ||
            tx.payment_id.includes('malformed_ai')
        ))
    );

    if (requiresAiDiagnosis) {
        isAiUsed = true;
        const rawAiResult = await aiService.diagnoseAmbiguousFailure(tx, { description: tx.failure_code });
        const validation = aiService.validateRecommendation(rawAiResult);

        if (!validation.valid) {
            // Safe failure: AI returned malformed output or invalid category
            diagnosedCategory = 'ambiguous_decline';
            diagnosisExplanation = `AI recommendation rejected: ${validation.reason}. Safe escalation applied.`;
            proposedAction = 'Escalate to human review';
            confidence = 0.5;

            db.run(
                'INSERT INTO failure_reasons (transaction_id, category, code, explanation, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [txId, diagnosedCategory, tx.failure_code, diagnosisExplanation, confidence, nowIso]
            );

            logAudit({
                transactionId: txId,
                step: 'DIAGNOSED',
                actor: 'AI_AGENT',
                action: 'AI Validation Rejected',
                result: diagnosisExplanation,
                metadata: { valid: false, reason: validation.reason }
            });

            logAudit({
                transactionId: txId,
                step: 'DECISION',
                actor: 'RECOVERY_AGENT',
                action: 'Safe Fallback',
                result: proposedAction,
                metadata: { proposedAction, safeFallback: true }
            });
        } else {
            const aiData = validation.sanitized;
            diagnosedCategory = aiData.diagnosedCategory;
            diagnosisExplanation = aiData.explanation;
            proposedAction = aiData.proposedAction;
            confidence = aiData.confidence;

            db.run(
                'INSERT INTO failure_reasons (transaction_id, category, code, explanation, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [txId, diagnosedCategory, tx.failure_code, diagnosisExplanation, confidence, nowIso]
            );

            logAudit({
                transactionId: txId,
                step: 'DIAGNOSED',
                actor: 'AI_AGENT',
                action: 'LLM classification',
                result: diagnosisExplanation,
                metadata: {
                    category: diagnosedCategory,
                    confidence,
                    provider: aiData.provider,
                    model: aiData.provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'offline_fallback'
                }
            });

            logAudit({
                transactionId: txId,
                step: 'DECISION',
                actor: 'AI_AGENT',
                action: 'AI Recommendation',
                result: proposedAction,
                metadata: {
                    proposedAction,
                    timing: aiData.timing,
                    recoveryMessage: aiData.recoveryMessage,
                    provider: aiData.provider
                }
            });
        }
    } else {
        // Deterministic Rule Engine for known categories
        switch (tx.failure_category) {
            case 'insufficient_funds':
                diagnosisExplanation = `Razorpay code ${tx.failure_code} mapped directly — no LLM call needed. Root cause: Insufficient customer account balance.`;
                proposedAction = `Rule: insufficient_funds → retry in 24h, max 2 attempts. Attempt ${tx.retry_count + 1} of 2 recommended.`;
                break;
            case 'bank_technical_decline':
                diagnosisExplanation = `Razorpay code ${tx.failure_code} mapped directly. Root cause: Issuer bank system downtime or network glitch.`;
                proposedAction = 'Rule: bank_technical_decline → immediate retry, max 1 attempt.';
                break;
            case 'card_expired':
                diagnosisExplanation = `Razorpay code ${tx.failure_code} mapped directly. Root cause: Customer card expiry date passed.`;
                proposedAction = 'Rule: card_expired → send alternate payment link, max 1 attempt.';
                break;
            case 'network_timeout':
                diagnosisExplanation = `Razorpay code ${tx.failure_code} mapped directly. Root cause: Gateway session timed out before bank response.`;
                proposedAction = 'Rule: network_timeout → immediate retry, max 1 attempt.';
                break;
            default:
                diagnosedCategory = 'ambiguous_decline';
                diagnosisExplanation = `Unrecognized failure code ${tx.failure_code}.`;
                proposedAction = 'Unknown category → route to human review.';
        }

        db.run(
            'INSERT INTO failure_reasons (transaction_id, category, code, explanation, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [txId, diagnosedCategory, tx.failure_code, diagnosisExplanation, 1.0, nowIso]
        );

        logAudit({
            transactionId: txId,
            step: 'DIAGNOSED',
            actor: 'RULE_ENGINE',
            action: 'Classified',
            result: diagnosisExplanation,
            metadata: { category: diagnosedCategory, code: tx.failure_code, confidence: 1.0 }
        });

        logAudit({
            transactionId: txId,
            step: 'DECISION',
            actor: 'RECOVERY_AGENT',
            action: 'Decision',
            result: proposedAction,
            metadata: { proposedAction }
        });
    }

    // 4. GUARDRAIL (Deterministic authorization - Gatekeeper)
    const guardrailResult = evaluateGuardrails(
        { ...tx, failure_category: diagnosedCategory },
        { proposedAction }
    );

    // Record intervention
    db.run(
        'INSERT INTO interventions (transaction_id, intervention_type, reason, status, created_at) VALUES (?, ?, ?, ?, ?)',
        [txId, guardrailResult.decision, guardrailResult.reason, guardrailResult.authorized ? 'APPROVED' : 'ESCALATED', nowIso]
    );

    if (!guardrailResult.authorized) {
        // Guardrail triggered blockage/escalation
        logAudit({
            transactionId: txId,
            step: 'GUARDRAIL_CHECK',
            actor: 'GUARDRAIL',
            action: 'Guardrail triggered',
            result: guardrailResult.reason,
            metadata: { guardrail: guardrailResult.guardrailTriggered }
        });

        const finalStatus = 'ESCALATED';
        db.run(
            'UPDATE transactions SET status = ?, action_taken = ?, updated_at = ? WHERE id = ?',
            [finalStatus, guardrailResult.action, nowIso, txId]
        );

        logAudit({
            transactionId: txId,
            step: 'ESCALATED',
            actor: 'SYSTEM',
            action: 'Escalated',
            result: `Case safely moved to escalation queue per guardrail policy (${guardrailResult.guardrailTriggered || 'BLOCKED'}).`,
            metadata: { status: finalStatus }
        });

        return {
            id: txId,
            status: finalStatus,
            actionTaken: guardrailResult.action,
            recoveredAmount: 0
        };
    }

    // Guardrail passed
    logAudit({
        transactionId: txId,
        step: 'GUARDRAIL_CHECK',
        actor: 'GUARDRAIL',
        action: 'Guardrail passed',
        result: `Deterministic guardrail authorized action: ${guardrailResult.action}. Retries permitted: ${guardrailResult.currentRetry}/${guardrailResult.maxRetries}.`,
        metadata: { decision: guardrailResult.decision }
    });

    // 5. EXECUTE (Razorpay Test Mode dispatch)
    const attemptNumber = tx.retry_count + 1;
    const executionResult = await razorpayService.executePaymentRetry(tx, attemptNumber);

    if (!executionResult.executed) {
        // Step 5 Failure: Dispatch to provider failed (e.g. gateway timeout)
        db.run(
            `INSERT INTO payment_attempts (transaction_id, attempt_number, action, status, provider_reference, error_code, error_message, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [txId, attemptNumber, guardrailResult.action, 'FAILED', null, executionResult.errorCode || 'GATEWAY_ERROR', executionResult.errorMessage || 'Execution dispatch failed', nowIso]
        );

        logAudit({
            transactionId: txId,
            step: 'EXECUTED',
            actor: 'RAZORPAY',
            action: 'Execution Failed',
            result: `Razorpay retry dispatch failed: ${executionResult.errorMessage || 'Gateway Error'}. Provider Ref: none.`,
            metadata: { error: executionResult.errorMessage, mode: executionResult.mode }
        });

        // Safe fallback: escalate or schedule depending on retry limit
        const newRetryCount = attemptNumber;
        const finalStatus = newRetryCount >= guardrailResult.maxRetries ? 'ESCALATED' : 'SCHEDULED';
        const actionDesc = newRetryCount >= guardrailResult.maxRetries ? 'Execution failed — escalated' : 'Execution failed — retry scheduled';

        db.run(
            `UPDATE transactions 
             SET status = ?, retry_count = ?, action_taken = ?, updated_at = ? 
             WHERE id = ?`,
            [finalStatus, newRetryCount, actionDesc, nowIso, txId]
        );

        logAudit({
            transactionId: txId,
            step: finalStatus === 'ESCALATED' ? 'ESCALATED' : 'FAILED',
            actor: 'SYSTEM',
            action: finalStatus === 'ESCALATED' ? 'Escalated' : 'Retry Scheduled',
            result: `Provider execution failed. Safe fallback applied: ${actionDesc}.`,
            metadata: { finalStatus, retry_count: newRetryCount }
        });

        return {
            id: txId,
            status: finalStatus,
            actionTaken: actionDesc,
            recoveredAmount: 0
        };
    }

    // Step 5 Success: Retry attempt successfully dispatched to provider
    db.run(
        `INSERT INTO payment_attempts (transaction_id, attempt_number, action, status, provider_reference, error_code, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [txId, attemptNumber, guardrailResult.action, 'PENDING', executionResult.providerReference, null, null, nowIso]
    );

    const executionDescription = executionResult.mode === 'RAZORPAY_TEST_API'
        ? `Retry attempt created via Razorpay Test API (/v1/orders). Provider Ref: ${executionResult.providerReference}.`
        : `Retry attempt dispatched via Razorpay Test Mode simulation. Provider Ref: ${executionResult.providerReference}.`;

    logAudit({
        transactionId: txId,
        step: 'EXECUTED',
        actor: 'RAZORPAY',
        action: 'Executed',
        result: executionDescription,
        metadata: { providerRef: executionResult.providerReference, mode: executionResult.mode }
    });

    // 6. VERIFY (Independent check of payment outcome)
    const verification = await razorpayService.verifyPaymentStatus(executionResult.providerReference, tx);

    logAudit({
        transactionId: txId,
        step: 'VERIFIED',
        actor: 'VERIFIER',
        action: 'Verified',
        result: verification.verified
            ? `Razorpay verification confirmed status: ${verification.status}. Payment captured successfully.`
            : `Razorpay verification check failed: ${verification.errorMessage || 'Declined'}.`,
        metadata: { verified: verification.verified, status: verification.status, providerMode: verification.mode }
    });

    // 7. RECOVER or ESCALATE / SCHEDULE
    if (verification.verified) {
        const recoveredAmount = tx.amount;
        const finalStatus = 'RECOVERED';

        db.run(
            `UPDATE transactions 
             SET status = ?, recovered_amount = ?, retry_count = ?, action_taken = ?, updated_at = ? 
             WHERE id = ?`,
            [finalStatus, recoveredAmount, attemptNumber, guardrailResult.action, nowIso, txId]
        );

        db.run(
            `UPDATE payment_attempts 
             SET status = 'SUCCESS' 
             WHERE transaction_id = ? AND attempt_number = ?`,
            [txId, attemptNumber]
        );

        logAudit({
            transactionId: txId,
            step: 'RECOVERED',
            actor: 'SYSTEM',
            action: 'Recovered',
            result: `Payment succeeded on retry #${attemptNumber}. ₹${recoveredAmount.toLocaleString('en-IN')} recovered.`,
            metadata: { recoveredAmount, attemptNumber }
        });

        return {
            id: txId,
            status: finalStatus,
            actionTaken: guardrailResult.action,
            recoveredAmount
        };
    } else {
        // Verification failed
        const newRetryCount = attemptNumber;
        let finalStatus = 'FAILED';
        let actionDesc = guardrailResult.action;

        db.run(
            `UPDATE payment_attempts 
             SET status = 'FAILED', error_code = ?, error_message = ?
             WHERE transaction_id = ? AND attempt_number = ?`,
            [verification.errorCode || 'DECLINED', verification.errorMessage || 'Retry failed', txId, attemptNumber]
        );

        if (newRetryCount >= guardrailResult.maxRetries) {
            finalStatus = 'ESCALATED';
            actionDesc = 'Retry limit reached — escalated';

            db.run(
                `UPDATE transactions 
                 SET status = ?, retry_count = ?, action_taken = ?, updated_at = ? 
                 WHERE id = ?`,
                [finalStatus, newRetryCount, actionDesc, nowIso, txId]
            );

            logAudit({
                transactionId: txId,
                step: 'ESCALATED',
                actor: 'SYSTEM',
                action: 'Guardrail triggered',
                result: `Attempt limit (${guardrailResult.maxRetries}) reached with no payment. Moved to escalation queue — no further automated action taken.`,
                metadata: { finalStatus, retry_count: newRetryCount }
            });
        } else {
            finalStatus = 'SCHEDULED';
            actionDesc = `Retry scheduled +24h (${newRetryCount} of ${guardrailResult.maxRetries})`;

            db.run(
                `UPDATE transactions 
                 SET status = ?, retry_count = ?, action_taken = ?, updated_at = ? 
                 WHERE id = ?`,
                [finalStatus, newRetryCount, actionDesc, nowIso, txId]
            );

            logAudit({
                transactionId: txId,
                step: 'FAILED',
                actor: 'SYSTEM',
                action: 'Retry Pending',
                result: `Attempt ${newRetryCount} failed. Queued for next scheduled recovery attempt.`,
                metadata: { retry_count: newRetryCount }
            });
        }

        return {
            id: txId,
            status: finalStatus,
            actionTaken: actionDesc,
            recoveredAmount: 0
        };
    }
}

/**
 * Run recovery pipeline for a batch or all eligible pending transactions
 */
async function runRecoveryBatch(batchId = null) {
    let querySql = `
        SELECT id FROM transactions 
        WHERE status IN ('FAILED', 'SCHEDULED')
    `;
    const params = [];

    if (batchId) {
        querySql += ' AND batch_id = ?';
        params.push(batchId);
    }

    const txRows = db.query(querySql, params);
    const results = [];

    for (const row of txRows) {
        const result = await processTransactionRecovery(row.id);
        results.push(result);
    }

    return results;
}

module.exports = {
    processTransactionRecovery,
    runRecoveryBatch
};
