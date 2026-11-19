// A plan window's usage against its pace, as @yaks/model `pace` judges it, for
// a script that reads the plan's meters itself (claude-budget), so it and the
// spawn's account pick (`freest`) cannot disagree:
//
//   bin/pace.ts <window minutes> <percent used> <resets, epoch seconds> [points a reset gives back]
//
// prints the share of the window gone, the points held against it and the
// points under pace (below zero, over), one line, space-separated.

import { pace } from '@yaks/model/route'

let [window, used, resets, back] = Deno.args.map(Number)
let p = pace(
  {
    window,
    used,
    resets: resets ? new Date(resets * 1000).toISOString() : undefined,
  },
  Date.now(),
  back || 0,
)
console.log(p.gone, p.spent, p.under)
