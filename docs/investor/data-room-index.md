# Stack62 — Investor Data Room Index

*Use this index to organise the due diligence data room (Notion, Google Drive, or Datasite). Each section lists the documents an investor or acquirer will request and their current status.*

---

## 1. Company & Legal

| Document | Status | Notes |
|---------|--------|-------|
| Certificate of Incorporation | ☐ Needed | Include jurisdiction |
| Memorandum & Articles of Association | ☐ Needed | |
| Register of Shareholders (cap table) | ☐ Needed | Include all share classes, vesting schedules |
| Register of Directors | ☐ Needed | |
| Any existing investor agreements (SAFEs, convertible notes) | ☐ Needed | |
| Any existing shareholder agreements | ☐ Needed | |
| Founder vesting schedules | ☐ Needed | Standard 4yr/1yr cliff |
| IP assignment agreements (founders → company) | ☐ Needed | Critical for acquisition |
| Employment / contractor agreements (key staff) | ☐ Needed | |
| Any NDAs with strategic partners | ☐ Needed | |

---

## 2. Financials

| Document | Status | Notes |
|---------|--------|-------|
| Historical P&L (last 24 months or since founding) | ☐ Needed | Month-by-month |
| Balance sheet | ☐ Needed | Latest available |
| Cash flow statement | ☐ Needed | |
| Bank statements (last 6 months) | ☐ Needed | |
| Financial projections (3 year) | ☐ Needed | See `business-model.md` for assumptions |
| Current MRR and ARR breakdown | ☐ Needed | By plan tier |
| Churn rate (monthly, annual) | ☐ Needed | |
| CAC and LTV by channel | ☐ Needed | |
| Outstanding liabilities / loans | ☐ Needed | |
| Accounts payable / receivable | ☐ Needed | |

---

## 3. Product & Technology

| Document | Status | Notes |
|---------|--------|-------|
| Technical architecture overview | ✅ Done | `docs/investor/technical-due-diligence.md` |
| System capabilities reference | ✅ Done | `docs/SYSTEM_CAPABILITIES.md` |
| Backend architecture docs | ✅ Done | `docs/stack62-backend-architecture.md` |
| SOC 2 readiness checklist | ✅ Done | `docs/soc2-readiness.md` |
| Security review (penetration test results) | ☐ Needed | Commission before Series A |
| Open-source license audit | ☐ Needed | Verify no GPL in production |
| Third-party code / library audit | ☐ Needed | |
| Any filed patents or patent applications | ☐ Needed | Consider filing on Plan→Diff→Approve flow |
| Bug tracker / issue list (GitHub) | ✅ Available | GitHub Issues |
| CI/CD pipeline documentation | ✅ Done | `.github/workflows/ci.yml` |
| Disaster recovery plan | ☐ Needed | Document RTO/RPO targets |
| Data retention and deletion policy | ☐ Needed | GDPR requirement |

---

## 4. Product & Market

| Document | Status | Notes |
|---------|--------|-------|
| Executive summary | ✅ Done | `docs/investor/executive-summary.md` |
| Market opportunity analysis | ✅ Done | `docs/investor/market-opportunity.md` |
| Competitive landscape | ✅ Done | `docs/investor/competitive-landscape.md` |
| Product roadmap | ✅ Done | `docs/investor/product-roadmap.md` |
| Business model & unit economics | ✅ Done | `docs/investor/business-model.md` |
| Customer case studies (1–3) | ☐ Needed | Key for closing investors |
| Product demo video (< 5 minutes) | ☐ Needed | Loom or Vimeo |
| Pitch deck (slide format) | ☐ Needed | Distillation of docs above |
| User quickstart guide | ✅ Done | `docs/user-quickstart.md` |
| SME ops vertical blueprint | ✅ Done | `docs/sme-ops-mvp-blueprint.json` |

---

## 5. Customers & Revenue

| Document | Status | Notes |
|---------|--------|-------|
| Customer list (anonymised) | ☐ Needed | Tier, tenure, MRR |
| Customer contracts (top 5 by ARR) | ☐ Needed | With redacted PII |
| Churn reasons (exit interviews / survey data) | ☐ Needed | |
| NPS or CSAT data | ☐ Needed | |
| Pipeline / CRM export (prospects) | ☐ Needed | |
| Partnership agreements (if any) | ☐ Needed | Paystack, integration partners |

---

## 6. Team & Operations

| Document | Status | Notes |
|---------|--------|-------|
| Org chart | ☐ Needed | |
| Founder bios and LinkedIn profiles | ☐ Needed | |
| Key employee contracts | ☐ Needed | |
| Equity / option pool schedule | ☐ Needed | |
| Open hiring plan (next 12 months) | ☐ Needed | |
| Advisor agreements | ☐ Needed | |
| Board minutes (if board exists) | ☐ Needed | |

---

## 7. Compliance & Risk

| Document | Status | Notes |
|---------|--------|-------|
| GDPR / CCPA compliance assessment | ☐ Needed | Privacy policy + DPA ready |
| Privacy policy (public) | ☐ Needed | |
| Terms of service (public) | ☐ Needed | |
| Data processing agreements (customers) | ☐ Needed | |
| Any ongoing litigation | ☐ Needed | |
| Insurance certificates (D&O, E&O, cyber) | ☐ Needed | |
| HMRC / tax filings (if UK) | ☐ Needed | |

---

## Data Room Setup Checklist

**Recommended platform:** Notion (for early-stage informal review) or Datasite / Ansarada (for formal M&A process)

- [ ] Create top-level folders matching sections 1–7 above
- [ ] Upload all ✅ Done documents first — gives investors something to read immediately
- [ ] Set folder-level permissions (some investors get partial view)
- [ ] Enable watermarking on sensitive financials and customer data
- [ ] Add NDA requirement before granting access
- [ ] Track who has viewed what (most platforms support this)
- [ ] Create a Q&A section for investor questions (avoids duplicate email threads)

---

## Priority Order for Pre-Pitch Preparation

For a seed or pre-Series A conversation, the minimum viable data room is:

1. ✅ Executive summary
2. ✅ Technical due diligence
3. ✅ Business model
4. ✅ Competitive landscape
5. ✅ Product roadmap
6. ☐ **Pitch deck** (create next)
7. ☐ **3-year financial model** (create next)
8. ☐ **Cap table** (create next)
9. ☐ **1–2 customer case studies** (create after first paying customers)
10. ☐ **Product demo video** (record a 5-min walkthrough)

---

*Last updated: May 2026. Assign an owner to each ☐ item with a target completion date before beginning investor conversations.*
