// Who the platform writes as. The envelope sender must be an address the
// fleet's Email Sending domain (src/mailaddr.ts `mailDomain`, bot.yak.sh —
// DKIM signed, SPF/DMARC on cf-bounce.bot.yak.sh) is authorized to send;
// yaks.app has no Email Sending setup, so a letter from there is refused at
// the API. The reader still answers the platform: REPLY_TO is the yaks.app
// address, and the display name is the platform's. A space that white-labels
// its login will want its own pair; that is a later leaf's.
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { type Host, replyTo } from './host.ts'
export let FROM = 'hello@bot.yak.sh'

// REPLY_TO is also where the platform writes to its own people (the feedback
// tool, the usage alert): the box's @yaks/mail pulls hello@yaks.app, whose
// address is filed under the yaks.app project, so a letter there is held for
// that project's sessions and filed as a task on its board (@yaks/mail
// `mail_task`). One address, so the letter lands in one project.
export let REPLY_TO = replyTo()

/**
 * A letter to REPLY_TO as the platform store's rows: the address as an
 * entity, and the letter delivered to it, `about` the entity it concerns. The
 * store's pool sends it after the write commits, through the platform's own
 * sender (config.ts), and marks it delivered only once the sender took it, so
 * a mail outage leaves it waiting. `eid` is the letter's: one derived from
 * what it is about makes writing it again owe nothing new.
 */
export let toPlatform = (
  env: Host,
  eid: string,
  letter: { subject: string; body: string; about: string },
): Bundle[] => {
  let address = replyTo(env)
  let to = derivedEid(JSON.stringify(['platform-address', address]))
  return [{ entity: { eid: to }, email: { address } }, {
    entity: { eid },
    doc: { title: letter.subject, body: letter.body },
    mail: { from: FROM, target: letter.about },
    deliver: { to },
  }]
}
