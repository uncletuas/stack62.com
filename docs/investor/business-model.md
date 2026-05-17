# Stack62 — Business Model & Unit Economics

## Revenue Streams

### 1. SaaS Subscriptions (Primary — 80% of revenue)

| Plan | Monthly | Annual | Included Users | AI Credits/mo | Storage |
|------|---------|--------|---------------|--------------|---------|
| Starter | $49 | $470 | 5 | $10 | 5GB |
| Growth | $199 | $1,910 | 25 | $50 | 50GB |
| Business | $599 | $5,750 | 100 | $150 | 500GB |
| Enterprise | Custom | Custom | Unlimited | Custom | Custom |

**Add-on seats:**
- Starter: $9/user/mo above 5
- Growth: $12/user/mo above 25
- Business: $15/user/mo above 100

### 2. AI Credit Top-ups (Secondary — 15% of revenue)

Each plan includes a monthly AI credit allowance. Usage above the allowance is billed at:
- $0.008 per 1K input tokens (Anthropic-equivalent pricing)
- $0.024 per 1K output tokens

SMBs running active Coworker sessions consume 50K–500K tokens/month. At scale, this creates a durable usage-based revenue layer that grows with customer engagement.

### 3. Implementation & Onboarding Services (5% of revenue)

- **Starter pack:** $500 one-time — vertical blueprint deployment + team training (2h)
- **Growth pack:** $2,000 one-time — custom system build + integrations setup + 4h training
- **Enterprise onboarding:** $10,000–$50,000 — full deployment, custom integrations, SLA setup

---

## Unit Economics (Growth Plan — Model Customer)

| Metric | Value |
|--------|-------|
| ACV (Annual Contract Value) | $2,388 (monthly billing) / $1,910 (annual) |
| Gross Margin | ~78% (net of AI compute, hosting, support) |
| CAC — Self-serve | $80–$150 (content + product-led growth) |
| CAC — Sales-assisted | $400–$800 (outbound + demo) |
| Payback Period — Self-serve | 1.5–3 months |
| Payback Period — Sales-assisted | 3–6 months |
| LTV (assuming 36-month retention) | $7,164 |
| LTV:CAC — Self-serve | 48:1 |
| LTV:CAC — Sales-assisted | 15:1 |
| Average NRR target | 115% (seat expansion + usage growth) |

---

## Cost Structure

**Variable costs (per customer):**
- AI compute (Anthropic/OpenRouter): $5–$40/mo depending on usage
- Database & storage (Render Postgres/S3): $2–$15/mo
- Email delivery (Resend): <$1/mo
- Payment processing (Paystack/Stripe): 1.5% of transaction

**Fixed costs (monthly, at seed stage):**
- Engineering: $15,000 (2 engineers)
- Infrastructure baseline: $500
- Tools & SaaS: $800
- Legal & compliance: $1,000/mo amortised

---

## Path to Profitability

| Milestone | MRR | Customers | Gross Margin |
|-----------|-----|-----------|-------------|
| Break-even | $35,000 | ~200 avg Growth customers | 78% |
| Ramen-profitable | $60,000 | ~350 customers | 78% |
| Seed target (18mo) | $250,000 | ~1,500 customers | 80% |
| Series A target (30mo) | $1,000,000 | ~5,000 customers | 82% |

---

## Go-to-Market Strategy

### Phase 1: Product-Led Growth (0–12 months)
- Free trial (14 days, full Growth plan features)
- Self-serve signup with guided Coworker onboarding ("build your first system in 10 minutes")
- Content marketing: "build a [CRM / approval workflow / inventory tracker] with AI" tutorials
- Integrations directory: Slack App Directory, Microsoft Teams marketplace

### Phase 2: Vertical Playbooks (6–18 months)
- Launch 3 vertical playbook bundles (SME Ops, Legal, Healthcare Admin) with case studies
- Partner with SMB accountants, HR consultants, and business coaches as referral channels
- Paystack partnership for Africa market distribution

### Phase 3: Sales Motion (12–30 months)
- Inside sales for Business ($599+) and Enterprise
- Channel partner program for managed service providers
- White-label licensing for regional business software distributors

---

## Pricing Philosophy

Stack62 is deliberately priced **below the "hire a developer" threshold**:
- A single developer costs $8,000–$15,000/month
- Stack62 Growth at $199/month = **1.3–2.5% of the alternative cost**
- This makes ROI conversations trivially easy and accelerates adoption

The AI credit model aligns Stack62's revenue with customer value: the more a customer uses Coworker to build and run systems, the more value they get — and the more they pay, proportionally.
