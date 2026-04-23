import { beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const s3MockState = {
  objects: new Map<string, Buffer>(),
}

mock.module('../../storage/s3.js', () => ({
  normalizeStorageKey: (key: string) => key.replace(/^\/+/, '').replace(/\\/g, '/'),
  listStorageObjectKeysByPrefix: async ({ prefix }: { prefix: string }) => {
    const normalized = prefix.replace(/^\/+/, '')
    return [...s3MockState.objects.keys()].filter(k =>
      k === normalized || k.startsWith(`${normalized}/`),
    )
  },
  getObjectFromStorage: async ({ key }: { key: string }) => {
    const value = s3MockState.objects.get(key)
    if (!value) throw new Error(`missing object: ${key}`)
    return { buffer: Buffer.from(value) }
  },
  uploadObjectToStorage: async ({ key, body }: { key: string; body: Buffer | Uint8Array | string }) => {
    const normalizedBody =
      typeof body === 'string' ? Buffer.from(body) : Buffer.from(body)
    s3MockState.objects.set(key, normalizedBody)
  },
  deleteStorageObjects: async ({ keys }: { keys: string[] }) => {
    for (const key of keys) s3MockState.objects.delete(key)
  },
}))

const { prepareAgentSandboxWorkspace } = await import('./agentSandboxWorkspace')

beforeEach(() => {
  s3MockState.objects.clear()
  process.env.AGENT_SANDBOX_S3_ENABLED = 'true'
  process.env.AGENT_SANDBOX_S3_PREFIX = 'agent_sandbox_workspaces_test'
})

describe('agentSandboxWorkspace S3 persistence', () => {
  test('persists sandbox file updates and hydrates in a fresh workspace session', async () => {
    const baseCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aistudio-s3-persist-'))
    const workspaceIdentity = 'persist-demo'

    try {
      const first = await prepareAgentSandboxWorkspace({
        baseCwd,
        workspaceIdentity,
        hostProjectRoot: '/virtual/project',
        projectFiles: {
          '/src/app.ts': { code: 'export const version = 1\n' },
        },
      })

      first.scopedFs.writeFileSync('/virtual/project/src/app.ts', 'export const version = 2\n')
      first.scopedFs.writeFileSync('/virtual/project/src/new.txt', 'hello sandbox\n')
      await first.persistToS3()

      const second = await prepareAgentSandboxWorkspace({
        baseCwd,
        workspaceIdentity,
        hostProjectRoot: '/virtual/project',
      })

      const app = second.scopedFs.readFileSync('/virtual/project/src/app.ts', { encoding: 'utf8' })
      const extra = second.scopedFs.readFileSync('/virtual/project/src/new.txt', { encoding: 'utf8' })

      expect(app).toBe('export const version = 2\n')
      expect(extra).toBe('hello sandbox\n')
    } finally {
      fs.rmSync(baseCwd, { recursive: true, force: true })
    }
  })

  test('deletes stale S3 objects after local file removal and re-persist', async () => {
    const baseCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aistudio-s3-cleanup-'))
    const workspaceIdentity = 'cleanup-demo'

    try {
      const first = await prepareAgentSandboxWorkspace({
        baseCwd,
        workspaceIdentity,
        hostProjectRoot: '/virtual/project',
        projectFiles: {
          '/src/keep.ts': { code: 'keep\n' },
          '/src/remove.ts': { code: 'remove\n' },
        },
      })
      await first.persistToS3()

      first.scopedFs.unlinkSync('/virtual/project/src/remove.ts')
      await first.persistToS3()

      const second = await prepareAgentSandboxWorkspace({
        baseCwd,
        workspaceIdentity,
        hostProjectRoot: '/virtual/project',
      })

      expect(second.scopedFs.readFileSync('/virtual/project/src/keep.ts', { encoding: 'utf8' })).toBe('keep\n')
      expect(() => second.scopedFs.readFileSync('/virtual/project/src/remove.ts', { encoding: 'utf8' })).toThrow(
        /ENOENT/i,
      )
    } finally {
      fs.rmSync(baseCwd, { recursive: true, force: true })
    }
  })

  test('does not persist dot-prefixed files or directories to S3', async () => {
    const baseCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aistudio-s3-ephemeral-'))
    const workspaceIdentity = 'ephemeral-demo'

    try {
      const prepared = await prepareAgentSandboxWorkspace({
        baseCwd,
        workspaceIdentity,
        hostProjectRoot: '/virtual/project',
        projectFiles: {
          '/src/keep.ts': { code: 'keep\n' },
        },
      })

      prepared.scopedFs.mkdirSync('/virtual/project/.tmp', { recursive: true })
      prepared.scopedFs.writeFileSync('/virtual/project/.tmp/runtime.tmp', 'tmp\n')
      prepared.scopedFs.mkdirSync('/virtual/project/.cache', { recursive: true })
      prepared.scopedFs.writeFileSync('/virtual/project/.cache/cache.bin', 'cache\n')
      prepared.scopedFs.mkdirSync('/virtual/project/.state', { recursive: true })
      prepared.scopedFs.writeFileSync('/virtual/project/.state/state.json', '{}\n')
      prepared.scopedFs.mkdirSync('/virtual/project/.config', { recursive: true })
      prepared.scopedFs.writeFileSync('/virtual/project/.config/tool.conf', 'x=1\n')
      prepared.scopedFs.mkdirSync('/virtual/project/.npm', { recursive: true })
      prepared.scopedFs.writeFileSync('/virtual/project/.npm/_update-notifier-last-checked', 'x\n')
      prepared.scopedFs.mkdirSync('/virtual/project/src/.hidden-dir', { recursive: true })
      prepared.scopedFs.writeFileSync('/virtual/project/src/.hidden-dir/secret.txt', 'secret\n')
      prepared.scopedFs.writeFileSync('/virtual/project/src/.env', 'A=1\n')

      await prepared.persistToS3()

      const objectKeys = [...s3MockState.objects.keys()]
      expect(objectKeys.some(key => key.includes('/files/.tmp/'))).toBe(false)
      expect(objectKeys.some(key => key.includes('/files/.cache/'))).toBe(false)
      expect(objectKeys.some(key => key.includes('/files/.state/'))).toBe(false)
      expect(objectKeys.some(key => key.includes('/files/.config/'))).toBe(false)
      expect(objectKeys.some(key => key.includes('/files/.npm/'))).toBe(false)
      expect(objectKeys.some(key => key.includes('/files/src/.hidden-dir/'))).toBe(false)
      expect(objectKeys.some(key => key.includes('/files/src/.env'))).toBe(false)
      expect(objectKeys.some(key => key.endsWith('/files/src/keep.ts'))).toBe(true)
    } finally {
      fs.rmSync(baseCwd, { recursive: true, force: true })
    }
  })
})
