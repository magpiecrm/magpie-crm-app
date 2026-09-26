import crypto from 'crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { applyBuilderAction } from '../../features/email-builder/applyAction'
import { SURVEY_ACTION_PREFIX, applySurveyBuilderAction } from '../../features/survey-builder/applyAction'
import { COPILOT_TOOLS } from './tools'
import { emitEvent, getSession, pushDesignSnapshot, pushSurveyDesignSnapshot } from './state'
import { needsApproval } from './permissions'
import type { CopilotSessionState } from './state'
import { isImageResult } from './types'
import { APP_NAME } from '../../brand'
import type { ClientAction, CopilotTool, ToolContext } from './types'

/** How long a blocked tool call waits for the user before giving up. */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Block until the user approves this call, or the request times out.
 *
 * The promise is held open inside the MCP handler, so the model is genuinely
 * paused — a denial means the tool never runs, rather than running and being
 * reported afterwards.
 */
async function awaitApproval(sessionId: string, tool: CopilotTool<any>, args: unknown): Promise<boolean> {
  const session = getSession(sessionId)
  if (!session) return false

  const id = crypto.randomUUID()
  return new Promise<boolean>(resolve => {
    let settled = false
    const settle = (approved: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      session.pendingApprovals.delete(id)
      resolve(approved)
    }

    const timer = setTimeout(() => settle(false), APPROVAL_TIMEOUT_MS)
    session.pendingApprovals.set(id, settle)

    emitEvent(sessionId, {
      type: 'permission_request',
      id,
      tool: tool.name,
      args,
      reason: tool.destructive
        ? 'This permanently changes data.'
        : 'Approval is required for every change in this mode.',
    })

    // Nobody is listening (no open stream), so nothing can ever approve it.
    if (session.listeners.size === 0) settle(false)
  })
}

/** Mirror a client-targeted mutation onto the server's copy of browser state. */
function applyToClientState(session: CopilotSessionState, action: ClientAction) {
  if (action.action === 'updatePersona') {
    session.clientState.persona = {
      ...(session.clientState.persona ?? {}),
      ...(action.args as Record<string, unknown>),
    }
    return
  }

  if (action.action.startsWith(SURVEY_ACTION_PREFIX)) {
    const surveyBuilder = session.clientState.surveyBuilder
    if (!surveyBuilder) return
    const next = applySurveyBuilderAction(
      { pages: surveyBuilder.pages as any, theme: surveyBuilder.theme as any },
      { action: action.action, args: action.args },
    )
    session.clientState.surveyBuilder = {
      ...surveyBuilder,
      pages: next.pages,
      theme: next.theme as unknown as Record<string, unknown>,
    }
    return
  }

  const builder = session.clientState.builder
  if (!builder) return
  const next = applyBuilderAction(
    { blocks: builder.blocks as any, globalStyle: builder.globalStyle as any },
    { action: action.action, args: action.args },
  )
  session.clientState.builder = {
    ...builder,
    blocks: next.blocks,
    globalStyle: next.globalStyle as unknown as Record<string, unknown>,
  }
}

export interface Gate {
  needsApproval(tool: CopilotTool<any>): boolean
  awaitApproval(tool: CopilotTool<any>, args: unknown): Promise<boolean>
}

type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export interface ToolOutcome {
  isError?: boolean
  content: ToolContent[]
}

/**
 * Run one tool call: ask for approval when the gate says so, run the handler,
 * and turn the result (or failure) into content for the model. Shared by the
 * MCP servers and the OpenAI loop, so every model gets the same tools, the
 * same approvals and the same error text.
 */
export async function executeTool(tool: CopilotTool<any>, args: unknown, ctx: ToolContext, gate: Gate | null): Promise<ToolOutcome> {
  try {
    if (gate?.needsApproval(tool)) {
      const approved = await gate.awaitApproval(tool, args)
      if (!approved) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `${tool.name} was declined by the user. Do not retry it; ask what they would like instead.`,
          }],
        }
      }
    }

    const result = await tool.handler(args as any, ctx)

    // Tools that render something return the pixels too, so the model can
    // actually look at its own output instead of reasoning about markup.
    if (isImageResult(result)) {
      const { __image, ...rest } = result
      return {
        content: [
          { type: 'text', text: JSON.stringify(rest, null, 2) },
          { type: 'image', data: __image.data, mimeType: __image.mimeType },
        ],
      }
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  } catch (err: any) {
    // Return the failure as a tool error rather than throwing, so the
    // model sees what went wrong and can correct itself. The old harness
    // surfaced validation failures straight to the user and gave up.
    return {
      isError: true,
      content: [{ type: 'text', text: `${tool.name} failed: ${err?.message ?? String(err)}` }],
    }
  }
}

/**
 * Register `tools` on `server`. Shared by the in-app copilot (with its approval
 * gate) and the public MCP server (without one: outside AI apps ask their own
 * user before running a tool that isn't read-only).
 */
function registerTools(
  server: McpServer,
  tools: CopilotTool<any>[],
  ctx: ToolContext,
  gate: Gate | null,
  describe: (tool: CopilotTool<any>) => string = (tool) => tool.description,
) {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: describe(tool),
        inputSchema: tool.input,
        annotations: {
          readOnlyHint: tool.readOnly ?? false,
          destructiveHint: tool.destructive ?? false,
          // Paid searches reach out to SocialFetch.
          openWorldHint: tool.costsCredits ?? false,
        },
      },
      (args: any) => executeTool(tool, args, ctx, gate) as Promise<any>,
    )
  }
}

/**
 * Tools an outside AI app (Claude, ChatGPT, Cursor, …) can use: everything that
 * works on the server's data. Tools that edit a design open in the browser
 * only make sense inside the app's own copilot, so they're left out.
 */
export const PUBLIC_TOOLS = COPILOT_TOOLS.filter((t) => t.target === 'server' && !t.browserOnly)

/** The public MCP server behind `/api/mcp`, for one authenticated MCP key. */
export function buildPublicMcpServer(): McpServer {
  const server = new McpServer(
    { name: APP_NAME, version: '1.0.0' },
    {
      instructions:
        `Tools for ${APP_NAME}, a B2B prospecting and email marketing app. Read before you write: call getLists, getCampaigns or getSavedTemplates to get real IDs rather than guessing. ` +
        'searchPeople and searchCompanies spend the account owner\'s SocialFetch credits on every call, so only search when the user asked for it and keep result counts small. ' +
        'Designing emails visually happens in the app\'s own builder; here you can work with saved templates, campaigns, lists, contacts, surveys and personas.',
    },
  )
  const ctx: ToolContext = {
    sessionId: 'public-mcp',
    getClientState: () => ({}),
    emitClientAction: () => {
      throw new Error('That only works inside the app\'s own copilot, with the builder open.')
    },
  }
  registerTools(server, PUBLIC_TOOLS, ctx, null, (tool) =>
    tool.costsCredits ? `${tool.description} Spends SocialFetch credits on every call.` : tool.description,
  )
  return server
}

/**
 * Build an MCP server exposing the copilot tool registry, bound to one
 * conversation.
 *
 * This runs in-process rather than as a spawned stdio server: the tool handlers
 * need the same database and the same per-session client state as the rest of
 * the app, and an HTTP transport on localhost gets that with no IPC and no
 * second copy of the data layer.
 */
export function buildMcpServer(sessionId: string): McpServer {
  const server = new McpServer(
    { name: 'email-marketing', version: '1.0.0' },
    {
      instructions:
        'Tools for this prospecting and email marketing app. Read before you write: call getLists/getCampaigns/getBlocks to obtain real IDs rather than guessing them.',
    },
  )

  registerTools(server, COPILOT_TOOLS, sessionToolContext(sessionId), sessionGate(sessionId))
  return server
}

/**
 * The approval gate for one in-app copilot conversation: its permission mode
 * decides what needs asking, and the user answers in the chat.
 */
export function sessionGate(sessionId: string): Gate {
  return {
    needsApproval: (tool) => needsApproval(tool.name, getSession(sessionId)?.permissionMode ?? 'ask'),
    awaitApproval: (tool, args) => awaitApproval(sessionId, tool, args),
  }
}

/** Tool context for one in-app copilot conversation, with its live browser state. */
export function sessionToolContext(sessionId: string): ToolContext {
  return {
    sessionId,
    getClientState: () => getSession(sessionId)?.clientState ?? {},
    emitClientAction: (action) => {
      const session = getSession(sessionId)
      if (!session) {
        throw new Error('Copilot session has expired. Ask the user to send the message again.')
      }
      // Snapshot before mutating so `undoLastChange` has something to restore.
      // `restoreDesign` is itself the undo, so it must not record one.
      if (action.action.startsWith(SURVEY_ACTION_PREFIX)) {
        if (action.action !== 'survey.restoreDesign') pushSurveyDesignSnapshot(session, action.action)
      } else if (action.action !== 'restoreDesign' && action.action !== 'updatePersona') {
        pushDesignSnapshot(session, action.action)
      }
      session.pendingClientActions.push(action)
      // Apply it to our copy too, using the same reducer the browser runs.
      // Otherwise getBlocks/compileEmail keep reporting the design as it was at
      // the start of the turn, and the model loops trying to make its own edits
      // take effect.
      applyToClientState(session, action)
    },
  }
}
