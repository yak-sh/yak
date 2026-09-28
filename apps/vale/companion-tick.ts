// One scheduled companion step over store rows. The worker supplies rows and
// the model's choice; this uses the page's path and ordinary gathering rules.
import { comp, num, str } from './bundle.ts'
import {
  advance,
  type Choice,
  objectiveOf,
  progressOf,
  routeTo,
  treesOf,
} from './companion.ts'
import { LODES } from './gather.ts'
import { HOME, LEVELS } from './levels.ts'
import { naturalNear } from './nature.ts'
import type { Bundle } from './net.ts'
import { spotOf } from './regions.ts'
import { groundAt, hearthOf, type Vale } from './terrain.ts'
import { type WorkFrame, working } from './work.ts'

export type Snapshot = {
  hero?: Bundle
  directive: Bundle
  directives: Bundle[]
  items: Bundle[]
  upgraded: Bundle[]
  gathered: Bundle[]
}

export type PickTree = (choices: Choice[]) => Promise<Choice>

let halt = (eid: string): Bundle => ({
  entity: { eid },
  wake: null,
  call: null,
})

let start = (v: Vale, hero: Bundle | undefined): [number, number, number] => {
  let seen = comp(hero, 'seen')
  let fire = hearthOf(HOME) ?? spotOf(HOME, LEVELS[HOME].arrive) ?? [128, 128]
  let home: [number, number] = [fire[0], fire[1] + 4]
  let x = num(seen.x, home[0]), z = num(seen.z, home[1])
  return [x, groundAt(v, x, z), z]
}

let position = (
  v: Vale,
  state: Record<string, unknown>,
  hero?: Bundle,
): [number, number, number] =>
  typeof state.x == 'number' && typeof state.y == 'number' &&
    typeof state.z == 'number'
    ? [state.x, state.y, state.z]
    : start(v, hero)

let report = (
  eid: string,
  at: [number, number, number],
  now: number,
  call: string,
  phase: string,
  target: string,
  since: number,
  status: string,
  speed = 0,
): Bundle => ({
  entity: { eid },
  companion: {
    x: at[0],
    y: at[1],
    z: at[2],
    at: now,
    call,
    phase,
    target,
    since,
    status,
    speed,
  },
})

/** One occurrence, idempotent by its scheduled call's eid. The item and
 * position are returned in one batch so a retry observes both or neither. */
export let companionTick = async (
  v: Vale,
  s: Snapshot,
  call: string,
  now: number,
  choose: PickTree,
): Promise<Bundle[]> => {
  let eid = s.directive.entity.eid
  let objective = objectiveOf(s.hero, s.directives)
  if (!objective || objective.eid != eid) return [halt(eid)]
  let state = comp(s.directive, 'companion')
  if (str(state.call) == call || now < num(state.at)) return []
  let at = position(v, state, s.hero)
  let done = progressOf(s.items, eid)
  if (done >= objective.count) {
    return [{
      ...report(eid, at, now, call, 'done', '', now, 'Done'),
      wake: null,
      call: null,
    }]
  }
  let natural = naturalNear(v, at[0], at[2], 32)
  let trees = treesOf(at[0], at[2], natural, s.gathered, now)
  let target = trees.find((t) => t.eid == str(state.target))
  let phase = str(state.phase)
  if (!target || phase == 'choose' || phase == 'wait') {
    let choices: Choice[] = []
    for (let tree of trees) {
      let path = routeTo(v, at, tree)
      if (path) choices.push(path)
      if (choices.length == 3) break
    }
    if (!choices.length) {
      return [report(eid, at, now, call, 'wait', '', now, 'Waiting for a tree')]
    }
    let picked = await choose(choices)
    return [report(
      eid,
      at,
      now,
      call,
      'walk',
      picked.eid,
      now,
      `Walking to ${LODES[picked.kind].name}`,
    )]
  }
  if (phase != 'chop') {
    let route = routeTo(v, at, target)
    if (!route) {
      return [report(eid, at, now, call, 'choose', '', now, 'Finding a tree')]
    }
    let moved = advance(
      at,
      route.path.slice(1),
      Math.min(10, Math.max(0, (now - num(state.at, now)) / 1000)),
    )
    at = moved.at
    return [report(
      eid,
      at,
      now,
      call,
      moved.path.length ? 'walk' : 'chop',
      target.eid,
      moved.path.length ? num(state.since, now) : now,
      moved.path.length
        ? `Walking to ${LODES[target.kind].name}`
        : `Chopping ${LODES[target.kind].name}`,
      moved.speed,
    )]
  }
  let written: Bundle[] = []
  let toil = working({
    hero: objective.player,
    mine: (name: string) => name == 'item' ? s.items : s.upgraded,
    gathered: () => s.gathered,
    keep: (...rows: Bundle[]) => written.push(...rows),
  })
  let frame = (time: number): WorkFrame => ({
    body: { x: at[0], y: at[1], z: at[2] },
    sheet: { bag: [], worn: {} },
    down: false,
    now: time,
  })
  let as = { target: target.eid, directive: eid }
  let since = num(state.since, now)
  toil.tick(v, frame(since), true, false, natural, as)
  let job = toil.tick(v, frame(now), false, false, natural, as)
  if (written.length) {
    let finished = done + written.length >= objective.count
    return [
      ...written,
      {
        ...report(
          eid,
          at,
          now,
          call,
          finished ? 'done' : 'choose',
          '',
          now,
          finished ? 'Done' : 'Choosing a tree',
        ),
        ...finished ? { wake: null, call: null } : {},
      },
    ]
  }
  let waiting = job.doing?.trade == 'wood'
  return [report(
    eid,
    at,
    now,
    call,
    waiting ? 'chop' : 'choose',
    waiting ? target.eid : '',
    since,
    waiting ? `Chopping ${LODES[target.kind].name}` : 'Choosing a tree',
  )]
}
