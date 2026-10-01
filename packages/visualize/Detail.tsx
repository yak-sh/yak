/** Anatomy detail deliberately projects code metadata rather than rendering
 * arbitrary objects. Schemas expose field names/types, never defaults/examples.
 */

import { Button, Chip } from '@yaks/ui'
import type { AtlasModel, Edge, Node } from './model.ts'
import { colorOf, elapsed, groupName, statusOf } from './Topology.tsx'

let record = (value: unknown): Record<string, unknown> =>
  value && typeof value == 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}

let strings = (value: unknown) => Array.isArray(value)
  ? value.filter((v): v is string => typeof v == 'string') : []

let typeName = (schema: Record<string, unknown>) =>
  typeof schema.type == 'string' ? schema.type
    : Array.isArray(schema.type) ? strings(schema.type).join(' | ')
    : typeof schema.$ref == 'string' ? 'reference'
    : schema.oneOf || schema.anyOf ? 'union' : 'unspecified'

type Property = { name: string; type: string; required: boolean }
let fields = (schema: unknown): Property[] => {
  let data = record(schema)
  let required = new Set(strings(data.required))
  return Object.entries(record(data.properties)).map(([name, value]) => ({
    name, type: typeName(record(value)), required: required.has(name),
  }))
}

let Schema = ({ title, properties }: {
  title: string; properties: Property[]
}) => properties.length ? <details class="Detail_Schema">
  <summary>{title}<span>{properties.length} fields</span></summary>
  <dl class="Detail_Fields">
    {properties.slice(0, 32).map((prop) => <div key={prop.name}>
      <dt>{prop.name}{prop.required && <span title="Required field"> *</span>}</dt>
      <dd>{prop.type}</dd>
    </div>)}
  </dl>
  {properties.length > 32 && <p class="Detail_Note">
    First 32 field names shown. The anatomy JSON door has the full contract.
  </p>}
</details> : null

let metadata = (node: Node): [string, string][] => {
  let rows: [string, string][] = []
  if (node.package) rows.push(['Package', node.package])
  if (node.facet) rows.push(['Facet', node.facet])
  for (let [key, label] of [
    ['configured', 'Configured'], ['selected', 'Selected'],
    ['attempted', 'Attempted'], ['noop', 'No-op binding'],
    ['method', 'Method'], ['path', 'Path'], ['handler', 'Handler'],
    ['tier', 'Tier'], ['extends', 'Open vocabulary'],
    ['observed', 'Category observed'],
  ]) {
    let value = node.detail[key]
    if (typeof value == 'boolean') rows.push([label, value ? 'Yes' : 'No'])
    else if (typeof value == 'string') rows.push([label, value])
  }
  return rows
}

let Flags = ({ node }: { node: Node }) => <dl class="Detail_Flags">
  {([
    ['Declared', node.declared], ['Loaded', node.loaded], ['Bound', node.bound],
  ] as [string, boolean][]).map(([label, present]) => <div key={label}
    data-present={present}>
    <dt><i aria-hidden="true" />{label}</dt>
    <dd>{present ? 'Yes' : 'Not reported'}</dd>
  </div>)}
</dl>

let References = ({ node }: { node: Node }) => {
  let rows = ['refs', 'before', 'hooks', 'facets'].flatMap((key) =>
    strings(node.detail[key]).map((name) => ({ key, name })))
  return rows.length ? <details class="Detail_Schema">
    <summary>Code references<span>{rows.length}</span></summary>
    <ul class="Detail_References">
      {rows.slice(0, 32).map((row, i) => <li key={i}>
        <span>{row.key}</span><code>{row.name}</code>
      </li>)}
    </ul>
    {rows.length > 32 && <p class="Detail_Note">First 32 references shown.</p>}
  </details> : null
}

let Relationships = ({ model, node }: { model: AtlasModel; node: Node }) => {
  let links = model.edges.filter((edge) =>
    edge.from == node.id || edge.to == node.id)
  let names = new Map(model.nodes.map((n) => [n.id, n.name]))
  return <section class="Detail_Relations" aria-label="Part relationships">
    <div class="Detail_Subhead"><h3>Relationships</h3><span>{links.length}</span></div>
    {links.length ? <ul>
      {links.slice(0, 16).map((edge) => {
        let outgoing = edge.from == node.id
        let other = outgoing ? edge.to : edge.from
        return <li key={edge.id}>
          <button type="button" class="Detail_Link"
            onClick={() => model.select(edge.id)}>
            <span aria-hidden="true">{outgoing ? '↗' : '↙'}</span>
            <span><small>{edge.kind}</small>{names.get(other) ?? other}</span>
          </button>
        </li>
      })}
    </ul> : <p class="Detail_Note">No relationships reported in this snapshot.</p>}
    {links.length > 16 && <Button type="button" mod="quiet"
      onClick={() => {
        model.search(node.name)
        model.set({ view: 'list', group: 'relations', listPage: 0 })
      }}>View all {links.length} relationships →</Button>}
  </section>
}

let NodeDetail = ({ model, node }: { model: AtlasModel; node: Node }) => {
  let recent = model.events.findLast((event) => event.node == node.id)
  let props = Array.isArray(node.detail.props)
    ? node.detail.props.map((prop) => {
      let data = record(prop)
      return {
        name: String(data.name ?? ''), type: typeName(record(data.schema)),
        required: false,
      }
    }).filter((prop) => prop.name) : fields(node.detail.schema)
  return <>
    <div class="Detail_Identity" style={{ '--part': `var(--${colorOf(node)})` }}>
      <div class="Detail_Tokens">
        <Chip style={{ '--hue': `var(--${colorOf(node)})` }}>
          {groupName(node.group)}
        </Chip>
        <Chip mod={statusOf(node) == 'unattempted' ? 'ghost' : undefined}>
          {statusOf(node)}
        </Chip>
      </div>
      <h2>{node.name}</h2>
      {node.description && <p>{node.description}</p>}
    </div>
    {node.group == 'phases' ? <p class="Detail_Callout">
      A synthetic label for the {node.detail.path == 'rollback'
        ? 'rollback' : 'apply'} path, not a separately bound implementation.
      Timing appears only when this process reports an observed phase.
    </p> : <Flags node={node} />}
    {node.detail.observed === false && <p class="Detail_Callout"
      data-tone="caution">
      <strong>Category unobserved here.</strong> The host does not report
      coverage for this category. Unreported parts or bindings are not
      evidence of absence.
    </p>}
    {node.group == 'facets' && node.detail.attempted === false &&
      <p class="Detail_Callout" data-tone="caution">
        <strong>Not attempted, not absent.</strong> This lazy facet has not been
        resolved. Its declaration alone says nothing about import success.
      </p>}
    {node.group == 'effects' && node.detail.noop === true &&
      <p class="Detail_Callout">This is a declared no-op binding. Being bound
        is not evidence that work ran.</p>}
    {node.group == 'secrets' && <p class="Detail_Callout" data-tone="caution">
      A configured secret name only. No value is read or displayed here.
    </p>}
    <dl class="Detail_Metadata">
      {metadata(node).map(([label, value]) => <div key={label}>
        <dt>{label}</dt><dd>{value}</dd>
      </div>)}
    </dl>
    <Schema title="Component fields" properties={props} />
    <Schema title="Input contract" properties={fields(node.detail.inputSchema)} />
    <Schema title="Output contract" properties={fields(node.detail.outputSchema)} />
    <References node={node} />
    {recent && <div class="Detail_Observed">
      <span class="Atlas_Eyebrow">Last retained observation</span>
      <Button type="button" onClick={() => model.choose(recent.id)}>
        {recent.kind} · {elapsed(recent)} <span aria-hidden="true">↗</span>
      </Button>
    </div>}
    <Relationships model={model} node={node} />
    <details class="Detail_Identifiers">
      <summary>Stable identifier</summary><code>{node.id}</code>
    </details>
  </>
}

let EdgeDetail = ({ model, edge }: { model: AtlasModel; edge: Edge }) => {
  let from = model.nodes.find((node) => node.id == edge.from)
  let to = model.nodes.find((node) => node.id == edge.to)
  return <>
    <div class="Detail_Identity">
      <Chip>Relationship</Chip><h2>{edge.kind}</h2>
      <p>A declared connection in the composition.</p>
    </div>
    <div class="Detail_Endpoints">
      <span class="Atlas_Eyebrow">From</span>
      <Button type="button" onClick={() => model.select(edge.from)}>
        {from?.name ?? edge.from}
      </Button>
      <span class="Detail_Direction" aria-hidden="true">↓ {edge.kind}</span>
      <span class="Atlas_Eyebrow">To</span>
      <Button type="button" onClick={() => model.select(edge.to)}>
        {to?.name ?? edge.to}
      </Button>
    </div>
    <p class="Detail_Callout">A relationship is not measured data transfer.
      Pulses mark observed trace records, never inferred traffic.</p>
    <details class="Detail_Identifiers">
      <summary>Stable identifier</summary><code>{edge.id}</code>
    </details>
  </>
}

/** Selection stays in the page graph; expanding code metadata is native HTML. */
export let Detail = ({ model }: { model: AtlasModel }) => {
  let node = model.selected
  let edge = model.edges.find((edge) => edge.id == model.state.selected)
  return <aside class="Detail" id="atlas-detail" tabIndex={-1}
    aria-label="Selected anatomy detail">
    <header class="Detail_Header">
      <span class="Atlas_Eyebrow">Anatomy detail</span>
      {model.state.selected && <Button type="button" mod="quiet"
        aria-label="Clear selected part" onClick={() => model.select('')}>×</Button>}
    </header>
    <div class="Detail_Body">
      {node ? <NodeDetail model={model} node={node} />
        : edge ? <EdgeDetail model={model} edge={edge} />
        : <div class="Detail_Empty">
          <svg viewBox="0 0 120 96" aria-hidden="true">
            <path d="M22 48h38m0 0V18h38m-38 30v30h38" />
            <circle cx="22" cy="48" r="8" />
            <circle cx="60" cy="48" r="10" />
            <circle cx="98" cy="18" r="6" />
            <circle cx="98" cy="78" r="6" />
          </svg>
          <h2>{model.state.selected ? 'Part no longer reported'
            : 'Every part has a place.'}</h2>
          <p>{model.state.selected
            ? 'This selection is outside the current anatomy snapshot.'
            : 'Select a part or a relationship to see its contract, provenance and connections.'}</p>
          <div class="Detail_EmptyNote">
            <span>Declared ≠ loaded ≠ bound</span>
            <p>These are composition facts, not execution counts.</p>
          </div>
        </div>}
    </div>
  </aside>
}
