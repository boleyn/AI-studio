import { describe, expect, test } from 'bun:test'
import { buildProjectMemfsOverlay } from 'src/server/agent/runtime/claudeQueryAdapter'
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

  test('finds Chinese content in files_with_matches mode', async () => {
    const overlay = buildProjectMemfsOverlay(projectRoot, {
      '/src/app.tsx': { code: 'export default function App() { return "欢迎来到 AI3 Studio"; }\n' },
      '/src/other.ts': { code: 'export const other = "hello";\n' },
    })

    const result = await runWithVirtualProjectRoot(projectRoot, () =>
      runWithFsImplementation(overlay, () =>
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
  })

  test('returns matching content lines with line numbers', async () => {
    const overlay = buildProjectMemfsOverlay(projectRoot, {
      '/src/app.tsx': {
        code: ['const title = "欢迎来到 AI3 Studio";', 'console.log(title);'].join('\n'),
      },
    })

    const result = await runWithVirtualProjectRoot(projectRoot, () =>
      runWithFsImplementation(overlay, () =>
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
  })

  test('respects glob filters in virtual filesystem mode', async () => {
    const overlay = buildProjectMemfsOverlay(projectRoot, {
      '/src/app.tsx': { code: 'export const label = "欢迎来到 AI3 Studio";\n' },
      '/docs/readme.md': { code: '# 欢迎来到 AI3 Studio\n' },
    })

    const result = await runWithVirtualProjectRoot(projectRoot, () =>
      runWithFsImplementation(overlay, () =>
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
  })

  test('includes context lines for content mode', async () => {
    const overlay = buildProjectMemfsOverlay(projectRoot, {
      '/src/app.tsx': {
        code: ['line before', '欢迎来到 AI3 Studio', 'line after'].join('\n'),
      },
    })

    const result = await runWithVirtualProjectRoot(projectRoot, () =>
      runWithFsImplementation(overlay, () =>
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
  })
})
