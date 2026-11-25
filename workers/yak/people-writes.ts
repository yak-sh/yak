// What a space's owner writes to its People page through the tab's page graph
// (@yaks/platform/people-rows), done here as them: an invitation sent, sent
// again or withdrawn, someone taken off, and another space's Operator let in
// or taken back out. Each is the tool their assistant calls, or what that
// tool does, called as them, so the page and the assistant do each one way.
// The answer is the act with what it came to in `said`; a refusal says why,
// and the page says it under the form.
import type { Bundle } from '@yaks/graph'
import { PEOPLE_ACTS, type PeopleAct } from '@yaks/platform/people-rows'
import { CallError } from '@yaks/tools/errors'
import type { Directory, Role } from './directory.ts'
import type { Env } from './env.ts'
import { again } from './invite.ts'
import { letIn, letOut } from './operator-reach.ts'
import { sentence } from './pages.ts'
import { vouched, type Who } from './session.ts'
import { ownedBy } from './side.ts'
import { TOOLS } from './tools.ts'

type Said = Record<string, string | undefined> & { space: string }

// A seat lowered or removed takes out the Operators it let in
// (operator-reach.ts `leftWith`), which the owner never named: the answer
// says which, in the tool's own words, rather than a bare "Saved."
let told = (out: { text: string; value?: unknown }, done: string) =>
  (out.value as { unreached?: string[] } | undefined)?.unreached?.length
    ? sentence(out.text)
    : done

// A refusal as a sentence, the way the page says one.
let plainly = <T>(work: Promise<T>): Promise<T> =>
  work.catch((e) => {
    throw e instanceof CallError
      ? new CallError(e.code, sentence(e.message))
      : e
  })

/** Do the owner's acts on their People page, in order, and answer each with
 * what it came to. */
export let peopleApply = async (
  bundles: Bundle[],
  env: Env,
  dir: Directory,
  who: Who & { person: string },
): Promise<Bundle[]> => {
  let { person } = who
  let tool = (name: string, args: Record<string, unknown>) =>
    plainly(TOOLS.find((t) => t.name == name)!.run({ env, dir, person }, args))
  let answered: Bundle[] = []
  for (let b of bundles) {
    let act = PEOPLE_ACTS.find((a) => a in b) as PeopleAct
    let asked = b[act] as Said
    let space = await ownedBy(dir, person, asked.space)
    if (!space) throw new CallError('access', 'That space is not yours.')
    let headers = vouched({ ...who, role: 'owner' })
    let said: string
    if (act == 'memberAdd') {
      let out = await tool('member_add', {
        space: space.slug,
        ...asked.friend ? { friend: asked.friend } : { email: asked.email },
        ...asked.app ? { app: asked.app } : {},
        ...asked.role ? { role: asked.role } : {},
        ...asked.note ? { note: asked.note } : {},
      })
      said = told(
        out,
        (out.value as { invited?: boolean } | undefined)?.invited
          ? 'Invitation sent.'
          : 'Saved.',
      )
    } else if (act == 'memberRemove') {
      let out = await tool('member_remove', {
        space: space.slug,
        email: asked.email,
        ...asked.app ? { app: asked.app } : {},
      })
      said = told(out, 'Removed.')
    } else if (act == 'inviteAgain') {
      let no = await again(env, dir, space, who, asked.invite!)
      if (no) throw new CallError('arguments', no.say)
      said = 'Sent again.'
    } else if (act == 'operatorAdmit') {
      // Only a space the owner sits in is let in.
      let other = (await dir.seated(person))
        .find((s) => s.space.eid == asked.operator)?.space
      if (!other) throw new CallError('missing', 'You are in no such space.')
      let role = (asked.role ?? 'editor') as Role
      await plainly(letIn(dir, space, other, role, person, headers))
      said = 'Saved.'
    } else {
      await plainly(letOut(dir, space, asked.operator!, headers))
      said = 'Removed.'
    }
    answered.push({ ...b, [act]: { ...asked, said } })
  }
  return answered
}
