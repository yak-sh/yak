import { type Ent, idOf, settled, statusOf } from '../../types.ts'
import { crewed, gated } from '../../live.ts'
import * as ui from '@yaks/ui'
import { linkProps } from '../nav.tsx'
import { Dot } from '../Dot.tsx'
import { renderView } from '../registry.ts'

// The Inline role: identify an entity in flowing content — dot for a task +
// truncated title, ONE anchor wearing the whole internal-link contract
// (nav.tsx linkProps): plain click follows, cmd/middle-click opens a new tab,
// right-click opens the entity menu, and dragging makes a card. `Id` is the
// bare chip for dense rows that need the graph id (meta lines, titlebars).

let retired = (e: Ent) => (e.project && e.archived ? 'retired' : undefined)

export let IdFace = ({ e }: { e: Ent }) => (
  <ui.Id {...linkProps(e)} mod={retired(e)}>{idOf(e)}</ui.Id>
)

// Resolve at render time: Inline is imported while the registry is composed.
export let Id = ({ e }: { e: Ent }) => renderView(e, 'Id')

let Line = ui.block('a', 'Inline', { Title: 'span' })
let { Title } = Line

// A settled task's title is struck — the sentence says whether the entity
// still binds, wherever it's said (the Dependency read, now universal). The
// words are the entity's Title view, so a package's own (a bug's headline)
// names it here too; one with no title is called by its id.
// The literal spaces are for the TUI painter: the web's flex layout
// suppresses whitespace-only items and spaces via gap instead.
export let Inline = ({ e, dot }: { e: Ent; dot?: boolean }) => (
  <Line {...linkProps(e)}>
    {dot && (
      <>
        <Dot status={statusOf(e)} gated={gated(e)} live={crewed(e)} />
        {' '}
      </>
    )}
    <Title mod={settled(statusOf(e)) && 'settled'}>
      {renderView(e, 'Title', { in: 'Inline' })}
    </Title>
  </Line>
)

export let TaskInline = ({ e }: { e: Ent }) => <Inline e={e} dot />

/** A compact session address with its lifecycle, wherever status names it. */
export let SessionId = ({ e }: { e: Ent }) => (
  <>
    <Id e={e} /> {e.session?.status ?? 'starting'}
  </>
)
