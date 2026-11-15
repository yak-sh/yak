// Which yaks.app accounts and visitors are nobody's. An account is an address,
// and an address on the fleet's bot domain is a test account: its sign-in
// codes land in the tasks graph, so only the fleet can hold one, and nothing
// it makes is a person's work. Two addresses there are not throwaways:
// `admin@bot.yak.sh` is the platform's own admin person (D-35373), whom an
// agent runs a platform act as, and whose acts are the platform's, and
// `yourname@bot.yak.sh` holds the demo space (M-37804). An address on `.invalid`
// (RFC 2606) can never read a letter, so nobody can hold it either.
//
// Both sides read the rule from here: `yak admin` (@yaks/admin), which keeps
// an agent on a test account unless the argv says otherwise, and the
// platform, which skips what exists only for a person when nobody is one:
// feedback is kept and never mailed, and a space nobody else is in is deleted
// without a confirmation letter (workers/yak tools.ts).
//
// A visitor Cloudflare verified as a company's bot is nobody's too, and every
// page's report door drops what one says broke (@yaks/tracker/report `door`).

export let BOT = '@bot.yak.sh'
export let ADMIN = `admin${BOT}`
export let DEMO = `yourname${BOT}`

// An address we cannot see is not proof, so it reads as somebody's: the safe
// direction to be wrong in.
export let isTestAddress = (address: string): boolean =>
  (address.endsWith(BOT) && address != ADMIN && address != DEMO) ||
  address.endsWith('.invalid')

// A visit is nobody's when its link names the fleet's own checks as its
// source (`utm_source=agent-check`): an agent checking a live page, through a
// browser or a script that says it is one, tags its visit so, and the funnel
// counts what it does apart from a person's (workers/yak funnel.ts).
export let CHECK = 'agent-check'
