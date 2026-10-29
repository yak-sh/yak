/** Selected platform waits over loopback HTTP, using the production kernel,
 * directory, connector and app doors with local Durable Object/R2 bindings.
 * These are response-complete waits, not browser paint or Cloudflare latency. */
import type { CollectedSuite, Samples } from '@yaks/benchmark'
import { FORMS } from './platform-forms.ts'
import { installed } from '../workers/yak/dependencies.ts'

export let NAMES = [
  'management/html',
  'management/settings-html',
  'management/connections-html',
  'management/trash-html',
  'management/billing-html',
  'management/connect-html',
  ...['people', 'new', 'visits', 'selling'].map((view) =>
    `management/${view}-html`
  ),
  ...[
    'apps',
    'settings',
    'connections',
    'trash',
    'billing',
    'connect',
    'people',
    'new',
    'visits',
    'selling',
  ].map((view) => `management/${view}-populated-html`),
  ...FORMS,
  'app/html',
  'connector/app-list',
  'connector/file-list',
  'connector/graph-query',
  'connector/graph-apply',
] as const

/** Registration is inert: only collect starts the isolated probe process. */
export let suite = (
  args: string[] = [],
  root = new URL('../', import.meta.url).pathname,
  selected: readonly string[] = NAMES,
): CollectedSuite => {
  if (args.length) throw new Error('platform-waits takes no arguments')
  for (let name of selected) {
    if (!(NAMES as readonly string[]).includes(name)) {
      throw new Error(`Unknown platform workload: ${name}`)
    }
  }
  return {
    name: 'platform-waits',
    metric: 'median-of-round-medians',
    workload: 'v3/local-kernel-http/1-space/1-app/256-docs/7-samples/warm',
    benches: selected.map((name) => ({ name, unit: 'ms' })),
    collect: async () => {
      await installed(`${root}/workers/yak`, {
        seed: new URL('../workers/yak/', import.meta.url).pathname.replace(
          /\/$/,
          '',
        ),
      })
      let child = await new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          `${root}/bench/platform-waits-probe.ts`,
        ],
        cwd: root,
        env: { BENCH_NAMES: JSON.stringify(selected) },
        stdout: 'piped',
        stderr: 'piped',
      }).output()
      if (!child.success) {
        throw new Error(
          `platform-waits probe failed (${child.code})\n${
            new TextDecoder().decode(child.stderr).trim()
          }`,
        )
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
    throw new Error(
      `platform page ${response.status}: missing ${wanted}\n${
        text.slice(-3000)
      }`,
    )
  }
  return text
}
