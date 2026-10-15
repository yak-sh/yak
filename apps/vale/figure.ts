// Mossvale's figure design rows and the lookup used by game rules. Drawing
// and animation of those values belong to @yaks/stage/puppet.
import type { Rig } from '@yaks/stage/puppet'
import { comp } from './bundle.ts'
import type { Bundle } from './net.ts'

/** A rig with Mossvale's creature identity, hit size and dust colour. */
export type Figure = Rig & { of: string; size: number; dust: number }

/** Every creature's figure, by the creature's eid. */
export let FIGURES: Record<string, Figure> = {}

/** Seeded looks, or the current main output and its build provenance. */
export let FIGURE_ROWS = '.figure !built | .figure .built.current=true ' +
  '.built.build.build.variant=main *'

export let FIGURE_BUILDS = '.figure .built.current=true ' +
  '.built.build.build.variant=main ' +
  '.fields=built.current,built.build.build.variant'

let installed: Bundle[] | undefined

/** Install the store's current figures. A creature drawn twice keeps the
 * last row. The same rows again keep the index. */
export let useFigures = (rows: Bundle[]) => {
  if (rows == installed) return
  installed = rows
  FIGURES = Object.fromEntries(rows.flatMap((row) => {
    let f = comp(row, 'figure') as Figure
    let built = comp(row, 'built')
    let build = rows.find((r) => r.entity.eid == built.build)
    if (
      row.built && (built.current !== true ||
        comp(build, 'build').variant != 'main')
    ) return []
    return typeof f.of == 'string' ? [[f.of, f]] : []
  }))
}

/** How big the game takes a creature to be, by its eid: its figure's size,
 * or 1 while it has no figure. */
export let sizeOf = (beast: string) => FIGURES[beast]?.size ?? 1
