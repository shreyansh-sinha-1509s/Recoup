/**
 * Recoup Deterministic Guardrails Engine
 * 
 * CORE SAFETY PRINCIPLE:
 * AI recommends.
 * Deterministic guardrails authorize.
 * Razorpay executes.
 * 
 * The AI/LLM must NEVER directly authorize a financial action or bypass a guardrail.
 */

const GUARDRAIL_POLICIES = [
    {
        id: 'insufficient_funds',
        name: 'Insufficient funds',
        description: 'Retry after 24 hours, maximum 2 attempts, then move to escalation queue.',
        maxAttempts: 2,
        delayHours: 24,
        allowAutoRetry: true,
        actionType: 'SCHEDULE_RETRY'
    },
    {
        id: 'card_expired',
        name: 'Card expired',
        description: 'Send one alternate payment link, maximum 1 attempt. No auto-retry on the same card.',
        maxAttempts: 1,
        delayHours: 0,
        allowAutoRetry: false,
        actionType: 'SEND_PAYMENT_LINK'
    },
    {
        id: 'bank_technical_decline',
        name: 'Bank technical decline',
        description: 'Immediate retry, maximum 1 attempt, before escalation.',
        maxAttempts: 1,
        delayHours: 0,
        allowAutoRetry: true,
        actionType: 'IMMEDIATE_RETRY'
    },
    {
        id: 'network_timeout',
        name: 'Network timeout',
        description: 'Immediate retry, maximum 1 attempt.',
        maxAttempts: 1,
        delayHours: 0,
        allowAutoRetry: true,
        actionType: 'IMMEDIATE_RETRY'
    },
    {
        id: 'risk_fraud_hold',
        name: 'Risk / fraud hold',
        description: 'Never auto-retried. Routed to human review with full context, no automated action.',
        maxAttempts: 0,
        delayHours: 0,
        allowAutoRetry: false,
        actionType: 'ESCALATE'
    },
    {
        id: 'incentive_cap',
        name: 'Incentive cap',
        description: 'Any discount or incentive offered during recovery is capped at 10% of transaction value.',
        maxDiscountPercent: 10
    },
    {
        id: 'high_value_hold',
        name: 'High-value hold',
        description: 'Transactions above ₹50,000 always route to human review, regardless of category.',
        thresholdAmount: 50000
    }
];

const HIGH_VALUE_THRESHOLD = 50000;

/**
 * Evaluate deterministic guardrails for a transaction recommendation
 * @param {Object} tx - Transaction object
 * @param {Object} recommendation - AI or Rule Engine proposed intervention
 * @returns {Object} Deterministic decision
 */
function evaluateGuardrails(tx, recommendation = {}) {
    const { amount, failure_category, retry_count = 0 } = tx;

    // Guardrail 1: High-Value Hold Check
    if (amount > HIGH_VALUE_THRESHOLD) {
        return {
            decision: 'ESCALATE',
            authorized: false,
            guardrailTriggered: 'HIGH_VALUE_HOLD',
            reason: `Amount ₹${amount.toLocaleString('en-IN')} exceeds ₹${HIGH_VALUE_THRESHOLD.toLocaleString('en-IN')} threshold — routed to human review per policy.`,
            maxRetries: 0,
            currentRetry: retry_count,
            action: 'Escalated — above ₹50,000'
        };
    }

    // Guardrail 2: Risk / Fraud Hold Check
    if (failure_category === 'risk_fraud_hold') {
        return {
            decision: 'ESCALATE',
            authorized: false,
            guardrailTriggered: 'FRAUD_RISK_HOLD',
            reason: 'Risk / fraud hold category is never auto-retried. Routed to human review.',
            maxRetries: 0,
            currentRetry: retry_count,
            action: 'Never auto-retried — human review'
        };
    }

    // Guardrail 3: Insufficient Funds Policy
    if (failure_category === 'insufficient_funds') {
        const maxAttempts = 2;
        if (retry_count >= maxAttempts) {
            return {
                decision: 'ESCALATE',
                authorized: false,
                guardrailTriggered: 'MAX_RETRIES_EXCEEDED',
                reason: `Maximum retry attempts (${maxAttempts}) reached for insufficient funds. Escalating case.`,
                maxRetries: maxAttempts,
                currentRetry: retry_count,
                action: 'Retry limit reached — escalated'
            };
        }

        const nextAttemptNumber = retry_count + 1;
        return {
            decision: 'SCHEDULE_RETRY',
            authorized: true,
            guardrailTriggered: null,
            retryDelayHours: 24,
            maxRetries: maxAttempts,
            currentRetry: nextAttemptNumber,
            reason: `Rule: insufficient_funds → retry in 24h, max ${maxAttempts} attempts. Attempt ${nextAttemptNumber} of ${maxAttempts} authorized.`,
            action: `Retry scheduled +24h (${nextAttemptNumber} of ${maxAttempts})`
        };
    }

    // Guardrail 4: Bank Technical Decline Policy
    if (failure_category === 'bank_technical_decline') {
        const maxAttempts = 1;
        if (retry_count >= maxAttempts) {
            return {
                decision: 'ESCALATE',
                authorized: false,
                guardrailTriggered: 'MAX_RETRIES_EXCEEDED',
                reason: `Maximum retry attempts (${maxAttempts}) reached for bank technical decline.`,
                maxRetries: maxAttempts,
                currentRetry: retry_count,
                action: 'Retry limit reached — escalated'
            };
        }
        return {
            decision: 'ALLOW_RETRY',
            authorized: true,
            guardrailTriggered: null,
            retryDelayHours: 0,
            maxRetries: maxAttempts,
            currentRetry: 1,
            reason: 'Rule: bank_technical_decline → immediate retry authorized, max 1 attempt.',
            action: 'Immediate retry (1 of 1)'
        };
    }

    // Guardrail 5: Network Timeout Policy
    if (failure_category === 'network_timeout') {
        const maxAttempts = 1;
        if (retry_count >= maxAttempts) {
            return {
                decision: 'ESCALATE',
                authorized: false,
                guardrailTriggered: 'MAX_RETRIES_EXCEEDED',
                reason: `Maximum retry attempts (${maxAttempts}) reached for network timeout.`,
                maxRetries: maxAttempts,
                currentRetry: retry_count,
                action: 'Retry limit reached — escalated'
            };
        }
        return {
            decision: 'ALLOW_RETRY',
            authorized: true,
            guardrailTriggered: null,
            retryDelayHours: 0,
            maxRetries: maxAttempts,
            currentRetry: 1,
            reason: 'Rule: network_timeout → immediate retry authorized, max 1 attempt.',
            action: 'Immediate retry (1 of 1)'
        };
    }

    // Guardrail 6: Card Expired Policy
    if (failure_category === 'card_expired') {
        const maxAttempts = 1;
        if (retry_count >= maxAttempts) {
            return {
                decision: 'ESCALATE',
                authorized: false,
                guardrailTriggered: 'MAX_RETRIES_EXCEEDED',
                reason: 'Alternate payment link already sent. Moving to escalation queue.',
                maxRetries: maxAttempts,
                currentRetry: retry_count,
                action: 'Retry limit reached — escalated'
            };
        }
        return {
            decision: 'ALLOW_RETRY',
            authorized: true,
            guardrailTriggered: null,
            retryDelayHours: 0,
            maxRetries: maxAttempts,
            currentRetry: 1,
            reason: 'Rule: card_expired → alternate payment link authorized, max 1 attempt.',
            action: 'Alternate payment link sent (1 of 1)'
        };
    }

    // Guardrail 7: Ambiguous Decline Policy
    if (failure_category === 'ambiguous_decline') {
        return {
            decision: 'ESCALATE',
            authorized: false,
            guardrailTriggered: 'AMBIGUOUS_DECLINE',
            reason: 'Ambiguous failure code routed to human risk review. Automated execution safely blocked.',
            maxRetries: 0,
            currentRetry: retry_count,
            action: 'Ambiguous decline — human review'
        };
    }

    // Fallback default: Escalate unknown failure categories
    return {
        decision: 'ESCALATE',
        authorized: false,
        guardrailTriggered: 'UNKNOWN_CATEGORY',
        reason: `Unknown failure category '${failure_category}'. Guardrail safely blocks automatic retry.`,
        maxRetries: 0,
        currentRetry: retry_count,
        action: 'Blocked by guardrail — human review'
    };
}

module.exports = {
    GUARDRAIL_POLICIES,
    HIGH_VALUE_THRESHOLD,
    evaluateGuardrails
};
