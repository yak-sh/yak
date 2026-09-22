/// <reference lib="deno.ns" />
// A refusal is not an incident (tool.ts `refuse`): the runner records a
// `CallError` as `error{code}` and mails nothing, and anything else a tool
// throws is a defect it reports.
import { assert, assertEquals } from '@std/assert'
import { CallError } from '@yaks/tools'
import { rejected } from './tool.ts'

Deno.test("a door's 4xx is a refusal with its code, and a 5xx a defect", () => {
  let code = (status: number) => {
    let e = rejected(status, 'no')
    return e instanceof CallError ? e.code : null
  }
  assertEquals(
    [400, 403, 404, 409, 413, 422, 429, 500, 503].map(code),
    [
      'arguments',
      'access',
      'missing',
      'conflict',
      'limit',
      'arguments',
      'limit',
      null,
      null,
    ],
  )
  assert(rejected(500, 'no') instanceof Error)
})
