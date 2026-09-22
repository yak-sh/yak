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
  // Same doors and numbers, their own counters.
  let rates = (rows: unknown) =>
    (rows as { name: string; simple: unknown }[]).map((r) => [r.name, r.simple])
  assertEquals(rates(staging.ratelimits), rates(config.ratelimits))
  for (let row of staging.ratelimits as { namespace_id: string }[]) {
    assert(
      !(config.ratelimits as { namespace_id: string }[])
        .some((r) => r.namespace_id == row.namespace_id),
    )
  }
  assertEquals(staging.name, 'yak-staging')
  let vars = staging.vars as Record<string, string>
  assertEquals(vars.APEX, 'yaks.fyi')
  assertEquals(vars.WORKER_NAME, staging.name)
  assertEquals(vars.SENTRY_ENVIRONMENT, 'staging')
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
