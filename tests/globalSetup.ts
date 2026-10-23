import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TestProject } from 'vitest/node'
import { buildTemplate } from './harness.ts'

/* Runs once per vitest invocation, before any worker: the migrated PGlite
   template every integration server is copied from. Its own temp directory,
   so overlapping runs in one checkout never see each other's files. */
let dir: string
// Synthetic provider catalogs: integration tests must never send fake keys to providers.
const catalogs = createServer((_req, res) => {
  const ids = ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra', 'gpt-6.1-sol']
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ data: ids.map((id) => ({ id, created: 1 })) }))
})

export async function setup(project: TestProject): Promise<void> {
  dir = mkdtempSync(path.join(tmpdir(), 'doop-test-template-'))
  await buildTemplate(dir)
  project.provide('templateDir', dir)
  await new Promise<void>((resolve) => catalogs.listen(0, '127.0.0.1', resolve))
  const address = catalogs.address()
  if (!address || typeof address === 'string') throw new Error('Catalog fixture did not bind')
  project.provide('modelCatalogUrl', `http://127.0.0.1:${address.port}`)
}

export async function teardown(): Promise<void> {
  await new Promise<void>((resolve) => catalogs.close(() => resolve()))
  rmSync(dir, { recursive: true, force: true })
}
