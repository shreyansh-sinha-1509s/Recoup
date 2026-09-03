# Recoup

> **Recover revenue. Intelligently.**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/shreyansh-sinha-1509s/Recoup)

Recoup is an autonomous, AI-assisted Revenue Recovery Agent built for **Razorpay Buildathon 2026 (Track 03 — AI Revenue Recovery)**. It diagnoses failed payment root causes, formulates bounded recovery recommendations, enforces deterministic financial safety guardrails, and independently verifies settled revenue.

---

## 1. Project Overview

Payment declines are a major source of revenue leakage for digital merchants. Standard automated retry systems blindly resubmit transactions, triggering cardholder disputes, bank rate-limiting, and unnecessary processing fees.

**Recoup** introduces an intelligent, bounded recovery workflow:
- **Diagnose before acting**: Classifies known bank codes deterministically and employs Anthropic Claude Haiku 4.5 for ambiguous failures.
- **Enforce strict guardrails**: Deterministic rules govern retry delays, maximum attempt limits, customer incentive caps, and high-value risk holds.
- **Execute & Verify independently**: Retries are dispatched via Razorpay Test Mode and verified independently before being accounted as recovered.

---

## 2. The Problem

- **Blind Retries Fail**: Retrying an `insufficient_funds` decline immediately will fail 99% of the time, whereas retrying after salary cycles (+24h) yields high recovery rates.
- **Fraud & Dispute Exposure**: Retrying suspicious or high-value transactions without human oversight leads to chargebacks and payment gateway penalties.
- **Uncontrolled AI Agents**: Giving an LLM open-ended write authority over financial systems introduces catastrophic risk of unauthorized transactions or runaway retry loops.

---

## 3. The Solution

Recoup implements an 8-stage bounded state machine:

$$\text{Detect} \longrightarrow \text{Diagnose} \longrightarrow \text{Recommend} \longrightarrow \text{Guardrail Check} \longrightarrow \text{Execute} \longrightarrow \text{Verify} \longrightarrow \text{Recover / Escalate}$$

```
┌─────────────────┐
│ 1. DETECTED     │ Payment failure captured with raw gateway error code
└────────┬────────┘
         ▼
┌─────────────────┐
│ 2. DIAGNOSED    │ Root cause identified (Rule Engine or AI Agent)
└────────┬────────┘
         ▼
┌─────────────────┐
│ 3. DECISION     │ Bounded recovery action proposed (Recommendation Only)
└────────┬────────┘
         ▼
┌─────────────────┐
│ 4. GUARDRAIL    │ Deterministic policy gate (PASSED vs BLOCKED)
└────────┬────────┘
         ▼
┌─────────────────┐
│ 5. EXECUTED     │ Dispatched via Razorpay Test Mode / API Adapter
└────────┬────────┘
         ▼
┌─────────────────┐
│ 6. VERIFIED     │ Independent gateway verification (CAPTURED vs DECLINED)
└────────┬────────┘
         ▼
┌─────────────────┐
│ 7. RECOVERED    │ State transitioned to RECOVERED (or ESCALATED on failure)
└─────────────────┘
```

---

## 4. Core Architecture Principle

$$\mathbf{\text{AI Recommends}} \;\longrightarrow\; \mathbf{\text{Deterministic Guardrails Authorize}} \;\longrightarrow\; \mathbf{\text{Razorpay Executes}} \;\longrightarrow\; \mathbf{\text{Verification Confirms}}$$

1. **AI has ZERO direct financial authority**: The AI agent proposes diagnoses, retry delays, and customer recovery messages. It cannot authorize transactions, move money, or bypass safety bounds.
2. **Deterministic Guardrails are Absolute**: Code-level policies validate all recommendations against business rules, risk thresholds, and attempt counters.
3. **Execution and Verification are Separated**: Dispatched retries are never marked as recovered until an independent verification step confirms `status: CAPTURED`.

---

## 5. Key Features

- **Failure Detection & Ingestion**: Ingests failed payment batches with transaction metadata and gateway error codes.
- **Hybrid Diagnosis Engine**:
  - Direct deterministic mapping for standard Razorpay error codes (`BAD_REQUEST_ERROR`, `GATEWAY_ERROR`).
  - Anthropic Claude Haiku 4.5 reasoning for ambiguous, multi-factor declines.
  - Offline fallback reasoning when external LLM APIs are unreachable.
- **Deterministic Policy Guardrails**: Enforces backoff delays, attempt limits, and exclusion rules.
- **Risk & Fraud Protection**: Zero automated retries on fraud holds or transactions $>₹50,000$.
- **Razorpay Adapter**: Cleanly separates `RAZORPAY_TEST_MODE` local simulation from `RAZORPAY_TEST_API` live test credentials.
- **Audit Trail & Case Ledger**: Every transaction maintains an immutable step-by-step reasoning log with actor stamps (`SYSTEM`, `RULE_ENGINE`, `AI_AGENT`, `GUARDRAIL`, `RAZORPAY`, `VERIFIER`).
- **Control Center & Visual Analytics**:
  - **KPI Metrics Strip**: Revenue at Risk, Recovered Revenue, Recovery Rate, Batch Size.
  - **Recovery Pipeline**: Interactive 6-stage flow visualizer synced live to selected Case Ledger transactions.
  - **Recovery Analytics**: Recovered Revenue Trend Chart, Failure Distribution Donut Chart, Stepped Conversion Funnel, and Category Performance breakdown.
  - **Dark / Light Theme**: Professional fintech operations UI with persistent `localStorage` theme toggling.

---

## 6. Financial Guardrails

All recovery actions must satisfy deterministic code-level rules before dispatch:

| Failure Category | Guardrail Rule | Maximum Limit | Action on Exceeded |
|---|---|---|---|
| **Insufficient funds** | Retry after **24 hours** | **2 attempts** | Escalate to Ops Queue |
| **Card expired** | Generate alternate payment link | **1 link** | Escalate to Ops Queue |
| **Bank technical decline** | Immediate retry | **1 attempt** | Escalate to Ops Queue |
| **Network timeout** | Immediate retry | **1 attempt** | Escalate to Ops Queue |
| **Risk / Fraud hold** | **Never auto-retry** | **0 attempts** | Immediate Escalate / Human Review |
| **High-value hold** | Transactions **> ₹50,000** | **0 auto-retries** | Immediate Escalate / Human Review |
| **Incentive cap** | Maximum discount / incentive | **10%** | Hard capped by policy validator |

---

## 7. Technology Stack

- **Frontend**: Vanilla HTML5, Vanilla CSS3 (Custom Design System tokens), Vanilla JavaScript (No React, no bloated dependencies, instant load performance).
- **Backend**: Node.js, Express.js.
- **Database**: SQLite via Node.js native `node:sqlite` (`DatabaseSync` — zero native rebuild dependencies, lightweight and embedded).
- **AI Model**: Anthropic Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) with structured JSON schema outputs and deterministic offline fallback.
- **Payment Gateway**: Razorpay Test Mode simulation adapter & Test API integration.

---

## 8. Project Structure

```text
Recoup/
├── dashboard.html             # Control Center frontend (Vanilla JS/HTML/CSS)
├── server.js                  # Express application server & routes
├── package.json               # Node.js manifest & test scripts
├── render.yaml                # Render Blueprint deployment specification
├── .env.example               # Template for environment configuration
├── .gitignore                 # Excludes .env, node_modules, logs, test artifacts
│
├── db/
│   ├── database.js            # SQLite connection & query helpers (node:sqlite)
│   └── schema.sql             # Relational schema (batches, txns, audits, metrics)
│
├── guardrails/
│   └── policy.js              # Deterministic financial safety guardrails engine
│
├── routes/
│   ├── agent.js               # POST /api/agent/run (batch recovery execution)
│   ├── batch.js               # POST /api/batch/generate (synthetic batch generator)
│   ├── guardrails.js          # GET /api/guardrails (active safety policies)
│   └── results.js             # GET /api/results (metrics, cases, audit logs)
│
├── services/
│   ├── ai.js                  # Anthropic Claude Haiku 4.5 client + offline fallback
│   ├── metrics.js             # Dynamic metric aggregation (Risk, Recovered, Rate)
│   ├── razorpay.js            # Razorpay Test Mode execution & verifier adapter
│   └── recovery.js            # 8-stage core recovery pipeline orchestrator
│
└── tests/
    ├── recovery.test.js       # Phase 1 test suite (DB, Guardrails, Audit, Pipeline)
    ├── phase2a.test.js        # Phase 2A test suite (Insufficient funds A-F)
    └── phase2b.test.js        # Phase 2B test suite (AI Diagnosis & Bounds A-H)
```

---

## 9. Getting Started

### Prerequisites
- Node.js version 22.x or later (recommended for native `node:sqlite` support).

### Installation

1. **Clone repository**:
   ```bash
   git clone https://github.com/shreyansh-sinha-1509s/Recoup.git
   cd Recoup
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   ```

4. **Start the server**:
   ```bash
   npm start
   ```

5. **Open the Control Center**:
   Navigate to [http://localhost:3000/dashboard.html](http://localhost:3000/dashboard.html) in your browser.

---

## 10. Automated Testing

Run the full end-to-end verification suite:

```bash
npm test
```

The test suite validates:
- **Phase 1**: SQLite tables, deterministic guardrails, 8-stage audit logging, separate execute vs. verify states, dynamic metrics.
- **Phase 2A (Tests A–F)**: Complete insufficient funds lifecycle, attempt limits, failure fallbacks, verification success (`RECOVERED`), verification decline (`ESCALATED`).
- **Phase 2B (Tests A–H)**: AI diagnosis for ambiguous declines, high-value policy blocks, fraud hold blocks, schema validation, Anthropic offline fallback, and zero-authority AI architecture.

---

## 11. Demo Mode & Provider Transparency

Recoup operates out-of-the-box with **zero external credentials required**:
- **Razorpay**: Runs in high-fidelity deterministic `RAZORPAY_TEST_MODE` simulation when API keys are absent. All audit trail messages transparently state:  
  `"Retry attempt dispatched via Razorpay Test Mode simulation."`
- **AI Reasoning**: Uses deterministic offline reasoning when `ANTHROPIC_API_KEY` is not provided, tagging audit logs with `provider: offline_fallback`.
- If valid `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` or `ANTHROPIC_API_KEY` are supplied in `.env`, Recoup automatically switches to live test endpoints without configuration changes.

---

## 12. Deployment (Render Web Service)

Recoup is configured for one-click deployment to **Render** via `render.yaml`.

### Render Deployment Steps:
1. Click the **Deploy to Render** button at the top of this README, or create a new **Web Service** on [Render](https://render.com).
2. Connect the repository `https://github.com/shreyansh-sinha-1509s/Recoup`.
3. Configure settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
4. Deploy the service.

---

## 13. Security & Safety Principles

- **No Secrets Committed**: `.env` and sensitive files are strictly excluded via `.gitignore`.
- **Zero Financial Authority for AI**: AI cannot execute payments or alter financial limits.
- **Immutable Audit Trail**: Every stage of diagnosis, recommendation, authorization, execution, and verification is logged with timestamped actor metadata.
- **Fail-Safe Defaults**: Malformed inputs, missing keys, or unexpected errors default to safe escalation rather than retrying.

---

## 14. Hackathon Context

- **Event**: Razorpay Buildathon 2026
- **Track**: Track 03 — AI Revenue Recovery
- **Mission**: Build an autonomous revenue recovery system combining AI diagnosis with deterministic financial guardrails and Razorpay execution.
