const express = require('express');
const cors = require('cors');
const path = require('node:path');
require('dotenv').config();

const db = require('./db/database');
const batchRoutes = require('./routes/batch');
const agentRoutes = require('./routes/agent');
const resultsRoutes = require('./routes/results');
const guardrailsRoutes = require('./routes/guardrails');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Database schema
db.getDb();

// Middlewares
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Keep requests without an Origin header allowed for direct / server-to-server requests
        if (!origin) return callback(null, true);

        const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1');
        const isVercel = origin.endsWith('.vercel.app') || origin === 'https://vercel.app';
        const isRender = origin.endsWith('.onrender.com');
        const isAllowed = allowedOrigins.includes(origin) || allowedOrigins.includes('*');

        if (isLocal || isVercel || isRender || isAllowed) {
            return callback(null, true);
        }

        return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets from root workspace (including dashboard.html)
app.use(express.static(path.join(__dirname)));

// API Routes
app.use('/api/batch', batchRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/results', resultsRoutes);
app.use('/api/guardrails', guardrailsRoutes);

// Healthcheck endpoint for cloud hosting / Render
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'recoup'
    });
});

// Detailed API healthcheck endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        project: 'Recoup — AI Revenue Recovery Agent',
        track: 'Razorpay Buildathon Track 03',
        timestamp: new Date().toISOString()
    });
});

// Root endpoint serves dashboard.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
    });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(` Recoup — AI Revenue Recovery Agent Server Running  `);
        console.log(` URL: http://localhost:${PORT}                      `);
        console.log(` Mode: Razorpay Test Mode                           `);
        console.log(` Database: SQLite (${process.env.DB_PATH || 'recoup.sqlite'}) `);
        console.log(`====================================================`);
    });
}

module.exports = app;
