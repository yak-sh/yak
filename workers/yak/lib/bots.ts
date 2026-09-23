// Which yaks.app accounts are nobody's. An account is an address, and an
// address on the fleet's bot domain is a test account: its sign-in codes land
// in the tasks graph, so only the fleet can hold one, and nothing it makes is
// a person's work. One address there is not a throwaway: `admin@bot.yak.sh`
// is the platform's own admin person (D-35373), whom an agent runs a platform
// act as, and whose acts are the platform's.
//
// Both sides read the rule from here: `yak admin` (@yaks/admin), which keeps
// an agent on a test account unless the argv says otherwise, and the
// platform, which skips what exists only for a person when nobody is one:
// feedback is kept and never mailed, and a space nobody else is in is deleted
// without a confirmation letter (workers/yak/tools.ts).

export let BOT = '@bot.yak.sh'
export let ADMIN = `admin${BOT}`

// An address we cannot see is not proof, so it reads as somebody's: the safe
// direction to be wrong in.
export let isTestAddress = (address: string) =>
  address.endsWith(BOT) && address != ADMIN
