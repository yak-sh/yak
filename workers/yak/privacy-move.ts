// Every entity of an app store written before its privacy was kept, or
// reckoned under declarations a deploy has since changed, given the privacy
// it makes (@yaks/member privacy.ts), by the store mover. An entity written
// since is the rule's. Until none is left, the store is read by the
// declarations themselves, never by a privacy it lacks: the store finds that
// out for itself (@yaks/member personal.ts `stored`), so nothing here says the
// pass is done. Each set of declarations is a rule of its own, named by their
// hash, so a deploy that changes them owes the pass again.
import type { Bundle } from '@yaks/graph'
import { declarationsOf, type Personal, privacy } from '@yaks/member'
import { given, used } from '@yaks/host/config'
import type { Vocab } from '@yaks/vocab'
import type { Mark } from '@yaks/platform/mover'
import { appConfig } from './config.ts'
import type { Rule } from './mover.ts'

// What an app store's @yaks/member is configured with (config.ts).
let member = appConfig.plugins!.find((p) => used(p) == '@yaks/member')!
let options = given(member) as { personal?: Personal; through?: Personal }

/** The mark every privacy pass is named under, before its hash. */
export let PRIVACY_MARK = 'yak/store/privacy/1'

/** The passes for this vocabulary's declarations, one for each line its
 * stale entities are found by, so each batch is read from an index. They run
 * in every app store: copies of the production stores proved that each
 * reader sees by the privacy the pass writes what the declarations showed
 * them (T-156154). */
export let privacyRules = (vocab: Vocab): Rule[] => {
  let p = privacy(
    declarationsOf(vocab, options.personal, options.through),
  )
  // Read synchronously, as the mover does.
  let sync = (v: Bundle[] | Promise<Bundle[]>) => {
    if (v instanceof Promise) throw new Error('a store moves synchronously')
    return v
  }
  return p.stale.map((line, i) => ({
    mark: `${PRIVACY_MARK}/${p.hash}/${i}` as Mark,
    stores: 'apps',
    live: 'apps',
    find: `${line}&*`,
    move: (row, read) => {
      if (!read) throw new Error('privacy reckoning reads its sources')
      return sync(p.reckon(
        (eids) =>
          eids.flatMap((eid) =>
            eid == row.entity.eid ? [row] : read(`.entity.eid=${eid}&*`)
          ),
        [row.entity.eid],
      ))
    },
  }))
}
