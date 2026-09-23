// Who the platform writes as. The envelope sender must be an address the
// fleet's Email Sending domain (bot.yak.sh —
// DKIM signed, SPF/DMARC on cf-bounce.bot.yak.sh) is authorized to send;
// yaks.app has no Email Sending setup, so a letter from there is refused at
// the API. The reader still answers the platform: REPLY_TO is the yaks.app
// address, and the display name is the platform's. A space that white-labels
// its login will want its own pair; that is a later leaf's.
import { replyTo } from './host.ts'
export let FROM = 'hello@bot.yak.sh'
export let REPLY_TO = replyTo()

// The fleet's task graph, addressed as a reader. hello@yaks.app forwards to a
// person's mailbox and nowhere else, so a letter sent only there is invisible
// to every agent: it waits for that person to relay it by hand. This is the
// address the graph's inbound sweep (@yaks/mail inbound.ts) pulls into `mail`
// entities, which is what puts a letter in an inbox and on the comms bus. FROM is a
// bot.yak.sh address, so the arrival is DKIM-aligned and grades verified —
// the sweep delivers nothing else to the bus.
export let GRAPH = 'task@bot.yak.sh'
