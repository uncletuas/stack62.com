# SOC2 readiness — current state

A practical inventory of what's in place vs. what's missing for a
Type-1 (point-in-time) SOC2 audit. Not a substitute for a real
auditor — this is the homework checklist before engaging one.

## Trust Service Criteria coverage

### CC1 — Control Environment

| Status | Control |
|--|--|
| ✅ | Code reviewed via pull requests; main branch protected on GitHub |
| ✅ | Single source-controlled repo with full history |
| ⏳ | Written security policy / acceptable-use policy (TODO) |
| ⏳ | Org chart with roles, hiring + offboarding checklist (TODO) |

### CC2 — Communication & Information

| Status | Control |
|--|--|
| ✅ | Activity log audit trail (`activity_logs` table) |
| ✅ | Retention enforced via daily cron (per-plan window: free=7d…enterprise=∞) |
| ✅ | Sentry error reporting on backend + frontend (PII scrubbed) |
| ⏳ | Customer-facing status page (Statuspage / Better Stack) (TODO) |
| ⏳ | Documented incident response procedure (TODO) |

### CC3 — Risk Assessment

| Status | Control |
|--|--|
| ⏳ | Annual risk assessment document (TODO) |
| ⏳ | Vendor / sub-processor inventory (TODO — currently: Render, OpenRouter, Anthropic, Resend, Slack, Google, AWS S3, Sentry) |

### CC4 — Monitoring

| Status | Control |
|--|--|
| ✅ | Sentry alerts on backend exceptions |
| ✅ | Activity log captures every auth + tool-call + admin action |
| ⏳ | Uptime monitoring with alerting (TODO — set up UptimeRobot / Better Stack pointing at /v1/health) |
| ⏳ | Quarterly access review (TODO) |

### CC5 — Control Activities

| Status | Control |
|--|--|
| ✅ | RBAC via membership roles |
| ✅ | Per-folder ACLs |
| ✅ | Coworker action-level guardrail (sensitive actions always pause for approval) |
| ✅ | Plan + approval workflow for AI-applied changes |

### CC6 — Logical & Physical Access Controls

| Status | Control |
|--|--|
| ✅ | Argon2id password hashing |
| ✅ | JWT-based auth (24h default expiry) |
| ✅ | Email verification flow |
| ✅ | Password reset flow |
| ✅ | Slack bot tokens encrypted at rest (AES-256-GCM via SecretEncryptionService) |
| ✅ | Integration credentials encrypted at rest |
| ⏳ | MFA for org admins (TODO — `SECURITY_REQUIRE_2FA_FOR_ADMINS` env exists; flow not yet built) |
| ⏳ | SSO for enterprise customers (TODO — Google OAuth exists for personal; SAML / OIDC enterprise SSO pending) |

### CC7 — System Operations

| Status | Control |
|--|--|
| ✅ | Containerised deploys (Docker on Render) |
| ✅ | CI workflow (GitHub Actions: tsc + build on PR/push) |
| ✅ | Database migrations gated behind synchronize=false (operator flip when stable) |
| ⏳ | Automated database backups (Render Postgres does daily snapshots; document the restore path) (TODO) |
| ⏳ | Disaster recovery drill documented (TODO) |

### CC8 — Change Management

| Status | Control |
|--|--|
| ✅ | All changes go through git commits with co-author attribution |
| ✅ | CI must pass before merge (workflow runs typecheck + build on PR) |
| ⏳ | Production-deploy approval (TODO — Render currently auto-deploys main; could gate behind manual approval for production-tier services) |

### CC9 — Risk Mitigation

| Status | Control |
|--|--|
| ⏳ | Pen-testing report (TODO — run before claiming SOC2) |
| ⏳ | Bug bounty program (TODO — optional) |

## Data-residency notes

- Application data: AWS S3 (region: eu-north-1 / Stockholm)
- Application database + Redis: Render us-west (Oregon)
- LLM traffic: OpenRouter (US) → Anthropic / OpenAI hosted regions

For EU-only deployments, redeploy to Render's Frankfurt region.

## Customer-facing artifacts to ship before claiming SOC2

1. Privacy policy + terms of service
2. Sub-processor list (the vendor inventory above, customer-facing)
3. DPA template
4. GDPR data export (✅ already shipped: `GET /v1/account/export`)
5. GDPR data deletion endpoint (TODO — currently soft-deletes via status='deleted')
6. Status page (UptimeRobot recommended for v1 — $5/mo, hooks into our /v1/health)

## Estimate to "audit-ready"

Working backwards from the TODOs above: ~2 weeks of doc work
(security policy, IR plan, vendor list, DPA, privacy policy) plus
the MFA flow (~1 week) plus the disaster-recovery drill (~3 days).

Then engage an auditor (Vanta / Drata / Tugboat / Insight) — they
manage the evidence collection. Audit fee starts around $10–20k for
Type-1.

Don't bother with this until you have an enterprise customer asking
for the report — until then, the controls above are enough for SMB
trust.
