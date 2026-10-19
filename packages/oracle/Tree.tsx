/** @jsxImportSource preact */
// Oracle pages read their tree and conversations through the host's live asks.
// Nodes and sessions always pass through the shared entity renderer.
import type { Answer, Bundle, Io, Props } from '@yaks/inspect'
import {
  Body,
  Head,
  Loading,
  Pairs,
  Rows,
  Section,
  Tile,
  Value,
} from '@yaks/ui'

let comp = (e: Bundle, name: string): Record<string, unknown> => {
  let value = e[name]
  return value && typeof value == 'object' ? value : {}
}
let text = (value: unknown) => typeof value == 'string' ? value : ''
let advert = (e: Bundle) => {
  let value = comp(e, 'oracle').advert
  return value && typeof value == 'object' ? value : {}
}
let field = (value: object, name: string) =>
  name in value ? text(Reflect.get(value, name)) : ''
export let title = (e: Bundle): string =>
  field(advert(e), 'title') || text(comp(e, 'doc').title) ||
  text(comp(e, 'oracle').domain) || 'Oracle'

export type Branch = { node: Bundle; children: Branch[] }

/** Every node appears once, including disconnected nodes and malformed cycles. */
export let branches = (nodes: Bundle[], edges: Bundle[], root: string) => {
  let byId = new Map(nodes.map((b) => [b.entity.eid, b]))
  let children = new Map<string, string[]>(), seen = new Set<string>()
  for (
    let b of [...edges].sort((a, b) =>
      Number(comp(a, 'edge').ord ?? 0) - Number(comp(b, 'edge').ord ?? 0)
    )
  ) {
    let edge = comp(b, 'edge'), parent = text(edge.to)
    children.set(parent, [...children.get(parent) ?? [], text(edge.from)])
  }
  let walk = (eid: string): Branch[] => {
    let node = byId.get(eid)
    if (!node || seen.has(eid)) return []
    seen.add(eid)
    return [{ node, children: (children.get(eid) ?? []).flatMap(walk) }]
  }
  return [root, ...byId.keys()].flatMap(walk)
}

let State = ({ answer, empty }: { answer: Answer; empty: string }) =>
  answer.error
    ? <Section.Note mod='refused'>{answer.error}</Section.Note>
    : answer.rows.length
    ? null
    : !answer.ready
    ? <Loading />
    : <Section.Sub>{empty}</Section.Sub>

let Twig = ({ branch, io }: { branch: Branch; io: Io }) => (
  <Rows.Item role='listitem'>
    {io.show(branch.node, 'Oracle.Tree.Tile')}
    {!!branch.children.length && (
      <Rows mod='nested' role='list'>
        {branch.children.map((child) => (
          <Twig key={child.node.entity.eid} branch={child} io={io} />
        ))}
      </Rows>
    )}
  </Rows.Item>
)

let Conversations = ({ answer, io }: { answer: Answer; io: Io }) => (
  <Section data-section='conversations'>
    <Section.Title>Conversations</Section.Title>
    <Section.Sub>
      The latest 50 conversations; open one to read its turns.
    </Section.Sub>
    <State answer={answer} empty='No conversations yet.' />
    <Rows>
      {answer.rows.map((b) => (
        <Rows.Item key={b.entity.eid}>
          {io.show(b, 'Oracle.Dialogue.Tile')}
        </Rows.Item>
      ))}
    </Rows>
  </Section>
)

/** The tree's page, with one subscription per kind of row. */
export let Tree = ({ e, got, io }: Props) => (
  <>
    <Head>
      <Head.Title>{title(e)}</Head.Title>
      <Head.Sub>Oracle tree</Head.Sub>
    </Head>
    <Section data-section='nodes'>
      <Section.Title>
        Nodes <Section.Count>{got.nodes.rows.length}</Section.Count>
      </Section.Title>
      <State answer={got.nodes} empty='No nodes in this tree.' />
      {got.edges.error && (
        <Section.Note mod='refused'>{got.edges.error}</Section.Note>
      )}
      {!got.edges.ready && !got.edges.rows.length && <Loading />}
      <Rows role='list' aria-label='Oracle tree'>
        {branches(
          got.nodes.rows,
          got.edges.rows,
          text(comp(e, 'oracle_tree').root),
        )
          .map((branch) => (
            <Twig key={branch.node.entity.eid} branch={branch} io={io} />
          ))}
      </Rows>
    </Section>
    <Conversations answer={got.dialogues} io={io} />
  </>
)

/** The oracle's advertisement is the node's shared face in every list. */
export let NodeTile = ({ e, io }: Props) => (
  <Tile href={`${io.link(e.entity.eid)}?v=Oracle`}>
    <Tile.Title>{title(e)}</Tile.Title>
    <Tile.Kind>{text(comp(e, 'oracle').domain)}</Tile.Kind>
    <Tile.Sub>{field(advert(e), 'description')}</Tile.Sub>
  </Tile>
)
export let TreeTile = ({ e, io }: Props) => (
  <Tile href={io.link(e.entity.eid)}>
    <Tile.Title>{title(e)}</Tile.Title>
    <Tile.Kind>Oracle tree</Tile.Kind>
  </Tile>
)
export let Inline = ({ e, io }: Props) => (
  <a href={io.link(e.entity.eid)}>{title(e)}</a>
)
export let Title = ({ e }: Props) => <>{title(e)}</>

export let Node = ({ e, got, io }: Props) => {
  let oracle = comp(e, 'oracle')
  let refs = (rows: Bundle[], prop: string) =>
    rows.map((b) => text(comp(b, 'edge')[prop])).filter(Boolean)
  let parents = refs(got.parents.rows, 'to')
  let children = refs(got.children.rows, 'from')
  let ids = [...parents, ...children]
  let related =
    io.ask(ids.length ? { nodes: `.entity.eid=${ids.join(',')} *` } : {})
      .nodes ?? { rows: [], ready: true }
  let faces = (ids: string[]) =>
    ids.flatMap((eid) => {
      let b = related.rows.find((b) => b.entity.eid == eid)
      return b
        ? [<Rows.Item key={eid}>{io.show(b, 'Oracle.Tree.Tile')}</Rows.Item>]
        : []
    })
  return (
    <>
      <Head>
        <Head.Title>{title(e)}</Head.Title>
        <Head.Sub>Oracle</Head.Sub>
      </Head>
      <Pairs>
        <Pairs.Key>Domain</Pairs.Key>
        <Pairs.Value>{text(oracle.domain)}</Pairs.Value>
        <Pairs.Key>Tree</Pairs.Key>
        <Pairs.Value>
          <State answer={got.tree} empty='Tree unavailable.' />
          {got.tree.rows.map((b) => io.show(b, 'Inline'))}
        </Pairs.Value>
      </Pairs>
      <Body>{field(advert(e), 'description')}</Body>
      <Section data-section='self-context'>
        <Section.Title>Self context</Section.Title>
        {text(oracle.self)
          ? (
            <Body>
              <Value mod='text'>{text(oracle.self)}</Value>
            </Body>
          )
          : <Section.Sub>No retained self context.</Section.Sub>}
      </Section>
      <Section data-section='parent'>
        <Section.Title>Parent</Section.Title>
        <State answer={got.parents} empty='Root or unattached node.' />
        <Rows>{faces(parents)}</Rows>
        {!!parents.length && !related.ready && !related.rows.length && (
          <Loading />
        )}
      </Section>
      <Section data-section='children'>
        <Section.Title>Children</Section.Title>
        <State answer={got.children} empty='No children.' />
        <Rows>{faces(children)}</Rows>
        {!!children.length && !related.ready && !related.rows.length && (
          <Loading />
        )}
        {related.error && (
          <Section.Note mod='refused'>{related.error}</Section.Note>
        )}
      </Section>
      <Conversations answer={got.dialogues} io={io} />
    </>
  )
}

/** Conversations remain sessions: this face links to the existing session page. */
export let Dialogue = ({ e, io }: Props) => {
  let d = comp(e, 'oracle_dialogue')
  let peers = io.ask({
    peers: `.entity.eid=${text(d.from)},${text(d.to)} *`,
  }).peers
  let node = (eid: string) => peers.rows.find((b) => b.entity.eid == eid)
  let name = (eid: string) => node(eid) ? title(node(eid)!) : io.name(eid)
  return (
    <Tile href={io.link(e.entity.eid)}>
      <Tile.Title>{name(text(d.from))} → {name(text(d.to))}</Tile.Title>
      <Tile.Kind>
        {d.declined ? 'declined' : d.finished ? 'finished' : 'in progress'}
      </Tile.Kind>
      <Tile.Sub>
        revision {String(d.revision ?? 0)} · {String(d.turns ?? 0)} turns
      </Tile.Sub>
    </Tile>
  )
}
