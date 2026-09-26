// The vale's store as this page holds it: a @yaks/client graph kept in step
// with the app's own doors at ./api/, the watches the game reads from, which
// hero this tab plays, and the clock everyone shares.
//
// A hero belongs to the person who made it: the store stamps every row with
// who wrote it (`created.by`), so a signed-in person finds their heroes on any
// device by asking for the ones they made. A tab remembers which of them it
// is playing (sessionStorage), so two tabs can play two heroes, and a reload
// keeps playing the same one; a hero made while signed out is known only to
// its tab.
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

/** One of a person's heroes, as the gate lists them. */
export type Hero = {
  eid: string
  name: string
  tint: string
  hair: string
  skin: string
}

export let vocab = loadVocab([words])

// How long rows wait to be sent together: under the door's 30 a minute.
let PACE = 2100

// Which hero this tab plays.
let HERO = 'mossvale.hero'
let tab = {
  get: (): string | null => {
    try {
      return sessionStorage.getItem(HERO)
    } catch {
      return null
    }
  },
  set: (eid: string) => {
    try {
      sessionStorage.setItem(HERO, eid)
    } catch { /* a tab that cannot keep it asks again after a reload */ }
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
  let hero: string | null = null

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
    players: c.watch('.player&?position&?motion&?vitals&?fight'),
    creatures: c.watch('.creature'),
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

  let none: Bundle[] = []

  let net = {
    client: c,
    watches,
    now,
    /** the eid of the hero this tab plays, once there is one */
    get hero() {
      return hero
    },
    /** the hero this tab played before a reload, if it remembers one */
    played: tab.get,
    /** play this hero in this tab */
    choose: (eid: string) => {
      hero = eid
      tab.set(eid)
      follow(eid)
    },
    /** the heroes a person made, as the store answers now.
     *
     * TODO: a watch on the client, once a page's client can know the store's
     * whole vocabulary. The store stamps `created` in the platform's own words
     * (workers/yak/vocab.ts `coreDoc`), which no door serves and no package
     * exports, so this page's vocabulary lacks `created` and the client
     * refuses to route `created.by`. Until then the store's query door
     * answers it. */
    heroes: async (person: string): Promise<Hero[]> => {
      let q = `.player&.created.by=${JSON.stringify(person)}`
      let r = await fetch(new URL(`query?${encodeURIComponent(q)}`, base))
      let rows: unknown = r.ok ? await r.json() : []
      return (Array.isArray(rows) ? rows : []).flatMap((row) => {
        let eid = row?.entity?.eid
        let p = row?.player
        return typeof eid == 'string' && p && typeof p == 'object'
          ? [{
            eid,
            name: str(p.name, 'Wanderer'),
            tint: str(p.tint, '#c95f4a'),
            hair: str(p.hair, '#5a3a26'),
            skin: str(p.skin, '#e7b996'),
          }]
          : []
      })
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
    /** make a hero and play it in this tab */
    create: (
      look: { name: string; tint: string; hair: string; skin: string },
    ) => {
      let eid = crypto.randomUUID()
      net.choose(eid)
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
