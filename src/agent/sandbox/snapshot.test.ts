import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  applySandboxWorkspaceSnapshot,
  collectSandboxWorkspaceSnapshot,
} from './snapshot'

describe('agent sandbox workspace synchronization', () => {
  test('includes project files, attachments and skills while excluding runtime state', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aistudio-sandbox-sync-'))
    try {
      const files: Record<string, string> = {
        'src/index.ts': 'project\n',
        '.files/input.pdf': 'pdf\n',
        'skills/pdf/SKILL.md': 'built-in skill\n',
        '.aistudio/skills/custom/SKILL.md': 'custom skill\n',
        '.aistudio/settings.json': 'secret config\n',
        '.config/tool.json': 'runtime config\n',
        '.git/config': 'git config\n',
      }
      for (const [relativePath, content] of Object.entries(files)) {
        const absolutePath = path.join(root, relativePath)
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
        fs.writeFileSync(absolutePath, content)
      }

      const snapshot = await collectSandboxWorkspaceSnapshot(root)
      const paths = snapshot.files.map(file => file.path)
      expect(paths).toContain('src/index.ts')
      expect(paths).toContain('.files/input.pdf')
      expect(paths).toContain('skills/pdf/SKILL.md')
      expect(paths).toContain('.aistudio/skills/custom/SKILL.md')
      expect(paths).not.toContain('.aistudio/settings.json')
      expect(paths).not.toContain('.config/tool.json')
      expect(paths).not.toContain('.git/config')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('replaces stale workspace contents and preserves executable mode', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aistudio-sandbox-sync-'))
    try {
      fs.writeFileSync(path.join(root, 'stale.txt'), 'stale\n')
      await applySandboxWorkspaceSnapshot(root, {
        files: [
          {
            path: 'scripts/run.sh',
            contentBase64: Buffer.from('#!/bin/sh\necho ok\n').toString('base64'),
            mode: 0o755,
          },
        ],
      })

      expect(fs.existsSync(path.join(root, 'stale.txt'))).toBe(false)
      expect(fs.readFileSync(path.join(root, 'scripts/run.sh'), 'utf8')).toContain(
        'echo ok',
      )
      expect(fs.statSync(path.join(root, 'scripts/run.sh')).mode & 0o777).toBe(
        0o755,
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects traversal and duplicate paths before deleting current files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aistudio-sandbox-sync-'))
    try {
      fs.writeFileSync(path.join(root, 'keep.txt'), 'keep\n')
      await expect(
        applySandboxWorkspaceSnapshot(root, {
          files: [
            {
              path: '../escape.txt',
              contentBase64: Buffer.from('bad').toString('base64'),
            },
          ],
        }),
      ).rejects.toThrow(/invalid sandbox snapshot path/i)
      expect(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8')).toBe('keep\n')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('can apply command results without deleting local runtime configuration', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aistudio-sandbox-sync-'))
    try {
      fs.mkdirSync(path.join(root, '.aistudio'), { recursive: true })
      fs.writeFileSync(path.join(root, '.aistudio/settings.json'), 'keep config\n')
      fs.writeFileSync(path.join(root, 'removed-by-command.txt'), 'old\n')

      await applySandboxWorkspaceSnapshot(
        root,
        {
          files: [
            {
              path: 'created-by-command.txt',
              contentBase64: Buffer.from('new\n').toString('base64'),
            },
          ],
        },
        { preserveExcludedPaths: true },
      )

      expect(fs.existsSync(path.join(root, 'removed-by-command.txt'))).toBe(false)
      expect(fs.readFileSync(path.join(root, 'created-by-command.txt'), 'utf8')).toBe(
        'new\n',
      )
      expect(fs.readFileSync(path.join(root, '.aistudio/settings.json'), 'utf8')).toBe(
        'keep config\n',
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

test('exports a generated binary artifact without changing its bytes', async () => {
  const { HostDirFileSystem } = await import('./environments/hostDirFs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aistudio-artifact-'))
  try {
    // Invalid UTF-8 without a NUL byte still needs binary encoding.
    const original = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    fs.writeFileSync(path.join(root, 'output.jpg'), original)
    fs.writeFileSync(path.join(root, 'summary.md'), '工作成果\n')

    const exported = await new HostDirFileSystem(root).exportTextFiles()
    const encoded = exported['/output.jpg'].code
    expect(encoded).toStartWith('data:application/octet-stream;base64,')
    expect(Buffer.from(encoded.split(',')[1], 'base64')).toEqual(original)
    expect(exported['/summary.md'].code).toBe('工作成果\n')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
