import type { ZodRawShape, infer as ZodInfer, ZodObject } from 'zod'

/**
 * Where a tool's effect lands.
 *
 * `server` tools mutate the database or call an external API and return a
 * result directly. `client` tools mutate state that only exists in the
 * browser — the open email-builder design, the unsaved persona form — so
 * their effect is queued and streamed back for the client to apply.
 */
type ToolTarget = 'server' | 'client'

/** Client-owned state the browser syncs into the session so tools can read it. */
export interface CopilotClientState {
  /** Route the user is on, e.g. `/marketing/campaigns/12`. */
  route?: string
  /** The user's IANA time zone, e.g. `Europe/London`, for dates like a task's due time. */
  timeZone?: string
  builder?: {
    blocks: unknown[]
    globalStyle: Record<string, unknown>
    selectedBlockId?: string | null
  }
  persona?: Record<string, unknown>
  campaign?: {
    id: number
    name: string
    subject?: string
  }
  /** Set when the email builder is editing a saved template rather than a campaign. */
  template?: {
    id: string
    name: string
  }
  /** The survey builder's live, possibly unsaved, design. */
  surveyBuilder?: {
    surveyId: string
    pages: unknown[]
    theme: Record<string, unknown>
    selectedPageId?: string | null
    selectedBlockId?: string | null
  }
  survey?: {
    id: string
    name: string
    status: string
    /** Real responses exist, so questions and options can't be deleted. */
    hasResponses?: boolean
  }
}

/** A mutation produced by a `client` tool, drained by the SSE stream. */
export interface ClientAction {
  action: string
  args: unknown
}

export interface ToolContext {
  sessionId: string
  getClientState: () => CopilotClientState
  /** Queue a mutation for the browser to apply to its local state. */
  emitClientAction: (action: ClientAction) => void
}

/**
 * A copilot tool. The Zod shape is the single source of truth: it becomes the
 * MCP input schema, the runtime validator, and the generated prompt reference.
 * Nothing is written twice, so nothing can drift.
 */
export interface CopilotTool<Shape extends ZodRawShape = ZodRawShape> {
  name: string
  /** Shown to the model. Say what it does *and* when to reach for it. */
  description: string
  input: Shape
  target: ToolTarget
  /**
   * Irreversible or outward-facing. Gated behind approval in every permission
   * mode except `bypass` — see `permissions.ts`.
   */
  destructive?: boolean
  /** Read-only. Never gated, and safe to retry. */
  readOnly?: boolean
  /**
   * Only works against a design open in the browser (the live builder state),
   * so it's left out of the public MCP server that outside AI apps use.
   */
  browserOnly?: boolean
  /** Spends paid credits (SocialFetch). Said so to outside AI apps, which run tools unattended. */
  costsCredits?: boolean
  handler: (
    args: ZodInfer<ZodObject<Shape>>,
    ctx: ToolContext,
  ) => Promise<unknown>
}

/**
 * Returned by a tool that wants the model to *look* at something.
 *
 * The MCP layer turns this into an image content block alongside the text, so
 * the model receives the rendered pixels rather than a description of them.
 */
export interface ToolImageResult {
  __image: { data: string; mimeType: string }
  [key: string]: unknown
}

export function isImageResult(value: unknown): value is ToolImageResult {
  return typeof value === 'object' && value !== null && '__image' in value
}

/** Helper that preserves the shape's type through the registry. */
export function defineTool<Shape extends ZodRawShape>(
  tool: CopilotTool<Shape>,
): CopilotTool<Shape> {
  return tool
}
