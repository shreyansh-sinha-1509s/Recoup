const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { logAudit } = require('../services/audit');

// Helper to generate realistic Razorpay-style payment IDs
function generatePaymentId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'pay_';
    for (let i = 0; i < 10; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}

// Realistic failed transaction templates
const FAILURE_TEMPLATES = [
    // Insufficient funds (Primary focus of Phase 1)
    {
        category: 'insufficient_funds',
        code: 'BAD_REQUEST_ERROR / payment.failed.insufficient_funds',
        amountRange: [500, 12000],
        weight: 55
    },
    // Bank technical decline
    {
        category: 'bank_technical_decline',
        code: 'GATEWAY_ERROR / bank_technical',
        amountRange: [800, 9500],
        weight: 15
    },
    // Card expired
    {
        category: 'card_expired',
        code: 'BAD_REQUEST_ERROR / card_expired',
        amountRange: [1200, 6000],
        weight: 12
    },
    // Risk / fraud hold
    {
        category: 'risk_fraud_hold',
        code: 'RISK_HOLD / velocity_exceeded',
        amountRange: [5000, 25000],
        weight: 8
    },
    // Network timeout
    {
        category: 'network_timeout',
        code: 'GATEWAY_ERROR / network_timeout',
        amountRange: [400, 4500],
        weight: 8
    },
    // High-value hold test case (> ₹50,000)
    {
        category: 'card_expired',
        code: 'BAD_REQUEST_ERROR / card_expired',
        amountRange: [52000, 85000],
        weight: 2
    }
];

function selectWeightedTemplate() {
    const totalWeight = FAILURE_TEMPLATES.reduce((sum, t) => sum + t.weight, 0);
    let rand = Math.random() * totalWeight;
    for (const t of FAILURE_TEMPLATES) {
        if (rand < t.weight) return t;
        rand -= t.weight;
    }
    return FAILURE_TEMPLATES[0];
}

function getRandomAmount(min, max) {
    const raw = Math.floor(Math.random() * (max - min + 1) + min);
    // Round to nearest 10 or 50 for realistic merchant prices
    return Math.round(raw / 10) * 10;
}

const FIRST_NAMES = ['Aarav', 'Diya', 'Rohan', 'Ananya', 'Vikram', 'Pooja', 'Rahul', 'Neha', 'Kabir', 'Sneha', 'Aditya', 'Meera'];
const LAST_NAMES = ['Sharma', 'Verma', 'Patel', 'Reddy', 'Iyer', 'Gupta', 'Singh', 'Nair', 'Deshmukh', 'Mehta'];

/**
 * POST /api/batch/generate
 * Generates synthetic failed transactions and persists them to SQLite
 */
router.post('/generate', (req, res) => {
    try {
        const count = parseInt(req.body.count, 10) || 100;
        const now = new Date();
        const batchNum = Math.floor(100 + Math.random() * 900);
        const batchId = `batch_${batchNum}`;
        const nowIso = now.toISOString();

        let totalAtRisk = 0;
        const transactionIds = [];
        const txRecords = [];

        for (let i = 0; i < count; i++) {
            const template = selectWeightedTemplate();
            const amount = getRandomAmount(template.amountRange[0], template.amountRange[1]);
            totalAtRisk += amount;

            const paymentId = generatePaymentId();
            const txId = `txn_${paymentId.substring(4)}`;
            const fname = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
            const lname = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
            const customerName = `${fname} ${lname}`;
            const customerEmail = `${fname.toLowerCase()}.${lname.toLowerCase()}${Math.floor(Math.random() * 99)}@example.com`;
            const customerContact = `+9198${Math.floor(10000000 + Math.random() * 90000000)}`;

            txRecords.push({
                id: txId,
                batch_id: batchId,
                payment_id: paymentId,
                customer_name: customerName,
                customer_email: customerEmail,
                customer_contact: customerContact,
                amount,
                currency: 'INR',
                status: 'FAILED',
                failure_category: template.category,
                failure_code: template.code,
                retry_count: 0,
                max_retries: 2,
                created_at: nowIso,
                updated_at: nowIso
            });

            transactionIds.push(txId);
        }

        // Insert batch header
        db.run(
            `INSERT INTO batches (id, status, total_count, total_amount, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [batchId, 'PENDING', count, totalAtRisk, nowIso, nowIso]
        );

        // Insert transactions
        const insertTx = db.getDb().prepare(`
            INSERT INTO transactions (id, batch_id, payment_id, customer_name, customer_email, customer_contact, amount, currency, status, failure_category, failure_code, retry_count, max_retries, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const tx of txRecords) {
            insertTx.run(
                tx.id,
                tx.batch_id,
                tx.payment_id,
                tx.customer_name,
                tx.customer_email,
                tx.customer_contact,
                tx.amount,
                tx.currency,
                tx.status,
                tx.failure_category,
                tx.failure_code,
                tx.retry_count,
                tx.max_retries,
                tx.created_at,
                tx.updated_at
            );
        }

        res.status(201).json({
            success: true,
            batch_id: batchId,
            number_generated: count,
            total_amount_at_risk: totalAtRisk,
            transaction_ids: transactionIds,
            created_at: nowIso
        });
    } catch (err) {
        console.error('Error in POST /api/batch/generate:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
