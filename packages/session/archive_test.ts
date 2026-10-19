// Synthetic compressed rollouts prove bounded import, restart recovery and
// decoder failure isolation. Their plaintext exists only in this fixture.
import { test } from '@yaks/testing'
import { assertEquals, assertExists } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { archive } from './archive.ts'
import { look, type Seen } from './service.ts'
import { logOf } from './tail.ts'
import { locked, store } from './testing.ts'

let id = 'bbdd36d9-10ae-4677-8264-e5011bba746f'
let other = 'c28ef513-5ba3-4797-aa58-7f1bc81c69f1'
let root = Deno.makeTempDirSync()
let seq = 0
let fixture = () => {
  let dir = `${root}/${++seq}`
  Deno.mkdirSync(`${dir}/2026/10/19`, { recursive: true })
  return dir
}
let path = (dir: string, thread = id) =>
  `${dir}/2026/10/19/rollout-2026-10-19T15-00-00-${thread}.jsonl.zst`
let text = (type: string, payload: Record<string, unknown>) =>
  JSON.stringify({ type, timestamp: '2026-10-19T15:00:00.000Z', payload }) +
  '\n'
let input = (body: string) =>
  text('response_item', {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: body }],
  })
let log = (body: string, thread = id) =>
  text('session_meta', { id: thread, source: 'cli' }) + input(body) +
  text('response_item', {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: 'answer' }],
  })
let zip = (file: string, body: string) => {
  let raw = `${root}/input`
  Deno.writeTextFileSync(raw, body)
  let result = new Deno.Command('zstd', { args: ['-qc', '--', raw] })
    .outputSync()
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr))
  Deno.writeFileSync(file, result.stdout)
}
let seen = (): Seen => ({ tails: new Map(), done: new Set() })
let close = (s: Seen) =>
  Promise.all([...s.tails.values()].map((t) => t?.stream?.close()))
let entries = async (g: Graph, thread = id): Promise<Bundle[]> =>
  await g.read(`.entry.session=${thread} .order=entry.seq *`)
let bodies = async (g: Graph, thread = id) =>
  (await entries(g, thread)).map((b) => (b.content as Comp | undefined)?.body)
    .filter(Boolean)
let completed = async (g: Graph, file: string) =>
  ((await g.get([logOf(file)]))[0]?.log as Comp | undefined)?.finished
let drain = async (g: Graph, dir: string, s: Seen) => {
  for (let n = 0; n < 100; n++) {
    await look(g, '', s, { codex: dir, full: 0, slice: 0 })
    if (await completed(g, path(dir))) return
  }
  throw new Error('archive did not finish')
}

let dir = fixture(), file = path(dir), g = locked(store()), s = seen()
zip(file, log('first'))
await look(g, '', s, { codex: dir, full: 0, slice: 0 })
let consumed = ((await g.get([logOf(file)]))[0].log as Comp).consumed
await close(s)
let resumed = seen()
await drain(g, dir, resumed)
let originalRows = await entries(g)
let originalBodies = await bodies(g)
let finished = await completed(g, file)
await close(resumed)
let writes = 0, apply = g.apply
// Observe writes through the graph interface: a completed immutable log does
// no work when another process discovers it.
g.apply = (...args) => {
  writes++
  return apply(...args)
}
await look(g, '', seen(), { codex: dir, full: 0 })
let replayWrites = writes
zip(file, log('first') + input('next'))
await drain(g, dir, resumed)
let extended = await bodies(g)
let extendedIds = (await entries(g)).slice(0, originalRows.length).map((b) =>
  b.entity.eid
)
await close(resumed)

test('a compressed rollout resumes a bounded read and completed discovery does no writes', () => {
  assertEquals(consumed, 1)
  assertEquals(originalBodies, ['first', 'answer'])
  assertExists(finished)
  assertEquals(replayWrites, 0)
})

test('changed archive bytes invalidate completion and preserve existing entry identities', () => {
  assertEquals(extended, ['first', 'answer', 'next'])
  assertEquals(extendedIds, originalRows.map((b) => b.entity.eid))
})

let partialDir = fixture(), partial = path(partialDir)
let partialGraph = locked(store()), partialSeen = seen()
zip(partial, log('old prefix'))
await look(partialGraph, '', partialSeen, {
  codex: partialDir,
  full: 0,
  slice: 0,
})
await look(partialGraph, '', partialSeen, {
  codex: partialDir,
  full: 0,
  slice: 0,
})
let prefix = await bodies(partialGraph)
await close(partialSeen)
zip(partial, log('replacement prefix'))
let changedSeen = seen()
await drain(partialGraph, partialDir, changedSeen)
let replaced = await bodies(partialGraph)
await close(changedSeen)

test('a replaced unfinished archive restarts its cursor after an importer restart', () => {
  assertEquals(prefix, ['old prefix'])
  assertEquals(replaced, ['replacement prefix', 'answer'])
})

let brokenDir = fixture(), broken = path(brokenDir)
let errors: unknown[] = [], brokenGraph = locked(store()), brokenSeen = seen()
Deno.writeFileSync(broken, new Uint8Array([1, 2, 3, 4]))
zip(path(brokenDir, other), log('healthy', other))
for (let n = 0; n < 10; n++) {
  await look(brokenGraph, '', brokenSeen, {
    codex: brokenDir,
    full: 0,
    report: (e) => errors.push(e),
  })
  if (errors.length && await completed(brokenGraph, path(brokenDir, other))) {
    break
  }
}
let notFinished = await completed(brokenGraph, broken)
await look(brokenGraph, '', brokenSeen, {
  codex: brokenDir,
  full: 0,
  report: (e) => errors.push(e),
})
let healthy = await bodies(brokenGraph, other)
zip(broken, log('repaired'))
await drain(brokenGraph, brokenDir, brokenSeen)
let repaired = await bodies(brokenGraph)
await close(brokenSeen)

test('a broken old archive stays retryable while later files import', () => {
  assertEquals(errors.length, 1)
  assertEquals(notFinished, undefined)
  assertEquals(healthy, ['healthy', 'answer'])
  assertEquals(repaired, ['repaired', 'answer'])
})

let plainDir = fixture(), plainGraph = locked(store()), plainSeen = seen()
let zipped = path(plainDir), plain = zipped.slice(0, -4)
Deno.writeTextFileSync(plain, log('plain'))
await look(plainGraph, '', plainSeen, { codex: plainDir, full: 0 })
let before = await entries(plainGraph)
zip(zipped, log('plain'))
Deno.removeSync(plain)
await drain(plainGraph, plainDir, plainSeen)
let after = await entries(plainGraph)
await close(plainSeen)

test('compressing an already imported rollout keeps its log and message identities', () => {
  assertEquals(after.map((b) => b.entity.eid), before.map((b) => b.entity.eid))
  assertEquals(logOf(zipped), logOf(plain))
})

let truncatedDir = fixture(),
  truncatedGraph = locked(store()),
  truncatedSeen = seen()
zip(path(truncatedDir), log('large '.repeat(40000)))
let compressed = Deno.readFileSync(path(truncatedDir))
Deno.writeFileSync(
  path(truncatedDir),
  compressed.subarray(0, compressed.length - 4),
)
let truncatedErrors: unknown[] = []
for (let n = 0; n < 20 && !truncatedErrors.length; n++) {
  await look(truncatedGraph, '', truncatedSeen, {
    codex: truncatedDir,
    full: 0,
    report: (error) => truncatedErrors.push(error),
  })
}
let truncatedMark = await completed(truncatedGraph, path(truncatedDir))
await close(truncatedSeen)

test('a decoder that yields valid prefix bytes then fails never marks the log finished', () => {
  assertEquals(truncatedErrors.length, 1)
  assertEquals(truncatedMark, undefined)
})

let cancelledDir = fixture(),
  cancelledGraph = locked(store()),
  cancelledSeen = seen()
zip(path(cancelledDir), log('cancel me'))
let cancel = new AbortController(), cancellationErrors: unknown[] = []
cancel.abort()
await look(cancelledGraph, '', cancelledSeen, {
  codex: cancelledDir,
  full: 0,
  signal: cancel.signal,
  report: (error) => cancellationErrors.push(error),
})
let cancellationMark = await completed(cancelledGraph, path(cancelledDir))
await close(cancelledSeen)

let abortRead = new AbortController()
let source = archive(path(cancelledDir), abortRead.signal)
let reading = source.read()
abortRead.abort()
let abortedChunk = await reading
await source.close()
let stoppedDecoder = source.done

test('cancelled archive capture never reports decoder failure or stamps completion', () => {
  assertEquals(cancellationErrors, [])
  assertEquals(cancellationMark, undefined)
  assertEquals(abortedChunk, undefined)
  assertEquals(stoppedDecoder, false)
})

Deno.removeSync(root, { recursive: true })
