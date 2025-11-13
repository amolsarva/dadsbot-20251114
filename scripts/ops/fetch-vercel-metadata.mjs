#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const scriptName = new URL(import.meta.url).pathname.split('/').pop();
const baseEnvSummary = {
  node: process.version,
  script: scriptName,
  cwd: process.cwd()
};

const timestamp = () => new Date().toISOString();

const log = (message, extra = {}) => {
  console.log(
    `[diagnostic] ${timestamp()} ${JSON.stringify({ ...baseEnvSummary, ...extra.envSummary })} :: ${message}`,
    extra.details ? JSON.stringify(extra.details) : ''
  );
};

const logError = (message, error, extra = {}) => {
  console.error(
    `[diagnostic] ${timestamp()} ${JSON.stringify({ ...baseEnvSummary, ...extra.envSummary })} :: ${message}`,
    error instanceof Error ? JSON.stringify({ message: error.message, stack: error.stack }) : JSON.stringify(error)
  );
};

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    const error = new Error(`Missing required environment variable: ${name}`);
    logError('Aborting due to missing environment variable', error, {
      envSummary: { requiredVariable: name }
    });
    throw error;
  }
  return value;
};

const fetchJson = async (url, headers, context) => {
  log('Fetching Vercel API resource', {
    envSummary: { ...context, url }
  });

  let response;
  try {
    response = await fetch(url, {
      headers,
      method: 'GET'
    });
  } catch (networkError) {
    logError('Vercel API request threw before response', networkError, {
      envSummary: { ...context, url }
    });
    throw networkError;
  }

  if (!response.ok) {
    const payload = await response.text();
    const error = new Error(
      `Vercel API request failed: ${response.status} ${response.statusText}`
    );
    logError('Vercel API call failed', error, {
      envSummary: { ...context, url },
      details: { responseBody: payload }
    });
    throw error;
  }

  const json = await response.json();
  log('Received Vercel API payload', {
    envSummary: { ...context, url },
    details: { keys: Object.keys(json) }
  });
  return json;
};

const collectProjects = async (headers, scope) => {
  const projects = [];
  let next = undefined;

  while (true) {
    const params = new URLSearchParams({ limit: '100' });
    if (scope.teamId) {
      params.set('teamId', scope.teamId);
    }
    if (next) {
      params.set('from', next);
    }
    const url = `https://api.vercel.com/v9/projects?${params.toString()}`;
    const payload = await fetchJson(url, headers, {
      scope: scope.teamId ? `team:${scope.teamId}` : 'personal'
    });

    const mapped = (payload.projects ?? []).map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      framework: project.framework || null
    }));

    log('Appending fetched projects batch', {
      envSummary: {
        scope: scope.teamId ? `team:${scope.teamId}` : 'personal',
        batchSize: mapped.length
      }
    });

    projects.push(...mapped);
    next = payload.pagination?.next;

    if (!next) {
      break;
    }
  }

  log('Completed project enumeration', {
    envSummary: {
      scope: scope.teamId ? `team:${scope.teamId}` : 'personal',
      totalProjects: projects.length
    }
  });

  return projects;
};

const main = async () => {
  log('Starting Vercel metadata collection', {
    envSummary: { tokenPresent: Boolean(process.env.VERCEL_API_TOKEN) }
  });

  const token = requireEnv('VERCEL_API_TOKEN');
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const user = await fetchJson('https://api.vercel.com/www/user', headers, {
    resource: 'user'
  });

  const teamsPayload = await fetchJson('https://api.vercel.com/v2/teams', headers, {
    resource: 'teams'
  });
  const teams = (teamsPayload.teams ?? []).map((team) => ({
    id: team.id,
    name: team.name,
    slug: team.slug,
    createdAt: team.createdAt
  }));

  log('Fetched teams metadata', {
    envSummary: { teamCount: teams.length }
  });

  const personalProjects = await collectProjects(headers, {});
  const teamsWithProjects = [];

  for (const team of teams) {
    const projects = await collectProjects(headers, { teamId: team.id });
    teamsWithProjects.push({ ...team, projects });
  }

  const snapshot = {
    fetchedAt: timestamp(),
    actor: {
      userId: user.user?.id ?? null,
      username: user.user?.username ?? null,
      email: user.user?.email ?? null
    },
    teams: teamsWithProjects,
    personalProjects
  };

  const outputPath = resolve('ops', 'vercel-context.json');
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
  log('Wrote Vercel context snapshot', {
    envSummary: { outputPath }
  });
};

main().catch(async (error) => {
  const failurePath = resolve('ops', 'vercel-context.json');
  try {
    const payload = {
      fetchedAt: timestamp(),
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null
      }
    };
    await writeFile(failurePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
    log('Persisted failure snapshot', {
      envSummary: { outputPath: failurePath }
    });
  } catch (writeError) {
    logError('Failed to persist failure snapshot', writeError, {
      envSummary: { outputPath: failurePath }
    });
  }

  logError('Vercel metadata collection failed', error);
  process.exit(1);
});
