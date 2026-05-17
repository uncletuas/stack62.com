# Stack62 — Product Roadmap

**Last updated:** May 2026  
**Current stage:** MVP complete — moving to growth

---

## Current State (Shipped)

The following capabilities are production-ready:

- **AI Coworker** — natural language system design, plan/diff/approve governance
- **System Builder** — modules, entities, field types, views (table, kanban, gallery, calendar)
- **Record Management** — CRUD, field validation, filtering, bulk operations
- **Workflow Engine** — multi-step automations, approvals with escalation, scheduled triggers
- **Document Generation** — Word, PDF, Excel, PowerPoint (template + data-driven)
- **Multi-channel Integrations** — Slack, WhatsApp Business, email (Resend)
- **Meeting Bot** — Google Meet live caption capture + transcript storage
- **Billing & Subscriptions** — Paystack payments, plan tiers, usage counters, seat management
- **Auth & SSO** — JWT, Google OAuth, email verification, 2FA scaffolding
- **OAuth Integrations** — Google, Meta, QuickBooks, Microsoft 365 (configured)
- **Multi-tenant** — Per-org data isolation, role-based access control, audit log
- **Self-hosted AI** — Anthropic, OpenRouter, Ollama support
- **Semantic Search** — Vector embeddings, content indexing, workspace-wide search
- **API** — RESTful API with Swagger docs, rate limiting, Sentry monitoring
- **Deployment** — Docker, Render blueprint, S3 storage, Redis queues

---

## Roadmap

### Q3 2026 — Growth Foundations

**Payments & Monetisation**
- [ ] Stripe integration (replace Paystack stub for international markets)
- [ ] Usage-based AI credit billing (metered billing via Stripe)
- [ ] Annual billing discount flow
- [ ] Customer portal (self-serve plan changes, invoice history)

**Onboarding & Activation**
- [ ] Interactive onboarding wizard ("build your first system in 10 minutes")
- [ ] Vertical blueprint marketplace (SME Ops, Legal, Healthcare Admin)
- [ ] Guided Coworker tour (first-session prompts, example systems)
- [ ] In-app contextual help (Coworker answers questions about the platform)

**Platform Reliability**
- [ ] SOC 2 Type I audit preparation (complete controls inventory, remediate gaps)
- [ ] End-to-end test suite for critical paths (auth, billing, system creation, workflow execution)
- [ ] Automated database backup + point-in-time recovery
- [ ] Uptime monitoring and incident runbook

---

### Q4 2026 — Depth & Integrations

**AI Capabilities**
- [ ] Coworker memory persistence (remembers business context across sessions)
- [ ] Multi-step AI plan with conditional branching ("if the approval is rejected, also...")
- [ ] AI-suggested data cleanup (detects duplicates, missing fields, stale records)
- [ ] Voice-to-system (record a voice note; Coworker builds the system)

**Integrations (Depth)**
- [ ] QuickBooks two-way sync (invoices, contacts, payments)
- [ ] Google Calendar event creation from workflows
- [ ] WhatsApp inbound message → workflow trigger
- [ ] Zapier / Make connector (publish Stack62 as a trigger/action)

**Collaboration**
- [ ] Real-time multi-user record editing (optimistic locking + conflict resolution)
- [ ] @mention in records (notify teammates)
- [ ] Comments and activity thread on records
- [ ] Guest access (external collaborators, read-only)

---

### Q1 2027 — Vertical Expansion

**Healthcare Admin Vertical**
- [ ] HIPAA-compliant storage tier (BAA, encryption at rest, audit controls)
- [ ] Patient records blueprint + appointment workflow
- [ ] Referral letter document template
- [ ] UK CQC / US HIPAA compliance checklist integration

**Legal Vertical**
- [ ] Matter management blueprint
- [ ] Document version control with client-facing portal
- [ ] Deadline & docket tracking workflow
- [ ] E-signature integration (DocuSign or native)

**Reporting & Analytics**
- [ ] Custom dashboard builder (drag-and-drop widgets)
- [ ] Scheduled reports (auto-generated PDF/Excel sent by email)
- [ ] Cross-system analytics (aggregate data across multiple systems)

---

### Q2 2027 — Scale & Ecosystem

**Mobile**
- [ ] iOS and Android native apps (React Native)
- [ ] Offline mode for record entry
- [ ] Push notifications for workflow approvals

**Platform Extensibility**
- [ ] Public API v2 with OAuth scopes (enable third-party app building on Stack62)
- [ ] Webhook outbound (trigger external systems on record events)
- [ ] Plugin SDK (white-label Stack62 modules for channel partners)
- [ ] Marketplace for community-built templates and integrations

**Enterprise Readiness**
- [ ] SAML/SSO (Okta, Microsoft Entra)
- [ ] SOC 2 Type II certification
- [ ] Custom data residency (EU, US, Africa regions)
- [ ] SLA-backed enterprise plan with dedicated support

---

## Engineering Capacity Assumptions

This roadmap assumes:
- **Current:** 1–2 engineers (founder-led development)
- **Post-seed (Q3 2026):** 3–4 engineers
- **Post-Series A (Q1 2027):** 8–10 engineers

Items marked as Q1/Q2 2027 may accelerate with additional engineering headcount.

---

## Success Metrics by Quarter

| Quarter | Target MRR | Paying Customers | Key Milestone |
|---------|-----------|-----------------|---------------|
| Q3 2026 | $25,000 | 150 | Stripe live; first vertical blueprint shipped |
| Q4 2026 | $75,000 | 400 | SOC 2 Type I; 3 integrations live |
| Q1 2027 | $175,000 | 900 | Healthcare vertical; mobile beta |
| Q2 2027 | $350,000 | 1,800 | SOC 2 Type II; public API; Series A ready |
