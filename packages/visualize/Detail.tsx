/** @jsxImportSource react */
/** Anatomy detail deliberately projects code metadata rather than rendering
 * arbitrary objects. Schemas expose field names/types, never defaults/examples.
 */

import { Button, Chip } from '@yaks/ui'
import type { AtlasModel, Edge, Node } from './model.ts'
import { colorOf, elapsed, groupName, statusOf } from './Topology.tsx'

let record = (value: unknown): Record<string, unknown> =>
  value && typeof value == 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

let strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v == 'string')
    : []

let typeName = (schema: Record<string, unknown>) =>
  typeof schema.type == 'string'
    ? schema.type
    : Array.isArray(schema.type)
    ? strings(schema.type).join(' | ')
    : typeof schema.$ref == 'string'
    ? 'reference'
    : schema.oneOf || schema.anyOf
    ? 'union'
    : 'unspecified'

type Property = { name: string; type: string; required: boolean }
let fields = (schema: unknown): Property[] => {
  let data = record(schema)
  let required = new Set(strings(data.required))
  return Object.entries(record(data.properties)).map(([name, value]) => ({
    name,
    type: typeName(record(value)),
    required: required.has(name),
  }))
}

let Schema = ({ title, properties }: {
  title: string
  properties: Property[]
}) =>
  properties.length
    ? (
      <details className='Detail_Schema'>
        <summary className='Atlas_Summary Detail_Schema_Summary'>
          {title}
          <span className='Detail_Schema_Summary_Text'>
            {properties.length} fields
          </span>
        </summary>
        <dl className='Detail_Fields Atlas_Reset'>
          {properties.slice(0, 32).map((prop) => (
            <div className='Detail_Fields_Row' key={prop.name}>
              <dt className='Detail_Fields_Term'>
                {prop.name}
                {prop.required && (
                  <span
                    className='Detail_Fields_Term_Text'
                    title='Required field'
                  >
                    *
                  </span>
                )}
              </dt>
              <dd className='Detail_Fields_Value'>{prop.type}</dd>
            </div>
          ))}
        </dl>
        {properties.length > 32 && (
          <p className='Detail_Note Atlas_Reset'>
            First 32 field names shown. The anatomy JSON door has the full
            contract.
          </p>
        )}
      </details>
    )
    : null

let metadata = (node: Node): [string, string][] => {
  let rows: [string, string][] = []
  if (node.package) rows.push(['Package', node.package])
  if (node.facet) rows.push(['Facet', node.facet])
  for (
    let [key, label] of [
      ['configured', 'Configured'],
      ['selected', 'Selected'],
      ['attempted', 'Attempted'],
      ['noop', 'No-op binding'],
      ['method', 'Method'],
      ['path', 'Path'],
      ['handler', 'Handler'],
      ['tier', 'Tier'],
      ['extends', 'Open vocabulary'],
      ['observed', 'Category observed'],
    ]
  ) {
    let value = node.detail[key]
    if (typeof value == 'boolean') rows.push([label, value ? 'Yes' : 'No'])
    else if (typeof value == 'string') rows.push([label, value])
  }
  return rows
}

let Flags = ({ node }: { node: Node }) => (
  <dl className='Detail_Flags Atlas_Reset'>
    {([
      ['Declared', node.declared],
      ['Loaded', node.loaded],
      ['Bound', node.bound],
    ] as [string, boolean][]).map(([label, present]) => (
      <div className='Detail_Flags_Row' key={label} data-present={present}>
        <dt className='Detail_Flags_Term'>
          <i className='Detail_Flags_Indicator' aria-hidden='true' />
          {label}
        </dt>
        <dd className='Detail_Flags_Value'>
          {present ? 'Yes' : 'Not reported'}
        </dd>
      </div>
    ))}
  </dl>
)

let References = ({ node }: { node: Node }) => {
  let rows = ['refs', 'before', 'hooks', 'facets'].flatMap((key) =>
    strings(node.detail[key]).map((name) => ({ key, name }))
  )
  return rows.length
    ? (
      <details className='Detail_Schema'>
        <summary className='Atlas_Summary Detail_Schema_Summary'>
          Code references<span className='Detail_Schema_Summary_Text'>
            {rows.length}
          </span>
        </summary>
        <ul className='Detail_References Atlas_Reset'>
          {rows.slice(0, 32).map((row, i) => (
            <li className='Detail_References_Item' key={i}>
              <span className='Detail_References_Text'>{row.key}</span>
              <code className='Detail_References_Code'>{row.name}</code>
            </li>
          ))}
        </ul>
        {rows.length > 32 && (
          <p className='Detail_Note Atlas_Reset'>First 32 references shown.</p>
        )}
      </details>
    )
    : null
}

let Relationships = ({ model, node }: { model: AtlasModel; node: Node }) => {
  let links = model.edges.filter((edge) =>
    edge.from == node.id || edge.to == node.id
  )
  let names = new Map(model.nodes.map((n) => [n.id, n.name]))
  return (
    <section className='Detail_Relations' aria-label='Part relationships'>
      <div className='Detail_Subhead'>
        <h3 className='Atlas_Reset Detail_Subhead_Title'>Relationships</h3>
        <span className='Detail_Subhead_Text'>{links.length}</span>
      </div>
      {links.length
        ? (
          <ul className='Atlas_Reset Detail_Relations_List'>
            {links.slice(0, 16).map((edge) => {
              let outgoing = edge.from == node.id
              let other = outgoing ? edge.to : edge.from
              return (
                <li key={edge.id}>
                  <button
                    type='button'
                    className='Detail_Link Atlas_Button'
                    onClick={() => model.select(edge.id)}
                  >
                    <span className='Detail_Link_Text' aria-hidden='true'>
                      {outgoing ? '↗' : '↙'}
                    </span>
                    <span className='Detail_Link_Text'>
                      <small className='Detail_Link_Note'>{edge.kind}</small>
                      {names.get(other) ?? other}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )
        : (
          <p className='Detail_Note Atlas_Reset'>
            No relationships reported in this snapshot.
          </p>
        )}
      {links.length > 16 && (
        <Button
          className='Atlas_Button'
          type='button'
          mod='quiet'
          onClick={() => {
            model.search(node.name)
            model.set({ view: 'list', group: 'relations', listPage: 0 })
          }}
        >
          View all {links.length} relationships →
        </Button>
      )}
    </section>
  )
}

let NodeDetail = ({ model, node }: { model: AtlasModel; node: Node }) => {
  let recent = model.events.findLast((event) => event.node == node.id)
  let props = Array.isArray(node.detail.props)
    ? node.detail.props.map((prop) => {
      let data = record(prop)
      return {
        name: String(data.name ?? ''),
        type: typeName(record(data.schema)),
        required: false,
      }
    }).filter((prop) => prop.name)
    : fields(node.detail.schema)
  return (
    <>
      <div
        className='Detail_Identity'
        style={{ '--part': `var(--${colorOf(node)})` }}
      >
        <div className='Detail_Tokens'>
          <Chip style={{ '--hue': `var(--${colorOf(node)})` }}>
            {groupName(node.group)}
          </Chip>
          <Chip mod={statusOf(node) == 'unattempted' ? 'ghost' : undefined}>
            {statusOf(node)}
          </Chip>
        </div>
        <h2 className='Atlas_Reset Detail_Identity_Title'>{node.name}</h2>
        {node.description && (
          <p className='Atlas_Reset Detail_Identity_Description'>
            {node.description}
          </p>
        )}
      </div>
      {node.group == 'phases'
        ? (
          <p className='Detail_Callout Atlas_Reset'>
            A synthetic label for the{' '}
            {node.detail.path == 'rollback' ? 'rollback' : 'apply'}{' '}
            path, not a separately bound implementation. Timing appears only
            when this process reports an observed phase.
          </p>
        )
        : <Flags node={node} />}
      {node.detail.observed === false && (
        <p className='Detail_Callout Atlas_Reset' data-tone='caution'>
          <strong className='Detail_Callout_Strong'>
            Category unobserved here.
          </strong>{' '}
          The host does not report coverage for this category. Unreported parts
          or bindings are not evidence of absence.
        </p>
      )}
      {node.group == 'facets' && node.detail.attempted === false &&
        (
          <p className='Detail_Callout Atlas_Reset' data-tone='caution'>
            <strong className='Detail_Callout_Strong'>
              Not attempted, not absent.
            </strong>{' '}
            This lazy facet has not been resolved. Its declaration alone says
            nothing about import success.
          </p>
        )}
      {node.group == 'effects' && node.detail.noop === true &&
        (
          <p className='Detail_Callout Atlas_Reset'>
            This is a declared no-op binding. Being bound is not evidence that
            work ran.
          </p>
        )}
      {node.group == 'secrets' && (
        <p className='Detail_Callout Atlas_Reset' data-tone='caution'>
          A configured secret name only. No value is read or displayed here.
        </p>
      )}
      <dl className='Detail_Metadata Atlas_Reset'>
        {metadata(node).map(([label, value]) => (
          <div className='Detail_Metadata_Row' key={label}>
            <dt className='Detail_Metadata_Term'>{label}</dt>
            <dd className='Detail_Metadata_Value'>{value}</dd>
          </div>
        ))}
      </dl>
      <Schema title='Component fields' properties={props} />
      <Schema
        title='Input contract'
        properties={fields(node.detail.inputSchema)}
      />
      <Schema
        title='Output contract'
        properties={fields(node.detail.outputSchema)}
      />
      <References node={node} />
      {recent && (
        <div className='Detail_Observed'>
          <span className='Atlas_Eyebrow'>Last retained observation</span>
          <Button
            className='Atlas_Button'
            type='button'
            onClick={() => model.choose(recent.id)}
          >
            {recent.kind} · {elapsed(recent)} <span aria-hidden='true'>↗</span>
          </Button>
        </div>
      )}
      <Relationships model={model} node={node} />
      <details className='Detail_Identifiers'>
        <summary className='Atlas_Summary Detail_Identifiers_Summary'>
          Stable identifier
        </summary>
        <code className='Detail_Identifiers_Code'>{node.id}</code>
      </details>
    </>
  )
}

let EdgeDetail = ({ model, edge }: { model: AtlasModel; edge: Edge }) => {
  let from = model.nodes.find((node) => node.id == edge.from)
  let to = model.nodes.find((node) => node.id == edge.to)
  return (
    <>
      <div className='Detail_Identity'>
        <Chip>Relationship</Chip>
        <h2 className='Atlas_Reset Detail_Identity_Title'>{edge.kind}</h2>
        <p className='Atlas_Reset Detail_Identity_Description'>
          A declared connection in the composition.
        </p>
      </div>
      <div className='Detail_Endpoints'>
        <span className='Atlas_Eyebrow'>From</span>
        <Button
          className='Atlas_Button Detail_Endpoints_Button'
          type='button'
          onClick={() => model.select(edge.from)}
        >
          {from?.name ?? edge.from}
        </Button>
        <span className='Detail_Direction' aria-hidden='true'>
          ↓ {edge.kind}
        </span>
        <span className='Atlas_Eyebrow'>To</span>
        <Button
          className='Atlas_Button Detail_Endpoints_Button'
          type='button'
          onClick={() => model.select(edge.to)}
        >
          {to?.name ?? edge.to}
        </Button>
      </div>
      <p className='Detail_Callout Atlas_Reset'>
        A relationship is not measured data transfer. Pulses mark observed trace
        records, never inferred traffic.
      </p>
      <details className='Detail_Identifiers'>
        <summary className='Atlas_Summary Detail_Identifiers_Summary'>
          Stable identifier
        </summary>
        <code className='Detail_Identifiers_Code'>{edge.id}</code>
      </details>
    </>
  )
}

/** Selection stays in the page graph; expanding code metadata is native HTML. */
export let Detail = ({ model }: { model: AtlasModel }) => {
  let node = model.selected
  let edge = model.edges.find((edge) => edge.id == model.state.selected)
  return (
    <aside
      className='Detail Atlas_Focusable'
      id='atlas-detail'
      tabIndex={-1}
      aria-label='Selected anatomy detail'
    >
      <header className='Detail_Header'>
        <span className='Atlas_Eyebrow'>Anatomy detail</span>
        {model.state.selected && (
          <Button
            className='Atlas_Button'
            type='button'
            mod='quiet'
            aria-label='Clear selected part'
            onClick={() => model.select('')}
          >
            ×
          </Button>
        )}
      </header>
      <div className='Detail_Body'>
        {node
          ? <NodeDetail model={model} node={node} />
          : edge
          ? <EdgeDetail model={model} edge={edge} />
          : (
            <div className='Detail_Empty'>
              <svg
                className='Detail_Empty_Icon'
                viewBox='0 0 120 96'
                aria-hidden='true'
              >
                <path d='M22 48h38m0 0V18h38m-38 30v30h38' />
                <circle
                  className='Detail_Empty_Icon_Circle'
                  cx='22'
                  cy='48'
                  r='8'
                />
                <circle
                  className='Detail_Empty_Icon_Circle'
                  cx='60'
                  cy='48'
                  r='10'
                />
                <circle
                  className='Detail_Empty_Icon_Circle'
                  cx='98'
                  cy='18'
                  r='6'
                />
                <circle
                  className='Detail_Empty_Icon_Circle'
                  cx='98'
                  cy='78'
                  r='6'
                />
              </svg>
              <h2 className='Atlas_Reset Detail_Empty_Title'>
                {model.state.selected
                  ? 'Part no longer reported'
                  : 'Every part has a place.'}
              </h2>
              <p className='Atlas_Reset Detail_Empty_Description'>
                {model.state.selected
                  ? 'This selection is outside the current anatomy snapshot.'
                  : 'Select a part or a relationship to see its contract, provenance and connections.'}
              </p>
              <div className='Detail_EmptyNote'>
                <span className='Detail_EmptyNote_Text'>
                  Declared ≠ loaded ≠ bound
                </span>
                <p className='Atlas_Reset Detail_EmptyNote_Description'>
                  These are composition facts, not execution counts.
                </p>
              </div>
            </div>
          )}
      </div>
    </aside>
  )
}
