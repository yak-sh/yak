/** @jsxImportSource preact */
// A topic keeps its own three context heads; a conversation cultivates them.
// Only those immutable texts and direct graph neighbors are read by this page.
import type { Answer, Bundle, Io, Props } from '@yaks/inspect'
import { names } from '@yaks/edge'
import { Body, Head, Loading, Rows, Section, Tile, Value } from '@yaks/ui'
import { Conversations, State, title } from './Tree.tsx'

let part = (e: Bundle | undefined, name: string): Record<string, unknown> => {
  let value = e?.[name]
  return value && typeof value == 'object' ? value : {}
}
let text = (value: unknown) => typeof value == 'string' ? value : ''
let slots = ['parent', 'self', 'children']
let labels = ['Parent context', 'Self context', 'Children context']

let Context = ({
  slot,
  head,
  answer,
  io,
}: { slot: string; head: string; answer: Answer; io: Io }) => {
  let row = answer.rows.find((b) => b.entity.eid == head)
  let at = text(part(row, 'created').at)
  return (
    <Section data-section={`${slot}-context`}>
      <Section.Title>{labels[slots.indexOf(slot)]}</Section.Title>
      {!head ? <Section.Sub>No stored {slot} context.</Section.Sub> : row
        ? (
          <>
            <Body>
              <Value mod='text'>{text(part(row, 'content').body)}</Value>
            </Body>
            <Section.Sub>
              <a
                href={io.link(head)}
                title={text(part(row, 'prompt').revision)}
              >
                Stored version
              </a>
              {at && <>· {io.when(at)}</>}
              {' · '}
              <a href={io.find(`.cites .edge.from=${head}`)}>Evidence</a>
            </Section.Sub>
          </>
        )
        : answer.error
        ? <Section.Note mod='refused'>{answer.error}</Section.Note>
        : !answer.ready
        ? <Loading />
        : <Section.Sub>Stored context unavailable.</Section.Sub>}
    </Section>
  )
}

let Neighbors = ({
  label,
  answer,
  incoming,
  eid,
  io,
}: {
  label: string
  answer: Answer
  incoming: boolean
  eid: string
  io: Io
}) => {
  let ids = [
    ...new Set(
      answer.rows.map((row) =>
        text(part(row, 'edge')[incoming ? 'from' : 'to'])
      ),
    ),
  ].filter((id) => id && id != eid)
  let peers = io.ask(
    ids.length
      ? {
        peers: `.topic .entity.eid=${ids.join(',')} ?doc ?topic_context`,
      }
      : {},
  ).peers ?? { rows: [], ready: true }
  let tags = names(io.vocab)
  return (
    <Section data-section={incoming ? 'incoming-topics' : 'outgoing-topics'}>
      <Section.Title>{label}</Section.Title>
      <State answer={answer} empty='No links.' />
      <Rows>
        {answer.rows.flatMap((edge) => {
          let id = text(part(edge, 'edge')[incoming ? 'from' : 'to'])
          let peer = peers.rows.find((row) =>
            row.entity.eid == id
          )
          let relation = Object.keys(tags).filter((tag) => edge[tag]).join(', ')
          return peer
            ? [
              <Rows.Item key={edge.entity.eid}>
                <Section.Sub>
                  <a href={io.link(edge.entity.eid)}>
                    {incoming
                      ? `${relation} → this topic`
                      : `this topic → ${relation}`}
                  </a>
                </Section.Sub>
                {io.show(peer, 'List.Tile')}
              </Rows.Item>,
            ]
            : []
        })}
      </Rows>
      {ids.length > 0 && !peers.ready && <Loading />}
      {peers.error && <Section.Note mod='refused'>{peers.error}</Section.Note>}
      {answer.rows.length >= 100 && (
        <Section.Sub>
          Showing the first 100 links.{' '}
          <a href={io.find(`.edge.${incoming ? 'to' : 'from'}=${eid}`)}>
            All links
          </a>
        </Section.Sub>
      )}
    </Section>
  )
}

export let Topic = ({ e, got, io }: Props) => {
  let kept = part(e, 'topic_context')
  let ids = [...new Set(slots.map((slot) => text(kept[slot])).filter(Boolean))]
  let heads = io.ask(
    ids.length
      ? {
        heads: `.entity.eid=${
          ids.join(',')
        } .fields=content.body,prompt.source,prompt.revision,created.at`,
      }
      : {},
  ).heads ?? { rows: [], ready: true }
  return (
    <>
      <Head>
        <Head.Title>{title(e)}</Head.Title>
        <Head.Sub>Topic</Head.Sub>
      </Head>
      <Section data-section='advertisement'>
        <Section.Title>Advertisement</Section.Title>
        <Body>
          <Value mod='text'>{text(part(e, 'doc').body)}</Value>
        </Body>
      </Section>
      {slots.map((slot) => (
        <Context
          key={slot}
          slot={slot}
          head={text(kept[slot])}
          answer={heads}
          io={io}
        />
      ))}
      {io.show(e, 'Oracle.Query')}
      <Conversations answer={got.dialogues} io={io} />
      <Neighbors
        label='Outgoing topics'
        answer={got.outgoing}
        incoming={false}
        eid={e.entity.eid}
        io={io}
      />
      <Neighbors
        label='Incoming topics'
        answer={got.incoming}
        incoming
        eid={e.entity.eid}
        io={io}
      />
    </>
  )
}

export let TopicTile = ({ e, got, io }: Props) => {
  let topic = got?.face?.rows[0] ?? e
  return (
    <Tile mod='detail' href={`${io.link(e.entity.eid)}?v=Oracle`}>
      <Tile.Kind>Topic</Tile.Kind>
      <Tile.Title mod='wrap'>{title(topic)}</Tile.Title>
      <Tile.Sub mod='wrap'>{text(part(topic, 'doc').body)}</Tile.Sub>
      <Tile.End>Open →</Tile.End>
    </Tile>
  )
}
