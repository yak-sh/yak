// Every space on the Pro plan, paid or comped, from before a space that takes
// it was given @yaks/platform/plans `PRO_GRANT` is given it now, on top of what
// is left of its starter, once (directory.ts `granting`). Only the directory
// holds spaces.
import { line } from '@yaks/query'
import type { Bundle } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { meteredOf, type MeteredRow, topUp } from '@yaks/platform/meter'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { PRO_GRANT } from '@yaks/platform/plans'
import type { Rule } from './mover.ts'

export let proGrantMove = (row: Bundle, now: Date = new Date()): Bundle[] => {
  let space = meteredOf(row as MeteredRow)
  if (space.tier != 'pro') return []
  return [{
    entity: { eid: row.entity.eid },
    starter: { dollars: topUp(space, PRO_GRANT, now) },
    pro_grant: { at: now.toISOString() },
    $was: {
      starter: {
        dollars: space.starter == null ? null : token(space.starter),
      },
      pro_grant: { at: null },
    },
  }]
}

export let proGrantRule: Rule = {
  mark: 'yak/store/pro-grant/1',
  stores: [PLATFORM_STORE],
  core: ['plan', 'comp', 'starter', 'pro_grant'],
  live: 'all',
  find: line`.space&!pro_grant.at&*`,
  move: (row) => proGrantMove(row),
}
