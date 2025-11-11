import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, test } from 'vitest'

type EnvSummary = {
  cwd: string
  node: string
}

function envSummary(): EnvSummary {
  return {
    cwd: process.cwd(),
    node: process.version,
  }
}

function logDiagnostic(event: string, payload: Record<string, unknown> = {}): void {
  const timestamp = new Date().toISOString()
  const details = { ...payload, env: envSummary() }
  console.log('[diagnostic]', timestamp, event, details)
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'coverage') continue
    const resolved = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkFiles(resolved)
    } else {
      yield resolved
    }
  }
}

describe('blob env alias validation', () => {
  test('tsconfig maps @/ to the project root and blob env file exists', () => {
    const tsconfigPath = path.resolve(process.cwd(), 'tsconfig.json')
    logDiagnostic('blob-env-alias:load-tsconfig', { tsconfigPath })
    const raw = fs.readFileSync(tsconfigPath, 'utf-8')
    const tsconfig = JSON.parse(raw) as Record<string, any>
    const compilerOptions = tsconfig.compilerOptions ?? {}
    const paths = compilerOptions.paths ?? {}
    const alias = paths['@/*'] as unknown
    logDiagnostic('blob-env-alias:paths-read', { alias })

    expect(Array.isArray(alias)).toBe(true)
    expect(alias).toContain('./*')

    const blobEnvPath = path.resolve(process.cwd(), 'utils/blob-env.ts')
    const exists = fs.existsSync(blobEnvPath)
    logDiagnostic('blob-env-alias:file-exists', { blobEnvPath, exists })
    expect(exists).toBe(true)
  })

  test('imports referencing blob env use the @ alias', async () => {
    const root = process.cwd()
    const matches: Array<{ file: string; importPath: string }> = []
    logDiagnostic('blob-env-alias:scan-start', { root })

    for await (const file of walkFiles(root)) {
      if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue
      const contents = await fs.promises.readFile(file, 'utf-8')
      if (!contents.includes('blob-env')) continue

      const regex = /from\s+['"]([^'"\\]+blob-env[^'"]*)['"]/g
      let match: RegExpExecArray | null
      while ((match = regex.exec(contents))) {
        matches.push({ file, importPath: match[1] })
      }
    }

    logDiagnostic('blob-env-alias:scan-complete', {
      matchCount: matches.length,
      importPaths: matches.map((m) => m.importPath),
    })

    expect(matches.length).toBeGreaterThan(0)
    for (const { file, importPath } of matches) {
      expect(importPath, `${file} should import blob env via @ alias`).toBe('@/utils/blob-env')
    }
  })
})
