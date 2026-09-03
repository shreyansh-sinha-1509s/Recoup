const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { getAuditTrail } = require('../services/audit');

const CATEGORY_LABELS = {
    'insufficient_funds': 'Insufficient funds',
    'bank_technical_decline': 'Bank technical decline',
    'card_expired': 'Card expired',
    'risk_fraud_hold': 'Risk / fraud hold',
    'network_timeout': 'Network timeout',
    'ambiguous_decline': 'Ambiguous decline'
};

function formatStatus(status) {
    const s = (status || '').toUpperCase();
    if (s === 'RECOVERED') return 'recovered';
    if (s === 'ESCALATED') return 'escalated';
    if (s === 'SCHEDULED' || s === 'PENDING') return 'pending';
    return 'failed';
}

/**
 * GET /api/results
 * Returns summary metrics, category breakdown, latest run info, and transactions list
 */
router.get('/', (req, res) => {
    try {
        // Fetch all transactions (or for latest batch if specified)
        const batchId = req.query.batch_id;
        let txSql = `SELECT * FROM transactions`;
        const txParams = [];
        if (batchId) {
            txSql += ` WHERE batch_id = ?`;
            txParams.push(batchId);
        }
        txSql += ` ORDER BY created_at DESC`;

        const transactions = db.query(txSql, txParams);

        // Fetch latest batch info
        const latestBatch = db.get(`SELECT * FROM batches ORDER BY created_at DESC LIMIT 1`);

        // Calculate summary metrics
        let totalAtRisk = 0;
        let totalRecovered = 0;
        let eligibleRevenue = 0;
        let recoveredCases = 0;
        let escalatedCases = 0;
        let pendingCases = 0;
        let failedCases = 0;

        const breakdownMap = {
            'insufficient_funds': { total: 0, recovered: 0, escalated: 0 },
            'bank_technical_decline': { total: 0, recovered: 0, escalated: 0 },
            'card_expired': { total: 0, recovered: 0, escalated: 0 },
            'risk_fraud_hold': { total: 0, recovered: 0, escalated: 0 },
            'network_timeout': { total: 0, recovered: 0, escalated: 0 }
        };

        const ledgerCases = [];

        for (const tx of transactions) {
            totalAtRisk += tx.amount;
            
            // Risk hold is not eligible for auto retry per guardrail
            if (tx.failure_category !== 'risk_fraud_hold' && tx.amount <= 50000) {
                eligibleRevenue += tx.amount;
            }

            if (tx.status === 'RECOVERED') {
                totalRecovered += tx.recovered_amount || tx.amount;
                recoveredCases++;
            } else if (tx.status === 'ESCALATED') {
                escalatedCases++;
            } else if (tx.status === 'SCHEDULED' || tx.status === 'PENDING') {
                pendingCases++;
            } else {
                failedCases++;
            }

            const cat = tx.failure_category || 'insufficient_funds';
            if (!breakdownMap[cat]) {
                breakdownMap[cat] = { total: 0, recovered: 0, escalated: 0 };
            }
            breakdownMap[cat].total++;
            if (tx.status === 'RECOVERED') {
                breakdownMap[cat].recovered++;
            } else if (tx.status === 'ESCALATED') {
                breakdownMap[cat].escalated++;
            }

            // Fetch audit summary for ledger
            const auditRows = db.query(
                `SELECT step, actor, action, result, metadata, timestamp FROM audit_log WHERE transaction_id = ? ORDER BY id ASC`,
                [tx.id]
            );

            const auditSteps = auditRows.map(a => ({
                step: a.step,
                actor: a.actor,
                head: a.action || a.step,
                body: a.result,
                t: a.timestamp,
                metadata: a.metadata ? (typeof a.metadata === 'string' ? JSON.parse(a.metadata) : a.metadata) : {}
            }));

            ledgerCases.push({
                id: tx.payment_id,
                internal_id: tx.id,
                amount: tx.amount,
                cause: CATEGORY_LABELS[tx.failure_category] || tx.failure_category,
                failure_category: tx.failure_category,
                action: tx.action_taken || (tx.status === 'RECOVERED' ? 'Payment recovered' : 'Pending review'),
                status: formatStatus(tx.status),
                raw_status: tx.status,
                recovered: tx.status === 'RECOVERED' ? (tx.recovered_amount || tx.amount) : 0,
                retry_count: tx.retry_count,
                audit: auditSteps
            });
        }

        const recoveryRate = eligibleRevenue > 0
            ? Math.round((totalRecovered / eligibleRevenue) * 1000) / 10
            : (totalAtRisk > 0 ? Math.round((totalRecovered / totalAtRisk) * 1000) / 10 : 0);

        // Format breakdown list
        const breakdownList = Object.keys(breakdownMap).map(key => {
            const item = breakdownMap[key];
            const pct = item.total > 0 ? Math.round((item.recovered / item.total) * 100) : 0;
            return {
                category: key,
                label: CATEGORY_LABELS[key] || key,
                total: item.total,
                recovered: item.recovered,
                escalated: item.escalated,
                percent: pct
            };
        });

        // Latest run text
        let latestRunText = 'No batch runs yet.';
        if (latestBatch) {
            const bDate = new Date(latestBatch.created_at);
            const timeStr = bDate.toTimeString().split(' ')[0].substring(0, 5) + ' IST';
            latestRunText = `${latestBatch.id.replace('_', ' #')} · started ${timeStr} · ${transactions.length} txns · ${Object.keys(breakdownMap).length} categories, ${escalatedCases} escalation queue.`;
        }

        res.json({
            success: true,
            metrics: {
                revenue_at_risk: totalAtRisk,
                recovered_revenue: totalRecovered,
                eligible_revenue: eligibleRevenue,
                recovery_rate: recoveryRate,
                batch_size: transactions.length,
                recovered_cases: recoveredCases,
                escalated_cases: escalatedCases,
                pending_cases: pendingCases,
                failed_cases: failedCases
            },
            breakdown: breakdownList,
            latest_run: {
                batch_id: latestBatch ? latestBatch.id : null,
                text: latestRunText
            },
            cases: ledgerCases
        });
    } catch (err) {
        console.error('Error in GET /api/results:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/results/:id
 * Returns complete case detail including audit trail, attempts, failure reasons
 */
router.get('/:id', (req, res) => {
    try {
        const idParam = req.params.id;
        const tx = db.get(
            `SELECT * FROM transactions WHERE id = ? OR payment_id = ?`,
            [idParam, idParam]
        );

        if (!tx) {
            return res.status(404).json({ success: false, error: 'Transaction not found' });
        }

        const failureReasons = db.query(
            `SELECT * FROM failure_reasons WHERE transaction_id = ? ORDER BY id ASC`,
            [tx.id]
        );

        const interventions = db.query(
            `SELECT * FROM interventions WHERE transaction_id = ? ORDER BY id ASC`,
            [tx.id]
        );

        const paymentAttempts = db.query(
            `SELECT * FROM payment_attempts WHERE transaction_id = ? ORDER BY id ASC`,
            [tx.id]
        );

        const auditTrail = getAuditTrail(tx.id);

        res.json({
            success: true,
            transaction: {
                id: tx.payment_id,
                internal_id: tx.id,
                batch_id: tx.batch_id,
                customer_name: tx.customer_name,
                customer_email: tx.customer_email,
                customer_contact: tx.customer_contact,
                amount: tx.amount,
                currency: tx.currency,
                status: tx.status,
                ui_status: formatStatus(tx.status),
                failure_category: tx.failure_category,
                cause: CATEGORY_LABELS[tx.failure_category] || tx.failure_category,
                failure_code: tx.failure_code,
                retry_count: tx.retry_count,
                max_retries: tx.max_retries,
                action_taken: tx.action_taken,
                recovered_amount: tx.recovered_amount,
                created_at: tx.created_at,
                updated_at: tx.updated_at
            },
            failure_reasons: failureReasons,
            interventions,
            payment_attempts: paymentAttempts,
            audit_trail: auditTrail.map(a => ({
                step: a.step,
                actor: a.actor,
                head: a.action,
                body: a.result,
                t: a.timestamp,
                metadata: a.metadata
            }))
        });
    } catch (err) {
        console.error('Error in GET /api/results/:id:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
