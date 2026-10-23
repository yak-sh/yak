/**
 * What an agent is given, as the Markdown view of a persona or a skill draws
 * it, so that view is the preview. A persona's is its whole text: its own
 * words, then each document it contains in full and what it reads, the text
 * `yak persona read` says and a session wearing it is given (`voice` of
 * `wear`). The page composes it with that same code over what the page holds
 * (@yaks/inspect's `useReading`), so it is recomposed as anything it read
 * moves. A skill's is its SKILL.md, as an agent loads it (`renderSkill`).
 * Either is drawn as its source, as written.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import * as ui from '@yaks/ui'
import { type Bundle, type Props, useReading } from '@yaks/inspect'
import { Refused } from '@yaks/graph/errors'
import { voice, type Worn } from './voice.ts'
import { wear } from './worn.ts'
import { renderSkill } from './skill-text.ts'

/** A text as its source, once it is all there. */
let Source = (
  { eid, text, ready }: { eid: string; text: string; ready: boolean },
): JSX.Element =>
  ready
    ? h(ui.Body, { mod: 'source', 'data-markdown': eid }, h('pre', {}, text))
    : h(ui.Loading, {})

/** A persona's whole text, as an agent wearing it is given it. */
export let PersonaText = ({ e, io }: Props): JSX.Element => {
  let { value, ready } = useReading(io, (r) => {
    let worn = wear(r, io.vocab)(e.entity.eid) as Worn | undefined
    return worn ? voice(io.vocab)(worn) : ''
  })
  return h(Source, { eid: e.entity.eid, text: value, ready })
}

/** A skill's SKILL.md, or why it cannot be written as one. */
export let skillText = (b: Bundle): string => {
  try {
    return renderSkill({ doc: b.doc, skill: b.skill, content: b.content })
  } catch (error) {
    if (!(error instanceof Refused)) throw error
    return `${error.message}.`
  }
}

/** A skill's SKILL.md, as an agent loads it. */
export let SkillText = ({ e, io }: Props): JSX.Element => {
  let { value, ready } = useReading(io, (r) => {
    let [b] = r.get([e.entity.eid])
    return b ? skillText(b) : ''
  })
  return h(Source, { eid: e.entity.eid, text: value, ready })
}
