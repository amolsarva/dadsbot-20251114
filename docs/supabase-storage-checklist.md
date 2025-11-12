# Supabase Storage Configuration Checklist

Use this walkthrough to confirm the Supabase credentials that power uploads from the app. Complete every step so the runtime can persist transcripts, manifests, and audio artifacts reliably.

## 1. Verify the Supabase project and bucket
1. Sign in to [Supabase](https://supabase.com/) and open the project hosting the bot.
2. Record the **Project URL** from **Project Settings → API**; diagnostics log the first eight characters so you can confirm the correct project is active.
3. Navigate to **Storage → Buckets** and ensure a bucket such as `dadsbot-sessions` exists. If not, create one with public access disabled.

## 2. Capture required credentials
1. From **Project Settings → API**, copy the **service_role** key. The runtime refuses to initialize Supabase storage without it.
2. Optional: copy the **anon** key if any client-side components need to talk to Supabase directly.
3. Update your `tmpkeys.txt` so it contains:

   ```
   STORAGE_MODE supabase
   SUPABASE_URL https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY <service_role>
   SUPABASE_STORAGE_BUCKET dadsbot-sessions
   SUPABASE_ANON_KEY <anon-key-if-needed>
   ```

4. Store `tmpkeys.txt` securely (1Password, Vercel env vars, etc.) and point the `TMP_KEYS_PATH` environment variable at it during builds.

## 3. Deploy and validate
1. Redeploy the site after updating secrets.
2. Visit `/api/diagnostics/storage` or the `/diagnostics` page. Storage should report `provider: "supabase"`, include your bucket name, and confirm health probes succeeded.
3. If diagnostics show `mode: "memory"`, the runtime could not read `tmpkeys.txt`. Check the deployment logs for `[diagnostic] storage:environment:failed` entries.

## 4. Test uploads end-to-end
1. Record a short session in the deployed app.
2. Inspect the Supabase bucket for new objects under `sessions/<session-id>/`.
3. Download an object to ensure it contains valid JSON/audio.

## 5. Rotate keys safely
1. Generate a new service role key in Supabase.
2. Update the entry in `tmpkeys.txt` (or your secret manager) and redeploy.
3. After the redeploy succeeds, revoke the old key in Supabase.

## Troubleshooting quick hits
- **Storage still in memory** → confirm `STORAGE_MODE` is set to `supabase` and that the runtime log includes a successful `supabase:init` entry.
- **Uploads fail with 401/403** → the service role key may be incorrect or revoked. Check `/api/diagnostics/storage` for the exact error payload.
- **Objects appear but URLs 404** → ensure the proxy base override (`PUBLIC_STORAGE_BASE_URL` in `tmpkeys.txt`) points to a public CDN or use the built-in `/api/blob/` proxy paths.
