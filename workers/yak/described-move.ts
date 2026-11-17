// An app's store first deployed before 51105bf6c (T-121442) described the
// platform's vocabulary in rows: some 450 `_comp`, `_prop`, `_before`, …
// entities with their `doc`, and the `_vocab` hash they were written from.
// Every read since derives them (@yaks/code `describing`), which reads past the
// stored copy, so nothing sees them, and a query scanning `doc` walks them
// all (T-143252). They go. A `_package` a `_lens` names is the store's own
// (@yaks/lens) and stays. The platform's own stores describe theirs in rows,
// so only an app's store owes this.
import { joined, line, sub } from '@yaks/query'
import type { Bundle } from '@yaks/graph'
import { DESCRIBED as ROWS } from '@yaks/platform/listing'
import type { Rule } from './mover.ts'

export let describedRule: Rule = {
  mark: 'yak/store/described/1',
  stores: 'apps',
  live: 'apps',
  core: ROWS,
  find: line`${
    sub(joined(
      ROWS.map((c) =>
        c == '_package' ? line`._package&!_lens_package` : line`.${c}`
      ),
      '|',
    ))
  }&*`,
  move: (row: Bundle) => [{ entity: { eid: row.entity.eid }, $delete: true }],
}
