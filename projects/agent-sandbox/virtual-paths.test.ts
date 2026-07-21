import { describe, expect, test } from 'bun:test'
import { resolveVirtualWorkspacePaths } from './virtual-paths'

const root = '/workspace/example'

describe('resolveVirtualWorkspacePaths', () => {
  test('resolves standalone virtual paths', () => {
    expect(resolveVirtualWorkspacePaths('cd /skills/xlsx && ls /.files/a.xlsx', root)).toBe(
      'cd /workspace/example/skills/xlsx && ls /workspace/example/.files/a.xlsx',
    )
  })

  test('resolves paths inside quoted script source without changing quoting', () => {
    const command = `python3 -c '\nfile_path = "/.files/a.xlsx"\nprint(file_path)\n'`
    expect(resolveVirtualWorkspacePaths(command, root)).toBe(
      `python3 -c '\nfile_path = "/workspace/example/.files/a.xlsx"\nprint(file_path)\n'`,
    )
  })

  test('does not rewrite URL path segments', () => {
    expect(resolveVirtualWorkspacePaths('curl https://example.com/skills/xlsx', root)).toBe(
      'curl https://example.com/skills/xlsx',
    )
  })
})
