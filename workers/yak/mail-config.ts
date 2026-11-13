// Who the platform writes as. The envelope sender must be an address the
// fleet's Email Sending domain (src/mailaddr.ts `mailDomain`, bot.yak.sh —
// DKIM signed, SPF/DMARC on cf-bounce.bot.yak.sh) is authorized to send;
// yaks.app has no Email Sending setup, so a letter from there is refused at
// the API. The reader still answers the platform: REPLY_TO is the yaks.app
// address, and the display name is the platform's. A space that white-labels
// its login will want its own pair; that is a later leaf's.
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { replyTo } from '@yaks/platform/host'
export let FROM = 'hello@bot.yak.sh'

// REPLY_TO is the public address: what people write to the platform, and
// what a person said that the platform relays to it (the feedback tool). The
// box's @yaks/mail pulls it into the yaks.app project, and its owner gets a
// copy of every letter (holdco services/inbox-worker `OWNER_COPY_DOMAINS`).
export let REPLY_TO = replyTo()

// INTERNAL is where the platform writes for its agents, with no person
// writing (the refusal report, the usage alert, the gallery's code review):
// the yaks.app project's own address, which only the box pulls (yak.sh's
// Email Routing catch-all hands it to holdco-inbox, which keeps no owner
// copy), so the letter is filed as a task on that project's board (@yaks/mail
// `mail_task`). Internal mail never goes to REPLY_TO.
export let INTERNAL = 'hello@bot.yak.sh'

/**
 * A letter to `address` (REPLY_TO or INTERNAL) as the platform store's rows:
 * the address as an entity, and the letter delivered to it, `about` the entity
 * it concerns where it is not that entity itself (a refusal report is its own
 * letter). The store's pool sends it after the write commits, through the
 * platform's own sender (config.ts), and marks it delivered only once the
 * sender took it, so a mail outage leaves it waiting. `eid` is the letter's:
 * one derived from what it is about makes writing it again owe nothing new.
 */
export let toPlatform = (
  address: string,
  eid: string,
  letter: { subject: string; body: string; about?: string },
): Bundle[] => {
  let to = derivedEid(JSON.stringify(['platform-address', address]))
  return [{ entity: { eid: to }, email: { address } }, {
    entity: { eid },
    doc: { title: letter.subject, body: letter.body },
    mail: { from: FROM, ...letter.about ? { target: letter.about } : {} },
    deliver: { to },
  }]
}
