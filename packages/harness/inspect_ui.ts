/** Graph-owned search state; source retrieval is bounded and independent of rendering. */
import { h } from 'preact'
import type { Bundle, Comp } from '@yaks/graph'
import { Scroll, pressTo, type Key } from '@yaks/tui'
import { define, type Renderer } from '@yaks/render'
import { parse } from '@yaks/query'
import { render } from '@yaks/preact'
import { loadVocab } from '@yaks/vocab'
import type { Frontend } from './frontend.ts'
import type { UIAgent } from './panels.ts'
import type { SearchCursor, SourceMatch } from './inspection.ts'

export const inspector = (ui: Frontend, agent: UIAgent) => {
  const state = () => ui.client.ent('inspection')!.inspection as Comp
  const session = () => String((ui.client.ent('view')!.frontend as Comp).selected ?? '')
  const set = ui.inspectState
  const fail = (generation: number, e: unknown) => {
    if (state().generation == generation) set({ message: String(e) })
  }
  const reveal = (match: SourceMatch) => {
    const viewport = ui.viewport('viewport-' + session())
    viewport.set({ anchor: { id: match.entity, offset: 0 }, follow: false })
    viewport.watch.close()
    set({ entity: match.entity, message: 'Match at source character ' + match.offset })
  }
  const find = async (fresh: boolean) => {
    if (!agent.search || !session()) return
    const generation = Number(state().generation) + 1
    const query = String(state().query), id = session()
    const cursor = fresh ? undefined : JSON.parse(String(state().cursor || 'null')) as SearchCursor | null
    const was = fresh ? [] : JSON.parse(String(state().matches)) as SourceMatch[]
    set({ generation, session: id, mode: '', message: 'Searching…' })
    try {
      const page = await agent.search(id, query, cursor ?? undefined)
      if (state().generation != generation || session() != id) return
      const matches = [...was, ...page.matches].slice(-200)
      set({ matches: JSON.stringify(matches), cursor: page.next ? JSON.stringify(page.next) : null, index: matches.length ? (fresh ? 0 : Math.min(was.length, matches.length - 1)) : -1, message: matches.length ? matches.length + ' matches loaded' : page.next ? 'No matches in this page; n searches further' : 'No matches' })
      const match = matches[Number(state().index)]
      if (match) reveal(match)
    } catch (e) { fail(generation, e) }
  }
  const inspect = async (entity: string, start = 0, revision?: string) => {
    if (!agent.inspect || !entity) return
    const generation = Number(state().generation) + 1, id = session()
    set({ generation, session: id, entity, mode: 'detail', message: 'Loading source…', text: '' })
    try {
      const page = await agent.inspect(id, entity, start, revision)
      if (state().generation != generation || session() != id) return
      const { entry, ...value } = page
      set({ ...value, metadata: JSON.stringify(entry), message: '', mode: 'detail' })
    } catch (e) { fail(generation, e) }
  }
  return (key: Key): boolean => {
    let s = state()
    if (s.session && s.session != session()) {
      set({ session: session(), mode: '', query: '', matches: '[]', cursor: null, index: -1, message: '', generation: Number(s.generation) + 1 })
      s = state()
    }
    if ((ui.client.ent('keyboard')!.keyboard as Comp).mode != 'NORMAL') return false
    const text = key.name == 'char' && !key.ctrl && !key.alt ? key.text : undefined
    if (s.mode == 'query') {
      if (key.name == 'escape') set({ mode: '', message: '' })
      else if (key.name == 'enter') { if (s.query) void find(true); else set({ mode: '' }) }
      else if (key.name == 'backspace') set({ query: Array.from(String(s.query)).slice(0, -1).join('') })
      else if (text || key.name == 'paste') set({ query: (String(s.query) + (key.text ?? '')).replace(/[\r\n]/g, ' ').slice(0, 256) })
      return true
    }
    if (s.mode == 'detail') {
      if (key.name == 'escape' || text == 'q') set({ mode: '', message: '' })
      else if (text == ']' && s.next != null) void inspect(String(s.entity), Number(s.next), String(s.revision))
      else if (text == 'j' || text == 'k' || key.name == 'down' || key.name == 'up' || key.name == 'pageup' || key.name == 'pagedown') pressTo('entry-detail', { name: text == 'j' ? 'down' : text == 'k' ? 'up' : key.name })
      else if (text == '[' && Number(s.start) > 0) void inspect(String(s.entity), Math.max(0, Number(s.start) - 4096), String(s.revision))
      return true
    }
    if (text == '/' && session()) { set({ mode: 'query', session: session(), query: '', message: '' }); return true }
    if ((text == 'n' || text == 'N') && s.query) {
      const matches = JSON.parse(String(s.matches)) as SourceMatch[]
      let index = Number(s.index) + (text == 'n' ? 1 : -1)
      if (text == 'n' && index >= matches.length && s.cursor) { void find(false); return true }
      if (matches.length) { index = (index + matches.length) % matches.length; set({ index }); reveal(matches[index]) }
      else if (s.cursor) void find(false)
      return true
    }
    if (key.name == 'enter' && session()) {
      const viewport = ui.client.ent('viewport-' + session())?.viewport as Comp | undefined
      const entity = String(viewport?.selected ?? viewport?.item ?? s.entity ?? '')
      if (entity) void inspect(entity)
      return true
    }
    return false
  }
}

const detailVocab = loadVocab([{ $defs: Object.fromEntries(['prompt', 'result', 'error', 'exception', 'attachment', 'ask'].map((name) => [name, { properties: {} }])) }])
const detail = (match: string | true, label: string): Renderer => ({
  view: 'Detail', match: match === true ? true : parse(match),
  render: (_b, host, ctx) => host('div', null, host('div', { class: 'Entry_Hint' }, label + ' · literal source'), host('div', { wrap: '1' }, String(ctx.text ?? ''))),
})
export const detailViews = define([detail('.prompt', 'Instructions'), detail('.result', 'Tool result'), detail('.exception', 'Exception'), detail('.error', 'Error'), detail('.attachment', 'Attachment'), detail('.ask', 'Request'), detail(true, 'Entry')])

export const InspectionPanel = ({ ui }: { ui: Frontend }) => {
  const s = ui.inspection.value[0].inspection as Comp
  if (!s.mode && !s.message) return null
  return h('div', { border: 'Composer_Border', ...(s.mode == 'detail' ? { height: '12', col: '1' } : {}) },
    s.mode == 'query' ? '/' + String(s.query) + ' · Enter search · Esc cancel' :
    s.mode == 'detail' ? h('div', { col: '1', grow: '1' },
      h('div', { class: 'Entry_Hint' }, 'Source ' + s.start + '–' + (Number(s.start) + Array.from(String(s.text ?? '')).length) + ' / ' + s.total + ' · [/] chunks · Esc close'),
      h(Scroll, { id: 'entry-detail', grow: '1', follow: false }, render(detailViews, JSON.parse(String(s.metadata || '{"entity":{"eid":"detail"}}')) as Bundle, 'Detail', detailVocab, { text: s.text }))) : null,
    s.message ? h('div', { class: 'Entry_Hint', wrap: '1' }, String(s.message)) : null)
}
