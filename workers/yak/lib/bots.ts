// Which yaks.app accounts and visitors are nobody's. An account is an address,
// and an address on the fleet's bot domain is a test account: its sign-in
// codes land in the tasks graph, so only the fleet can hold one, and nothing
// it makes is a person's work. One address there is not a throwaway:
// `admin@bot.yak.sh` is the platform's own admin person (D-35373), whom an
// agent runs a platform act as, and whose acts are the platform's.
//
// Both sides read the rule from here: `yak admin` (@yaks/admin), which keeps
// an agent on a test account unless the argv says otherwise, and the
// platform, which skips what exists only for a person when nobody is one:
// feedback is kept and never mailed, and a space nobody else is in is deleted
// without a confirmation letter (workers/yak/tools.ts).
//
// A visitor is nobody when Cloudflare verified it as a company's bot: a
// search engine's or an AI company's crawler, a link previewer, a monitor.
// Cloudflare checks the network it came from, so the list is Cloudflare's to
// keep, never a list of user agents here to rot. Nobody looks at a page one
// renders, so nothing it says broke is a person's break (apps.ts `/report`).

export let BOT = '@bot.yak.sh'
export let ADMIN = `admin${BOT}`

// An address we cannot see is not proof, so it reads as somebody's: the safe
// direction to be wrong in.
export let isTestAddress = (address: string) =>
  address.endsWith(BOT) && address != ADMIN

/** A request as the runtime hands it over, with Cloudflare's own facts on it. */
type Arrived = Request & { cf?: { verifiedBotCategory?: string } }

// Unverified reads as a person, the same safe direction: a request with no
// `cf` came from inside, and a bot Cloudflare could not verify is let through.
export let isVerifiedBot = (req: Request) =>
  !!(req as Arrived).cf?.verifiedBotCategory
