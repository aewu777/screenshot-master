/**
 * Host-neutral runtime assembly.
 *
 * Every host adapter needs the same three things: the resolved configuration,
 * the capture service for the current operating system, and a logger. Building
 * them here keeps the adapters thin and keeps the support check in one place.
 */

import {
  createScreenshotService,
  silentLogger,
  type Logger,
  type ScreenshotService,
} from './capture.js'
import { resolveConfig, type ScreenshotConfig } from './config.js'
import {
  SUPPORTED_PLATFORMS,
  createBackendForPlatform,
  isSupportedPlatform,
} from './platforms/index.js'

export interface CreateRuntimeOptions {
  /** Overrides `process.platform`; used by tests. */
  platform?: string
  /** Overrides the whole service; used by tests. */
  service?: ScreenshotService
  logger?: Logger
}

export interface Runtime {
  service: ScreenshotService
  config: ScreenshotConfig
}

/**
 * Resolve the configuration and build the capture service.
 *
 * An unsupported platform is not fatal: the tools are still registered and fail
 * with `UNSUPPORTED_PLATFORM` on the first call, which gives the model a clear
 * message instead of an empty tool list.
 */
export function createRuntime(
  rawConfig: Record<string, unknown> = {},
  options: CreateRuntimeOptions = {},
): Runtime {
  const logger: Logger = options.logger ?? silentLogger
  const platform = options.platform ?? process.platform
  const config = resolveConfig(rawConfig ?? {}, process.env, platform)

  if (!isSupportedPlatform(platform)) {
    logger.warn(
      `screenshot capture is not supported on ${platform}; the tools are registered but every call will fail with UNSUPPORTED_PLATFORM. Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}.`,
    )
  }

  const service =
    options.service ??
    createScreenshotService({
      backend: createBackendForPlatform(config, platform),
      config,
      logger,
    })

  return { service, config }
}
