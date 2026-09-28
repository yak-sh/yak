// One hero's companion follows the latest objective its owner gave through
// the app command. The request and its gathered items are store rows; this
// page supplies the walk and the ordinary work of a hero while it is open.
import { writer } from './chat.ts'
import { GATHER, LODES, nodesNear } from './gather.ts'
import type { Natural } from './nature.ts'
import { type Bundle, comp, type Net, num, str } from './net.ts'
import { fallOf } from './rules.ts'
import { fits, floorAt } from './sim.ts'
import type { Vale } from './terrain.ts'
import { walk } from './walk.ts'
import { type Work, type WorkFrame, working } from './work.ts'

export type Objective = { eid: string; player: string; count: number }
export type Tree = { eid: string; kind: string; x: number; z: number }
export type Choice = Tree & { path: [number, number, number][] }

/** Only the hero's owner can direct their companion. */
export let objectiveOf = (
  hero: Bundle | undefined,
  rows: Bundle[],
): Objective | null => {
  let owner = writer(hero)
  if (!hero?.player || !owner) return null
  let own = rows.filter((b) =>
    writer(b) == owner && str(comp(b, 'directive').player) == hero.entity.eid &&
    str(comp(b, 'directive').goal) == 'wood'
  )
  let row = own.sort((a, b) =>
    Date.parse(str(comp(b, 'created').at)) -
    Date.parse(str(comp(a, 'created').at))
  )[0]
  let count = num(comp(row, 'directive').count)
  return row && count >= 1 && count <= 10
    ? { eid: row.entity.eid, player: hero.entity.eid, count }
    : null
}

/** A gathered row is the progress record; it already credits the hero. */
export let progressOf = (rows: Bundle[], eid: string): number =>
  rows.filter((b) => str(comp(b, 'gathered').directive) == eid).length

/** Trees the page can see and nobody has spent in this life. */
export let treesOf = (
  x: number,
  z: number,
  natural: Natural[],
  gathered: Bundle[],
  now: number,
): Tree[] => {
  let by = new Map<string, { at: number }[]>()
  for (let b of gathered) {
    let g = comp(b, 'gathered'), eid = str(g.node)
    if (!by.has(eid)) by.set(eid, [])
    by.get(eid)!.push({ at: num(g.at) })
  }
  return nodesNear(x, z, 32, natural).filter((n) =>
    n.prop?.natural && LODES[n.lode]?.trade == 'wood' &&
    !fallOf(by.get(n.eid) ?? [], GATHER.wood.respawn, now).down
  ).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))
    .map((n) => ({ eid: n.eid, kind: n.lode, x: n.x, z: n.z }))
}

/** Reach a tree's side, outside its trunk but inside chopping range. */
export let routeTo = (
  v: Vale,
  from: [number, number, number],
  tree: Tree,
): Choice | null => {
  let radius = GATHER.wood.reach - 0.5
  let angle = Math.atan2(from[2] - tree.z, from[0] - tree.x)
  for (let i = 0; i < 4; i++) {
    let a = angle + i * Math.PI / 2
    let x = tree.x + radius * Math.cos(a)
    let z = tree.z + radius * Math.sin(a)
    let y = floorAt(v, x, z, from[1])
    if (!fits(v, x, z, y)) continue
    let to: [number, number, number] = [x, y, z]
    let path = walk(v, from, to)
    if (path.at(-1) == to) return { ...tree, path }
  }
  return null
}

/** Walk one frame along the same collision-aware route villagers use. */
export let advance = (
  from: [number, number, number],
  path: [number, number, number][],
  dt: number,
): { at: [number, number, number]; path: typeof path; speed: number } => {
  let left = Math.max(0, dt) * 2
  let at = from
  while (path.length && left > 0) {
    let to = path[0]
    let d = Math.hypot(to[0] - at[0], to[2] - at[2])
    if (d < 0.15) {
      at = to
      path = path.slice(1)
    } else {
      let k = Math.min(1, left / d)
      at = [
        at[0] + (to[0] - at[0]) * k,
        at[1] + (to[1] - at[1]) * k,
        at[2] + (to[2] - at[2]) * k,
      ]
      left -= d * k
      if (k == 1) path = path.slice(1)
    }
  }
  return {
    at,
    path,
    speed: dt > 0 ? Math.hypot(at[0] - from[0], at[2] - from[2]) / dt : 0,
  }
}

export type Companion = ReturnType<typeof companion>

/** The effectful boundary: read an objective, choose a tree, walk, and work. */
export let companion = (net: Net) => {
  let toil = working(net)
  let at: [number, number, number] | null = null
  let goal = ''
  let target: Choice | null = null
  let path: [number, number, number][] = []
  let tried = new Set<string>()
  let choosing = false
  let status = ''
  let nextTry = 0

  let choose = async (trees: Choice[]): Promise<Choice | null> => {
    let options = trees.slice(0, 3)
    if (!options.length) return null
    let criteria = Object.fromEntries(options.map((t, i) => [
      `tree${i + 1}`,
      `${LODES[t.kind].name}, ${Math.round(t.path.length / 4)} metres away`,
    ]))
    try {
      let r = await fetch(new URL('api/ai/run', document.baseURI), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'typesafe/jev',
          input: {
            state: [{
              role: 'user',
              content:
                'Gather wood for your companion. Choose one reachable natural tree.',
            }],
            questions: {
              tree: {
                type: 'choice',
                instructions: 'Which tree do you chop next?',
                criteria,
              },
            },
          },
        }),
      })
      if (!r.ok) throw new Error(`Jev answered ${r.status}`)
      let said = await r.json()
      let key = said.answers?.tree?.choice
      let i = Number(String(key).replace('tree', '')) - 1
      return options[i] ?? options[0]
    } catch (e) {
      console.warn('mossvale companion:', e)
      return options[0]
    }
  }

  return {
    tick: (
      v: Vale,
      f: WorkFrame,
      dt: number,
      natural: Natural[],
    ): {
      at: [number, number, number] | null
      speed: number
      status: string
      events: Work[]
      swing: number
    } => {
      let hero = net.hero ? net.client.ent(net.hero) : undefined
      let objective = objectiveOf(hero, net.mine('directive'))
      let done = objective ? progressOf(net.mine('item'), objective.eid) : 0
      if (!objective || objective.player != net.hero || f.down) {
        if (goal) toil.tick(v, f, false, true, natural)
        target = null
        goal = ''
        choosing = false
        status = ''
        return { at: null, speed: 0, status, events: [], swing: -1 }
      }
      if (!at || goal != objective.eid) {
        toil.tick(v, f, false, true, natural)
        at = [f.body.x, f.body.y, f.body.z]
        goal = objective.eid
        target = null
        path = []
        tried = new Set()
        choosing = false
        nextTry = 0
      }
      if (done >= objective.count) {
        target = null
        status = `Wood gathered ${done}/${objective.count}. Done!`
        return { at, speed: 0, status, events: [], swing: -1 }
      }
      let events: Work[] = []
      let speed = 0
      if (!target && !choosing && f.now >= nextTry) {
        let choices = treesOf(at[0], at[2], natural, net.gathered(), f.now)
          .filter((t) => !tried.has(t.eid)).slice(0, 3)
          .flatMap((t) => routeTo(v, at!, t) ?? [])
        if (!choices.length) tried.clear()
        choosing = true
        nextTry = f.now + 5000
        status = choices.length
          ? 'Choosing a tree'
          : 'Waiting for a nearby tree'
        let asked = goal
        void choose(choices).then((picked) => {
          if (asked != goal) return
          target = picked
          path = picked?.path.slice(1) ?? []
          choosing = false
        })
      }
      if (target && path.length) {
        let next = advance(at, path, dt)
        at = next.at
        path = next.path
        speed = next.speed
        status = `Walking to ${LODES[target.kind].name}`
      }
      if (target && !path.length) {
        let frame = { ...f, body: { x: at[0], y: at[1], z: at[2] } }
        let job = toil.tick(v, frame, true, false, natural, {
          target: target.eid,
          directive: objective.eid,
        })
        events = job.events
        status = `Chopping ${LODES[target.kind].name}`
        if (events.some((e) => e.type == 'got' || e.type == 'say')) {
          tried.add(target.eid)
          target = null
        }
        return {
          at,
          speed,
          status: `Wood ${done}/${objective.count} · ${status}`,
          events,
          swing: job.doing?.swing ?? -1,
        }
      }
      return {
        at,
        speed,
        status: `Wood ${done}/${objective.count} · ${status}`,
        events,
        swing: -1,
      }
    },
  }
}
