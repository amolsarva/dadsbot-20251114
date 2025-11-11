# Hosting options for Netlify-centric builds

The app is a Next.js 14 project with App Router server actions, serverless API routes, and blob-backed audio storage. These platforms cover the required deployment + storage combo with minimal code churn.

| Platform | What you get | Gaps / what to configure |
| --- | --- | --- |
| **Netlify** | Git-driven deploys, preview URLs, custom domains, serverless functions that map to `app/api/*`, Edge support, and Netlify Blobs with signed/public URLs. Diagnostics stay green once the blob secrets are in place. | Needs the Netlify Blobs token + site ID in env vars; see `docs/netlify-migration-guide.md` for a step-by-step checklist. |
| **Cloudflare Pages + Workers + R2** | Automatic builds from Git, global edge execution via Workers, and R2 for S3-compatible object storage. Strong fit if you want low-latency audio fetches worldwide. | Update `lib/blob.ts` to target R2 (S3 API or Workers bindings). No first-party email provider, so keep Resend/SendGrid secrets. |
| **Render + S3-compatible storage** | Single dashboard for SSR Node services, background workers, and managed Postgres if needed later. Auto-deploys from Git, built-in HTTPS, custom domains. | Pair with S3, Backblaze B2, or Cloudflare R2 for blob storage and adjust the helper. Preview deploys are manual. |
| **AWS Amplify Hosting + S3** | Managed Next.js builds and Lambda-backed SSR, tight integration with AWS ecosystem. S3 replaces blob storage, and SES/SNS are available for email. | Slightly more setup overhead (IAM roles, Amplify app creation). Update `lib/blob.ts` for S3 and keep the in-memory fallback. |
| **Fly.io** | Full control over regional container deployment with WireGuard private networking. Great for custom Node servers or multi-service topologies. | Bring your own CI/CD (e.g., GitHub Actions). No managed object store—connect S3/R2 and adjust the blob helper. Monitoring/metrics are more DIY. |

Netlify remains the most direct fit for Git-driven deploys with first-party blob storage. Render, Cloudflare, and AWS bring broader infrastructure options at the cost of slightly more configuration work, while Fly.io favors teams that want infrastructure primitives over turnkey platform features.
