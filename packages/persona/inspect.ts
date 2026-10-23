// What this package draws, as @yaks/render registrations: the desk of every
// persona and skill (`Context.Page`, the page the sidebar offers); a persona
// or a skill opened at the desk (`Context`, the tab it opens on); the body of
// its Full page, where what it says and every document it carries are typed
// into (`Full.Body`, and a card's face, `Card.Context`); and what an agent is
// given, as its Markdown view (`Markdown`, more specific than any doc's).
// Loaded only by an interface that draws them (./views.ts).

import { parse } from '@yaks/query'
import type { View } from '@yaks/inspect'
import { DeskPage, Workshop } from './desk.ts'
import { asks, PersonaBody, SkillBody } from './carried.ts'
import { PersonaText, SkillText } from './text.ts'
import { PERSONA, SKILL } from './comp.ts'

let persona = parse(`.doc .${PERSONA}`)
let skill = parse(`.doc .${SKILL}`)

/** The views this package draws. */
export let inspectViews: View[] = [
  { view: 'Context.Page', match: true, Render: DeskPage },
  { view: 'Context', match: persona, Render: Workshop },
  { view: 'Context', match: skill, Render: Workshop },
  { view: 'Full.Body', match: persona, asks, Render: PersonaBody },
  { view: 'Full.Body', match: skill, asks, Render: SkillBody },
  { view: 'Card.Context', match: persona, asks, Render: PersonaBody },
  { view: 'Card.Context', match: skill, asks, Render: SkillBody },
  { view: 'Markdown', match: persona, Render: PersonaText },
  { view: 'Markdown', match: skill, Render: SkillText },
]
