const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { runRecoveryBatch } = require('../services/recovery');

/**
 * POST /api/agent/run
 * Runs the Recoup Recovery Agent pipeline on unrecovered failed transactions.
 */
router.post('/run', async (req, res) => {
    try {
        let batchId = req.body.batch_id || null;

        // If no batch_id specified, find the most recent batch or unrecovered cases
        if (!batchId) {
            const latestBatch = db.get('SELECT id FROM batches ORDER BY created_at DESC LIMIT 1');
            if (latestBatch) {
                batchId = latestBatch.id;
            }
        }

        const startTime = Date.now();
        const results = await runRecoveryBatch(batchId);
        const durationMs = Date.now() - startTime;

        // Calculate run metrics
        let recoveredCount = 0;
        let recoveredAmount = 0;
        let escalatedCount = 0;
        let scheduledCount = 0;

        for (const r of results) {
            if (r.status === 'RECOVERED') {
                recoveredCount++;
                recoveredAmount += r.recoveredAmount || 0;
            } else if (r.status === 'ESCALATED') {
                escalatedCount++;
            } else if (r.status === 'SCHEDULED') {
                scheduledCount++;
            }
        }

        // Update batch record if batchId exists
        if (batchId) {
            db.run(
                `UPDATE batches 
                 SET status = 'COMPLETED', recovered_count = ?, recovered_amount = ?, escalated_count = ?, updated_at = ?
                 WHERE id = ?`,
                [recoveredCount, recoveredAmount, escalatedCount, new Date().toISOString(), batchId]
            );
        }

        res.json({
            success: true,
            batch_id: batchId,
            duration_ms: durationMs,
            total_processed: results.length,
            recovered_count: recoveredCount,
            recovered_amount: recoveredAmount,
            escalated_count: escalatedCount,
            scheduled_count: scheduledCount,
            results
        });
    } catch (err) {
        console.error('Error in POST /api/agent/run:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
