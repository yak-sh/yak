// complete() drives the REAL fake provider — a deno subprocess, no model, no
// key (adapters.ts `fake`) — so the spawn/read/deadline/reap path is exercised
// end to end, not mocked. Those rides are `slow` (a subprocess is the heavy
// tier); the unknown-model rejection never spawns, so it stays fast.
import { assertEquals } from '@std/assert'
import { slow } from './testing.ts'
import { complete } from './complete.ts'

// The graceful-absence floor that costs no process: a model no adapter admits
// is null, decided before anything is spawned — never a throw.
Deno.test('complete: an unknown model is null, not a throw', async () => {
  assertEquals(await complete('no-such-model', '', 'go'), null)
})

slow('complete: a normal reply returns the text', async () => {
  // fake echoes `done: <instruction>`; system frames the user prompt.
  assertEquals(await complete('fake-fast', '', 'hello'), 'done: hello')
})

slow('complete: a nonzero exit is graceful null', async () => {
  // `fail:N` makes the fake exit N — a provider that ran and failed.
  assertEquals(await complete('fake-fast', '', 'fail:7'), null)
})

slow('complete: the deadline kills a hang and returns null', async () => {
  // `delay:60000` parks the fake between events; the deadline kills it well
  // before it could answer, and the child is reaped by the awaited output.
  assertEquals(
    await complete('fake-fast', '', 'delay:60000 hi', { deadline: 100 }),
    null,
  )
})
