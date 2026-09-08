// A missing named-environment binding silently disables a door; a reused
// resource writes staging traffic into production. Hold both boundaries.
import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { parse } from '@std/toml'

let config = parse(
  Deno.readTextFileSync(new URL('./wrangler.toml', import.meta.url)),
)
let staging = (config.env as Record<string, Record<string, unknown>>).staging

Deno.test('staging repeats the kernel bindings without production resources', () => {
  for (
    let key of [
      'durable_objects',
      'migrations',
      'containers',
      'ai',
      'assets',
      'triggers',
      'send_email',
      'version_metadata',
      'cache',
      'exports',
      'observability',
    ]
  ) assertEquals(staging[key], config[key], `${key} must exist on staging`)

  for (
    let [key, resource] of [
      ['dispatch_namespaces', 'namespace'],
      ['r2_buckets', 'bucket_name'],
      ['vectorize', 'index_name'],
      ['kv_namespaces', 'id'],
      ['analytics_engine_datasets', 'dataset'],
      ['services', 'service'],
    ]
  ) {
    let live = config[key] as Record<string, string>[]
    let isolated = staging[key] as Record<string, string>[]
    assertEquals(isolated.map((r) => r.binding), live.map((r) => r.binding))
    for (let row of isolated) {
      assertNotEquals(
        row[resource],
        live.find((r) => r.binding == row.binding)![resource],
      )
    }
  }
  // Explicit empty list, not absent: staging emits to NO tail consumer (never
  // production's yak-tail), and spelling it silences the wrangler config warning
  // that otherwise crashes the deploy verifier (2cb41812).
  assertEquals(staging.tail_consumers, [])
  assertEquals(staging.name, 'yak-staging')
  let vars = staging.vars as Record<string, string>
  assertEquals(vars.APEX, 'yaks.fyi')
  assertEquals(vars.WORKER_NAME, staging.name)
  assertEquals(
    vars.DISPATCH_NAMESPACE,
    (staging.dispatch_namespaces as { namespace: string }[])[0].namespace,
  )
  assertEquals(
    vars.VIEWS_DATASET,
    (staging.analytics_engine_datasets as { dataset: string }[])[0].dataset,
  )
  assertNotEquals(vars.CF_ZONE, (config.vars as Record<string, string>).CF_ZONE)
  assert(!('MAIL_SINK' in vars), 'the owner address belongs in a secret')
  assertEquals(staging.routes, [
    { pattern: 'yaks.fyi/*', zone_name: 'yaks.fyi' },
    { pattern: '*.yaks.fyi/*', zone_name: 'yaks.fyi' },
  ])
})
