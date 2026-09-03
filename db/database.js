const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'recoup.sqlite');

// Ensure parent directory exists
const dbDir = path.dirname(path.resolve(dbPath));
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

let dbInstance = null;

function getDatabase() {
    if (!dbInstance) {
        dbInstance = new DatabaseSync(dbPath);
        // Enable WAL mode for concurrent performance and foreign keys
        dbInstance.exec('PRAGMA foreign_keys = ON;');
        initSchema(dbInstance);
    }
    return dbInstance;
}

function initSchema(db) {
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf8');
        db.exec(schema);
    }
}

// Database helper utilities
const db = {
    getDb: getDatabase,

    query(sql, params = []) {
        const stmt = getDatabase().prepare(sql);
        return stmt.all(...params);
    },

    get(sql, params = []) {
        const stmt = getDatabase().prepare(sql);
        return stmt.get(...params);
    },

    run(sql, params = []) {
        const stmt = getDatabase().prepare(sql);
        return stmt.run(...params);
    },

    exec(sql) {
        return getDatabase().exec(sql);
    }
};

module.exports = db;
