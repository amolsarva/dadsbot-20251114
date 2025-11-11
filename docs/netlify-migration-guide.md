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

## 3. Configure Supabase storage
1. In Supabase, create (or reuse) a project for the bot. Note the project URL from **Project settings → API**.
2. Under **Storage → Buckets**, create a bucket such as `dadsbot-sessions` with public access disabled.
3. From **Project settings → API**, copy the **service_role** and (optionally) **anon** keys.

Create a `tmpkeys.txt` file (or update the existing one) in the repo root with entries:

```
STORAGE_MODE supabase
SUPABASE_URL https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY <service_role>
SUPABASE_STORAGE_BUCKET dadsbot-sessions
SUPABASE_ANON_KEY <anon-key-if-needed>
```

Check the file into your deployment secrets mechanism (Netlify build environment, 1Password, etc.) and point `TMP_KEYS_PATH` at it during builds. The runtime refuses to start without `STORAGE_MODE`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET`.

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
   - **Storage** should report `mode: "supabase"` with your bucket name.
   - **OpenAI** and **Google** should echo the model IDs you configured.
   - **Smoke/E2E** tests should return emailed sessions and artifact links.
4. Record a short session and open **History** to make sure audio URLs resolve (they should use `/api/blob/...` with a 200 response backed by Supabase).

## 6. Rotate keys safely
- Regenerate Supabase service role keys in the dashboard, update `tmpkeys.txt` (or your secret manager), redeploy, and then revoke the old key.
- Track rotation cadence in `ToDoLater.txt` so credentials never stale out.

- **Storage still in memory** → confirm `STORAGE_MODE` is set to `supabase` and that the Supabase credentials resolve from `tmpkeys.txt` during the build.
- **Blob downloads 404** → make sure the bucket exists and the service role key has storage permissions.
- **Diagnostics missing OpenAI/Google** → Netlify hides secrets from build logs; verify they exist via the dashboard and re-run the deploy. The `/api/health` endpoint echoes which providers are active.

Following this checklist keeps feature parity with the previous hosting setup while ensuring Netlify storage is live from the first run.
