# Netlify Blob Storage Configuration Checklist

Use this walkthrough to verify the blob configuration items that cause 405 errors when uploads run from the app. Complete each step in order so you know the store and site wiring all match.

## 1. Confirm the blob store exists and matches the configured name
1. Sign in to [Netlify](https://app.netlify.com/) and open your team dashboard.
2. In the global navigation, choose **Storage** ➜ **Blobs**. (If the Storage item is hidden, open **Team settings** first, then choose **Storage** from the left-hand sidebar.)
3. Locate the store named `dads-interview-bot`. If it is missing, click **Create blob store**, enter `dads-interview-bot`, and finish the wizard. If you already use a different store name, note the exact value—you must copy it into `NETLIFY_BLOBS_STORE`.
4. When the store is present, open it and copy its **Store name** and **Store ID** for reference.

## 2. Export the Netlify blob credentials explicitly
1. In **Site settings → Environment variables**, define `NETLIFY_BLOBS_TOKEN`. Netlify’s managed function token works, or you can create a personal access token with **Blobs: Read and write** scope. The app refuses to fall back to anonymous credentials.
2. Set `NETLIFY_BLOBS_API_URL` explicitly — for most teams this is `https://api.netlify.com/api/v1/blobs`. Leaving it blank now blocks `/api/diagnostics/storage` so you immediately notice missing configuration.
3. Keep `NETLIFY_BLOBS_STORE` (if you override the default) and `NETLIFY_BLOBS_SITE_ID` configured as before. These settings still inform the runtime which store and site to target.
4. Remove any legacy aliases such as `BLOBS_TOKEN`, `BLOBS_SITE_ID`, or `BLOBS_CONTEXT`. They now trigger diagnostics errors and are ignored by the runtime.

## 3. Link the site ID
1. From the Netlify dashboard, open the **Sites** tab and select the site that hosts this app.
2. On the site overview page, scroll to **Site information** and expand it to reveal the **API ID** (UUID). This is Netlify’s canonical Site ID.
3. Copy the API ID and set it as `NETLIFY_BLOBS_SITE_ID` in your environment. Using the UUID skips the slug lookup path that requires additional REST permissions.
4. If you can only supply a site slug, keep `NETLIFY_BLOBS_SITE_SLUG` populated *and* temporarily define a `NETLIFY_BLOBS_TOKEN` with Sites API scope. The runtime needs it only long enough to resolve the slug to a UUID; once the diagnostics confirm the canonical Site ID you can remove the token again.

## 4. Validate optional URL overrides (if any)
1. Only follow this step if you have provided `NETLIFY_BLOBS_EDGE_URL`, `NETLIFY_BLOBS_API_URL`, or similar overrides.
2. In the blob store view from step 1, check the **Region** value. Netlify uses different base URLs per region.
3. Compare the region to the override values you have set. Confirm the hostnames point to the same region as your store. In particular, do **not** send writes to `https://netlify-blobs.netlify.app`; that domain serves cached reads only. For upload operations, explicitly set `NETLIFY_BLOBS_API_URL=https://api.netlify.com/api/v1/blobs` unless Netlify support instructs otherwise.
4. After adjusting overrides, redeploy the environment so the updated settings apply.

## 5. Ensure Next.js API routes deploy on Netlify
1. Confirm the repository includes a `netlify.toml` with the Next.js build command, `.next` publish directory, and the `@netlify/plugin-nextjs` entry. Without the plugin the App Router API endpoints (such as `/api/diagnostics`) are never compiled into Netlify Functions, yielding 404 responses in production.
2. After pushing configuration changes, trigger a fresh deploy and inspect the build logs. Look for `Framework detected: Next.js` and the Netlify adapter’s summary of generated API routes. If the log instead reports a static build, delete any conflicting build settings in the Netlify UI and redeploy.
3. When the deploy finishes, run `netlify functions:list` or open the deploy summary and confirm functions like `api_diagnostics` exist. Their presence verifies Netlify can execute your in-app diagnostics suite.

## 6. Confirm the deployment context in diagnostics
1. Open the in-app **Diagnostics** page and run the full suite.
2. In the log viewer, find the `***KEY NETFLIFY ITEMS***` block. It now repeats the store/token/site wiring and lists the detected deployment origin and URL so you can verify you are exercising the intended test release (for example, `https://dadsbot.netlify.app`).
3. If the deployment origin or URL do not match the environment you expected, re-run the tests from the correct host before continuing troubleshooting.

## After completing the checklist
Redeploy the site (or trigger the failing tests again) to confirm blob uploads now succeed. If 405 errors persist, recheck the store name, token scope, and site ID for typographical errors, then contact Netlify support with the failing request ID shown in the diagnostics.

### Troubleshooting initialization failures

- If a fresh deploy reports `Internal Server Error` responses from `/api/blob`, open `/api/health` or `/api/diagnostics/storage` on the deployment URL. Both endpoints now echo a `storageError` payload with the initialization failure message and the masked site/store identifiers Netlify attempted to use.
- Errors such as `NETLIFY_BLOBS_SITE_ID is set to "example-site"...` indicate the runtime only received a site slug. Update `NETLIFY_BLOBS_SITE_ID` to the UUID from **Site information** or temporarily supply `NETLIFY_BLOBS_TOKEN` so the slug can be resolved automatically (step 3 above).
- Authentication errors (HTTP 401/403) usually mean the Netlify runtime skipped injecting blob credentials. Confirm the site is running on Netlify Functions (step 5) and that no stale `NETLIFY_BLOBS_TOKEN` or `NETLIFY_API_TOKEN` values linger in your environment variables.
