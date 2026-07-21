import { type Ent, statuses } from '../../types.ts'
import { type Col, edgeLines, schema } from '../../schema.ts'
import { block } from '../ui.tsx'

// The Schema view: the vocabulary rendered AT RUNTIME from the very
// structures the code runs on (schema.ts over types.ts), so what it shows
// is what is — a hot-swap updates it with the code, and there is nothing
// to fall behind. Effects aren't here: their registry fills at server
// boot, and the browser only sees the boot-written Vocabulary doc body
// (this view's Show neighbor), which carries them.

let Frame = block('div', 'Schema', {
  Lede: 'p',
  Head: 'h3',
  Comp: 'section',
  Name: 'h4',
  Cols: 'div',
  Col: 'span',
  Type: 'span',
  Death: 'span',
  Tag: 'p',
  Line: 'p',
})
let { Lede, Head, Comp, Name, Cols, Col, Type, Death, Tag, Line } = Frame

// One column row: name, what it is, the death word when it's a
// reference, dimmed whole when the server owns it.
let ColRow = ({ c }: { c: Col }) => (
  <>
    <Col mod={c.stamped && 'stamped'}>{c.col}</Col>
    <Type mod={c.stamped && 'stamped'}>
      {c.type}
      {c.stamped && ' ⚙'}
      {c.death && <Death mod={c.death}>{c.death}</Death>}
    </Type>
  </>
)

export let Schema = ({ e: _e }: { e: Ent }) => (
  <Frame>
    <Lede>
      The vocabulary, read from the running code. ⚙ is server-stamped — never
      wire-writable. A → column is a reference; its death word says what happens
      when the target dies: <Death mod='cascade'>cascade</Death>{' '}
      the row's entity dies too, <Death mod='detach'>detach</Death>{' '}
      the column nulls, <Death mod='release'>release</Death>{' '}
      the row dies but its entity lives, <Death mod='keep'>keep</Death>{' '}
      the reference stands as history.
    </Lede>
    {schema().map(({ comp, cols }) => (
      <Comp key={comp}>
        <Name>{comp}</Name>
        {cols.length
          ? (
            <Cols>
              {cols.map((c) => <ColRow key={c.col} c={c} />)}
            </Cols>
          )
          : <Tag>a tag — the row is the statement</Tag>}
      </Comp>
    ))}
    <Head>edges</Head>
    {edgeLines.map((s) => <Line key={s}>{s}</Line>)}
    <Head>task statuses</Head>
    <Line>{statuses.join(' → ')}</Line>
  </Frame>
)
