// Domain verbs are offered only when this host speaks their writes. A generic
// graph page still has open/set/delete; a task or session host gets its own verbs.
import type { Vocab } from '@yaks/vocab'
import { type Command, commands } from './commands.ts'

let needs: Record<string, string[]> = {
  new: ['task', 'doc'],
  fix: ['task', 'doc', 'session', 'entry', 'content', 'using', 'claim'],
  chat: ['session', 'entry', 'content', 'using'],
  comment: ['comment', 'doc'],
  done: ['task', 'completed', 'cancelled'],
  wip: ['task', 'claim'],
  cancel: ['task', 'completed', 'cancelled', 'comment', 'doc'],
  meta: ['entry', 'session', 'comment', 'doc', 'meta'],
  dream: ['dream', 'doc'],
  knock: ['knock', 'deliver'],
  wake: ['wake', 'deliver'],
  park: ['session', 'wake', 'deliver'],
  mail: ['mail', 'deliver', 'doc'],
  reply: ['comment', 'doc'],
  claim: ['claim', 'session'],
  forget: ['memory'],
  task: ['task', 'doc'],
  session: ['session.id'],
  doc: ['doc'],
  memory: ['memory', 'doc'],
}

export let hostCommands = (vocab: Vocab): Record<string, Command> =>
  Object.fromEntries(
    Object.entries(commands).filter(([name]) =>
      (needs[name] ?? []).every((comp) => {
        let [name, prop] = comp.split('.')
        return prop ? vocab.prop(name, prop) : vocab.comp(name)
      })
    ),
  )
