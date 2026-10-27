// Who the platform writes as. The envelope sender must be an address the
// fleet's Email Sending domain (src/mailaddr.ts `mailDomain`, bot.yak.sh —
// DKIM signed, SPF/DMARC on cf-bounce.bot.yak.sh) is authorized to send;
// yaks.app has no Email Sending setup, so a letter from there is refused at
// the API. The reader still answers the platform: REPLY_TO is the yaks.app
// address, and the display name is the platform's. A space that white-labels
// its login will want its own pair; that is a later leaf's.
import { replyTo } from './host.ts'
export let FROM = 'hello@bot.yak.sh'

// REPLY_TO is also where the platform writes to its own people (the feedback
// tool, the usage alert): the box's @yaks/mail pulls hello@yaks.app, whose
// address is filed under the yaks.app project, so a letter there is held for
// that project's sessions and filed as a task on its board (@yaks/mail
// `mail_task`). One address, so the letter lands in one project.
export let REPLY_TO = replyTo()
