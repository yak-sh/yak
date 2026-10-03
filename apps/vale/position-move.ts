// Stored villager schedules follow connected heroes after location migration.
import { type Bundle, token } from '@yaks/graph'
import { comp } from './bundle.ts'

/** Preserve authored schedules; replace only the former villager presence test. */
export let wakeMove = (rows: Bundle[]): Bundle[] =>
  rows.flatMap((row) => {
    let wake = comp(row, 'wake')
    if (!row.villager || !Array.isArray(wake.while)) return []
    let changed = false
    let conditions = wake.while.map((condition) => {
      let level = typeof condition.match == 'string'
        ? condition.match.match(
          /^\.seen\.level=([^&]+)&\.seen\.at>=5-minutes-ago$/,
        )?.[1]
        : undefined
      if (!level) return condition
      changed = true
      return { ...condition, match: `.player&.position.level=${level}` }
    })
    return changed
      ? [{
        entity: { eid: row.entity.eid },
        wake: { while: conditions },
        $was: { wake: { while: token(wake.while) } },
      }]
      : []
  })
