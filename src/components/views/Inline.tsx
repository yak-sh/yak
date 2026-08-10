import { type Ent, idOf, settled } from '../../types.ts'
import { crewed, gated } from '../../live.ts'
import { block, Chip } from '../ui.tsx'
import { linkProps } from '../nav.tsx'
import { Dot } from '../Dot.tsx'
import { title } from '../title.tsx'

// The Inline role: identify an entity in flowing content — chip (+dot for a
// task) + truncated title, ONE anchor wearing the whole internal-link
// contract (nav.tsx linkProps): plain click follows, cmd/middle-click open
// new tabs, right-click opens the entity menu, and dragging makes a card.
// The chip inside carries no link of its own — the sentence IS the anchor,
// and the Surround stack keeps the Chip a span. `Id` is the bare chip for
// dense rows whose surround already says the title (meta lines, titlebars).

let retired = (e: Ent) => (e.project && e.archived ? 'retired' : undefined)

export let Id = ({ e }: { e: Ent }) => (
  <Chip {...linkProps(e)} mod={retired(e)}>{idOf(e)}</Chip>
)

let Line = block('a', 'Inline', { Title: 'span' })
let { Title } = Line

// A settled task's title is struck — the sentence says whether the entity
// still binds, wherever it's said (the Dependency read, now universal).
// The literal spaces are for the TUI painter: the web's flex layout
// suppresses whitespace-only items and spaces via gap instead.
export let Inline = ({ e, dot }: { e: Ent; dot?: boolean }) => (
  <Line {...linkProps(e)}>
    <Chip mod={retired(e)}>{idOf(e)}</Chip> {dot && (
      <>
        <Dot status={e.task!.status} gated={gated(e)} live={crewed(e)} />
        {' '}
      </>
    )}
    <Title
      mod={settled(e.task?.status) && 'settled'}
      {...title(e.doc?.title ?? e.kind)}
    />
  </Line>
)

export let TaskInline = ({ e }: { e: Ent }) => <Inline e={e} dot />
