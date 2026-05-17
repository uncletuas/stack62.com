# Security policy

## Supported versions

Stack62 is currently in active development. We ship security fixes to
the `main` branch and re-deploy the production service from `main`.
There are no historical branches to support.

## Reporting a vulnerability

Email **security@stack62.com** with:

- A description of the issue.
- Steps to reproduce — or a proof-of-concept if you have one.
- Affected version / commit SHA if you can identify it.
- Your name + contact so we can credit you (optional).

**Do not** file a public GitHub issue. We acknowledge reports within
2 business days and aim to ship a fix within 30 days for high-impact
issues.

PGP key for sensitive reports: see the security page at
https://stack62.com/security.

## Scope

In scope:
- The `stack62.com` web application and its API.
- The mobile-web experience served from the same origin.
- The meeting-bot worker container.
- Anything reachable from a Stack62-owned domain.

Out of scope (these are not bugs):
- Findings that require physical access to a user's device.
- Social engineering of Stack62 employees.
- DDoS / volumetric attacks.
- Issues in third-party integrations (Google, Meta, Intuit) — report
  those upstream.
- Theoretical issues without a practical exploit path.

## What we do well

- All passwords are argon2id hashed.
- Every external integration uses OAuth, not stored credentials.
- Tenant-scoped access control runs on every endpoint that reads or
  writes business data (`AccessControlService`).
- Database column-level encryption for integration secrets.
- File storage backed by either local disk (dev) or signed S3 URLs
  (prod); avatars and other public-ish reads route through a thin
  controller that enforces the "is this actually the user's avatar"
  check.
- Tier-routed LLM calls — sensitive prompts are gated to the
  frontier model, not the local self-hosted Llama (which doesn't see
  customer data unless deliberately routed).

## What we know we owe

- Two-factor authentication for sign-in (planned).
- Hardware-key WebAuthn (planned, after 2FA).
- Per-device session list + remote sign-out (depends on a session
  store; planned).
- SOC 2 Type II audit (see `docs/soc2-readiness.md`).

## Bug bounty

We don't currently run a paid bounty programme. We're happy to credit
researchers publicly with their consent and offer Stack62 swag for
high-impact reports. As we scale revenue, a paid programme is the
natural next step.

## Responsible disclosure

We follow the standard 90-day disclosure window. If we can't ship a
fix in 90 days for a complex issue, we'll keep you in the loop and
agree a revised date with you. Please do not publish details before
the fix is live and we've notified affected customers.

## Past advisories

None published yet. Once we have any, they'll appear in
[`docs/security-advisories/`](docs/security-advisories/).
