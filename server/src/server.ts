import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  TextDocumentSyncKind,
  InitializeResult, 
  PublishDiagnosticsParams
} from 'vscode-languageserver'

import * as handlers from './handlers'
import * as jobs from './engine/jobs'

import { TextDocument } from 'vscode-languageserver-textdocument'

const _ = require('lodash/fp')

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all)

// Create a simple text document manager.
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

let hasConfigurationCapability: boolean = false
let hasWorkspaceFolderCapability: boolean = false
let hasDiagnosticRelatedInformationCapability: boolean = false

connection.onInitialize((params: InitializeParams) => {
  let capabilities = params.capabilities

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  )
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  )
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  )

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: true
      },
      hoverProvider: true,
      definitionProvider: true
    }
  }
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true
      }
    }
  }

  return result
})

connection.onInitialized((_params) => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(DidChangeConfigurationNotification.type, undefined)
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(_event => {
      connection.console.log('Workspace folder change event received.')
    })
  }
})

connection.onNotification(jobs.Request.internalReady, handlers.handleReady)

connection.onNotification(jobs.Request.apiAddUri, handlers.handleAddUri)

connection.onNotification(jobs.Request.apiRemUri, handlers.handleRemUri)

connection.onExit(handlers.handleExit)

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(handlers.handleChangeContent)

// Document has been saved
documents.onDidSave(handlers.handleChangeContent)

// Hover over [line, character]
connection.onHover(handlers.handleHover)

// Go to definition (from context menu or F12 usually)
connection.onDefinition(handlers.handleGotoDefinition)

/**
 * Send arbitrary notifications back to the client.
 * 
 * @param notificationType {String} - Notification key, has to match a listener in the client
 * @param payload {*} - Anything (can be empty)
 */
export function sendNotification (notificationType: string, payload?: any) {
  connection.sendNotification(notificationType, payload)
}

// A set of files that previously had errors which should be cleared when a new lsp/check is performed
// VS Code remembers files with errors and won't clear them itself.
let fileUrisWithErrors: Set<string> = new Set()

/**
 * Clear `fileUrisWithErrors` after removing error flags for all `uri`s.
 */
export function clearDiagnostics () {
  fileUrisWithErrors.forEach((uri: string) => sendDiagnostics({ uri, diagnostics: [] }))
  fileUrisWithErrors.clear()
}

/**
 * Proxy for `connection.sendDiagnostics` that also adds the `uri` to `fileUrisWithErrors`.
 */
export function sendDiagnostics (params: PublishDiagnosticsParams) {
  fileUrisWithErrors.add(params.uri)
  connection.sendDiagnostics(params)
}

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection)

// Listen on the connection
connection.listen()
