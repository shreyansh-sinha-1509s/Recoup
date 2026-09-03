-- Schema for Recoup AI Revenue Recovery Agent
-- SQLite compatible

CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'PENDING',
    total_count INTEGER NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0,
    recovered_count INTEGER NOT NULL DEFAULT 0,
    recovered_amount REAL NOT NULL DEFAULT 0,
    escalated_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    batch_id TEXT,
    payment_id TEXT UNIQUE NOT NULL,
    customer_name TEXT,
    customer_email TEXT,
    customer_contact TEXT,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL DEFAULT 'FAILED',
    failure_category TEXT NOT NULL,
    failure_code TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 2,
    next_retry_at TEXT,
    action_taken TEXT,
    recovered_amount REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (batch_id) REFERENCES batches(id)
);

CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_tx_batch ON transactions(batch_id);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(failure_category);

CREATE TABLE IF NOT EXISTS payment_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_reference TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE TABLE IF NOT EXISTS failure_reasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT NOT NULL,
    category TEXT NOT NULL,
    code TEXT NOT NULL,
    explanation TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE TABLE IF NOT EXISTS interventions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT NOT NULL,
    intervention_type TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT NOT NULL,
    step TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    result TEXT NOT NULL,
    metadata TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_tx ON audit_log(transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(timestamp);
