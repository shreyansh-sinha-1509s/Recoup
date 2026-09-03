const db = require('../db/database');

/**
 * Format local time in HH:mm:ss or ISO
 */
function getFormattedTime() {
    const now = new Date();
    return now.toTimeString().split(' ')[0]; // e.g. "09:41:02"
}

/**
 * Log an audit trail entry for a transaction
 */
function logAudit({ transactionId, step, actor, action, result, metadata = {} }) {
    const timestamp = getFormattedTime();
    const metaStr = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);

    const sql = `
        INSERT INTO audit_log (transaction_id, step, actor, action, result, metadata, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [
        transactionId,
        step,
        actor,
        action,
        result,
        metaStr,
        timestamp
    ]);

    return {
        transactionId,
        step,
        actor,
        action,
        result,
        metadata,
        timestamp
    };
}

/**
 * Retrieve the full audit trail for a transaction
 */
function getAuditTrail(transactionId) {
    const sql = `
        SELECT id, transaction_id, step, actor, action, result, metadata, timestamp
        FROM audit_log
        WHERE transaction_id = ?
        ORDER BY id ASC
    `;
    const rows = db.query(sql, [transactionId]);
    return rows.map(r => ({
        ...r,
        metadata: r.metadata ? JSON.parse(r.metadata) : {}
    }));
}

module.exports = {
    logAudit,
    getAuditTrail,
    getFormattedTime
};
