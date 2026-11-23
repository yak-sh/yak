// The phone number's two confirmation acts: recoverable release, including
// links already mailed, and the owner's early return to the phone company.
// Marks and restore are the shared app/space trash in erase.ts.
import { shown } from '@yaks/phone'
import { type Kind } from './confirm.ts'
import { type Directory, type PhoneLine } from './directory.ts'
import type { Env } from './env.ts'
import { trashNumber, untrashNumber } from './erase.ts'
import { spaceNow } from './model-spend.ts'
import { syncVoice, voiceOf } from './number-voice.ts'
import { dollars, released } from './numbers.ts'
import type { Who } from './session.ts'

/** Keep its assignment for an exact restore; phone boundaries read the mark,
 * and its calls stop both ways at its provider. */
export let binnedNumber = async (
  env: Env,
  dir: Directory,
  line: PhoneLine,
  who: Who,
) => {
  await trashNumber(dir, line, who)
  await syncVoice(env, line, { in: false, out: false })
  return `${shown(line.number)} is in the trash. It stops taking ` +
    `calls and texts and still costs ${dollars(line.monthly)} a month. ` +
    'Restore it on the manage page to bring its assignment back. ' +
    'Only your confirmation returns it to the phone company.'
}

/** Bring a number back from the trash, its calls going again the ways its
 * space allows (number-voice.ts `voiceOf`). */
export let restoredNumber = async (
  env: Env,
  dir: Directory,
  line: PhoneLine,
  who: Who,
) => {
  await untrashNumber(dir, line, who)
  let space = await spaceNow(env, line.space)
  await syncVoice(env, line, voiceOf(false, space, new Date()))
}

// Keep the number door carried by existing letters: its press puts a number
// in the trash. Returning one early is a separate act on the same page.
export let heldNumber: Kind<PhoneLine> = {
  kind: 'number',
  reversible: true,
  find: async (dir, space, eid) =>
    (await dir.lines(space)).find((l) => l.eid == eid) ?? null,
  typed: (l) => l.number,
  title: (l) => `Release ${shown(l.number)} to the trash?`,
  until: () => 'The number is still held by the space.',
  lines: (_space, l) => [
    `${
      shown(l.number)
    } stops taking calls and texts and waits in the trash until you restore or permanently return it`,
    `it still costs ${
      dollars(l.monthly)
    } a month until returned to the phone company`,
  ],
  press: (l) => `Move ${shown(l.number)} to trash`,
  act: async (env, dir, _space, l, who) => await binnedNumber(env, dir, l, who),
}

export let trashedNumber: Kind<PhoneLine> = {
  ...heldNumber,
  kind: 'numbererase',
  reversible: false,
  title: (l) => `Return ${shown(l.number)} for good?`,
  until: (l) =>
    `It is in the trash and can be restored. It still costs ${
      dollars(l.monthly)
    } a month.`,
  stop: (l) =>
    l.ordering
      ? 'The phone company is still confirming this order.'
      : l.trashed
      ? ''
      : 'Release the number to the trash first.',
  lines: (_space, l) => [
    `${
      shown(l.number)
    }, given back to the phone company, which may never sell it to you again`,
    'the chance to restore it from the trash',
  ],
  press: (l) => `Return ${shown(l.number)} forever`,
  act: async (env, dir, _space, l) => {
    await released(env, l)
    await dir.purgeTrashEntities([l.eid])
    return `${
      shown(l.number)
    } is returned to the phone company: it costs nothing from now on.`
  },
}
