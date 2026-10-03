# Growthify Brand — Lead Generation System

This is the next version of the futuristic SEO/content/copywriting site.

## Funnel
1. Visitor enters website + email + consent.
2. The server performs a live homepage audit.
3. The visitor receives a Growth Score and a personalized report URL.
4. The report contains actionable opportunities and a strategy-call CTA.
5. The lead is stored in `data/leads.jsonl`.
6. Optional `CRM_WEBHOOK_URL` sends the lead to a CRM/automation platform.

## Run
Node.js 18+:
```bash
npm install
npm start
```
Open http://localhost:3000

## CRM connection
Set:
```bash
CRM_WEBHOOK_URL=https://your-crm-webhook.example
```
The server sends JSON containing `name`, `email`, `url`, `score`, `reportId`, and `createdAt`.

For a production setup, use a real CRM (HubSpot, Pipedrive, etc.), add API authentication/signing, retry queues and rate limiting.

## Email delivery
The current MVP creates an online report page. To automatically email the report, connect an email provider (for example Resend, Postmark or SendGrid) in `server.js`, using environment variables for credentials. Do not hard-code API keys.

## Production checklist
- Add HTTPS.
- Add rate limiting / bot protection.
- Use a database for leads and reports.
- Add privacy policy + consent logging/retention policy.
- Add email delivery and unsubscribe handling.
- Add deeper crawler checks in a background job.
- Verify all case-study numbers before publishing.
- Set `SALES_EMAIL` to `growthifybrand@gmail.com` (or your final sales inbox) before launch.
