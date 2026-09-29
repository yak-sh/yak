// Building plans are store rows seeded from seed/buildings/. Rooms and their
// furnishings are data; kit.ts raises each plan in a land's dress. Details
// such as signs and wheels are reusable operations selected by the row.
import { comp, str } from './bundle.ts'
import { DRESSES } from './buildings/dress.ts'
import { type Detail, detail } from './buildings/details.ts'
import {
  type Piece,
  type Place,
  type Plan,
  raise,
  type Raised,
  type Side,
  type Storey,
} from './buildings/kit.ts'
import * as furniture from './buildings/pieces.ts'
import type { Bundle } from './net.ts'
import type { Kind } from './props/kit.ts'

export type PlaceDesign =
  & { piece: string }
  & (
    | { at: [number, number]; face?: Side }
    | { on: Side; at: number }
  )
export type StoreyDesign = Omit<Storey, 'furnish'> & {
  furnish?: PlaceDesign[]
}
export type BuildingDesign = Omit<Plan, 'name' | 'storeys' | 'more'> & {
  kind: string
  storeys: StoreyDesign[]
  details?: Detail[]
}

let pieces: Record<string, Piece> = Object.fromEntries(
  Object.values(furniture).map((p) => [p.name, p]),
)

let planOf = (d: BuildingDesign): Plan => ({
  name: d.kind,
  size: d.size,
  ...(d.works ? { works: d.works } : {}),
  ...(d.chimney ? { chimney: d.chimney } : {}),
  storeys: d.storeys.map((s) => ({
    ...s,
    furnish: s.furnish?.map((p): Place => {
      let piece = pieces[p.piece]
      if (!piece) throw new Error(`${d.kind}: unknown piece ${p.piece}`)
      return { ...p, piece }
    }),
  })),
  ...(d.details?.length
    ? { more: (k) => d.details!.forEach((part) => detail(k, part, pieces)) }
    : {}),
})

/** Every building plan the store currently holds, by its kind. */
export let PLANS: Record<string, Plan> = {}

/** The kind of prop a plan is in a dress; any other kind as it is. */
export let dressed = (kind: string, dress = 'plaster') =>
  PLANS[kind] ? `${kind}.${dress}` : kind

// Four roof colours and grains per plan and dress.
let LOOKS = 4
let made = new Map<string, Raised>()
let raised = (plan: Plan, dress: string, seed: number): Raised => {
  let id = `${plan.name}.${dress}:${seed % LOOKS}`
  let got = made.get(id)
  if (!got) made.set(id, got = raise(plan, DRESSES[dress], seed % LOOKS))
  return got
}

/** Every plan in every dress, as a kind of prop. */
export let BUILDINGS: Record<string, Kind> = {}

/** Replace the building index when the store's design query changes. */
export let useBuildings = (rows: Bundle[]) => {
  PLANS = Object.fromEntries(rows.flatMap((row) => {
    let design = comp(row, 'building_design')
    let kind = str(design.kind)
    return kind ? [[kind, planOf(design as BuildingDesign)]] : []
  }))
  made.clear()
  BUILDINGS = Object.fromEntries(
    Object.entries(PLANS).flatMap(([name, plan]) =>
      Object.keys(DRESSES).map((dress): [string, Kind] => {
        let [w, d] = plan.size
        let build = (seed: number) => raised(plan, dress, seed)
        return [`${name}.${dress}`, {
          make: build,
          raise: build,
          shapes: LOOKS,
          span: [w, d],
          foot: Math.hypot(w, d) / 2,
          aside: true,
        }]
      })
    ),
  )
}
