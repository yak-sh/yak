// App graph lifecycle over private SQLite rows. The production declaration
// selector owns staging and release changes; this host supplies transactions,
// graph binding and sockets without Durable Object alarms or runtime duties.
import { json, readBody, refuse } from '@yaks/api'
import type { Actor, Bundle } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { cleanup } from '@yaks/testing'
import type { VocabDoc } from '@yaks/vocab'
import {
  candidate,
  declarationSlot,
  heldDeclaration,
  redeclared,
  selectDeclaration,
  stageDeclaration,
  unseeded,
} from './app-declarations.ts'
import { appWire, wireVocab } from './app-store-probe.ts'
import { broadcast, drafted, released } from './page-notice.ts'
import { expiring } from './expires.ts'
import { appDoc, appVocab, grew } from './vocab.ts'
import { sqliteApp } from './sqlite-app-probe.ts'
import { PLATFORM_OBJECT } from './door.ts'
import type { Env } from './env.ts'
import { mode } from '@yaks/member'

type Page = { send(packet: string): void }

/** An independent graph for each app or preview name; the directory stays put. */
export let lifecycleStores = (env: Env) => {
  let namespace = env.STORE
  let pages = new Map<string, Page[]>()
  let held = new Map<string, ReturnType<typeof store>>()
  let disposals = new Set<() => void>()
  cleanup(() => {
    for (let dispose of disposals) dispose()
  })
  let store = (name: string) => {
    let slots = new Map<string, string>()
    let unselectable = new Set<string>()
    let backend = sqliteApp((dispose) => disposals.add(dispose))
    let wire: ReturnType<typeof appWire>
    let deployed = false
    let read = (key: string) => slots.get(key) ?? null
    let write = (key: string, value: string) => void slots.set(key, value)
    let make = (doc: VocabDoc) => {
      let words = wireVocab(appVocab(doc))
      let g = backend.graph(words, wire?.graph)
      return appWire(words, name, {
        app: { eid: read('app')!, mode: mode(read('access')), manifest: doc },
        graph: () => g,
        found: backend.found,
      })
    }
    let bind = () => wire = make(appDoc(read('vocab') ?? '{}'))
    let rows = (comp: string, prop?: string) => {
      if (!wire.graph.vocab.comp(comp)) return 0
      let held = wire.graph.read(
        `.${comp}${prop ? '.' + prop : ''}&.limit=1`,
        { administrative: true },
      )
      if (held instanceof Promise) {
        throw new Error('declarations need synchronous rows')
      }
      return held.length
    }
    let atomic = (run: () => void, failed: (error: unknown) => void) => {
      let before = new Map(slots), active = wire
      try {
        backend.atomic(active.graph, run)
      } catch (error) {
        slots = before
        if (wire != active) wire.subs.stop()
        wire = active
        failed(error)
        return
      }
      if (wire != active) active.subs.stop()
    }
    let prepare = (next: string) =>
      JSON.stringify(
        grew(appDoc(read('vocab') ?? '{}'), appDoc(next), rows).doc,
      )
    let trial = (
      doc: VocabDoc,
      run: (trial: ReturnType<typeof appWire>) => void = () => {},
    ) => {
      let rollback = Symbol('declaration trial')
      let tried: ReturnType<typeof appWire> | undefined
      try {
        backend.atomic(wire.graph, () => {
          tried = make(doc)
          run(tried)
          throw rollback
        })
      } catch (error) {
        if (error !== rollback) throw error
      } finally {
        tried?.subs.stop()
      }
    }
    pages.set(name, [])
    let send = (packet: string) =>
      broadcast(pages.get(name)!, packet, (error) => {
        throw error
      })
    let fetch = async (request: Request): Promise<Response> => {
      try {
        let path = new URL(request.url).pathname
        for (
          let [header, key] of [['x-yak-app', 'app'], [
            'x-yak-access',
            'access',
          ]]
        ) {
          let value = request.headers.get(header)
          if (value) write(key, value)
        }
        if (!wire) bind()
        let selected = selectDeclaration(request, {
          read,
          write,
          own: false,
          unselectable,
          deployed: () => deployed,
          prepare,
          bind,
          seed: (bundles, actor, effects) =>
            wire.write(
              request,
              unseeded(wire.graph, bundles),
              actor,
              // Its ordinary guard checked the seed before staging it. Selection
              // is the host's committed delivery of that accepted write.
              { trusted: true, deferEffects: (run) => effects.push(run) },
            ),
          atomic,
          failed: (error) => {
            throw error
          },
        })
        if (selected.deploymentMoved) deployed = true
        for (let effect of selected.effects) await effect()
        if (path == '/drafted') return drafted(request, send)
        if (path == '/released') return released(request, send)
        if (path == '/expires') {
          if (
            !name.startsWith('preview/') ||
            request.headers.get('x-yak-kernel') != '1' ||
            request.method != 'POST'
          ) {
            return json({ error: 'NotFound', message: 'no route' }, 404)
          }
          write('expires', JSON.stringify(expiring(await request.json())))
          return json({ ok: true })
        }
        if (['/uses', '/tools'].includes(path)) {
          return declarationSlot(
            request,
            path.slice(1) as 'uses' | 'tools',
            read,
            write,
          )
        }
        if (path == '/vocab') {
          if (request.method == 'GET') {
            return json(appDoc(heldDeclaration(request, 'vocab', read)))
          }
          if (request.method != 'POST') {
            return Response.json(
              {
                error: 'NotAllowed',
                message: '/vocab takes GET or POST',
              },
              { status: 405, headers: { allow: 'GET, POST' } },
            )
          }
          let changed = redeclared(
            request,
            read('vocab') ?? '{}',
            await readBody(request),
            rows,
          )
          let release = candidate(request)
          if (release) {
            trial(changed.doc)
            stageDeclaration(
              request,
              'vocab',
              JSON.stringify(changed.doc),
              write,
            )
          } else {
            atomic(() => {
              stageDeclaration(
                request,
                'vocab',
                JSON.stringify(changed.doc),
                write,
              )
              bind()
            }, (error) => {
              throw error
            })
          }
          return json({
            ok: true,
            comps: Object.keys(changed.doc.$defs ?? {}),
            dropped: changed.dropped,
            added: changed.added,
            kept: changed.kept,
          })
        }
        if (path == '/seed') {
          let release = candidate(request)
          if (request.method != 'POST' || !release) {
            return json({ error: 'NotFound', message: 'no route' }, 404)
          }
          let bundles = JSON.parse(await readBody(request)) as Bundle[]
          if (!Array.isArray(bundles)) {
            throw new Refused('/seed takes a JSON array of bundles')
          }
          let actor: Actor | null = await wire.authenticate(request)
          let next = read(`vocab:${release}`)
          if (!next) throw new Refused('candidate vocabulary is not staged')
          trial(appDoc(prepare(next)), (trial) => {
            let out = trial.write(
              request,
              unseeded(trial.graph, bundles),
              actor,
              { check: true },
            )
            if (out instanceof Promise) {
              throw new Error('a staged seed must check synchronously')
            }
          })
          if (new URL(request.url).searchParams.get('check') != '1') {
            write(
              `seed:${release}`,
              JSON.stringify({
                bundles,
                actor,
                from: new URL(request.url).searchParams.get('from'),
              }),
            )
          }
          return json({ ok: true })
        }
        return await wire.fetch(request)
      } catch (error) {
        return refuse(error, request)
      }
    }
    disposals.add(() => wire?.subs.stop())
    return { fetch }
  }
  env.STORE = {
    idFromName: (name) => name,
    get: (name, options) => {
      if (String(name) == PLATFORM_OBJECT) return namespace.get(name, options)
      let key = String(name)
      let found = held.get(key)
      if (!found) held.set(key, found = store(key))
      return found
    },
  }
  return pages
}
