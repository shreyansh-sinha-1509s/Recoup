# 💰 Recoup — Recover Revenue. Intelligently.

🌐 **Live Demo:** 👉 [https://recoup-eight-rouge.vercel.app/](https://recoup-eight-rouge.vercel.app/)  
📊 **Control Center:** 👉 [https://recoup-eight-rouge.vercel.app/dashboard.html](https://recoup-eight-rouge.vercel.app/dashboard.html)  
🔗 **GitHub Repository:** 👉 [https://github.com/shreyansh-sinha-1509s/Recoup](https://github.com/shreyansh-sinha-1509s/Recoup)  

---

## 📌 Overview

**Recoup** is an AI-powered revenue recovery agent designed to help merchants recover revenue lost to failed digital payments.

It detects failed payment attempts, diagnoses the underlying failure root cause, recommends a bounded recovery action, enforces deterministic financial safety guardrails, executes permitted recovery actions through Razorpay Test Mode, and independently verifies whether the payment was actually captured before accounting revenue as recovered.

$$\mathbf{\text{AI Recommends}} \;\longrightarrow\; \mathbf{\text{Deterministic Guardrails Authorize}} \;\longrightarrow\; \mathbf{\text{Razorpay Executes}} \;\longrightarrow\; \mathbf{\text{Verification Confirms}}$$

The system is engineered to safely maximize recoverable merchant revenue while actively preventing unsafe retry loops, excessive attempts, unauthorized high-value retries, and automated actions on fraud-risk transactions.

> [!NOTE]  
> **Demonstration Mode Notice**: This demonstration uses **Razorpay Test Mode** / deterministic simulation where live merchant credentials are not configured. It is designed to demonstrate autonomous recovery architecture safely and does not process live payment card charges.

---

## 🎯 Problem Statement

Failed payments are a significant source of revenue leakage for digital merchants. When a payment declines, the default instinct is often to retry immediately or repeatedly. However, a crude retry-everything approach is dangerous and ineffective:

- **Temporary vs. Structural Failures**: An `insufficient_funds` decline will fail if retried immediately, but succeeds when scheduled after salary/billing cycles (+24h).
- **Payment Method Incompatibility**: Expired cards or invalid authentication require alternate payment links, not automated backend charge retries.
- **Customer Experience**: Repeated rapid retries trigger multiple SMS alerts, exhaust bank velocity limits, and irritate customers.
- **High-Value Exposure**: Large transactions ($>₹50,000$) represent substantial chargeback and operational risk requiring controlled escalation.
- **Fraud & Risk Compliance**: Risk-flagged and stolen card declines must never be auto-retried.
- **Execution $\neq$ Recovery**: A dispatched payment retry is merely an attempt; revenue cannot be claimed as recovered without independent gateway confirmation.

Recoup addresses these challenges by enforcing a bounded, auditable, and independently verified recovery decision cycle.

---

## 💡 Solution

Recoup replaces uncoordinated retry scripts with a structured 8-stage decision pipeline:

```text
       Failed Payment Detected
                 │
                 ▼
          Detect & Ingest
                 │
                 ▼
       Root-Cause Diagnosis
                 │
                 ▼
        AI Recommendation
                 │
                 ▼
    Deterministic Guardrails
                 │
                 ▼
     Permitted Recovery Action
                 │
                 ▼
    Razorpay Test Mode Execution
                 │
                 ▼
      Independent Verification
                 │
         ────────┴────────
        │                 │
        ▼                 ▼
   RECOVERED          ESCALATED
```

> [!IMPORTANT]  
> **Strict Separation of Concerns**: The AI layer does **NOT** have authorization to move money, adjust retry counters, or bypass guardrails. Code-level deterministic policies strictly govern all execution boundaries.

---

## 🚀 Key Features

- 🔍 **Failed Payment Detection**  
  Captures failed transaction events across batches, extracting gateway error codes, amounts, timestamps, and customer metadata to compute live revenue at risk.

- 🧠 **AI-Assisted Diagnosis**  
  Combines deterministic rule mapping for standard gateway error codes (`BAD_REQUEST_ERROR`, `GATEWAY_ERROR`) with Anthropic Claude Haiku 4.5 reasoning for ambiguous, multi-factor decline scenarios.

- 🛡️ **Deterministic Financial Guardrails**  
  Enforces code-level retry limits, mandatory backoff delays, high-value risk holds, customer incentive caps ($\le 10\%$), and fraud-risk exclusions before any action can be dispatched.

- 💳 **Razorpay Test Mode Execution**  
  Dispatches permitted recovery actions through the Razorpay integration layer, utilizing deterministic Test Mode simulation when API keys are absent and live Test API adapters when configured.

- ✅ **Independent Verification**  
  Separates execution from settlement. Transactions are only marked `RECOVERED` after an independent verification check confirms `status: CAPTURED`.

- 📊 **Recovery Analytics & Funnel**  
  Live visual operations dashboard computing revenue at risk, recovered revenue, recovery rate ($\%$) with trend charts, failure distribution donuts, and conversion funnels.

- 📋 **Immutable Audit Trail & Case Ledger**  
  Every transaction maintains a chronological audit log detailing detection, diagnosis, AI reasoning, guardrail evaluations, execution provider references, and verification confirmations.

- ⚠️ **Safe Human Escalation**  
  Transactions exceeding retry limits, high-value items, or fraud-flagged cases are automatically routed to the operations escalation queue.

- 🌗 **Light/Dark Fintech Interface**  
  Restrained internal-operations console built with custom CSS tokens, supporting persistent theme preferences and responsive desktop/mobile layouts.

---

## 🔄 Recovery Workflow

```text
01 Detect ──► 02 Diagnose ──► 03 Recommend ──► 04 Guardrail ──► 05 Execute ──► 06 Verify ──► 07 Recover / 08 Escalate
```

### 01 — Detect
Identify failed payments from merchant batches and calculate live revenue at risk.

### 02 — Diagnose
Classify the decline reason using direct deterministic rule mapping for known codes and Claude AI for complex or ambiguous failure descriptions.

### 03 — Recommend
Formulate a bounded recovery action proposal (e.g., scheduled retry backoff, customer payment link, or escalation recommendation).

### 04 — Guardrail
Evaluate the proposal against deterministic policy rules. The guardrail engine independently decides whether to authorize or block the action.

### 05 — Execute
Dispatch permitted recovery actions through the Razorpay execution layer (generating a unique provider reference).

### 06 — Verify
Query the payment provider to independently verify the capture state (`CAPTURED` vs. `DECLINED`).

### 07 — Recover
Transition the transaction state to `RECOVERED` and update recovered revenue metrics only upon verified payment capture.

### 08 — Escalate
Safely escalate blocked, high-risk, exhausted, or unverifiable transactions to the manual operations review queue.

---

## 🛡️ AI Safety — AI Recommends, Code Decides

Recoup implements a strict boundary architecture where AI reasoning is strictly advisory and completely decoupled from financial execution:

```text
                ┌───────────────────────────────────┐
                │        AI Layer (Claude)          │
                │     Advisory Diagnosis Only       │
                └─────────────────┬─────────────────┘
                                  │
                                  ▼
                ┌───────────────────────────────────┐
                │   Proposed Action Recommendation  │
                │     (Zero Direct Authority)       │
                └─────────────────┬─────────────────┘
                                  │
                                  ▼
                ┌───────────────────────────────────┐
                │     Deterministic Validator       │
                │   Schema & Integrity Checking     │
                └─────────────────┬─────────────────┘
                                  │
                                  ▼
                ┌───────────────────────────────────┐
                │     Deterministic Guardrails      │
                │    Policy Engine & Bounds Check   │
                └─────────┬───────────────────┬─────┘
                          │                   │
                     PASS │                   │ BLOCK
                          ▼                   ▼
                ┌──────────────────┐ ┌──────────────────┐
                │ Razorpay Test    │ │ Ops Escalation   │
                │ Mode Execution   │ │ Queue (Manual)   │
                └─────────┬────────┘ └──────────────────┘
                          │
                          ▼
                ┌──────────────────┐
                │   Independent    │
                │   Verification   │
                └─────────┬────────┘
                          │
                          ▼
                ┌──────────────────┐
                │ Revenue Recovery │
                │ Confirmed        │
                └──────────────────┘
```

### Active Deterministic Policy Rules:

| Failure Category | Guardrail Policy | Maximum Limit | Action on Exceeded |
| :--- | :--- | :--- | :--- |
| **Insufficient funds** | Scheduled retry after **24 hours** | **2 attempts** | Escalate to Ops Queue |
| **Card expired** | Generate alternate payment link | **1 link** | Escalate to Ops Queue |
| **Bank technical decline** | Immediate technical retry | **1 attempt** | Escalate to Ops Queue |
| **Network timeout** | Immediate retry | **1 attempt** | Escalate to Ops Queue |
| **Risk / Fraud hold** | **Never auto-retry** | **0 attempts** | Immediate Escalate / Human Review |
| **High-value hold** | Transactions **> ₹50,000** | **0 auto-retries** | Immediate Escalate / Human Review |
| **Incentive cap** | Customer recovery incentive | **$\le 10\%$ discount** | Hard capped by policy validator |

---

## 🏗️ Architecture & Deployment

Recoup is deployed across a decoupled, cloud-native architecture:

```text
  ┌──────────────────────────────────────────────────────────┐
  │                 Vercel (Static Frontend)                 │
  │  • Homepage (index.html)                                 │
  │  • Control Center (dashboard.html)                       │
  │  • Custom Vanilla CSS Design System                      │
  └────────────────────────────┬─────────────────────────────┘
                               │ HTTPS / JSON API
                               ▼
  ┌──────────────────────────────────────────────────────────┐
  │                 Render (Web Service / API)               │
  │  • Node.js & Express API Server                          │
  │  • Embedded SQLite Database (node:sqlite)                │
  │  • Deterministic Guardrails Engine (policy.js)           │
  │  • Claude AI Diagnostics (Anthropic API / Offline Fallback) │
  │  • Razorpay Test Mode Adapter (razorpay.js)              │
  └──────────────────────────────────────────────────────────┘
```

- **Frontend (Vercel)**: Fast, lightweight static UI with zero framework overhead.
- **Backend (Render)**: Express.js REST API with native Node.js SQLite persistence (`node:sqlite`).
- **AI Integration**: Anthropic Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) with deterministic offline fallback for offline/demo reliability.
- **Payment Gateway**: Razorpay Test Mode execution layer.

---

## 🔗 Live Links & API Endpoints

| Resource | URL |
| :--- | :--- |
| **Live Homepage** | [https://recoup-eight-rouge.vercel.app/](https://recoup-eight-rouge.vercel.app/) |
| **Control Center (Dashboard)** | [https://recoup-eight-rouge.vercel.app/dashboard.html](https://recoup-eight-rouge.vercel.app/dashboard.html) |
| **Live Backend Base** | [https://recoup-5bdk.onrender.com/](https://recoup-5bdk.onrender.com/) |
| **Backend Health Check** | [https://recoup-5bdk.onrender.com/health](https://recoup-5bdk.onrender.com/health) |
| **Results & Cases API** | [https://recoup-5bdk.onrender.com/api/results](https://recoup-5bdk.onrender.com/api/results) |
| **Guardrails Policies API** | [https://recoup-5bdk.onrender.com/api/guardrails](https://recoup-5bdk.onrender.com/api/guardrails) |
| **GitHub Repository** | [https://github.com/shreyansh-sinha-1509s/Recoup](https://github.com/shreyansh-sinha-1509s/Recoup) |

---

## 📁 Repository Structure

```text
Recoup/
├── index.html                 # Public homepage & product overview
├── dashboard.html             # Control Center & Case Ledger UI
├── server.js                  # Express application server & routes
├── package.json               # Manifest & test scripts
├── render.yaml                # Render Blueprint deployment config
├── .env.example               # Environment variables template
├── assets/
│   └── recoup-logo.png        # Official Recoup branding emblem
├── db/
│   ├── database.js            # SQLite connection helper (node:sqlite)
│   └── schema.sql             # Relational database schema
├── guardrails/
│   └── policy.js              # Deterministic financial safety guardrails engine
├── routes/
│   ├── agent.js               # POST /api/agent/run (batch recovery execution)
│   ├── batch.js               # POST /api/batch/generate (synthetic batch generator)
│   ├── guardrails.js          # GET /api/guardrails (active safety policies)
│   └── results.js             # GET /api/results (metrics, cases, audit logs)
├── services/
│   ├── ai.js                  # Claude Haiku 4.5 integration + offline fallback
│   ├── metrics.js             # Revenue at risk & recovery aggregation
│   ├── razorpay.js            # Razorpay Test Mode execution adapter
│   └── recovery.js            # 8-stage recovery orchestrator
└── tests/
    ├── recovery.test.js       # Phase 1 test suite (DB, Guardrails, Audits)
    ├── phase2a.test.js        # Phase 2A test suite (Insufficient funds lifecycle)
    └── phase2b.test.js        # Phase 2B test suite (AI Diagnosis & Bounds)
```

---

## 🧪 Local Setup & Verification

### Prerequisites
- Node.js v22.x or later

### Installation & Run

```bash
# 1. Clone the repository
git clone https://github.com/shreyansh-sinha-1509s/Recoup.git
cd Recoup

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env

# 4. Start the local server
npm start
```

Access the application locally:
- **Homepage:** [http://localhost:3000/](http://localhost:3000/)
- **Control Center:** [http://localhost:3000/dashboard.html](http://localhost:3000/dashboard.html)

### Running Automated Tests

Execute the comprehensive test suite validating all phases of the recovery engine:

```bash
npm test
```

---

## 🏆 Hackathon Context

- **Event:** Razorpay Buildathon 2026
- **Track:** Track 03 — AI Revenue Recovery
- **Mission:** Build an intelligent, bounded revenue recovery system combining AI diagnostic reasoning with deterministic financial guardrails and Razorpay execution.
