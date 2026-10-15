/** Holdfast's graph values. Designs are rows too; rules never use a module catalog. */
export type Point = [number, number, number]
export type MapDesign = {
  name: string
  path: Point[]
  slots: [number, number][]
  gold: number
  lives: number
}
export type EnemyDesign = {
  name: string
  hp: number
  speed: number
  armour: number
  bounty: number
  figure: Record<string, unknown>
}
export type TowerDesign = {
  name: string
  cost: number
  range: number
  rate: number
  damage: number
  splash: number
  slow: number
  speed: number
  pierce?: number
  upgrade?: string | null
  figure: Record<string, unknown>
}
export type WaveDesign = {
  map: string
  n: number
  groups: { enemy: string; count: number; gap: number }[]
}
export type Run = { map: string; seed: number }
export type Tower = {
  run: string
  design: string
  slot: number
  policy?: 'first' | 'strongest' | 'nearest'
}
export type Conductor = {
  run: string
  wave: number
  started: number
  spawned: number
  leaked: number
  bounty: number
  at: number
}
export type Creep = {
  run: string
  design: string
  wave: number
  along: number
  hp: number
  at: number
  slow_until: number
  slow?: number
}
export type Shot = {
  run: string
  tower: string
  creep: string
  lands: number
  damage: number
  splash: number
  slow: number
  pierce?: number
}
export type Row = {
  entity: { eid: string }
  $delete?: boolean
  map_design?: MapDesign
  enemy_design?: EnemyDesign
  tower_design?: TowerDesign
  wave_design?: WaveDesign
  run?: Run
  tower?: Tower
  spent?: { run: string; gold: number; tower: string }
  cleared?: { run: string; wave: number; leaked: number; bounty: number }
  conductor?: Conductor | null
  creep?: Creep | null
  shot?: Shot | null
  firing?: { run: string; at: number }
  player?: { run: string; slot: number | null; at: number }
  command?: {
    run: string
    player: string
    action: string
    slot?: number
    design?: string
    at: number
  } | null
  completed?: Record<string, unknown>
  [component: string]: unknown
}
