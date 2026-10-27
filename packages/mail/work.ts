// A letter that reaches a project is work for it, the way a bug the tracker
// opens is (@yaks/heal files a task for each). Hearing it is not enough: a
// session of the project hears an arrival once on its bus (@yaks/session) and
// marks it `notified`, and a session that heard it and went on with other work
// left nothing behind that says a person is still waiting. So the arrival
// files a task in the project, which stays open on its board until an answer
// goes out or an agent closes it.
//
//   mail_task      an arrival to a project, or to an address filed under one
//                  (hello@yaks.app under yaks.app), files `task{}` +
//                  `doc{title, body}` + `filed{project, priority}`, linked to
//                  the letter by an `about` edge
//   mail_answered  a letter this graph delivered about it (./answers.ts
//                  `answering`: its reply, or one sent about it) completes
//                  the task the letter filed
//
// Both are declared under the `local` option: a graph whose addresses are
// entities that read it (an agent, a project) is one where a letter is work
// for whoever works here; where a person reads the mail in a mail client, the
// mailbox is the destination and files nothing.
//
// The task's eid derives from the letter, so a run interrupted and run again
// finds the task it wrote, and the reply finds the task to complete without a
// search. Every word is the vocabulary's to declare: a graph without tasks,
// projects or edges files nothing, or files without the link.

import type { Bundle, Comp, Eid, ReadTx } from '@yaks/graph'
import type { Handlers } from '@yaks/effects'
import type { Vocab } from '@yaks/vocab'
import { identityEid } from '@yaks/graph/identity'
import { link } from '@yaks/edge'
import { DELIVER, DELIVERED, EMAIL, MAIL } from './comp.ts'
import { answering } from './answers.ts'

/** The task a letter filed: derived from the letter, so it is found again. */
export let taskEid = (letter: Eid): Eid => identityEid('mail_task', [letter])

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (v: unknown): string => typeof v == 'string' ? v : ''
let one = async (tx: ReadTx, eid: string): Promise<Bundle | undefined> =>
  eid ? (await tx.get([eid]))[0] : undefined

/** The project a letter reached: its target when that is a project, or the
 * project the target's address is filed under. */
let projectOf = async (tx: ReadTx, target: string): Promise<string> => {
  let to = await one(tx, target)
  if (!to) return ''
  if (to.project) return target
  return to[EMAIL] ? str(comp(to, 'filed').project) : ''
}

/** The task a letter files, for an agent to answer it. */
let filing = (letter: Bundle, project: Eid): Bundle[] => {
  let eid = letter.entity.eid
  let mail = comp(letter, MAIL)
  let from = str(mail.reply_address) || str(mail.from)
  let subject = str(comp(letter, 'doc').title).split('\n')[0] || '(no subject)'
  return [{
    entity: { eid: taskEid(eid) },
    task: {},
    doc: {
      title: `Letter from ${from || 'someone'}: ${
        subject.length > 160 ? `${subject.slice(0, 160)}…` : subject
      }`,
      body: `A letter${from ? ` from ${from}` : ''} reached this project. ` +
        `Read it with \`yak mail show ${eid}\`. A reply (\`yak mail ` +
        'reply`) or a letter sent `--about` it completes this task; cancel ' +
        'it when the letter needs no answer.',
    },
    filed: { project, priority: 1 },
  }]
}

/** `mail_task` and `mail_answered`, for a graph whose vocabulary has tasks
 * filed under projects; under any other, neither does anything. */
export let work = (vocab?: Vocab): Handlers => ({
  mail_task: async (event, tx, write) => {
    if (!vocab?.comp('task') || !vocab.prop('filed', 'project')) return
    let letter = await one(tx, event.entity.eid)
    if (!letter?.[MAIL] || letter[DELIVER]) return
    let project = await projectOf(tx, str(comp(letter, MAIL).target))
    if (!project || await one(tx, taskEid(letter.entity.eid))) return
    let linked = vocab.comp('edge') && vocab.comp('about')
    await write([
      ...filing(letter, project),
      ...linked
        ? [link(taskEid(letter.entity.eid), 'about', event.entity.eid)]
        : [],
    ])
  },
  mail_answered: async (event, tx, write) => {
    let reply = await one(tx, event.entity.eid)
    if (!reply?.[DELIVER] || !reply[DELIVERED]) return
    let tasks = await Promise.all(
      answering(reply).map((letter) => one(tx, taskEid(letter))),
    )
    let open = tasks.filter((t) => t?.task && !t.completed && !t.cancelled)
    if (open.length) {
      await write(open.map((t) => ({ entity: t!.entity, completed: {} })))
    }
  },
})
