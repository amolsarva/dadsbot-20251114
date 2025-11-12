# Vercel migration checklist

This project uses Next.js App Router with server actions, Supabase storage, and diagnostics routes. Vercel can host it without runtime changes as long as the deployment metadata and secrets mirror the local configuration. Use this checklist whenever you move to a fresh Vercel project so storage, AI providers, and the diagnostics dashboard stay healthy.

## 1. Prepare the repository
- Commit the `vercel.json` in the project root so custom function limits deploy with the app.
- Confirm `package.json` exposes the standard `build` and `start` scripts; Vercel calls them automatically.
- Ensure `scripts/embed-deploy-id.js` remains executable so the build can persist `DEPLOY_ID`.

## 2. Create the Vercel project
- In Vercel → **Add New… → Project**, import this repository and track the `main` branch.
- Under **Build & Development Settings**, leave the framework as **Next.js** and the build command as `npm run build`.
- Enable **Deploy Previews** so every pull request gets a unique URL that exercises the diagnostics routes.

## 3. Configure Supabase storage
1. In Supabase, create or reuse a project for the bot. Note the project URL from **Project Settings → API**.
2. Under **Storage → Buckets**, create a private bucket (for example `dadsbot-sessions`).
3. From **Project Settings → API**, copy the **service_role** key and (optionally) the **anon** key.

Create or update `tmpkeys.txt` in the repo root with entries:

```
STORAGE_MODE supabase
SUPABASE_URL https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY <service_role>
SUPABASE_STORAGE_BUCKET dadsbot-sessions
SUPABASE_ANON_KEY <anon-key-if-needed>
```

Store the file in your secret manager and expose it during builds via `TMP_KEYS_PATH`. The runtime refuses to start without the Supabase URL, bucket, and service role key.

## 4. Wire AI + email providers
Add production credentials as Vercel environment variables (Project → **Settings → Environment Variables**):
- `OPENAI_API_KEY` for AI follow-ups.
- `GOOGLE_API_KEY` and `GOOGLE_MODEL` for Gemini diagnostics.
- `RESEND_API_KEY` or `SENDGRID_API_KEY` for outbound email.
- `DEFAULT_NOTIFY_EMAIL` (must be a real address; placeholders trigger hard failures).

After saving, redeploy so the build embeds the updated secrets snapshot.

## 5. Deploy and validate
1. Trigger a deployment (push to `main` or click **Deploy**).
2. When Vercel finishes, open the Preview or Production URL and visit `/diagnostics`.
3. Confirm every check returns `ok: true`:
   - **Storage** reports `mode: "supabase"` with your bucket name.
   - **Google/OpenAI** sections echo the model IDs you configured.
   - **Smoke/E2E** tests write to Supabase and return artifact URLs.
4. Record a short session and verify audio/transcript links resolve through `/api/blob/...` with HTTP 200 responses.

## 6. Rotate keys safely
- Regenerate the Supabase service role key, update `tmpkeys.txt` (or the secret manager), redeploy, and then revoke the old key.
- Note rotation cadence in `ToDoLater.txt` so credentials never stale out.

## 7. Common diagnostics after migrating
- **Storage stuck in memory** → `STORAGE_MODE` is missing or not exposed during the build. Verify `TMP_KEYS_PATH` points to the real secrets file.
- **Blob downloads 404** → the Supabase bucket is missing or the service role lacks `storage.objects` permissions.
- **Diagnostics missing AI providers** → confirm the environment variables exist in the Vercel dashboard and redeploy. `/api/health` echoes which providers loaded.

Following this checklist preserves feature parity while ensuring the Vercel deployment exports the metadata that diagnostics expect.
