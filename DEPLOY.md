# Launch checklist

## Fastest production deployment: Render
1. Create a GitHub repository and upload this folder.
2. Create a new Web Service on Render and select the repository.
3. Choose Docker as the runtime. `render.yaml` is included for the service configuration.
4. Set the environment variables from `.env.example`:
   - `SITE_URL` = `https://growthifybrand.com`
   - `SALES_EMAIL` = `growthifybrand@gmail.com`
   - `RESEND_API_KEY` = your Resend API key (optional but recommended)
   - `RESEND_FROM` = a verified sender, e.g. `Growthify Brand <growthifybrand@gmail.com>`
   - `CRM_WEBHOOK_URL` = your CRM/automation webhook (optional)
5. Deploy. The app listens on the platform-provided `PORT`.
6. Add your custom domain and update `SITE_URL`.

## Important before launch
- Replace the placeholder copy in the Privacy Policy with your legal entity details and GDPR/privacy wording reviewed for your jurisdiction.
- Replace any demo case-study numbers with verified results.
- Verify your sending domain in Resend before enabling email delivery.
- Connect the CRM webhook to your actual automation/CRM endpoint.
- Test the audit with several real websites before advertising it.

## What works without external services
The site, live audit, report page, lead capture and persistent report storage work in the app itself. Resend and the CRM webhook are optional integrations controlled by environment variables.
