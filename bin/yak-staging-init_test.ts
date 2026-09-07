import { assertEquals, assertRejects } from '@std/assert'
import {
  BUCKETS,
  DIMENSIONS,
  DISPATCH,
  initialize,
  METRIC,
  OAUTH_KV,
  type Run,
  SECRETS,
  VECTORIZE,
} from './yak-staging-init'

let fake = (empty = false) => {
  let calls: string[][] = []
  let made = false
  let run: Run = (args) => {
    calls.push(args)
    let key = args.join(' ')
    if (key == 'dispatch-namespace list') {
      return Promise.resolve({
        success: true,
        stdout: empty ? '[]' : `[{ name: '${DISPATCH}' }]`,
        stderr: '',
      })
    }
    if (key == 'r2 bucket list') {
      return Promise.resolve({
        success: true,
        stdout: empty ? '' : BUCKETS.map((name) => `name: ${name}`).join('\n'),
        stderr: '',
      })
    }
    if (key == 'vectorize list --json') {
      return Promise.resolve({
        success: true,
        stdout: empty ? '[]' : JSON.stringify([{
          name: VECTORIZE,
          config: { dimensions: DIMENSIONS, metric: METRIC },
        }]),
        stderr: '',
      })
    }
    if (key == 'kv namespace list') {
      let rows = !empty || made ? [{ title: OAUTH_KV, id: 'kv-id' }] : []
      return Promise.resolve({
        success: true,
        stdout: JSON.stringify(rows),
        stderr: '',
      })
    }
    if (key == `kv namespace create ${OAUTH_KV}`) made = true
    return Promise.resolve({ success: true, stdout: '', stderr: '' })
  }
  return { calls, run }
}

Deno.test('yak-staging-init reports existing resources without creating them', async () => {
  let { calls, run } = fake()
  let lines: string[] = []
  assertEquals(await initialize(run, (line) => lines.push(line)), 'kv-id')
  assertEquals(calls.some((args) => args.includes('create')), false)
  assertEquals(lines.slice(0, 5), [
    `exists: dispatch namespace ${DISPATCH}`,
    `exists: R2 bucket ${BUCKETS[0]}`,
    `exists: R2 bucket ${BUCKETS[1]}`,
    `exists: Vectorize index ${VECTORIZE}`,
    `exists: KV namespace ${OAUTH_KV}`,
  ])
  assertEquals(
    lines.slice(-SECRETS.length),
    SECRETS.map((name) => `npx wrangler secret put ${name} --env staging`),
  )
})

Deno.test('yak-staging-init creates every missing resource once', async () => {
  let { calls, run } = fake(true)
  let lines: string[] = []
  await initialize(run, (line) => lines.push(line))
  assertEquals(
    calls.filter((args) => args.includes('create')),
    [
      ['dispatch-namespace', 'create', DISPATCH],
      ['r2', 'bucket', 'create', BUCKETS[0]],
      ['r2', 'bucket', 'create', BUCKETS[1]],
      [
        'vectorize',
        'create',
        VECTORIZE,
        `--dimensions=${DIMENSIONS}`,
        `--metric=${METRIC}`,
      ],
      ['kv', 'namespace', 'create', OAUTH_KV],
    ],
  )
  assertEquals(
    lines.slice(0, 5).every((line) => line.startsWith('created:')),
    true,
  )
})

Deno.test('yak-staging-init refuses an incompatible existing index', async () => {
  let { run } = fake()
  let changed: Run = async (args) => {
    if (args.join(' ') == 'vectorize list --json') {
      return {
        success: true,
        stdout: JSON.stringify([{
          name: VECTORIZE,
          config: { dimensions: 3, metric: METRIC },
        }]),
        stderr: '',
      }
    }
    return await run(args)
  }
  await assertRejects(
    () => initialize(changed, () => {}),
    Error,
    `want ${DIMENSIONS}/${METRIC}`,
  )
})
