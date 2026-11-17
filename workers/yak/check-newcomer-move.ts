// The newcomers an agent's check opened before the box said what kind of
// client opened one (directory.ts `testIs`): the two T-154822's check of the
// /churches box made on 2026-11-10, each of which trashed its own space
// within minutes. Marking them `test` takes them out of admin's people and
// visitor builds. Only these rows move, and only while they still say
// nothing of their client.
import { line } from '@yaks/query'
import type { Bundle, Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { PLATFORM_STORE } from '@yaks/platform/names'
import type { Rule } from './mover.ts'

export let CHECKS = [
  'b7871c96-991f-4dae-bfdb-2725b47b1d14',
  'f4bfc1fb-246b-45c2-8286-7ef2b23c5107',
]

export let checkNewcomerMove = (row: Bundle): Bundle[] => {
  let had = row.newcomer as Comp | undefined
  return CHECKS.includes(row.entity.eid) && had && had.client == null
    ? [{
      entity: { eid: row.entity.eid },
      newcomer: { client: 'test' },
      $was: { newcomer: { client: token(null) } },
    }]
    : []
}

export let checkNewcomerRule: Rule = {
  mark: 'yak/store/check-newcomer/1',
  stores: [PLATFORM_STORE],
  core: ['newcomer'],
  live: 'all',
  find: line`.entity.eid=${CHECKS}&.newcomer`,
  move: checkNewcomerMove,
}
