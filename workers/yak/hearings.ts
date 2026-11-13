// A recording the app keeps at ./api/blob, heard whole at any length its
// provider takes (@yaks/speech `hear.bytes`). ./api/speech/hear asks with the
// file's address, and the app's store hears it as an effect, the way it reads
// a document (documents.ts): each turn lands as a `heard_turn` row, then
// `heard` on the upload's entity, or `failed` with why. A page watching that
// entity sees it done; asking again for a file heard answers what was heard
// and charges nothing.
//
// The bytes go to the provider as the bucket streams them, through the store
// and never held whole. A provider that fetches a URL itself (Deepgram's
// `url`) would need a door that serves an app's bytes to whoever holds a
// link; a stream needs none, and costs the store only the wait.
import type { Attempt } from '@yaks/effects'
import { type Bundle, type Comp, token } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { addressed } from '@yaks/blob'
import { ModelError } from '@yaks/model'
import { heard, SpeechError, type Turn } from '@yaks/speech'
import type { Asked } from './apps.ts'
import { blobPrefix } from './blob-key.ts'
import { appStore, directoryOf } from './directory.ts'
import type { Stored } from './graph.ts'
import { KERNEL, metaOf } from './meta.ts'
import { size, unaffordable } from './meter.ts'
import { hearing, paused, speechOf } from './speech.ts'
import { blobKey, useOf } from './uploads.ts'

/// shaOf('/cookbook/api/blob/' + 'a'.repeat(64) + '/' + 'b'.repeat(64)) -> 'a'.repeat(64)
/// shaOf('./api/blob/' + 'c'.repeat(64)) -> 'c'.repeat(64)
/// shaOf('d'.repeat(64)) -> 'd'.repeat(64)
/// shaOf('./api/blob/nope') -> null
/** The upload an address names: what `POST ./api/blob` answered as its `url`,
 * relative or whole, or the bare SHA-256. */
export let shaOf = (address: unknown): string | null => {
  if (typeof address != 'string') return null
  let path = address.split(/[?#]/)[0]
  let at = path.lastIndexOf('/api/blob/')
  return addressed(at < 0 ? path : path.slice(at + '/api/blob/'.length))?.sha ??
    null
}

/// guessed(16_000 * 60) -> 60
/** The seconds a recording of `bytes` is held as before it is heard: as long
 * as it would be at 128 kbit/s, a meeting's MP3 or a phone's M4A. What it
 * holds past that is charged once heard all the same (model-spend.ts
 * `onHold`). */
export let guessed = (bytes: number) => bytes / 16_000

/// turnId('r', 0) == turnId('r', 0) -> true
/** The row a heard recording's `n`th turn is, the same on every run. */
export let turnId = (recording: string, n: number) =>
  derivedEid(`heard-turn|${recording}|${n}`)

/**
 * `./api/speech/hear` posted `{"blob": address}`: the upload's entity, which
 * is asked to be heard unless it was already heard (200) or is being heard
 * (202). Refused with words that say why: an address the app keeps no file
 * at, a file past what the provider hears, a budget that can't cover it.
 */
export let asking = async (asked: Asked, address: unknown) => {
  let { env, space, app, json } = asked
  let sha = shaOf(address)
  if (!sha) {
    return json(
      400,
      'bad_request',
      'post {"blob": "<the url ./api/blob answered for the recording>"}',
    )
  }
  let graph = metaOf(appStore(env.STORE, space, app, env), KERNEL)
  let recording = await useOf(sha)
  let [row] = await graph.query(`.entity.eid=${recording}&*`, {
    trusted: true,
  })
  if ((row?.attachment as Comp | undefined)?.blob != sha) {
    return json(404, 'no_such_file', 'the app keeps no file at that address')
  }
  if (row.heard) return Response.json({ recording, ...row.heard as Comp })
  let under = { recording }
  if (row.hearing && !row.failed) return Response.json(under, { status: 202 })
  let head = await env.BLOBS.head(blobKey(space, app, sha))
  if (!head) {
    return json(404, 'no_such_file', 'the app keeps no file at that address')
  }
  let { hear } = speechOf(env)!.provider
  if (head.size > hear.bytes) {
    return json(
      413,
      'too_large',
      `Speech hears a recording of up to ${size(hear.bytes)}; this one is ` +
        `${size(head.size)}.`,
    )
  }
  let why = await paused(env)
  if (why) return json(503, 'speech_off', why)
  let short = unaffordable(space, 'models', heard(hear, guessed(head.size)))
  if (short) return json(402, 'limit', short)
  try {
    await graph.apply([{
      entity: { eid: recording },
      hearing: { at: new Date().toISOString() },
      failed: null,
      $was: {
        hearing: { at: token((row.hearing as Comp | undefined)?.at ?? null) },
      },
    }], KERNEL)
  } catch (e) {
    // Asked by another at once: theirs is being heard.
    if (!(e instanceof Stale)) throw e
  }
  return Response.json(under, { status: 202 })
}

// The turns written to the store in one write.
let BATCH = 50

/** What a recording heard leaves in its store: each turn, any turn an
 * earlier hearing left past these, and `heard` last, so a page that sees it
 * finds every turn. */
export let landed = (
  recording: string,
  got: { turns: Turn[]; seconds: number; speakers: boolean },
  had: string[],
): Bundle[][] => {
  let turns: Bundle[] = got.turns.map((turn, n) => ({
    entity: { eid: turnId(recording, n) },
    heard_turn: { recording, ...turn },
  }))
  let ids = new Set(turns.map((t) => t.entity.eid))
  let gone: Bundle[] = had.filter((eid) => !ids.has(eid)).map((eid) => ({
    entity: { eid },
    $delete: true,
  }))
  let batches: Bundle[][] = []
  for (let i = 0; i < turns.length; i += BATCH) {
    batches.push(turns.slice(i, i + BATCH))
  }
  return [...batches, [...gone, {
    entity: { eid: recording },
    heard: {
      seconds: got.seconds,
      turns: got.turns.length,
      speakers: got.speakers,
    },
    failed: null,
  }]]
}

/**
 * The store's `speech_hear`: the upload `recording` heard, charged to its
 * space, its turns written. A no that won't change (the budget, speech
 * paused, a recording the provider can't hear) and a last try that failed
 * leave `failed{reason}`; asking again tries again. A run cut off after the
 * provider answered hears it again, and is charged again.
 */
export let hearWhole = async (
  at: Stored,
  recording: string,
  attempt?: Attempt,
) => {
  let [row] = await at.graph.get([recording])
  let sha = (row?.attachment as Comp | undefined)?.blob
  if (!row?.hearing || row.heard || typeof sha != 'string') return
  let { STORE, BLOBS } = at.env
  if (!STORE || !BLOBS || !at.app) throw new Error('Hearing has no storage')
  let found = at.context ?? await directoryOf(STORE).appAt(at.app)
  if (!found) throw new Error('Hearing has no account')
  let fail = async (reason: string) =>
    void await at.graph.apply([{
      entity: { eid: recording },
      failed: { reason },
    }], { trusted: true })
  let key = blobPrefix(found.space, found.app) + sha
  let [head, file] = await Promise.all([BLOBS.head(key), BLOBS.get(key)])
  if (!head || !file) return await fail('The recording is no longer kept.')
  let type = String((row.attachment as Comp).mime ?? '') ||
    'application/octet-stream'
  let got
  try {
    got = await hearing(
      { ...at.env, STORE },
      found.space,
      file.body,
      type,
      guessed(head.size),
    )
  } catch (e) {
    let final = e instanceof ModelError ||
      e instanceof SpeechError && !e.retry
    if (final || attempt?.last()) {
      await fail(e instanceof Error ? e.message : String(e))
    }
    if (final) return
    throw e
  }
  let had = await at.graph.read(`.heard_turn.recording=${recording}`)
  let speakers = speechOf(at.env)!.provider.hear.speakers
  for (
    let batch of landed(
      recording,
      { ...got, speakers },
      had.map((b) => b.entity.eid),
    )
  ) {
    await at.graph.apply(batch, { trusted: true })
  }
}
