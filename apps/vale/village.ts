// The villagers as this page holds them (villagers.ts says what they are):
// the store's row for each one in the level the hero is in, added the first
// time a hero comes; what they said back, where they chose to go and how they
// feel, off their transcripts; the line a hero says beside one, which asks
// them to answer, told what they hold, what deals stand between them and the
// hero (deals.ts), their job on the notice board, how they feel and where
// the land's people went lately; and the news of a quest handed in. What
// keeps a level's villagers awake while somebody plays in it is where the
// hero was last seen (seen.ts).
//
// A guest reads what villagers say and is not heard by them: only a person
// signed in speaks (chat.ts).
import type { Watch } from '@yaks/client'
import { EARSHOT, type Line } from './chat.ts'
import type { Deals } from './deals.ts'
import { type Bundle, comp, type Me, type Net, num, str } from './net.ts'
import type { Frame } from './play.ts'
import type { Spot } from './levels.ts'
import type { Vec } from './mesh.ts'
import type { Vale } from './terrain.ts'
import { GIVERS } from './quests.ts'
import { welcomed } from './village-tasks.ts'
import { wares } from './stock.ts'
import {
  aboutOf,
  born,
  characterOf,
  CHAT,
  decided,
  deeds,
  eidOf,
  goings,
  greeting,
  hears,
  looks,
  named,
  type Person,
  persona,
  said,
  where,
  WINDOW,
} from './villagers.ts'

// How far back the deeds a villager has heard of go, in ms.
let LATELY = 60 * 60_000

// How many of the level's villagers' outputs are asked for.
let HEARD = 60

export type Village = ReturnType<typeof village>

/** Only E engagement or a nearby name mention chooses a listener. The nearest
 * named villager hears an open mention when several names were said.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { listener } from './village.ts'
 * let nearby = [
 *   { id: 'bob', name: 'Bob the farmer', near: 9 },
 *   { id: 'wren', name: 'Elder Wren', near: 4 },
 *   { id: 'pip', name: 'Pip', near: 30 },
 * ]
 * assertEquals(listener(null, nearby, 'farm'), null)
 * assertEquals(listener(null, nearby, "Bob's farm"), { id: 'bob', heard: 'mentioned' })
 * assertEquals(listener(null, nearby, 'Bob and Wren'), { id: 'wren', heard: 'mentioned' })
 * assertEquals(listener(null, nearby, 'Pip'), null)
 * assertEquals(listener('bob', nearby, 'hello'), { id: 'bob', heard: 'addressed' })
 * ```
 */
export let listener = (
  engaged: string | null,
  nearby: { id: string; name: string; near: number }[],
  words: string,
): { id: string; heard: 'addressed' | 'mentioned' } | null => {
  if (engaged) return { id: engaged, heard: 'addressed' }
  let mentioned =
    nearby.filter((v) => v.near <= EARSHOT && named(v.name, words))
      .sort((a, b) => a.near - b.near)[0]
  return mentioned ? { id: mentioned.id, heard: 'mentioned' } : null
}

/** The villagers of whatever level the hero is in, over the store; `deal`
 * says what one holds free to give, and what deals stand with the hero. */
export let village = (net: Net, deal: Deals) => {
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
  let rows: Watch | null = null
  let think = watch('.tool.name=think')

  // What the level's villagers said back and chose, newest first.
  let level = ''
  let heard: Watch | null = null
  let chosen: Watch | null = null
  let follow = (lv: string) => {
    rows?.close()
    heard?.close()
    chosen?.close()
    level = lv
    rows = watch(`.villager.level=${JSON.stringify(lv)}&*`)
    let eids = GIVERS.filter((g) => g.level == lv).map((g) => eidOf(g.id))
    heard = eids.length
      ? watch(
        `.entry.session=${
          eids.join(',')
        }&.output&?content&?answer&?created&.order=-created.at&.limit=${HEARD}`,
      )
      : null
    chosen = eids.length
      ? watch(
        `.going.villager=${
          eids.join(',')
        }&?created&.order=-created.at&.limit=${HEARD}`,
      )
      : null
  }
  let read: {
    rows: unknown
    choices: unknown
    out: ReturnType<typeof decided>
  } | null = null
  let told = () => {
    let v = heard?.value ?? [], choices = chosen?.value ?? []
    if (read?.rows !== v || read?.choices !== choices) {
      let out = decided(v, choices, (s) => byEid.get(s)?.id ?? null)
      read = { rows: v, choices, out }
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
  let welcome = new Map<string, boolean>()
  let last: Frame | null = null
  let engaged: string | null = null
  let asked = new Set<string>()
  let held = (id: string) =>
    !!rows?.value.some((b) => b.entity.eid == eidOf(id))

  let people = (): Map<string, Person> => {
    let byId = new Map(rows?.value.map((b) => [b.entity.eid, b]) ?? [])
    return new Map(
      GIVERS.filter((g) => g.level == level).map((g) => [
        g.id,
        {
          ...aboutOf(g, comp(byId.get(eidOf(g.id)), 'villager')),
          ...characterOf(comp(byId.get(eidOf(g.id)), 'character')),
        },
      ]),
    )
  }

  // The falls in the level the hero is in, as a villager hears of them.
  let falls = (f: Frame) => {
    let here = new Set(f.mobs.map((m) => m.eid))
    return net.falls().flatMap((b) => {
      let s = comp(b, 'slain')
      if (!here.has(str(s.creature))) return []
      return [{
        by: net.who(str(s.by))?.name ?? 'a hero',
        kind: str(s.kind),
        at: num(s.at),
      }]
    })
  }

  return {
    /** Pip's line follows this hero's completion in the sibling task app. */
    greeting: async (
      id: string,
      line: string,
      seen?: boolean,
    ): Promise<{ words: string; done: boolean | null }> => {
      let hero = net.hero
      if (id != 'pip' || !hero) return { words: line, done: null }
      try {
        let done = await welcomed(hero)
        welcome.set(hero, done)
        return { words: greeting(id, line, done, seen), done }
      } catch (e) {
        console.warn('mossvale village tasks:', e)
        return { words: line, done: null }
      }
    },
    /** who is looking: a person signed in is heard */
    me: (who: Me) => {
      me = who
    },
    /** this frame: follow the hero's level, and add the rows of its
     * villagers the store does not hold yet */
    tick: (f: Frame) => {
      last = f
      if (engaged && f.talk?.id != engaged) engaged = null
      if (f.level != level) follow(f.level)
      if (!net.hero || !me?.writes) return
      let tool = think?.value[0]?.entity.eid
      if (!tool || !rows?.ready) return
      let stored = new Map(rows.value.map((b) => [b.entity.eid, b]))
      let missing = GIVERS.filter((g) =>
        g.level == f.level && !stored.has(eidOf(g.id)) && !asked.has(g.id)
      )
      let older = GIVERS.filter((g) =>
        g.level == f.level && stored.has(eidOf(g.id)) && !asked.has(g.id)
      ).flatMap((g) => {
        let saved = comp(stored.get(eidOf(g.id)), 'villager')
        let patch = Object.fromEntries(
          Object.entries(aboutOf(g)).filter(([key]) => !(key in saved)),
        )
        return Object.keys(patch).length ? [{ g, patch }] : []
      })
      for (let g of missing) asked.add(g.id)
      for (let { g } of older) asked.add(g.id)
      // Another page adding the same row first refuses this one.
      if (missing.length) write(missing.map((g) => born(g, tool)))
      if (older.length) {
        write(older.map(({ g, patch }) => ({
          entity: { eid: eidOf(g.id) },
          villager: patch,
        })))
      }
    },
    /** E starts a conversation; being nearby alone never does. */
    engage: (id: string) => {
      engaged = last?.talk?.id == id ? id : null
    },
    leave: () => {
      engaged = null
    },
    near: (): string | null => {
      let g = engaged && byId.get(engaged)
      return g && held(g.id) && me?.person ? g.name : null
    },
    /** Address the engaged villager, or a nearby villager whose actual name
     * was said aloud. No listener means no model call. */
    to: (words: string): Record<string, unknown> | null => {
      let f = last
      if (!f || !me?.person) return null
      let heard = listener(
        engaged && f.talk?.id == engaged ? engaged : null,
        f.givers,
        words,
      )
      let g = heard && byId.get(heard.id)
      if (!g || !held(g.id)) return null
      let has = wares(g.level), bag = new Map<string, number>()
      for (let h of f.sheet.bag) {
        if (has.has(h.kind)) bag.set(h.kind, (bag.get(h.kind) ?? 0) + h.n)
      }
      let instructions = persona(g, {
        hero: { eid: net.hero ?? '', name: f.sheet.name, lvl: f.sheet.lvl },
        people: people(),
        heard: heard!.heard,
        holds: deal.holds(g.id),
        bag,
        dealt: deal.standing(f.sheet, g.id).map((v) => ({
          give: v.give,
          take: v.take,
          taken: v.state == 'taken',
          steps: v.steps,
        })),
        board: deal.board(g.id),
        quests: f.sheet.quests.filter((q) => q.quest.giver == g.id),
        deeds: deeds(falls(f), net.now() - LATELY),
        here: f.others.map((o) => o.name),
        mood: told().moods.get(g.id),
        goings: goings(g, told().plans, net.now() - LATELY),
        welcomeDone: g.id == 'pip' && welcome.get(net.hero ?? '') == true,
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
      write([hears(id, text)])
    },
    /** what the level's villagers said, oldest first, as lines over their
     * heads */
    lines: (): Line[] => told().lines,
    /** how a villager's feeling shows, when they have decided one */
    looks: (id: string): string | null => {
      let mood = told().moods.get(id)
      return mood ? looks(mood) : null
    },
    /** a villager's name and colour, for the chat's log */
    who: (id: string) => {
      let g = byId.get(id)
      return g ? { name: g.name, tint: g.look.tint } : null
    },
    /** where a villager stands at `now`, given where their home is */
    at: (id: string, home: Spot, now: number, v: Vale): Vec => {
      let g = byId.get(id)
      return g ? where(g, v, told().plans.get(id) ?? [], now) : [
        home[0],
        0,
        home[1],
      ]
    },
  }
}
