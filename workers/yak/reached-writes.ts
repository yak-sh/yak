// What an Operator settings page writes through the page graph's door
// (reach-door.ts) about how the person is told things away from the page
// (@yaks/platform/operator-settings): the way they chose, a browser they
// allowed notifications on, a number they agree to texts at, and texts
// stopped. Each is done as the person, and answered with the rows it moved.
import type { Bundle } from '@yaks/graph'
import {
  ALERTING,
  type Channel,
  TEXTING,
} from '@yaks/platform/operator-settings'
import { CallError } from '@yaks/tools/errors'
import type { Directory } from './directory.ts'
import type { Env } from './env.ts'
import { alertsRow, pushRow } from './operator-alerts.ts'
import { stopping } from './operator-texts.ts'
import { provePhone } from './phone-contact.ts'
import { vouched, type Who } from './session.ts'
import { personRows } from './side.ts'

/** Do each of `bundles` as `person`, signed in as `who`, answering the rows
 * they moved. A number that needs its code first is refused with what was
 * texted, which the page says. */
export let reachedApply = async (
  bundles: Bundle[],
  env: Env,
  dir: Directory,
  who: Who,
  person: string,
): Promise<Bundle[]> => {
  let moved = new Set<string>()
  let answered: Bundle[] = []
  for (let b of bundles) {
    if (b.alerting) {
      let { channel } = b.alerting as { channel: Channel }
      await dir.apply({ entities: [alertsRow(person, channel)] }, vouched(who))
      moved.add(ALERTING)
    } else if (b.allowPush) {
      let { subscription } = b.allowPush as { subscription: unknown }
      await dir.apply(
        { entities: [pushRow(person, subscription)] },
        vouched(who),
      )
      moved.add(ALERTING)
      answered.push(b)
    } else if (b.stopTexts) {
      await dir.apply({ entities: stopping(person) }, vouched(who))
      moved.add(TEXTING).add(ALERTING)
      answered.push(b)
    } else if (b.agreeTexts) {
      let { number = '', agreed = false, code = '', space = '' } = b
        .agreeTexts as {
          number?: string
          agreed?: boolean
          code?: string
          space?: string
        }
      let seat = (await dir.seated(person)).find((s) => s.space.eid == space)
      if (!seat) {
        throw new CallError('access', 'You are not a member of that space.')
      }
      let proof = await provePhone(
        env,
        person,
        seat.space,
        number,
        agreed,
        code,
      )
      if (proof) throw new CallError('arguments', proof.message)
      moved.add(TEXTING).add(ALERTING)
      answered.push(b)
    }
  }
  for (let line of moved) {
    answered.push(...await personRows(dir, person, line))
  }
  return answered
}
