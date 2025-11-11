# Netlify migration checklist

This project already builds with `next build`/`next start` and exposes every server feature through App Router routes, so Netlify can host it without changing the runtime. Follow this checklist whenever you move a fresh environment to Netlify so audio storage, email, and the diagnostics dashboard all stay healthy.

## 1. Prepare the repository
- Commit the `netlify.toml` at the project root:
  ```toml
  [build]
    command = "npm run build"
    publish = ".next"

  [[plugins]]
    package = "@netlify/plugin-nextjs"
  ```
- Verify that `package.json` still exposes `build`/`start` scripts—Netlify drives them automatically.

## 2. Create the Netlify site
- In Netlify → **Add new site from Git**, point to this repo and track the `main` branch.
- Enable **Deploy Previews** if you want per-PR URLs. Netlify will build every push automatically once the connection is live.

## 3. Provision Netlify Blobs
1. In the site dashboard, open **Storage → Blobs** and create (or note) the store name. The repo defaults to `dads-interview-bot`; feel free to keep it.
2. Copy the **Site ID** from **Site settings → General → Site details**.
3. Generate a Netlify function token or personal access token with **Blobs: Read and write** scope. The runtime refuses to operate without `NETLIFY_BLOBS_TOKEN` defined.

Add these values under **Site settings → Environment variables**:
- `NETLIFY_BLOBS_SITE_ID`
- `NETLIFY_BLOBS_STORE` (optional override; omit to use the default)
- `NETLIFY_BLOBS_TOKEN`
- `NETLIFY_BLOBS_API_URL` (required; use `https://api.netlify.com/api/v1/blobs` unless support instructs otherwise)
- Optional overrides if you host the store elsewhere: `NETLIFY_BLOBS_EDGE_URL`, `NETLIFY_BLOBS_PUBLIC_BASE_URL`.

> Tip: If you accidentally paste the site slug (for example `dadsbot`) instead of the UUID Site ID, keep `NETLIFY_BLOBS_TOKEN` defined and let diagnostics resolve the slug. Once the canonical Site ID appears in the logs you can rotate the token but you should not remove it.

> Without the site ID the runtime falls back to the in-memory store. Diagnostics will warn with `mode: "memory"` until you add the secret and redeploy.

## 4. Wire the AI + email providers
Add any production credentials you use today:
- `OPENAI_API_KEY` (enables real assistant follow-ups)
- `RESEND_API_KEY` or `SENDGRID_API_KEY` (controls outbound summary mail)
- `DEFAULT_NOTIFY_EMAIL` (must be set explicitly; fallback placeholders are rejected)
- UI niceties such as `NEXT_PUBLIC_APP_NAME` are optional.

## 5. Deploy and validate
1. Trigger a deployment by pushing to `main` or pressing **Deploy site**.
2. Once Netlify finishes, visit `/diagnostics` on the deployed URL.
3. Confirm all checks read `ok: true`:
   - **Storage** should now report `mode: "netlify"` with your store name.
   - **OpenAI** and **Google** should echo the model IDs you configured.
   - **Smoke/E2E** tests should return emailed sessions and artifact links.
4. Record a short session and open **History** to make sure audio URLs resolve (they should use `/api/blob/...` with a 200 response).

## 6. Rotate tokens safely
- Netlify Blobs tokens can be revoked without downtime: add the new token in the UI first, redeploy, then delete the old token.
- Track rotation cadence in `ToDoLater.txt` (see the existing reminder) so the credentials never stale out.

## 7. Troubleshooting quick hits
- **Storage still in memory** → double-check that `NETLIFY_BLOBS_TOKEN` and `NETLIFY_BLOBS_SITE_ID` are defined for the *production* context and that the latest deploy pulled them in (`Deploy settings → Environment`).
- **Blob downloads 404** → ensure the store name matches the one you configured; wrong store names silently create a new empty store.
- **Diagnostics missing OpenAI/Google** → Netlify hides secrets from build logs; verify they exist via the dashboard and re-run the deploy. The `/api/health` endpoint echoes which providers are active.

Following this checklist keeps feature parity with the previous hosting setup while ensuring Netlify storage is live from the first run.
