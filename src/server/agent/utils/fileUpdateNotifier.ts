import { clearDeliveredDiagnosticsForFile } from 'src/services/lsp/LSPDiagnosticRegistry.js'
import { getLspServerManager } from 'src/services/lsp/manager.js'
import { notifyVscodeFileUpdated } from 'src/services/mcp/vscodeSdkMcp.js'
import { logForDebugging } from './debug.js'
import { logError } from './log.js'

type NotifyFileUpdateOptions = {
  syncLsp?: boolean
  clearLspDiagnostics?: boolean
}

/**
 * Unified file-update notifier for editor/file-tree refresh signals.
 * - Always sends VSCode MCP file_updated notification
 * - Optionally emits LSP didChange/didSave for text updates
 */
export function notifyFileUpdated(
  filePath: string,
  oldContent: string | null,
  newContent: string | null,
  options?: NotifyFileUpdateOptions,
): void {
  const syncLsp = options?.syncLsp === true
  const clearLspDiagnostics = options?.clearLspDiagnostics === true

  if (syncLsp) {
    const lspManager = getLspServerManager()
    if (lspManager && typeof newContent === 'string') {
      if (clearLspDiagnostics) {
        clearDeliveredDiagnosticsForFile(`file://${filePath}`)
      }

      lspManager.changeFile(filePath, newContent).catch((err: Error) => {
        logForDebugging(
          `LSP: Failed to notify server of file change for ${filePath}: ${err.message}`,
        )
        logError(err)
      })

      lspManager.saveFile(filePath).catch((err: Error) => {
        logForDebugging(
          `LSP: Failed to notify server of file save for ${filePath}: ${err.message}`,
        )
        logError(err)
      })
    }
  }

  notifyVscodeFileUpdated(filePath, oldContent, newContent)
}
