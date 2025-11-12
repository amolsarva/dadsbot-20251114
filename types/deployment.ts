export type ParsedRepo = {
  owner: string | null
  name: string | null
  httpsUrl: string | null
}

export type DeploymentMetadata = {
  platform: 'vercel' | 'custom'
  deployId: string
  deployIdSource: string
  commitRef: string | null
  commitMessage: string | null
  commitTimestamp: string | null
  branch: string | null
  projectId: string | null
  projectName: string | null
  orgId: string | null
  deployUrl: string | null
  previewUrl: string | null
  siteUrl: string | null
  repo: ParsedRepo
  context: string | null
  region: string | null
}
