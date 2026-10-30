/** Test runtime and fixtures travel with the bench; product modules stay at
 * the revision being measured. These paths also identify the driver cache. */
export let SUPPORT = [
  'packages/testing/',
  'packages/d1/testing.ts',
  'packages/durable-object/testing.ts',
  'packages/harness/testing.ts',
  'packages/sqlite/testing.ts',
  'packages/sqlite/fixtures/',
  'packages/tui/testing.ts',
  'workers/yak/endpoints.ts',
  'workers/yak/mcp-probe.ts',
  'workers/yak/probe.ts',
  'workers/yak/testing.ts',
]

export let support = (file: string) =>
  SUPPORT.some((path) =>
    path.endsWith('/') ? file.startsWith(path) : file == path
  )

type Config = {
  imports?: Record<string, string>
  workspace?: string[]
  [key: string]: unknown
}

export let configured = (product: Config, driver: Config): Config => ({
  ...product,
  imports: { ...driver.imports, ...product.imports },
  workspace: [...new Set([...product.workspace ?? [], './packages/benchmark'])],
})
