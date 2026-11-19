// Every space that held the starter before it became $20 keeps the $100 it
// held (@yaks/platform/plans `STARTER`): a space with no starter of its own
// read the plan's, so one born before the change is given the old figure as
// its own. Only the directory holds spaces.
import { line } from '@yaks/query'
import type { Bundle } from '@yaks/graph'
import { PLATFORM_STORE } from '@yaks/platform/names'
import type { Rule } from './mover.ts'

// When the starter became $20, and what it was before.
let BEFORE = '2026-11-19T20:00:00.000Z'
let HELD = 100

export let starterMove = (row: Bundle): Bundle[] => [{
  entity: { eid: row.entity.eid },
  starter: { dollars: HELD },
  $was: { starter: { dollars: null } },
}]

export let starterRule: Rule = {
  mark: 'yak/store/starter-kept/1',
  stores: [PLATFORM_STORE],
  core: ['starter'],
  live: 'all',
  find: line`.space&!starter.dollars&.created.at<${BEFORE}&*`,
  move: starterMove,
}
