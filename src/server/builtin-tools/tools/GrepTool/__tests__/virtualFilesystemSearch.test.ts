import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prepareAgentSandboxWorkspace } from 'src/server/agent/runtime/agentSandboxWorkspace'
import {
  runWithFsImplementation,
  runWithVirtualProjectRoot,
} from 'src/utils/fsOperations.js'
import {
  grepVirtualFilesystem,
  splitGlobPatterns,
} from '../virtualFilesystemSearch'

describe('grepVirtualFilesystem', () => {
  const projectRoot = '/virtual/project'

  const createScopedSandboxFs = async (projectFiles: Record<string, { code?: string }>) => {
    const baseCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aistudio-grep-vfs-'))
    const prepared = await prepareAgentSandboxWorkspace({
      baseCwd,
      workspaceIdentity: `grep-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      hostProjectRoot: projectRoot,
      projectFiles,
    })

    return {
      scopedFs: prepared.scopedFs,
      cleanup: () => fs.rmSync(baseCwd, { recursive: true, force: true }),
    }
  }

  test('finds Chinese content in files_with_matches mode', async () => {
    const sandbox = await createScopedSandboxFs({
      '/src/app.tsx': { code: 'export default function App() { return "欢迎来到 AI3 Studio"; }\n' },
      '/src/other.ts': { code: 'export const other = "hello";\n' },
    })

    try {
      const result = await runWithVirtualProjectRoot(projectRoot, () =>
        runWithFsImplementation(sandbox.scopedFs, () =>
          grepVirtualFilesystem({
            pattern: '欢迎来到 AI3 Studio',
            absolutePath: projectRoot,
            outputMode: 'files_with_matches',
            caseInsensitive: false,
            showLineNumbers: true,
          }),
        ),
      )

      expect(result).toEqual([`${projectRoot}/src/app.tsx`])
    } finally {
      sandbox.cleanup()
    }
  })

  test('returns matching content lines with line numbers', async () => {
    const sandbox = await createScopedSandboxFs({
      '/src/app.tsx': {
        code: ['const title = "欢迎来到 AI3 Studio";', 'console.log(title);'].join('\n'),
      },
    })

    try {
      const result = await runWithVirtualProjectRoot(projectRoot, () =>
        runWithFsImplementation(sandbox.scopedFs, () =>
          grepVirtualFilesystem({
            pattern: '欢迎来到 AI3 Studio',
            absolutePath: projectRoot,
            outputMode: 'content',
            caseInsensitive: false,
            showLineNumbers: true,
          }),
        ),
      )

      expect(result).toContain(
        `${projectRoot}/src/app.tsx:1:const title = "欢迎来到 AI3 Studio";`,
      )
    } finally {
      sandbox.cleanup()
    }
  })

  test('respects glob filters in virtual filesystem mode', async () => {
    const sandbox = await createScopedSandboxFs({
      '/src/app.tsx': { code: 'export const label = "欢迎来到 AI3 Studio";\n' },
      '/docs/readme.md': { code: '# 欢迎来到 AI3 Studio\n' },
    })

    try {
      const result = await runWithVirtualProjectRoot(projectRoot, () =>
        runWithFsImplementation(sandbox.scopedFs, () =>
          grepVirtualFilesystem({
            pattern: '欢迎来到 AI3 Studio',
            absolutePath: projectRoot,
            outputMode: 'files_with_matches',
            caseInsensitive: false,
            showLineNumbers: true,
            globPatterns: splitGlobPatterns('*.md'),
          }),
        ),
      )

      expect(result).toEqual([`${projectRoot}/docs/readme.md`])
    } finally {
      sandbox.cleanup()
    }
  })

  test('includes context lines for content mode', async () => {
    const sandbox = await createScopedSandboxFs({
      '/src/app.tsx': {
        code: ['line before', '欢迎来到 AI3 Studio', 'line after'].join('\n'),
      },
    })

    try {
      const result = await runWithVirtualProjectRoot(projectRoot, () =>
        runWithFsImplementation(sandbox.scopedFs, () =>
          grepVirtualFilesystem({
            pattern: '欢迎来到 AI3 Studio',
            absolutePath: projectRoot,
            outputMode: 'content',
            caseInsensitive: false,
            showLineNumbers: true,
            contextBefore: 1,
            contextAfter: 1,
          }),
        ),
      )

      expect(result).toEqual([
        `${projectRoot}/src/app.tsx:1:line before`,
        `${projectRoot}/src/app.tsx:2:欢迎来到 AI3 Studio`,
        `${projectRoot}/src/app.tsx:3:line after`,
      ])
    } finally {
      sandbox.cleanup()
    }
  })
})
