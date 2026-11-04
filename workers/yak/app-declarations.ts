// An app's declaration slots and serving pointer. The host supplies atomic
// storage and graph binding; deciding what a request stages or selects is
// independent of a Durable Object and its installation duties.
import type { Actor, Bundle, Graph } from '@yaks/graph'
import { json, readBody } from '@yaks/api'
import { ACCEPTED } from './door.ts'
import { appDoc, grew, unlent, unsaid } from './vocab.ts'

type Word = 'vocab' | 'uses' | 'tools'
type Read = (key: string) => string | null
type Write = (key: string, value: string) => void
export type Deferred = (() => void | Promise<void>)[]

/** A candidate is prepared without moving the serving release. */
export let candidate = (request: Request): string | null => {
  let release = request.headers.get('x-yak-release')
  return request.headers.has('x-yak-base-release') && release &&
      /^[a-z0-9-]+$/.test(release)
    ? release
    : null
}

/** Read a candidate's own slot, falling back to the serving declaration. */
export let heldDeclaration = (request: Request, word: Word, read: Read) => {
  let release = candidate(request)
  return (release && read(`${word}:${release}`)) ?? read(word) ?? '{}'
}

/** The slot this request writes. */
export let declarationKey = (request: Request, word: Word) => {
  let release = candidate(request)
  return release ? `${word}:${release}` : word
}

/** Write a candidate slot or the serving slot this request addresses. */
export let stageDeclaration = (
  request: Request,
  word: Word,
  value: string,
  write: Write,
) => {
  write(declarationKey(request, word), value)
}

/** Admission and retained words are the same for every app graph host. */
export let redeclared = (
  request: Request,
  before: unknown,
  body: unknown,
  rows: (component: string, property?: string) => number,
) => {
  let was = appDoc(before)
  let accepted = JSON.parse(request.headers.get(ACCEPTED) ?? '[]')
  let next = unlent(
    unsaid(appDoc(body), was, 'vocab.json', accepted),
    was,
    'vocab.json',
    accepted,
  )
  return grew(was, next, rows)
}

/** A fixed seed row already present, including a tombstone, stays its owner's. */
export let unseeded = (graph: Graph, bundles: Bundle[]): Bundle[] => {
  let ids = bundles.map((b) => b.entity?.eid)
    .filter((id) => typeof id == 'string' && !id.startsWith('$'))
  let rows = graph.get(ids, ['entity'])
  if (rows instanceof Promise) {
    throw new Error('a staged seed must read synchronously')
  }
  let held = new Set(rows.map((b) => b.entity.eid))
  return bundles.filter((b) => !held.has(b.entity?.eid))
}

type Host = {
  read: Read
  write: Write
  own: boolean
  unselectable: Set<string>
  deployed: () => boolean
  prepare: (next: string) => string
  bind: () => void
  seed: (bundles: Bundle[], actor: Actor | null, effects: Deferred) => unknown
  atomic: (run: () => void, failed: (error: unknown) => void) => void
  failed: (error: unknown, release: string) => void
}

/** Select the directory's release, rolling back the whole transition on failure. */
export let selectDeclaration = (request: Request, host: Host) => {
  let unchanged = () => ({ deploymentMoved: false, effects: [] as Deferred })
  if (candidate(request) || host.own) return unchanged()
  let release = request.headers.get('x-yak-release')
  if (release == null || !/^[a-z0-9-]+$/.test(release)) return unchanged()
  let { read, write } = host
  let active = read('release')
  if (active == release || host.unselectable.has(release)) return unchanged()
  let deploymentMoved = false, selected = true
  let effects: Deferred = []
  host.atomic(() => {
    if (active == null) {
      deploymentMoved = release != '0' && !host.deployed()
      write('release', release)
      return
    }
    let words = ['vocab', 'uses', 'tools'] as const
    let was = read('vocab') ?? '{}', toolsWas = read('tools') ?? '{}'
    let next = read(`vocab:${release}`) ?? read('vocab') ?? '{}'
    if (active != '0' && release != '0') next = host.prepare(next)
    for (let word of words) write(`${word}:${active}`, read(word) ?? '{}')
    for (let word of words) {
      write(
        word,
        word == 'vocab'
          ? next
          : read(`${word}:${release}`) ?? read(word) ?? '{}',
      )
    }
    write('release', release)
    if (read('vocab') != was) host.bind()
    let seed = read(`seed:${release}`)
    let planted = seed
      ? JSON.parse(seed) as {
        bundles: Bundle[]
        actor: Actor | null
        from?: string
      }
      : null
    let mark = planted?.from ? `seeded:${planted.from}` : 'seeded'
    let seeded = read(mark) ||
      (planted?.from == read('app') && read('seeded'))
    if (planted && !seeded && !request.headers.has('x-yak-base-release')) {
      let result = host.seed(planted.bundles, planted.actor, effects)
      if (result instanceof Promise) {
        throw new Error('a staged seed must apply synchronously')
      }
      write(mark, release)
    }
    deploymentMoved = read('tools') != toolsWas || read('vocab') != was ||
      !host.deployed()
  }, (error) => {
    selected = false
    host.unselectable.add(release)
    host.failed(error, release)
  })
  return selected ? { deploymentMoved, effects } : unchanged()
}

/** The declaration's JSON-object slots, served by either graph host. */
export let declarationSlot = async (
  request: Request,
  word: 'uses' | 'tools',
  read: Read,
  write: Write,
): Promise<Response> => {
  if (request.method == 'GET') {
    return Response.json(JSON.parse(heldDeclaration(request, word, read)))
  }
  if (request.method != 'POST') {
    return Response.json({
      error: 'NotAllowed',
      message: `/${word} takes GET or POST`,
    }, { status: 405, headers: { allow: 'GET, POST' } })
  }
  let body = await readBody(request)
  let held: unknown
  try {
    held = JSON.parse(body.trim() || '{}')
  } catch {
    held = null
  }
  if (!held || typeof held != 'object' || Array.isArray(held)) {
    return json(
      { error: 'Refused', message: `/${word} takes a JSON object` },
      400,
    )
  }
  let now = JSON.stringify(held)
  if (now != read(declarationKey(request, word))) {
    stageDeclaration(request, word, now, write)
  }
  return json({ ok: true, [word]: Object.keys(held) })
}
