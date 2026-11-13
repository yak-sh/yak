import { kvStorage } from './binding-probe.ts'
import { servingAuthority } from './app-serving-authority.ts'
import { copyOf, servingDirectory } from './directory-copy.ts'
import { fetch as directoryFetch } from './directory.ts'
import type { Driver } from '@yaks/sql'
// App graph lifecycle over RAM rows, or private SQLite for storage behavior. The production declaration
// selector owns staging and release changes; this host supplies transactions,
// graph binding and sockets without Durable Object alarms or runtime duties.
import { json, readBody, refuse } from '@yaks/api'
import type { Actor, Bundle } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { cleanup } from '@yaks/testing'
import { driver, type Measure } from '@yaks/durable-object'
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
import { appWire, beside, wireVocab } from './app-store-probe.ts'
import { broadcast, drafted, released } from './page-notice.ts'
import { expiring } from './expires.ts'
import { storageDoor } from './page-storage.ts'
import { appDoc, appVocab, grew } from './vocab.ts'
import { sqliteApp } from './sqlite-app-probe.ts'
import { ramApp } from './ram-app-probe.ts'
import { PLATFORM_OBJECT } from './door.ts'
import type { Env } from './env.ts'
import { mode } from '@yaks/member'
import { eraseStore, weighing } from './app-storage.ts'
import { reviveStore, suspendStore } from './app-dormancy.ts'
import { weighed } from './meter.ts'
import {
  fitSchema,
  KV,
  reshapeSlots,
  shapeOf,
  slotsOf,
} from './store-schema.ts'
import type { durable } from '../../packages/durable-object/testing.ts'
import type { Snapshot } from '../../packages/sqlite/testing.ts'

type Page = {
  send(packet: string): void
  close?(code: number, reason: string): void
}
type Physical = ReturnType<typeof durable>
type Backend =
  & Pick<ReturnType<typeof sqliteApp>, 'graph' | 'atomic'>
  & Partial<Pick<ReturnType<typeof sqliteApp>, 'found' | 'adopt'>>

/** An independent graph for each app or preview name; the directory stays put. */
export let lifecycleStores = (
  env: Env,
  storage?: (name: string, from: Snapshot) => Physical,
  measure?: Measure,
) => {
  let namespace = env.STORE
  let pages = new Map<string, Page[]>()
  let held = new Map<string, ReturnType<typeof store>>()
  let states = new Map<string, { storage: Physical }>()
  let pending = new Set<Promise<void>>()
  let failures: unknown[] = []
  let wait = (work: Promise<void>) => {
    pending.add(work)
    work.then(() => pending.delete(work), () => pending.delete(work))
  }
  let disposals = new Set<() => void>()
  cleanup(() => {
    for (let dispose of disposals) dispose()
  })
  let store = (name: string, restored?: Physical) => {
    let slots = new Map<string, string>()
    let unselectable = new Set<string>()
    let memory = kvStorage()
    let physical: Physical | undefined
    let persistence = () => physical ?? memory
    let sql: (Driver & Disposable) | undefined
    // Its write log while its rows are in RAM, kept across its graphs.
    let log: Driver | undefined
    let backend: Backend = storage || restored
      ? sqliteApp(
        (dispose) => disposals.add(dispose),
        storage && ((from) => {
          let owned = physical = storage(name, from)
          states.set(name, { storage: owned })
          return sql = Object.assign(driver(owned, undefined, measure), {
            [Symbol.dispose]: () => owned[Symbol.dispose](),
          })
        }),
      )
      : ramApp()
    let hydrated = !!restored
    let slotCache = new Map<string, string | null>()
    let raw: ReturnType<typeof slotsOf> | undefined
    // A driver over storage this store holds, for the app's graph to use next.
    let drive = (owned: Physical) => {
      sql = Object.assign(driver(owned, undefined, measure), {
        [Symbol.dispose]: () => owned[Symbol.dispose](),
      })
      backend.adopt!(sql)
    }
    if (restored) {
      let owned = physical = restored
      states.set(name, { storage: owned })
      drive(owned)
      raw = slotsOf(() => sql!, slotCache)
      reshapeSlots(raw.read, raw.write)
    }
    let wire: ReturnType<typeof appWire>
    let deployed = false
    let read = (key: string) => raw ? raw.read(key) : slots.get(key) ?? null
    let write = (key: string, value: string) => {
      if (raw) raw.write(key, value)
      else slots.set(key, value)
    }
    let weigh = weighing({
      read: () =>
        physical && read('app') && !name.startsWith('preview/')
          ? { bytes: physical.sql.databaseSize, told: read('weighed') }
          : null,
      tell: (bytes) => weighed(env, read('app')!, bytes),
      remember: (bytes) => write('weighed', String(bytes)),
      failed: (error) => void failures.push(error),
      wait,
    })
    let make = (doc: VocabDoc, reset = false) => {
      let words = wireVocab(appVocab(doc))
      let g = backend.graph(
        words,
        wire?.graph,
        hydrated
          ? (sql) => {
            let [failure] = fitSchema(
              sql,
              shapeOf(name, JSON.stringify(doc)),
              read,
              write,
              () => env.CF_VERSION_METADATA?.id ?? null,
            )
            if (failure) throw failure
          }
          : undefined,
        reset,
      )
      if (sql && !raw) {
        sql.query(KV)
        raw = slotsOf(() => sql!, slotCache)
        for (let [key, value] of slots) raw.write(key, value)
        slots.clear()
      }
      let eid = read('app')
      let next = appWire(words, name, {
        ...(eid
          ? { app: { eid, mode: mode(read('access')), manifest: doc } }
          : {}),
        graph: () => g,
        found: backend.found,
        db: () => sql ?? (log ??= beside()),
      })
      if (physical) {
        g.use({
          name: 'yak/weigh',
          hooks: {
            effect: (rows) => {
              weigh()
              return rows
            },
          },
        })
      }
      return next
    }
    let bind = (reset = false) =>
      wire = make(appDoc(read('vocab') ?? '{}'), reset)
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
        slotCache.clear()
        if (wire != active) wire.subs.stop()
        wire = active
        failed(error)
        return
      }
      if (wire != active) active.subs.stop()
    }
    let authority = servingAuthority({
      read,
      write,
      copy: () => env.SERVING_COPY,
      directory: () => env.STORE,
      now: () => Date.now(),
      transport: () =>
        servingDirectory({
          fetch: (request) => directoryFetch(request, env),
        }, { copy: env.SERVING_COPY ? copyOf(env) : undefined }),
      // The refreshed request carries its new standing into appWire's
      // request-local vouch; no prior role survives the header replacement.
      vouch: () => {},
      atomic: (run) =>
        atomic(run, (error) => {
          throw error
        }),
      bind,
      mode: (value) => {
        let app = read('app')
        if (app) {
          wire.graph.apply(
            [{ entity: { eid: app }, access: { mode: value } }],
            { trusted: true },
          )
        }
      },
    })
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
        slotCache.clear()
      }
    }
    pages.set(name, [])
    let send = (packet: string) =>
      broadcast(pages.get(name)!, packet, (error) => {
        throw error
      })
    let erase = async () => {
      if (!wire) bind()
      return await eraseStore(name, {
        pages: pages.get(name)!,
        close: () => wire.subs.stop(),
        clear: async () => {
          await physical?.deleteAll()
          memory.map.clear()
        },
        plant: () => {
          wire.subs.stop()
          slots.clear()
          slotCache.clear()
          raw = undefined
          hydrated = false
          unselectable.clear()
          deployed = false
          // `deleteAll` passed by the driver, whose caches still hold the
          // tables it saw: the emptied storage is planted through a new one.
          if (physical) drive(physical)
          bind(true)
          return json({ ok: true })
        },
      })
    }
    let fetch = async (request: Request): Promise<Response> => {
      try {
        let path = new URL(request.url).pathname
        let kernel = request.headers.get('x-yak-kernel') == '1'
        if (await persistence().get<boolean>('dormant')) {
          if (kernel && path == '/' && request.method == 'DELETE') {
            if (physical) {
              await physical.deleteAll()
              return json({ ok: true })
            }
            return await erase()
          }
          if (
            !(kernel && ['/dormant', '/revive'].includes(path) &&
              request.method == 'POST')
          ) {
            return json(
              { error: 'NotFound', message: 'app is in the trash' },
              404,
            )
          }
        }
        if (kernel && request.method == 'POST' && path == '/dormant') {
          if (!wire) bind()
          await suspendStore(persistence(), pages.get(name)!)
          return json({ ok: true })
        }
        if (kernel && request.method == 'POST' && path == '/revive') {
          if (!wire) bind()
          return await reviveStore(persistence(), {
            activate: () => {},
            start: () => {
              if (!wire) bind()
              return undefined
            },
            arm: async () => {
              await physical?.setAlarm(Date.now())
            },
          })
        }
        if (env.SERVING_COPY) {
          if (!wire) bind()
          await authority.learn(request)
        }
        let learned = false
        for (
          let [header, key] of [['x-yak-app', 'app'], [
            'x-yak-access',
            'access',
          ]]
        ) {
          let value = request.headers.get(header)
          if (value && value != read(key)) {
            write(key, value)
            learned = true
          }
        }
        if (!wire) bind()
        else if (learned) {
          let before = wire
          bind()
          before.subs.stop()
        }
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
        if (path == '/' && request.method == 'DELETE') {
          if (request.headers.get('x-yak-kernel') != '1') {
            return json({ error: 'NotFound', message: 'no route' }, 404)
          }
          return await erase()
        }
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
        if (path == '/storage') return storageDoor(request, read, write)
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
  return {
    sockets: pages,
    states,
    // The object starts again on these bytes, as a restored Durable Object
    // does: one app_new already stood up (tools.ts) is let go.
    restore: (name: string, physical: Physical) => {
      let restored = store(name, physical)
      held.set(name, restored)
      return restored
    },
    object: (name: string) => env.STORE.get(env.STORE.idFromName(name)),
    settled: async () => {
      while (pending.size) await Promise.all(pending)
      if (failures.length) throw failures.shift()
    },
  }
}
