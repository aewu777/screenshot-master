/**
 * OpenCode host adapter.
 *
 * OpenCode 2.x loads plugin packages by their default export: `{ id, setup }`.
 * Inside `setup` a plugin registers tools with `ctx.tool.transform`, which is a
 * synchronous transform over the tool registry; `setup` may return a cleanup
 * function.
 *
 * This adapter only maps. The tool definitions, argument validation and capture
 * logic come from the same host-neutral modules the DeepSeek Harness adapter
 * uses, so the two hosts cannot drift apart in tool names, schemas or wording.
 *
 * The types below mirror `@opencode/plugin` 2.x without importing it: the
 * package is provided by OpenCode at runtime and the plugin should not depend on
 * a specific copy of it.
 */

import type { ScreenshotService } from '../capture.js'
import type { ScreenshotConfig } from '../config.js'
import { toScreenshotError } from '../errors.js'
import { type Logger } from '../capture.js'
import { createRuntime } from '../runtime.js'
import type { JsonSchemaNode, ToolDefinition } from '../toolkit.js'
import { buildToolDefinitions } from '../tools.js'

export const OPENCODE_PLUGIN_ID = 'screenshot-master'

/** A content part OpenCode accepts as a tool result. */
export interface OpencodeTextContent {
  readonly type: 'text'
  readonly text: string
}

/**
 * A tool result OpenCode accepts.
 *
 * `output` is deliberately absent: OpenCode rejects a result that carries
 * `output` when the tool declares no output schema, and this adapter does not
 * declare one. The model reads the text, not a structured payload.
 */
export interface OpencodeToolResult {
  readonly content?: string | readonly OpencodeTextContent[]
  readonly metadata?: Readonly<Record<string, unknown>>
}

/**
 * Executor context. `signal` aborts when the user stops the call; the real
 * OpenCode context also carries session and message ids, which this plugin does
 * not need.
 */
export interface OpencodeToolContext {
  readonly signal?: AbortSignal
}

export interface OpencodeToolOptions {
  /**
   * `false` keeps the tool directly callable instead of exposing it inside the
   * Code Mode tool namespace.
   */
  readonly codemode?: boolean
}

/** The subset of OpenCode's `Tool.Info` this adapter produces. */
export interface OpencodeTool {
  readonly name: string
  readonly description: string
  readonly input: JsonSchemaNode
  readonly options?: OpencodeToolOptions
  execute(input: unknown, context: OpencodeToolContext): Promise<OpencodeToolResult>
}

export interface OpencodeToolEditor {
  add(tool: OpencodeTool): void
}

export interface OpencodeRegistration {
  dispose(): Promise<void> | void
}

export interface OpencodeToolDomain {
  transform(callback: (editor: OpencodeToolEditor) => void): Promise<OpencodeRegistration>
}

/** The subset of OpenCode's plugin `Context` this adapter uses. */
export interface OpencodePluginContext {
  readonly options?: Record<string, unknown>
  readonly tool: OpencodeToolDomain
}

export interface OpencodeSetupOptions {
  /** Overrides `process.platform`; used by tests. */
  platform?: string
  /** Overrides the whole service; used by tests. */
  service?: ScreenshotService
  logger?: Logger
  /** Extra configuration merged over the plugin options. */
  config?: Record<string, unknown>
}

export interface OpencodeSetupResult {
  service: ScreenshotService
  config: ScreenshotConfig
  /** Removes the tool registration from the OpenCode registry. */
  dispose(): Promise<void>
}

/** Render the definition's model-facing text block. */
function renderResult(definition: ToolDefinition, args: unknown, value: unknown): string {
  return definition.output
    .render(args, value)
    .map((block) => block.text)
    .join('\n')
}

/**
 * OpenCode surfaces a rejected executor as a failed tool call. Keep the stable
 * error code on the error object so logs and tests can assert on it, and keep
 * the message actionable.
 */
function toToolError(error: unknown): Error {
  const normalized = toScreenshotError(error)
  const failure = new Error(normalized.toMessage(), { cause: normalized })
  failure.name = 'ScreenshotError'
  return Object.assign(failure, { code: normalized.code })
}

/** Map one host-neutral tool definition onto OpenCode's tool shape. */
export function toOpencodeTool(definition: ToolDefinition): OpencodeTool {
  return {
    name: definition.name,
    description: definition.description,
    input: definition.parameters,
    options: { codemode: false },
    async execute(input, context) {
      const args = (input ?? {}) as Record<string, unknown>
      try {
        const value = await definition.execute(
          args,
          context?.signal ? { signal: context.signal } : {},
        )
        return { content: renderResult(definition, args, value) }
      } catch (error) {
        throw toToolError(error)
      }
    },
  }
}

/**
 * Build the service, register the three tools, and return a disposer.
 *
 * Exported separately from the default plugin export so the whole registration
 * path can be tested without OpenCode.
 */
export async function setup(
  ctx: OpencodePluginContext,
  options: OpencodeSetupOptions = {},
): Promise<OpencodeSetupResult> {
  if (!ctx || typeof ctx !== 'object' || !ctx.tool || typeof ctx.tool.transform !== 'function') {
    throw new Error(
      'screenshot-master: the OpenCode plugin context has no tool domain (ctx.tool.transform).',
    )
  }

  const rawConfig = { ...(ctx.options ?? {}), ...(options.config ?? {}) }
  const { service, config } = createRuntime(rawConfig, {
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.service === undefined ? {} : { service: options.service }),
  })

  const definitions = buildToolDefinitions(service)
  const registration = await ctx.tool.transform((editor) => {
    for (const definition of definitions) editor.add(toOpencodeTool(definition))
  })

  return {
    service,
    config,
    async dispose() {
      await registration.dispose()
    },
  }
}

const plugin = {
  id: OPENCODE_PLUGIN_ID,
  async setup(ctx: OpencodePluginContext): Promise<() => Promise<void>> {
    const { dispose } = await setup(ctx)
    return dispose
  },
}

export default plugin
