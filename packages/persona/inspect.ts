// What this package draws, as @yaks/render registrations: the desk of every
// persona and skill (`Context.Page`, the page the sidebar offers); a persona
// or a skill opened at the desk (`Context`, the tab it opens on), and its
// binder alone wherever that is asked for (`Binder`, and a card's face,
// `Card.Context`); and what an agent is given, as its Markdown view
// (`Markdown`, more specific than any doc's). Loaded only by an interface
// that draws them (./views.ts).

import { parse } from '@yaks/query'
import type { View } from '@yaks/inspect'
import { DeskPage, Workshop } from './desk.ts'
import { asks, PersonaBinder, SkillBinder } from './binder.ts'
import { PersonaText, SkillText } from './text.ts'
import { PERSONA, SKILL } from './comp.ts'

let persona = parse(`.doc .${PERSONA}`)
let skill = parse(`.doc .${SKILL}`)

/** The views this package draws. */
export let inspectViews: View[] = [
  { view: 'Context.Page', match: true, Render: DeskPage },
  { view: 'Context', match: persona, Render: Workshop },
  { view: 'Context', match: skill, Render: Workshop },
  { view: 'Binder', match: persona, asks, Render: PersonaBinder },
  { view: 'Binder', match: skill, Render: SkillBinder },
  { view: 'Card.Context', match: persona, asks, Render: PersonaBinder },
  { view: 'Card.Context', match: skill, Render: SkillBinder },
  { view: 'Markdown', match: persona, Render: PersonaText },
  { view: 'Markdown', match: skill, Render: SkillText },
]
