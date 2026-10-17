/** Selected platform waits over loopback HTTP, using the production kernel,
 * directory, connector and app doors with local Durable Object/R2 bindings.
 * These are response-complete waits, not browser paint or Cloudflare latency. */
import type { CollectedSuite, Samples } from '@yaks/benchmark'

export let NAMES = [
  'management/html',
  'management/settings-html',
  'management/connections-html',
  'management/trash-html',
  'management/billing-html',
  'management/connect-html',
  'app/html',
  'app/paint-cold',
  'app/paint-warm',
  'connector/app-list',
  'connector/file-list',
  'connector/graph-query',
  'connector/graph-apply',
] as const

/** Registration is inert: only collect starts the isolated probe process. */
export let suite = (args: string[] = []): CollectedSuite => {
  if (args.length) throw new Error('platform-waits takes no arguments')
  return {
    name: 'platform-waits',
    metric: 'median-of-round-medians',
    workload:
      'v2/local-kernel-http-and-chrome/1-space/1-app/256-docs/7-samples/warm',
    benches: NAMES.map((name) => ({ name, unit: 'ms' })),
    collect: async () => {
      let child = await new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          new URL('./platform-waits-probe.ts', import.meta.url).pathname,
        ],
        cwd: new URL('../', import.meta.url).pathname,
        stdout: 'piped',
        stderr: 'inherit',
      }).output()
      if (!child.success) {
        throw new Error(`platform-waits probe failed (${child.code})`)
      }
      let output = new TextDecoder().decode(child.stdout)
      let line = output.split('\n').findLast((line) =>
        line.startsWith('PLATFORM_WAITS_RESULT=')
      )
      if (!line) {
        throw new Error('platform-waits probe returned no measurements')
      }
      return JSON.parse(line.slice('PLATFORM_WAITS_RESULT='.length)) as Record<
        string,
        Samples
      >
    },
  }
}

/** Read the whole body: timing only fetch's headers misses the wait for content.
 * A failed or unrelated page never banks a deceptively fast answer. */
export let content = async (response: Response, wanted: string) => {
  let text = await response.text()
  if (response.status != 200 || !text.includes(wanted)) {
    throw new Error(`platform page ${response.status}: missing ${wanted}`)
  }
  return text
}
