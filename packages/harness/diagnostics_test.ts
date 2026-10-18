import { test } from '@yaks/testing'
import { assert, assertEquals, assertMatch } from '@std/assert'
import { createDiagnostics, uncaught } from './diagnostics.ts'
import type { Context } from '@yaks/tracker/report'

test('a defect reaches its reporter once with stack and cause kept and secrets redacted', async () => {
  let reported: { error: Error; context: Partial<Context> }[] = []
  let reporter = createDiagnostics({ secrets: ['secret-key-123'] })
  let detach = reporter.attach((error, context = {}) => {
    reported.push({ error: error as Error, context })
  })
  let error = new Error('savepoint failed secret-key-123', {
    cause: new Error('statement busy'),
  })
  reporter.report(error, { phase: 'projection', session: 'selected' })
  reporter.report(error, { phase: 'unhandledrejection' })
  await reporter.drain()
  assertEquals(reported.length, 1)
  let said = reported[0]
  assertMatch(said.error.stack!, /Caused by:/)
  assertMatch(said.error.stack!, /statement busy/)
  assertMatch(said.error.stack!, /diagnostics_test.ts/)
  assert(!said.error.stack!.includes('secret-key-123'))
  assertEquals(said.error.message, 'savepoint failed [redacted]')
  assertEquals(said.context.during?.session, 'selected')
  assertEquals(said.context.tags?.phase, 'projection')
  for (
    let key of [
      'pid',
      'cpu_sample_ms',
      'cpu_percent',
      'cpu_user_ms',
      'cpu_system_ms',
    ]
  ) {
    assert(Number.isFinite(said.context.tags?.[key]))
  }
  detach()
})

test('a defect nobody can take is said on the terminal, not lost', async () => {
  let warnings: string[] = []
  let reporter = createDiagnostics({ warn: (s) => warnings.push(s) })
  reporter.report(new Error('nowhere to write this'), { phase: 'startup' })
  await reporter.drain()
  assertEquals(warnings.length, 1)
  assertMatch(JSON.parse(warnings[0]).body, /nowhere to write this/)
})

// Exercise a fixed rejected sink once; keep its original warning and attempt count.
let failedSink = await (async () => {
  let warnings: string[] = []
  let attempts = 0
  let reporter = createDiagnostics({ warn: (s) => warnings.push(s) })
  reporter.attach(() => {
    attempts++
    throw new Error('reporter broken')
  })
  reporter.report(new Error('original failure'), { phase: 'daemon' })
  await reporter.drain()
  return { warnings, attempts }
})()
test('a delivery failure cannot recurse: the original is printed instead', () => {
  assertEquals(failedSink.attempts, 1)
  assertEquals(failedSink.warnings.length, 1)
  assertMatch(failedSink.warnings[0], /reporter broken/)
  assertMatch(
    failedSink.warnings[0],
    /Original exception:[\s\S]*original failure/,
  )
})

let runtimeError = new Error('render defect')
// Formatting stacks is covered above; these cases check routing and identity.
runtimeError.stack = 'Error: render defect'
let runtimeEvent = new ErrorEvent('error', {
  error: runtimeError,
  cancelable: true,
})
let runtimeRejection = new Event('unhandledrejection', { cancelable: true })
Object.defineProperty(runtimeRejection, 'reason', { value: runtimeError })
let laterEvent = new ErrorEvent('error', { error: new Error('later') })
test('global error hooks preserve fatal default, clean up, deduplicate, and uninstall', () => {
  let reports: { error: unknown; phase: string }[] = []
  let target = new EventTarget()
  let cleaned = 0
  let remove = uncaught(
    {
      report: (error, context) => reports.push({ error, phase: context.phase }),
    },
    target,
    () => {
      cleaned++
    },
  )
  assert(target.dispatchEvent(runtimeEvent))
  assert(!runtimeEvent.defaultPrevented)
  target.dispatchEvent(runtimeRejection)
  assertEquals(cleaned, 2)
  assert(reports[0].error === runtimeError)
  assert(reports[1].error === runtimeError)
  assertEquals(reports.map((r) => r.phase), ['error', 'unhandledrejection'])
  remove()
  target.dispatchEvent(laterEvent)
  assertEquals(reports.length, 2)
})

test('diagnostics say the same runtime error once across error and rejection phases', () => {
  let said: string[] = []
  let reporter = createDiagnostics({ warn: (s) => said.push(s) })
  reporter.report(runtimeError, { phase: 'error' })
  reporter.report(runtimeError, { phase: 'unhandledrejection' })
  assertEquals(said.length, 1)
})

let undelivered = await (async () => {
  let warnings: string[] = []
  let reporter = createDiagnostics({ warn: (s) => warnings.push(s) })
  reporter.attach(() => new Promise<void>(() => {}))
  reporter.report(new Error('original'), { phase: 'shutdown' })
  await reporter.drain(1)
  return warnings
})()
test('a diagnostic shutdown drain is bounded', () => {
  assertMatch(undelivered[0], /still pending/)
})

test('a fatal unhandled rejection really exits the subprocess, saying what it was', async () => {
  let module = new URL('./diagnostics.ts', import.meta.url).href
  let script = 'import {createDiagnostics,uncaught} from ' +
    JSON.stringify(module) + ';' +
    'uncaught(createDiagnostics());' +
    'Promise.reject(new Error("fatal-test", {cause:new Error("root-test")}));'
  let child = await new Deno.Command(Deno.execPath(), {
    args: ['eval', script],
    stdout: 'null',
    stderr: 'piped',
  }).output()
  assert(!child.success)
  let said = new TextDecoder().decode(child.stderr)
  assertMatch(said, /fatal-test/)
  assertMatch(said, /root-test/)
})
