// Historical examples are synthetic and secret-free. Tests exercise the pure
// classifier and its read plan, not a database or the one-time migration.
import type { Bundle } from '@yaks/graph'
import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { refusalFind, refusalPatch, refusalSource } from './refusals.ts'

let row = (code: string, body = ''): Bundle => ({
  entity: { eid: 'answer' },
  error: { code },
  content: { body },
})
let source = (eid = 'call'): Bundle => ({
  entity: { eid },
  call: { to: 'tool' },
  execution: { state: 'failed', by: 'runner' },
})
let patch = (code: string): Bundle => ({
  entity: { eid: 'answer' },
  error: null,
  refusal: { code },
})
let wrappers = (
  body: string,
) => [body, 'Response interrupted: ModelError: ' + body]

test('historical tool refusals require the referenced call and patch only their marker', () => {
  for (
    let code of [
      'Ambiguous',
      'Bounced',
      'NotFound',
      'Refused',
      'Stale',
      'SyntaxError',
      'Unknown',
      'Unsupported',
      'arguments',
      'artifact',
      'children',
      'diverged',
      'id',
      'land',
      'mcp_tool',
      'not_a_reader',
      'not_found',
      'observability',
      'refused',
      'sentry',
      'session',
      'session_cap',
      'since',
      'task',
      'too_large',
      'value',
      'where',
    ]
  ) {
    let answer = { ...row(code), output: { source: 'call' } }
    assertEquals(refusalPatch(answer, source()), patch(code))
    assertThrows(() => refusalPatch(answer), Error, 'eid=answer')
    assertThrows(
      () => refusalPatch(answer, source('other')),
      Error,
      `code=${code}`,
    )
    assertThrows(() => refusalPatch(answer, { entity: { eid: 'call' } }))
  }
})

test('historical standalone child/session refusals need their exact writer prefix', () => {
  for (
    let [code, body] of [
      ['child_cap', 'Error: concurrent child cap (4) reached'],
      ['session', 'Error: not a session: missing-session'],
      ['children', 'Error: not your child: missing-child'],
    ]
  ) {
    assertEquals(refusalPatch(row(code, body)), patch(code))
    assertThrows(() => refusalPatch(row(code, 'Unrecognized standalone error')))
  }
  assertThrows(() => refusalPatch(row('Refused')))
})

test('own provider refusal codes migrate without touching request state', () => {
  for (
    let code of [
      'context_length_exceeded',
      'max_output_tokens',
      'usage_limit_reached',
      'no_credential',
      'http_400',
      'http_401',
      'http_402',
      'http_404',
      'http_429',
    ]
  ) {
    assertEquals(
      refusalPatch({
        ...row(code),
        attempt: { state: 'interrupted' },
        execution: { state: 'failed', by: 'runner' },
      }),
      patch(code),
    )
  }
})

test('interrupted retry wrappers recover explicit refusal codes', () => {
  for (
    let [code, body] of [
      [
        'usage_limit_reached',
        'responses: HTTP 429 — The usage limit has been reached',
      ],
      ['http_429', 'responses: HTTP 429 — Rate limit exceeded'],
    ]
  ) {
    for (
      let bodyText of wrappers(
        `Model request failed after 3 attempts (${code}): ${body}`,
      )
    ) {
      assertEquals(refusalPatch(row('interrupted', bodyText)), patch(code))
    }
  }
  assertThrows(() =>
    refusalPatch(row(
      'interrupted',
      'Model request failed after 3 attempts (usage_limit_reached): responses: HTTP 500',
    ))
  )
  assertThrows(() =>
    refusalPatch(row(
      'interrupted',
      'Model request failed after 3 attempts (http_429): responses: HTTP 4290',
    ))
  )
  assertThrows(() =>
    refusalPatch(row(
      'interrupted',
      'Model request failed after 3 attempts (unrecognized): responses: HTTP 429',
    ))
  )
})

test('direct 4xx and credential wrappers recover codes using anchored evidence', () => {
  for (let status of [400, 401, 402, 404, 429]) {
    assertEquals(
      refusalPatch(row(
        'interrupted',
        `Response interrupted: ModelError: responses: HTTP ${status} — refusal`,
      )),
      patch(`http_${status}`),
    )
  }
  assertEquals(
    refusalPatch(row(
      'interrupted',
      'Response interrupted: ModelError: responses: credential unavailable',
    )),
    patch('no_credential'),
  )
  assertEquals(
    refusalPatch(row(
      'turn.failed',
      'unexpected status 401 Unauthorized: Incorrect API key provided: [redacted]',
    )),
    patch('http_401'),
  )
  for (
    let body of [
      'quoted responses: HTTP 401',
      'Response interrupted: ModelError: responses: HTTP 4010',
      'Response interrupted: ModelError: responses: credential unavailable maybe',
    ]
  ) assertThrows(() => refusalPatch(row('interrupted', body)))
  assertThrows(() => refusalPatch(row('turn.failed', 'some other failure')))
})

test('genuine transport, interruption and exit failures remain', () => {
  for (
    let code of [
      'transport',
      'server_error',
      'server_is_overloaded',
      'exit',
      'http_408',
      'http_500',
      'http_503',
      'http_504',
    ]
  ) assertEquals(refusalPatch(row(code)), undefined)
  for (
    let body of [
      'Response interrupted.',
      'Response interrupted: AbortError: The signal has been aborted',
      'Response interrupted: ModelError: responses: transport failed',
      'Response interrupted: ModelError: responses: transport failed — stream reset',
      'Response interrupted: ModelError: responses: error reading a body from connection',
      'Response interrupted: ModelError: responses: failed — server_error',
      'Response interrupted: ModelError: responses: failed — service_unavailable',
      'Response interrupted: ModelError: responses: HTTP 408',
      'Response interrupted: ModelError: responses: HTTP 503 — Unable to verify access',
      'Response interrupted: ModelError: responses: HTTP 504 — HTML contains HTTP 401',
      ...wrappers(
        'Model request failed after 3 attempts (transport): responses: transport failed',
      ),
      ...wrappers(
        'Model request failed after 3 attempts (http_500): responses: HTTP 500',
      ),
    ]
  ) assertEquals(refusalPatch(row('interrupted', body)), undefined)
  // A tool cutoff can quote provider-looking text without becoming a refusal.
  assertEquals(
    refusalPatch({
      ...row(
        'interrupted',
        'Response interrupted: ModelError: responses: HTTP 401',
      ),
      output: { source: 'call' },
    }),
    undefined,
  )
})

test('check findings, vault retries and strict kernel metadata remain despite refusal prose', () => {
  let body = 'Response interrupted: ModelError: responses: HTTP 401'
  for (let code of ['transient', 'info', 'warn', 'error', 'fail']) {
    let answer = { ...row(code, body), output: { source: 'call' } }
    let before = structuredClone(answer)
    assertEquals(refusalSource(answer), undefined)
    assertEquals(refusalPatch(answer), undefined)
    assertEquals(answer, before)
    assertThrows(() =>
      refusalPatch({ ...answer, error: { code, raw: 'payload' } })
    )
  }
  let kernel = {
    ...row('http_401', body),
    error: { code: 'http_401', at: '2026-10-01T00:00:00Z', message: body },
  }
  let before = structuredClone(kernel)
  assertEquals(refusalPatch(kernel), undefined)
  assertEquals(kernel, before)
  assertThrows(() =>
    refusalPatch({ ...kernel, error: { ...kernel.error, raw: 'payload' } })
  )
  assertThrows(() =>
    refusalPatch({
      ...kernel,
      error: { ...kernel.error, at: 'not a timestamp' },
    })
  )
})

let imported = (): Bundle => ({
  entity: { eid: 'answer' },
  result: { call: 'call', ms: 17 },
  imported: { source: 'fixture.jsonl', line: 12 },
  content: { body: 'historical failed tool result' },
})
let importedCall = (): Bundle => ({
  ...source(),
  imported: { source: 'fixture.jsonl', line: 11 },
})

test('imported failed result-only answers gain is_error using joined source evidence', () => {
  assertEquals(refusalPatch(imported(), importedCall()), {
    entity: { eid: 'answer' },
    refusal: { code: 'is_error' },
  })
  for (
    let called of [
      undefined,
      source('other'),
      source(),
      { ...importedCall(), imported: { source: 'different.jsonl' } },
      { ...importedCall(), execution: { state: 'done' } },
      { ...importedCall(), execution: { state: 'interrupted' } },
      { ...importedCall(), execution: { state: 'running' } },
    ]
  ) assertThrows(() => refusalPatch(imported(), called), Error, 'code=is_error')
  assertEquals(
    refusalPatch({
      entity: { eid: 'answer' },
      result: { call: 'call' },
    }, source()),
    undefined,
  )
})

test('patches preserve guards, raw provider payloads, content and all lifecycle state', () => {
  let answer: Bundle = {
    ...row('http_400', 'unchanged body'),
    output: { value: { error: { code: 'external', message: 'unchanged' } } },
    execution: { state: 'failed', by: 'runner' },
    attempt: { state: 'interrupted' },
    $was: { error: { code: 'guard' }, attempt: { state: 'guard2' } },
  }
  let before = structuredClone(answer)
  assertEquals(refusalPatch(answer), {
    ...patch('http_400'),
    $was: answer.$was,
  })
  assertEquals(answer, before)
  let called = importedCall()
  let calledBefore = structuredClone(called)
  refusalPatch(imported(), called)
  assertEquals(called, calledBefore)
})

test('unknown and raw error components fail without exposing payloads', () => {
  for (
    let answer of [
      row('unrecognized', 'SECRET_BODY'),
      row('SECRET CODE INJECTION', 'SECRET_BODY'),
      {
        ...row('http_400'),
        error: { code: 'http_400', message: 'SECRET_PAYLOAD' },
      },
      { entity: { eid: 'answer' }, error: {} },
      { entity: { eid: 'answer' }, error: 'SECRET_RAW' },
      { ...row('http_400'), refusal: { code: 'conflicting' } },
    ]
  ) {
    let error = assertThrows(() => refusalPatch(answer), Error)
    assertEquals(error.message.includes('SECRET'), false)
    assertEquals(error.message.includes('eid=answer'), true)
  }
})

test('already migrated refusals are idempotent and same-code duplicates remove only error', () => {
  assertEquals(
    refusalPatch({ entity: { eid: 'answer' }, refusal: { code: 'http_400' } }),
    undefined,
  )
  assertEquals(
    refusalPatch({ ...row('http_400'), refusal: { code: 'http_400' } }),
    {
      entity: { eid: 'answer' },
      error: null,
    },
  )
  assertEquals(
    refusalPatch({ ...imported(), refusal: { code: 'is_error' } }),
    undefined,
  )
})

test('candidate queries never expand reached sources and source reads are bounded', () => {
  assertEquals(refusalFind, [
    '.error&?content&?output&?result&?imported&?refusal&?entry',
    '.result&.imported&!error&!refusal&.result.call.execution.state=failed&?content&?output',
  ])
  let query = '.eid=call&.fields=call.to,execution.state,imported.source'
  assertEquals(
    refusalSource({ ...row('Refused'), output: { source: 'call' } }),
    query,
  )
  assertEquals(refusalSource(imported()), query)
  for (let code of ['http_400', 'transport', 'interrupted', 'turn.failed']) {
    assertEquals(
      refusalSource({ ...row(code), output: { source: 'call' } }),
      undefined,
    )
  }
  assertEquals(
    refusalSource({ ...imported(), refusal: { code: 'is_error' } }),
    undefined,
  )
  assertThrows(() =>
    refusalSource({ ...row('Refused'), output: { source: 'call&*' } })
  )
})
