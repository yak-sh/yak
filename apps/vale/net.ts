// The vale's store as this page holds it: a @yaks/client graph kept in step
// with the app's own doors at ./api/, the watches the game reads from, who is
// playing, and the clock everyone shares.
//
// Rows a player earns (a fall, a find, a quest step) are written through
// `keep`, which holds them a moment and sends them together: a visitor may
// write 30 times a minute, and a busy fight earns more rows than that. Until
// they are sent, `mine` counts them already, so nothing on screen waits.
import { type Client, client, type Watch } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import words from './vocab.json' with { type: 'json' }

export type Bundle = NonNullable<ReturnType<Client['ent']>>

/** One component of a row, or nothing: the fields are read with `num` and
 * `str`, which take what the store holds and default what it does not. */
export let comp = (
  b: Bundle | undefined,
  name: string,
): Record<string, unknown> => {
  let c = b?.[name]
  return c && typeof c == 'object' ? c : {}
}
export let num = (v: unknown, or = 0): number => typeof v == 'number' ? v : or
export let str = (v: unknown, or = ''): string => typeof v == 'string' ? v : or

/** Who is looking, as the app's door answers it. */
export type Me = {
  person: string | null
  name: string | null
  reads: boolean
  writes: boolean
  signIn: string | null
}

// The platform's doc, which a quest's title and words live in.
let DOC = {
  $defs: {
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
  },
}

export let vocab = loadVocab([DOC, words])

// How long rows wait to be sent together: under the door's 30 a minute.
let PACE = 2100

let HERO = 'mossvale.hero'

let stored = {
  get: (): string | null => {
    try {
      return localStorage.getItem(HERO)
    } catch {
      return null
    }
  },
  set: (eid: string) => {
    try {
      localStorage.setItem(HERO, eid)
    } catch { /* a page that cannot keep it asks again next time */ }
  },
}

export type Net = ReturnType<typeof connect>

/** Open the store. `base` is the app's api directory. */
export let connect = (base: URL) => {
  let c = client(vocab, [], {
    url: base.href.replace(/\/$/, ''),
    vault: false,
    wireVault: false,
    report: (e) =>
      console.warn(
        'mossvale store:',
        e.refused?.message ?? String(e.error),
        JSON.stringify(e.sent).slice(0, 300),
      ),
  })
  let skew = 0
  let now = () => Date.now() + skew
  let hero = stored.get()

  // My rows, until the store has them. Each change to the list replaces it,
  // so a reader can tell by its identity whether anything moved.
  let waiting: Bundle[] = []
  let last = 0
  let flush = () => {
    if (!waiting.length) return
    let batch = waiting
    waiting = []
    last = Date.now()
    c.mutate(batch)
  }
  let keep = (...bundles: Bundle[]) => {
    waiting = [...waiting, ...bundles]
    if (Date.now() - last >= PACE) flush()
  }

  // What the store holds of a watch, with what is still waiting to join it;
  // the same array for as long as neither changed.
  let joined = new Map<
    string,
    { held: Bundle[]; waiting: Bundle[]; out: Bundle[] }
  >()
  let join = (key: string, held: Bundle[], name: string): Bundle[] => {
    let j = joined.get(key)
    if (j && j.held == held && j.waiting == waiting) return j.out
    let seen = new Set(held.map((b) => b.entity.eid))
    let more = waiting.filter((b) => b[name] && !seen.has(b.entity.eid))
    let out = more.length ? [...held, ...more] : held
    joined.set(key, { held, waiting, out })
    return out
  }

  let watches: Record<string, Watch> = {
    players: c.watch('.player&?pose'),
    creatures: c.watch('.creature'),
    npcs: c.watch('.npc'),
    quests: c.watch('.quest&?doc'),
    falls: c.watch('.slain&.order=-slain.at&.limit=400'),
  }
  let own: Record<string, Watch> = {}
  let follow = (eid: string) => {
    for (let w of Object.values(own)) w.close()
    let q = JSON.stringify(eid)
    own = {
      slain: c.watch(`.slain.by=${q}`),
      item: c.watch(`.item.owner=${q}`),
      used: c.watch(`.used.by=${q}`),
      journal: c.watch(`.journal.player=${q}`),
    }
  }
  if (hero) follow(hero)

  let none: Bundle[] = []

  let net = {
    client: c,
    watches,
    now,
    /** the eid of this browser's hero, once there is one */
    get hero() {
      return hero
    },
    /** my rows of one kind: what the store holds, and what is waiting */
    mine: (name: string): Bundle[] =>
      join(name, own[name]?.value ?? none, name),
    /** the falls everyone has written, and mine still waiting */
    falls: (): Bundle[] => join('falls', watches.falls.value, 'slain'),
    keep,
    /** send what is waiting, if the pace allows */
    tick: () => {
      if (waiting.length && Date.now() - last >= PACE) flush()
    },
    /** send what is waiting now, whatever the pace: the page is going */
    flush,
    /** this frame's changes that stay on the page or go to the peers */
    move: (bundles: Bundle[]) => {
      if (bundles.length) c.mutate(bundles)
    },
    /** make a hero and make it this browser's */
    create: (
      look: { name: string; tint: string; hair: string; skin: string },
    ) => {
      let eid = crypto.randomUUID()
      hero = eid
      stored.set(eid)
      follow(eid)
      waiting = [...waiting, { entity: { eid }, player: look }]
      flush()
      return eid
    },
    /** who is looking, and the store's clock against ours */
    me: async (): Promise<Me> => {
      let t0 = Date.now()
      let r = await fetch(new URL('me', base)).catch(() => null)
      let t1 = Date.now()
      let date = Date.parse(r?.headers.get('date') ?? '')
      // The header is to the second: trust it only past a second's doubt.
      if (date) {
        let off = date + 500 - (t0 + t1) / 2
        if (Math.abs(off) > 1500) skew = off
      }
      if (r?.status == 404) {
        return {
          person: null,
          name: null,
          reads: true,
          writes: true,
          signIn: null,
        }
      }
      let body = r?.ok ? await r.json() : {}
      return {
        person: body.person ?? null,
        name: body.name ?? null,
        reads: body.reads ?? true,
        writes: body.writes ?? true,
        signIn: body.signIn ?? null,
      }
    },
  }
  addEventListener('pagehide', flush)
  return net
}
