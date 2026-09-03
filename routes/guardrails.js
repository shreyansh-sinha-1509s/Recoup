const express = require('express');
const router = express.Router();
const { GUARDRAIL_POLICIES } = require('../guardrails/policy');

/**
 * GET /api/guardrails
 * Returns the currently active deterministic policies.
 */
router.get('/', (req, res) => {
    try {
        res.json({
            success: true,
            count: GUARDRAIL_POLICIES.length,
            guardrails: GUARDRAIL_POLICIES
        });
    } catch (err) {
        console.error('Error in GET /api/guardrails:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
