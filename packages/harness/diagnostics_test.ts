import { assert, assertEquals, assertMatch } from '@std/assert'
import { createDiagnostics, uncaught } from './diagnostics.ts'
import { open } from './store.ts'

Deno.test('defect journal preserves stack/cause, redacts secrets, and graph receipt never becomes input', async () => {
  let h = open(':memory:')
  let lines: string[] = []
  let reporter = createDiagnostics({
    path: 'unused',
    write: (s) => lines.push(s),
    secrets: ['secret-key-123'],
  })
  let detach = reporter.attach(h.g)
  let error = new Error('savepoint failed secret-key-123', {
    cause: new Error('statement busy'),
  })
  reporter.report(error, { phase: 'projection', session: 'selected' })
  reporter.report(error, { phase: 'unhandledrejection' })
  await reporter.drain()
  let rows = await h.g.read('.exception')
  assertEquals(rows.length, 1)
  assertEquals(lines.length, 1)
  assert(!rows[0].entry)
  assertEquals(await h.g.read('.entry'), [])
  assertMatch(lines[0], /Caused by:/)
  assertMatch(lines[0], /statement busy/)
  assertMatch(lines[0], /diagnostics_test.ts/)
  assert(!lines[0].includes('secret-key-123'))
  assertEquals(JSON.parse(lines[0]).session, 'selected')
  detach()
  h.close()
})

Deno.test('database failure cannot recurse and original survives independent journal reopen', async () => {
  let dir = Deno.makeTempDirSync()
  let path = dir + '/exceptions.jsonl'
  let warnings: string[] = []
  let attempts = 0
  let reporter = createDiagnostics({ path, warn: (s) => warnings.push(s) })
  reporter.attach({
    apply: () => {
      attempts++
      throw new Error('database broken')
    },
  })
  reporter.report(new Error('original failure'), { phase: 'daemon' })
  await reporter.drain()
  assertEquals(attempts, 1)
  assertEquals(warnings.length, 1)
  let record = JSON.parse(Deno.readTextFileSync(path))
  assertMatch(record.body, /original failure/)
  let again = createDiagnostics({ path })
  again.report('second', { phase: 'startup' })
  assertEquals(Deno.readTextFileSync(path).trim().split('\n').length, 2)
  Deno.removeSync(dir, { recursive: true })
})

Deno.test('global error hooks preserve fatal default, clean up, deduplicate, and uninstall', () => {
  let lines: string[] = []
  let reporter = createDiagnostics({
    path: 'unused',
    write: (s) => lines.push(s),
  })
  let target = new EventTarget()
  let cleaned = 0
  let remove = uncaught(reporter, target, () => {
    cleaned++
  })
  let error = new Error('render defect')
  let event = new ErrorEvent('error', { error, cancelable: true })
  assert(target.dispatchEvent(event))
  assert(!event.defaultPrevented)
  let rejection = new Event('unhandledrejection', { cancelable: true })
  Object.defineProperty(rejection, 'reason', { value: error })
  target.dispatchEvent(rejection)
  assertEquals(cleaned, 2)
  assertEquals(lines.length, 1)
  remove()
  target.dispatchEvent(new ErrorEvent('error', { error: new Error('later') }))
  assertEquals(lines.length, 1)
})

Deno.test('journal failure prints original and graph shutdown drain is bounded', async () => {
  let warnings: string[] = []
  let reporter = createDiagnostics({
    path: 'unused',
    write: () => {
      throw new Error('disk full')
    },
    warn: (s) => warnings.push(s),
  })
  reporter.attach({ apply: () => new Promise(() => {}) })
  reporter.report(new Error('original'), { phase: 'shutdown' })
  await reporter.drain(1)
  assertMatch(warnings[0], /disk full/)
  assertMatch(warnings[0], /Original exception:.*original/)
  assertMatch(warnings[1], /still pending/)
})

Deno.test('fatal unhandled rejection really exits subprocess but leaves durable stack', async () => {
  let dir = Deno.makeTempDirSync()
  let path = dir + '/fatal.jsonl'
  let module = new URL('./diagnostics.ts', import.meta.url).href
  let script = 'import {createDiagnostics,uncaught} from ' +
    JSON.stringify(module) + ';' +
    'uncaught(createDiagnostics({path:' + JSON.stringify(path) + '}));' +
    'Promise.reject(new Error("fatal-test", {cause:new Error("root-test")}));'
  try {
    let child = await new Deno.Command(Deno.execPath(), {
      args: ['eval', script],
      stdout: 'null',
      stderr: 'piped',
    }).output()
    assert(!child.success)
    let record = JSON.parse(Deno.readTextFileSync(path))
    assertEquals(record.phase, 'unhandledrejection')
    assertMatch(record.body, /fatal-test/)
    assertMatch(record.body, /root-test/)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})
