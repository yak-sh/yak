// The villagers as this page holds them (villagers.ts says what they are):
// the store's row for each one in the level the hero is in, added the first
// time a hero comes; what they said back and where they chose to go, off
// their transcripts; the line a hero says beside one, which asks them to
// answer; the news of a quest handed in; and the mark on the hero that keeps
// a level's villagers awake while somebody plays in it.
//
// A guest reads what villagers say and is not heard by them: only a person
// signed in speaks (chat.ts), and only their hero's row is theirs to mark.
import type { Watch } from '@yaks/client'
import { type Line, writer } from './chat.ts'
import { type Bundle, comp, type Me, type Net, num, str } from './net.ts'
import type { Frame } from './play.ts'
import type { Spot } from './levels.ts'
import { GIVERS } from './quests.ts'
import {
  answered,
  born,
  CHAT,
  deeds,
  eidOf,
  persona,
  said,
  where,
  WINDOW,
} from './villagers.ts'

// How often a page says its hero is still in the level, in ms: well inside
// the five minutes that keep the villagers there awake.
let PRESENT = 2 * 60_000

// How far back the deeds a villager has heard of go, in ms.
let LATELY = 60 * 60_000

// How many of the level's villagers' outputs are asked for.
let HEARD = 60

export type Village = ReturnType<typeof village>

/** The villagers of whatever level the hero is in, over the store. */
export let village = (net: Net) => {
  let byEid = new Map(GIVERS.map((g) => [eidOf(g.id), g]))
  let byId = new Map(GIVERS.map((g) => [g.id, g]))
  let watch = (q: string): Watch | null => {
    try {
      return net.client.watch(q)
    } catch (e) {
      console.warn('mossvale villagers:', e)
      return null
    }
  }
  let rows = watch('.villager')
  let think = watch('.tool.name=think')
  // Who made each hero, which says whose hero is theirs to mark.
  watch('.player&?created')

  // What the level's villagers said back and chose, newest first.
  let level = ''
  let heard: Watch | null = null
  let follow = (lv: string) => {
    heard?.close()
    level = lv
    let eids = GIVERS.filter((g) => g.level == lv).map((g) => eidOf(g.id))
    heard = eids.length
      ? watch(
        `.entry.session=${
          eids.join(',')
        }&.output&?content&?answer&?created&.order=-created.at&.limit=${HEARD}`,
      )
      : null
  }
  let read: { rows: unknown; out: ReturnType<typeof answered> } | null = null
  let told = () => {
    let v = heard?.value ?? []
    if (read?.rows !== v) {
      read = { rows: v, out: answered(v, (s) => byEid.get(s)?.id ?? null) }
    }
    return read.out
  }

  // A write of its own, which the store may refuse without anything else
  // going down with it, and which never stops the frame that made it.
  let write = (bundles: Bundle[]) => {
    try {
      net.client.mutate(bundles)
    } catch (e) {
      console.warn('mossvale villagers:', e)
    }
  }

  let me: Me | null = null
  let last: Frame | null = null
  let asked = new Set<string>()
  let marked = { level: '', at: -Infinity }
  let held = (id: string) =>
    !!rows?.value.some((b) => b.entity.eid == eidOf(id))

  // The falls in the level the hero is in, as a villager hears of them.
  let falls = (f: Frame) => {
    let here = new Set(f.mobs.map((m) => m.eid))
    return net.falls().flatMap((b) => {
      let s = comp(b, 'slain')
      if (!here.has(str(s.creature))) return []
      let who = comp(net.client.ent(str(s.by)), 'player')
      return [{
        by: str(who.name, 'a hero'),
        kind: str(s.kind),
        at: num(s.at),
      }]
    })
  }

  return {
    /** who is looking: a person signed in is heard and marks their hero */
    me: (who: Me) => {
      me = who
    },
    /** this frame: follow the hero's level, say they are here, and add the
     * rows of its villagers the store does not hold yet */
    tick: (f: Frame) => {
      last = f
      if (f.level != level) follow(f.level)
      let hero = net.hero
      if (!hero || !me?.writes) return
      let now = Date.now()
      // Only a hero its person made is theirs to mark: a refused mark would
      // take the rows it went with down with it.
      let theirs = !!me.person && writer(net.client.ent(hero)) == me.person
      if (theirs && (marked.level != f.level || now - marked.at > PRESENT)) {
        marked = { level: f.level, at: now }
        net.keep({
          entity: { eid: hero },
          seen: { level: f.level, at: new Date(net.now()).toISOString() },
        })
      }
      let tool = think?.value[0]?.entity.eid
      if (!tool || !rows?.ready) return
      let missing = GIVERS.filter((g) =>
        g.level == f.level && !held(g.id) && !asked.has(g.id)
      )
      for (let g of missing) asked.add(g.id)
      // Another page adding the same row first refuses this one.
      if (missing.length) write(missing.map((g) => born(g, tool)))
    },
    /** the name of the villager a line said now would be said to */
    near: (): string | null => {
      let g = last?.talk
      return g && held(g.id) && me?.person ? g.name : null
    },
    /** the rest of a line said now, when it is said beside a villager: the
     * entry of their transcript that asks them to answer */
    to: (words: string): Record<string, unknown> | null => {
      let f = last
      let g = f?.talk && byId.get(f.talk.id)
      if (!f || !g || !held(g.id) || !me?.person) return null
      let instructions = persona(g, {
        hero: { name: f.sheet.name, lvl: f.sheet.lvl },
        quests: f.sheet.quests.filter((q) => q.quest.giver == g.id),
        deeds: deeds(falls(f), net.now() - LATELY),
        here: f.others.map((o) => o.name),
      })
      return {
        entry: { session: eidOf(g.id) },
        content: { body: said(f.sheet.name, words) },
        using: { model: CHAT, instructions, window: WINDOW, effort: 'low' },
      }
    },
    /** a villager hears news without answering it: a quest handed in */
    news: (id: string, text: string) => {
      if (!me?.writes || !held(id)) return
      write([{
        entity: { eid: crypto.randomUUID() },
        entry: { session: eidOf(id) },
        content: { body: text },
        notice: {},
      }])
    },
    /** what the level's villagers said, oldest first, as lines over their
     * heads */
    lines: (): Line[] => told().lines,
    /** a villager's name and colour, for the chat's log */
    who: (id: string) => {
      let g = byId.get(id)
      return g ? { name: g.name, tint: g.look.tint } : null
    },
    /** where a villager stands at `now`, given where their home is */
    at: (id: string, home: Spot, now: number): Spot => {
      let g = byId.get(id)
      return g ? where(g, told().plans.get(id) ?? [], now) : home
    },
  }
}
