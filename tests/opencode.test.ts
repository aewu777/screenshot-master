import { describe, expect, it, vi } from 'vitest'
import { ScreenshotError } from '../src/errors.js'
import plugin, {
  OPENCODE_PLUGIN_ID,
  setup,
  toOpencodeTool,
  type OpencodePluginContext,
  type OpencodeTool,
} from '../src/hosts/opencode.js'
import {
  FakeBackend,
  createTestService,
  makeTempDirectory,
  sequenceRandom,
} from './helpers/fakes.js'

interface Harness {
  context: OpencodePluginContext
  tools: OpencodeTool[]
  disposed: ReturnType<typeof vi.fn>
}

function makeHarness(options: Record<string, unknown> = {}): Harness {
  const tools: OpencodeTool[] = []
  const disposed = vi.fn(async () => undefined)
  const context: OpencodePluginContext = {
    options,
    tool: {
      async transform(callback) {
        callback({
          add(tool) {
            tools.push(tool)
          },
        })
        return { dispose: disposed }
      },
    },
  }
  return { context, tools, disposed }
}

function toolNamed(tools: OpencodeTool[], name: string): OpencodeTool {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`no tool named ${name}`)
  return tool
}

async function withHarness(
  run: (context: {
    tools: OpencodeTool[]
    backend: FakeBackend
    directory: string
    configOutputDir: string
  }) => Promise<void>,
  backend: FakeBackend = new FakeBackend(),
): Promise<void> {
  const temp = await makeTempDirectory()
  try {
    const { service } = createTestService({
      backend,
      outputDir: temp.path,
      random: sequenceRandom(),
    })
    const harness = makeHarness({ outputDir: temp.path })
    const result = await setup(harness.context, { platform: 'win32', service })
    try {
      await run({
        tools: harness.tools,
        backend,
        directory: temp.path,
        configOutputDir: result.config.outputDir,
      })
    } finally {
      await result.dispose()
    }
    expect(harness.disposed).toHaveBeenCalledTimes(1)
  } finally {
    await temp.cleanup()
  }
}

describe('OpenCode adapter', () => {
  it('registers the same three tools as the dsh adapter', async () => {
    await withHarness(async ({ tools }) => {
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'list_windows',
        'screenshot_screen',
        'screenshot_window',
      ])

      for (const tool of tools) {
        expect(tool.description.length).toBeGreaterThan(0)
        expect(tool.input.type).toBe('object')
        expect(tool.options).toEqual({ codemode: false })
        expect(tool.execute).toBeTypeOf('function')
      }
    })
  })

  it('keeps the host-neutral schema untouched when mapping', async () => {
    await withHarness(async ({ tools }) => {
      const mapped = toolNamed(tools, 'screenshot_window')
      expect(mapped.input.properties?.window_id).toBeDefined()
      const remapped = toOpencodeTool({
        name: 'example',
        description: 'Example tool',
        parameters: mapped.input,
        output: {
          schema: { type: 'object' },
          render: () => [{ type: 'text', text: 'ok' }],
        },
        execute: async () => ({}),
      })
      expect(remapped.input).toBe(mapped.input)
      expect(remapped.name).toBe('example')
    })
  })

  it('returns capture text and the structured result', async () => {
    await withHarness(async ({ tools, directory }) => {
      const tool = toolNamed(tools, 'screenshot_screen')
      const result = await tool.execute({}, {})

      expect(typeof result.content).toBe('string')
      expect(result.content).toContain('Saved screen screenshot to')
      expect(result.output).toMatchObject({ captureType: 'screen' })
      expect((result.output as { path: string }).path.startsWith(directory)).toBe(true)
    })
  })

  it('formats window listings for the model', async () => {
    await withHarness(async ({ tools }) => {
      const tool = toolNamed(tools, 'list_windows')
      const result = await tool.execute({}, {})
      expect(result.content).toContain('Displays (')
      expect(result.content).toContain('Windows (')
    })
  })

  it('captures a window by identifier', async () => {
    await withHarness(async ({ tools }) => {
      const tool = toolNamed(tools, 'screenshot_window')
      const result = await tool.execute({ window_id: 'win32:4195478' }, {})
      expect(result.content).toContain('Saved window screenshot to')
    })
  })

  it('rejects with the stable error code and an actionable message', async () => {
    const backend = new FakeBackend({
      screen: async () => ({
        fail: new ScreenshotError('CAPTURE_FAILED', 'the desktop refused the capture.', {
          hint: 'Check the screen recording permission.',
        }),
      }),
    })

    await withHarness(async ({ tools }) => {
      const tool = toolNamed(tools, 'screenshot_screen')
      await expect(tool.execute({}, {})).rejects.toMatchObject({
        name: 'ScreenshotError',
        code: 'CAPTURE_FAILED',
        message: 'the desktop refused the capture. Check the screen recording permission.',
      })
    }, backend)
  })

  it('rejects invalid arguments before touching the native layer', async () => {
    const backend = new FakeBackend()
    await withHarness(async ({ tools }) => {
      const tool = toolNamed(tools, 'screenshot_window')
      await expect(tool.execute({}, {})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
      expect(backend.calls).toHaveLength(0)
    }, backend)
  })

  it('uses the plugin options as configuration', async () => {
    await withHarness(async ({ configOutputDir, directory }) => {
      expect(configOutputDir).toBe(directory)
    })
  })

  it('exposes the plugin contract OpenCode expects', () => {
    expect(plugin.id).toBe(OPENCODE_PLUGIN_ID)
    expect(plugin.setup).toBeTypeOf('function')
  })

  it('rejects a context without a tool domain', async () => {
    await expect(setup({} as OpencodePluginContext)).rejects.toThrow(/tool domain/)
  })
})
