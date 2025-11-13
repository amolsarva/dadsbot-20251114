# Ops Diagnostics Feed

This directory stores operational diagnostics artifacts that surface Vercel deployment context inside the repository. All files created here should be committed so automated agents can inspect the most recent deployment state without needing external access.

Artifacts tracked here include:

- `vercel-last-build.log` and `vercel-last-deploy.log` fetched from the Vercel API by CI workflows.
- `runtime-diagnostics.json` created by polling the `/api/dev-diagnostics` route.
- `vercel-context.json` snapshots of team and project metadata retrieved for manual setup.

Every generator of files in this directory must emit `[diagnostic]`-prefixed logs with timestamps and exit loudly on missing configuration. Do not place secrets here.
