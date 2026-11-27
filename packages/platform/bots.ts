// Which yaks.app accounts and visitors are nobody's. An account is an address
// or a number. An address on the fleet's bot domain is a test account: its
// sign-in codes land in the tasks graph, so only the fleet can hold one, and
// nothing it makes is a person's work. So is a number of the fleet's own
// (`NUMBERS`). Two addresses there are not throwaways:
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
  isFleetAddress(address) && address != ADMIN && address != DEMO

// The numbers the fleet texts and calls from, as the bot domain is the
// addresses it signs in with: the platform's own senders (workers/yak
// wrangler.toml `PHONE_SENDER`, and the toll-free number beside it on its
// Telnyx profile), TaskMaster's line (@yaks/voipms on the box),
// the checks space's line and its bot's phone, and the number bought for
// T-2541's live check. Whoever texts from one is one of our tools, so a
// person the platform makes for it is a test account. A number our tools
// come to text from is added here.
export let NUMBERS: ReadonlySet<string> = new Set([
  '+18663141594',
  '+18557292688',
  '+12692347774',
  '+12692383446',
  '+12694929622',
  '+12692342784',
])

export let isTestNumber = (number: string): boolean => NUMBERS.has(number)

// Whether an address is no person's: any the fleet holds, the admin's and the
// demo's too, or one on `.invalid`. What either does is the fleet's, so a
// count of people (workers/yak funnel.ts) leaves it out, though neither is a
// throwaway.
export let isFleetAddress = (address: string): boolean =>
  address.endsWith(BOT) || address.endsWith('.invalid')

// A visit is nobody's when its link names the fleet's own checks as its
// source (`utm_source=agent-check`): an agent checking a live page, through a
// browser or a script that says it is one, tags its visit so, and the funnel
// counts what it does apart from a person's (workers/yak funnel.ts).
export let CHECK = 'agent-check'
