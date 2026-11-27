/** @jsxImportSource react */
/** The complete anatomy remains reachable without an unbounded DOM. Paging,
 * filters and selection are graph-owned; the map's caps never cap the list.
 */

import { Button, Chip, Tile } from '@yaks/ui'
import type { AtlasModel } from './model.ts'
import { colorOf, filtered, groupName, statusOf } from './Topology.tsx'

export let PAGE_SIZE = 64

export let matchingEdges = (model: AtlasModel) => {
  let text = model.state.filter.trim().toLocaleLowerCase()
  let names = new Map(model.nodes.map((node) => [node.id, node.name]))
  return model.edges.filter((edge) =>
    !text ||
    [edge.kind, names.get(edge.from), names.get(edge.to)].join(' ')
      .toLocaleLowerCase().includes(text)
  )
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
}

export let AnatomyList = ({ model }: { model: AtlasModel }) => {
  let relations = model.state.group == 'relations'
  let unobserved = model.coverage[model.state.group] === false
  let nodes = relations ? [] : filtered(model)
  let edges = relations ? matchingEdges(model) : []
  let total = relations ? edges.length : nodes.length
  let lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)
  let page = Math.min(lastPage, Math.max(0, model.state.listPage))
  let start = page * PAGE_SIZE
  let names = new Map(model.nodes.map((node) => [node.id, node.name]))
  return (
    <section className='AnatomyList' aria-label='Complete anatomy list'>
      <header className='Map_Header'>
        <div>
          <span className='Atlas_Eyebrow'>Complete anatomy</span>
          <h2 className='Atlas_Reset Map_Header_Title'>
            {relations ? 'Every declared connection' : 'Every reported part'}
          </h2>
        </div>
        <span className='Map_Count'>
          {total ? start + 1 : 0}–{Math.min(total, start + PAGE_SIZE)}
          <span className='Map_Count_Text'>of {total}</span>
        </span>
      </header>
      <div className='AnatomyList_Head' aria-hidden='true'>
        <span>{relations ? 'From → to' : 'Name / provenance'}</span>
        <span>{relations ? 'Relationship' : 'Group / state'}</span>
      </div>
      {!total
        ? (
          <div className='AnatomyList_Empty' role='status'>
            <h3 className='Atlas_Reset AnatomyList_Empty_Title'>
              {unobserved
                ? 'Category unobserved here.'
                : `No matching ${relations ? 'relationships' : 'parts'}.`}
            </h3>
            <p className='Atlas_Reset AnatomyList_Empty_Description'>
              {unobserved
                ? 'This host does not report coverage for this category. No matches cannot establish absence.'
                : 'Try a shorter filter or choose a different anatomy group.'}
            </p>
            {model.state.filter && (
              <Button
                className='Atlas_Button'
                type='button'
                onClick={() => {
                  model.search('')
                  model.set({ listPage: 0 })
                }}
              >
                Clear search
              </Button>
            )}
          </div>
        )
        : (
          <ul className='AnatomyList_Rows Atlas_Reset'>
            {relations
              ? edges.slice(start, start + PAGE_SIZE).map((edge) => (
                <li key={edge.id}>
                  <button
                    type='button'
                    className='AnatomyList_Row Atlas_Button'
                    aria-pressed={model.state.selected == edge.id}
                    onClick={() =>
                      model.select(edge.id)}
                  >
                    <Tile className='AnatomyList_Tile'>
                      <div className='AnatomyList_Name'>
                        <Tile.Title className='AnatomyList_Title'>
                          {names.get(edge.from) ?? edge.from}
                        </Tile.Title>
                        <Tile.Note className='AnatomyList_Note'>
                          → {names.get(edge.to) ?? edge.to}
                        </Tile.Note>
                      </div>
                      <Tile.Count className='AnatomyList_Kind'>
                        <Chip>{edge.kind}</Chip>
                      </Tile.Count>
                    </Tile>
                  </button>
                </li>
              ))
              : nodes.slice(start, start + PAGE_SIZE).map((node) => (
                <li key={node.id}>
                  <button
                    type='button'
                    className='AnatomyList_Row Atlas_Button'
                    aria-pressed={model.state.selected == node.id}
                    style={{ '--part': `var(--${colorOf(node)})` }}
                    onClick={() =>
                      model.select(node.id)}
                  >
                    <Tile className='AnatomyList_Tile'>
                      <i
                        className='AnatomyList_Mark'
                        aria-hidden='true'
                        data-bound={node.bound}
                      />
                      <div className='AnatomyList_Name'>
                        <Tile.Title className='AnatomyList_Title'>
                          {node.name}
                        </Tile.Title>
                        <Tile.Note className='AnatomyList_Note'>
                          {node.package ?? node.facet ?? 'Composition metadata'}
                        </Tile.Note>
                      </div>
                      <div className='AnatomyList_State'>
                        <Tile.Kind className='AnatomyList_Kind'>
                          {groupName(node.group)}
                        </Tile.Kind>
                        <Chip
                          mod={statusOf(node) == 'unattempted'
                            ? 'ghost'
                            : undefined}
                        >
                          {statusOf(node)}
                        </Chip>
                      </div>
                    </Tile>
                  </button>
                </li>
              ))}
          </ul>
        )}
      <footer className='AnatomyList_Pager'>
        <span className='AnatomyList_Pager_Text'>
          All {total} matches are accessible · {PAGE_SIZE} rows per page
        </span>
        <nav
          className='AnatomyList_Pager_Nav'
          aria-label='Anatomy list pagination'
        >
          <Button
            className='Atlas_Button'
            type='button'
            disabled={!page}
            aria-label='Previous anatomy page'
            onClick={() => model.set({ listPage: page - 1 })}
          >
            ← Previous
          </Button>
          <output
            className='AnatomyList_Pager_Output'
            aria-label='Anatomy list page'
          >
            {page + 1} / {lastPage + 1}
          </output>
          <Button
            className='Atlas_Button'
            type='button'
            disabled={page >= lastPage}
            aria-label='Next anatomy page'
            onClick={() => model.set({ listPage: page + 1 })}
          >
            Next →
          </Button>
        </nav>
      </footer>
    </section>
  )
}
