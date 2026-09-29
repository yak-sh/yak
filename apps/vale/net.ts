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
// Rows a player earns (a fall, a find, a gathering, a quest step) are written
// through `keep`, which holds them a moment and sends them together: a visitor
// may write 30 times a minute, and a busy fight earns more rows than that.
// Until they are sent, `mine` counts them already, so nothing on screen waits.
import { type Client, client, type Watch } from '@yaks/client'
import { comp, num, str } from './bundle.ts'
export { comp, num, str } from './bundle.ts'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { areaOf, looksOf, REACH } from './area.ts'
import { writer } from './chat.ts'
import { groupOf } from './party-state.ts'
import { SIZE } from './levels.ts'
import { type Look, lookOf } from './make.ts'
import { type Seen, seenOf } from './seen.ts'
import { once as read } from './once.ts'
import words from './vocab.json' with { type: 'json' }

export type Bundle = NonNullable<ReturnType<Client['ent']>>

/** One component of a row, or nothing: the fields are read with `num` and
 * `str`, which take what the store holds and default what it does not. */

/** Who is looking, as the app's door answers it. */
export type Me = {
  person: string | null
  name: string | null
  reads: boolean
  writes: boolean
  signIn: string | null
}

/** A hero as the vale shows them: how they look now, and where they were
 * last seen (seen.ts), as the gate lists a person's heroes and the world and
 * the chat show anyone's. */
export type Hero = Look & { eid: string; seen: Seen | null }

// The words the store speaks, as it serves them (./api/vocab.json): this app's
// own and every word the platform gives it, the byline `created` among them,
// so the client asks and writes what the store takes. Loaded at the top of the
// module, so everything that imports it evaluates with them. A page that cannot
// reach the door still plays on its own words; only the gate's heroes wait for
// the next load.
let spoken = async (): Promise<VocabDoc[]> => {
  try {
    let r = await fetch(new URL('api/vocab.json', document.baseURI))
    if (r.ok) return await r.json()
    console.warn('mossvale store: no words,', r.status)
  } catch (e) {
    console.warn('mossvale store: no words,', e)
  }
  return [words]
}

export let vocab = loadVocab(await spoken())

/** A hero, off their player row and their newest look row. */
let heroOf = (b: Bundle, look?: Bundle): Hero => ({
  eid: b.entity.eid,
  ...lookOf(comp(look, 'look')),
  seen: seenOf(b),
})

// Each hero's newest look row, by hero.
let newest = (rows: Bundle[]) => {
  let by = new Map<string, Bundle>()
  for (let b of rows) {
    let l = comp(b, 'look'), p = str(l.player), had = by.get(p)
    if (!had || num(l.at) >= num(comp(had, 'look').at)) by.set(p, b)
  }
  return by
}

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

  let lookQuery = ''
  let lookWatch: Watch | null = null
  let lookBy = new Map<string, Bundle>()
  let area = areaOf(SIZE / 2, SIZE / 2, REACH)
  let near = c.watch(area.query)
  // The remote watch brings rows here; the local view also sees a write this
  // page just made, before the server adds it to the remote watch's members.
  let nearby = c.watch(area.query, { remote: false })
  let pending: { area: typeof area; watch: Watch; off: () => void } | null =
    null
  let follow = (x: number, z: number) => {
    let next = areaOf(x, z, REACH)
    if (next.key == (pending?.area.key ?? area.key)) {
      syncLooks()
      return
    }
    pending?.off()
    pending?.watch.close()
    pending = null
    if (next.key == area.key) {
      syncLooks()
      return
    }
    let watch = c.watch(next.query)
    let swap = () => {
      if (!watch.ready || pending?.watch != watch) return
      pending.off()
      near.close()
      nearby.close()
      near = watch
      nearby = c.watch(next.query, { remote: false })
      area = next
      pending = null
      syncLooks()
    }
    pending = { area: next, watch, off: watch.subscribe(swap) }
    swap()
  }
  let selected = new Map<string, { held: Bundle[]; rows: Bundle[] }>()
  let rows = (name: string): Bundle[] => {
    let held = nearby.value, was = selected.get(name)
    if (was?.held == held) return was.rows
    let found = held.filter((b) => b[name])
    selected.set(name, { held, rows: found })
    return found
  }
  let syncLooks = () => {
    let query = looksOf(area, hero ?? undefined)
    if (query == lookQuery) return
    lookWatch?.close()
    lookQuery = query
    lookWatch = c.watch(query)
  }
  let own: Record<string, Watch> = {}
  let chosen: Watch | null = null
  let followHero = (eid: string) => {
    for (let w of Object.values(own)) w.close()
    let q = JSON.stringify(eid)
    own = {
      slain: c.watch(`.slain.by=${q}`),
      item: c.watch(`.item.owner=${q}&?gathered&?crafted`),
      used: c.watch(`.used.by=${q}`),
      upgraded: c.watch(`.upgraded.by=${q}`),
      journal: c.watch(`.journal.player=${q}`),
      equip: c.watch(`.equip.player=${q}`),
      learned: c.watch(`.learned.player=${q}`),
      respec: c.watch(`.respec.player=${q}`),
      fire: c.watch(`.fire.player=${q}`),
      explored: c.watch(`.explored.player=${q}`),
      directive: c.watch(
        `.directive.player=${q}&?created&?companion&.order=-created.at&.limit=10`,
      ),
      teleport_request: c.watch(
        `.teleport_request.player=${q}&?created&.order=-created.at&.limit=10`,
      ),
    }
  }

  let none: Bundle[] = []

  let ready = (w: Watch): Promise<void> =>
    w.ready ? Promise.resolve() : new Promise((done) => {
      let off = w.subscribe(() => {
        if (w.ready) {
          off()
          done()
        }
      })
    })

  // One indexed watch holds the looks of this hero and nearby heroes. Its
  // answer is cached across area changes so a new watch need not flash the
  // creation colours while it loads.
  let lookFor = (eid: string) => {
    syncLooks()
    let current = newest(join('looks', lookWatch?.value ?? none, 'look'))
    for (let [id, b] of current) lookBy.set(id, b)
    return lookBy.get(eid)
  }

  // A one-time read uses the app's query door. It does not add a subscription
  // to the page's hibernating socket while the gate or a distant name loads.
  let once = (query: string): Promise<Bundle[]> => {
    let url = new URL('query', base)
    url.search = query.split('&').map(encodeURIComponent).join('&')
    return read<Bundle>(url)
  }

  // The page and an agent use the same declared app command, with the same
  // caller and access checks. The selected hero is the page's default player.
  let command = async (
    name: string,
    args: Record<string, string | number | boolean>,
  ): Promise<string> => {
    let r = await fetch(new URL('command', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        args: { ...(hero ? { player: hero } : {}), ...args },
      }),
    })
    let answer = await r.json().catch(() => ({}))
    if (!r.ok) {
      throw new Error(answer.error?.message ?? `Command refused (${r.status})`)
    }
    return answer.text || `${name} completed.`
  }

  let glimpsed = new Map<string, Hero | null>()
  let asking = new Map<string, Promise<{ hero: Hero | null; by: string }>>()
  let about = (eid: string): Promise<{ hero: Hero | null; by: string }> => {
    let pending = asking.get(eid)
    if (pending) return pending
    let read = async () => {
      let b = c.ent(eid)
      if (!b?.player || !b.created) {
        b = (await once(`.eid=${JSON.stringify(eid)}&.player&?created&*`))[0] ??
          b
      }
      let looks = await once(`.look.player=${JSON.stringify(eid)}&*`)
      let look = newest(looks).get(eid)
      if (look) lookBy.set(eid, look)
      let found = b?.player ? heroOf(b, look ?? lookBy.get(eid)) : null
      glimpsed.set(eid, found)
      return { hero: found, by: writer(b) }
    }
    let result = read()
    asking.set(eid, result)
    void result.catch(() => asking.delete(eid))
    return result
  }

  let net = {
    client: c,
    now,
    /** Keep the world rows and moving players near this point. */
    follow,
    players: () => rows('player'),
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
      chosen?.close()
      chosen = c.watch(`.eid=${JSON.stringify(eid)}&?created&*`)
      followHero(eid)
      syncLooks()
    },
    /** the heroes a person made, once the store has answered */
    heroes: async (person: string): Promise<Hero[]> => {
      let players = await once(
        `.player&.created.by=${JSON.stringify(person)}&*`,
      )
      let ids = players.map((b) => b.entity.eid)
      let looks: Bundle[] = []
      // Each temporary query fits beside the page's other subscriptions.
      for (let i = 0; i < ids.length; i += 20) {
        looks.push(...await once(`.look.player=${ids.slice(i, i + 20)}`))
      }
      let by = newest(looks)
      for (let [id, b] of by) lookBy.set(id, b)
      return players.map((b) => heroOf(b, by.get(b.entity.eid)))
    },
    /** a hero as they look now, or null while the store holds no row of
     * theirs */
    who: (eid: string): Hero | null => {
      let b = c.ent(eid)
      if (b?.player) return heroOf(b, lookFor(eid))
      if (eid && !asking.has(eid)) void about(eid)
      return glimpsed.get(eid) ?? null
    },
    /** One named hero beyond the page's area, including their newest look
     * and the person who made them. */
    about,
    /** The party a named hero belongs to, from steps written by that hero's
     * owner even when they are beyond the page's world watch. */
    partyOf: async (eid: string): Promise<string> => {
      let { by } = await about(eid)
      if (!by) return ''
      let rows = await once(`.party_step.player=${JSON.stringify(eid)}&*`)
      return groupOf(rows, eid, by)
    },
    /** Whether the hero this tab remembers is still in the store. */
    known: async (eid: string): Promise<boolean> =>
      (await once(`.eid=${JSON.stringify(eid)}&.player`)).length > 0,
    /** my rows of one kind: what the store holds, and what is waiting */
    mine: (name: string): Bundle[] =>
      join(name, own[name]?.value ?? none, name),
    /** whether the store has answered for all my rows */
    settled: (): boolean =>
      !!chosen?.ready && Object.values(own).every((w) => w.ready),
    /** Wait for the selected hero and every row that shapes their sheet. */
    settle: async (): Promise<void> => {
      if (chosen) await Promise.all([chosen, ...Object.values(own)].map(ready))
    },
    /** the falls everyone has written, and mine still waiting */
    falls: (): Bundle[] => join('falls', rows('slain'), 'slain'),
    /** the nodes everyone has gathered, and mine still waiting */
    gathered: (): Bundle[] => join('gathered', rows('gathered'), 'gathered'),
    keep,
    command,
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
    create: (look: Look) => {
      let eid = crypto.randomUUID()
      net.choose(eid)
      waiting = [...waiting, { entity: { eid }, player: {} }, {
        entity: { eid: crypto.randomUUID() },
        look: { player: eid, ...lookOf(look), at: now() },
      }]
      flush()
      return eid
    },
    /** change how the hero this tab plays looks: a row of its own, sent
     * now, since a visitor may only add rows */
    restyle: (look: Look) => {
      if (!hero) return
      waiting = [...waiting, {
        entity: { eid: crypto.randomUUID() },
        look: { player: hero, ...lookOf(look), at: now() },
      }]
      flush()
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
