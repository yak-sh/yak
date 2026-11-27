import { blow, type BlowRules, hpOf } from '@yaks/game'
import type { Bundle } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import type { Action, Foe, Hit, Pawn, Seat, Turn } from './room-model.ts'

export class ActionRefused extends Error {}

/** How many tiles a pawn may walk in one turn. */
export let REACH = 3
/** How far the field runs from its middle, in tiles. */
export let EDGE = 11
/** A player's health and the might behind a strike. */
export let HERO = { most: 10, might: 4 }
/** Each foe: its health, might, the d6 a player needs to hit it, the d6 it
 * needs to hit back, and how many tiles it walks each round. */
export let FOES: Record<
  string,
  {
    name: string
    most: number
    might: number
    guard: number
    aim: number
    speed: number
  }
> = {
  wolf: { name: 'Wolf', most: 6, might: 3, guard: 3, aim: 3, speed: 2 },
  troll: { name: 'Bog troll', most: 12, might: 5, guard: 4, aim: 4, speed: 1 },
}
let tuning: BlowRules = {
  sure: false,
  luck: 0,
  greatAt: 0.9,
  greatScale: 1.5,
  spread: 0.25,
}
let camp: [kind: string, x: number, z: number][] = [
  ['wolf', -4, -5],
  ['wolf', 4, -5],
  ['troll', 0, -8],
]

type Spot = { eid: string; x: number; z: number }
export type Hero = Spot & Pawn & { hp: number; most: number }
export type Enemy = Spot & Foe & { hp: number; most: number; name: string }
/** The room as play reads it: the turn, every player's and foe's standing
 * health from the ledger, and the ledger itself, oldest first. */
export type Battle = {
  turn?: Turn
  party: Hero[]
  foes: Enemy[]
  hits: Hit[]
}

let health = (eid: string, most: number, life: number, hits: Hit[]) =>
  hpOf(eid, most, life, hits.map((h) => ({ ...h, foe: h.target })))

export let battle = (rows: Bundle[], room: string): Battle => {
  let hits = rows.flatMap((r) => r.play_hit ? [r.play_hit as Hit] : [])
    .sort((a, b) => a.number - b.number)
  return {
    turn: rows.find((r) => r.entity.eid === room)?.play_turn as Turn,
    hits,
    party: rows.flatMap((r) => {
      let pawn = r.play_pawn as Pawn | undefined
      if (!pawn) return []
      let { eid } = r.entity
      let hp = health(eid, HERO.most, pawn.life ?? 0, hits)
      return [{ ...pawn, eid, hp, most: HERO.most }]
    }),
    foes: rows.flatMap((r) => {
      let foe = r.play_foe as Foe | undefined
      let design = foe && FOES[foe.kind]
      if (!design) return []
      let { eid } = r.entity
      let hp = health(eid, design.most, 0, hits)
      return [{ ...foe!, eid, hp, most: design.most, name: design.name }]
    }),
  }
}

let apart = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.abs(a.x - b.x) + Math.abs(a.z - b.z)

/** A d6 and its odds, for a roll the player is about to make. */
export let odds = (need: number): string =>
  `${need}+ on a d6 (${Math.round((7 - need) / 6 * 100)}%)`

export let spawn = (room: string, seat: string, order: number): Bundle => ({
  entity: { eid: seat },
  play_pawn: {
    room,
    name: `Player ${order + 1}`,
    x: order * 2 - 3,
    z: 3,
    life: 0,
  },
})

export let foes = (room: string): Bundle[] =>
  camp.map(([kind, x, z], i) => ({
    entity: { eid: identityEid('starter-foe', [room, String(i)]) },
    play_foe: { room, kind, x, z },
  }))

// The app owns movement, dice, turn order and the rows committed together.
// A move spends steps and keeps the turn; a strike, revive or pass ends it.
// When the last standing player's turn ends, every foe walks and strikes.
export let act = (
  { room, seat }: Seat,
  seats: string[],
  rows: Bundle[],
  action: Action,
  random: () => number,
): Bundle[] => {
  let { turn, party, foes, hits } = battle(rows, room)
  if (!turn) throw new ActionRefused('This room has no game.')
  if (turn.seat !== seat) throw new ActionRefused('Wait for your turn.')
  if (action.number !== turn.number) {
    throw new ActionRefused('The turn changed. Try again.')
  }
  let me = party.find((p) => p.eid === seat)
  if (!me || me.hp <= 0) throw new ActionRefused('The party has fallen.')
  let bundles: Bundle[] = []
  let d6 = () => 1 + Math.floor(random() * 6)
  let ledger = hits.length
  let strike = (
    by: string,
    target: Hero | Enemy,
    life: number,
    need: number,
    might: number,
  ) => {
    let roll = d6()
    let dmg = roll >= need
      ? Math.min(target.hp, blow(might, random(), tuning).dmg)
      : 0
    target.hp -= dmg
    let number = ledger++
    let hit: Hit = {
      room,
      target: target.eid,
      by,
      life,
      dmg,
      roll,
      need,
      number,
    }
    bundles.push({
      entity: { eid: identityEid('starter-hit', [room, String(number)]) },
      play_hit: hit,
    })
  }
  let living = () => [
    ...party,
    ...foes.filter((f) => f.hp > 0),
  ]
  let taken = (x: number, z: number) =>
    living().some((s) => s.x === x && s.z === z)
  let next = { ...turn, number: turn.number + 1 }
  switch (action.kind) {
    case 'move': {
      let { x, z } = action
      let steps = apart(action, me)
      if (!Number.isInteger(x) || !Number.isInteger(z) || steps < 1) {
        throw new ActionRefused('Choose a tile to move to.')
      }
      if (steps > turn.steps) {
        throw new ActionRefused(
          turn.steps
            ? `Move up to ${turn.steps} more tiles.`
            : 'You have moved this turn.',
        )
      }
      if (Math.abs(x) > EDGE || Math.abs(z) > EDGE) {
        throw new ActionRefused('That tile is outside the field.')
      }
      if (taken(x, z)) throw new ActionRefused('Someone is standing there.')
      bundles.push({ entity: { eid: seat }, play_pawn: { x, z } })
      next.steps = turn.steps - steps
      break
    }
    case 'strike': {
      let foe = foes.find((f) => f.eid === action.foe && f.hp > 0)
      if (!foe) throw new ActionRefused('Choose a foe to strike.')
      if (apart(foe, me) > 1) throw new ActionRefused('Step next to it first.')
      strike(seat, foe, 0, FOES[foe.kind].guard, HERO.might)
      break
    }
    case 'revive': {
      let ally = party.find((p) => p.eid === action.seat)
      if (!ally || ally.hp > 0) {
        throw new ActionRefused('Choose a fallen ally.')
      }
      if (apart(ally, me) > 1) {
        throw new ActionRefused('Step next to them first.')
      }
      bundles.push({
        entity: { eid: ally.eid },
        play_pawn: { life: ally.life + 1 },
      })
      ally.life += 1
      ally.hp = HERO.most
      break
    }
    case 'pass':
      break
    default:
      throw new ActionRefused('Choose a move, strike, revive or pass.')
  }
  if (action.kind !== 'move') {
    let standing = (from: number) =>
      seats.slice(from).find((s) => party.some((p) => p.eid === s && p.hp > 0))
    let after = standing(seats.indexOf(seat) + 1)
    if (!after) {
      for (let foe of foes.filter((f) => f.hp > 0)) {
        let design = FOES[foe.kind]
        let prey = party.filter((p) => p.hp > 0)
          .sort((a, b) =>
            apart(a, foe) - apart(b, foe) || (a.eid < b.eid ? -1 : 1)
          )[0]
        if (!prey) break
        let from = { x: foe.x, z: foe.z }
        for (let i = 0; i < design.speed && apart(foe, prey) > 1; i++) {
          let [best] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
            .map(([dx, dz]) => ({ x: foe.x + dx, z: foe.z + dz }))
            .filter((t) =>
              !taken(t.x, t.z) && apart(t, prey) < apart(foe, prey)
            )
          if (!best) break
          foe.x = best.x
          foe.z = best.z
        }
        if (foe.x !== from.x || foe.z !== from.z) {
          bundles.push({
            entity: { eid: foe.eid },
            play_foe: { x: foe.x, z: foe.z },
          })
        }
        if (apart(foe, prey) === 1) {
          strike(foe.eid, prey, prey.life, design.aim, design.might)
        }
      }
    }
    next.seat = after ?? standing(0) ?? seat
    next.steps = REACH
  }
  bundles.push({
    entity: { eid: room },
    play_turn: next,
    $was: {
      play_turn: { number: token(turn.number) },
      play_room: { seats: token(seats) },
    },
  })
  return bundles
}
