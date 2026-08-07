import { type Ent } from '../../types.ts'
import { block, Stamp } from '../ui.tsx'
import { TitleEdit } from '../title.tsx'
import { Prop } from '../editors.tsx'
import { Entity } from '../Entity.tsx'
import { Id } from './Inline.tsx'

// A role is desired capacity, so its face leads with the desired controls and
// the reconciler's receipt. Sessions remain ordinary linked entities below.
let Frame = block('div', 'Role', {
  Head: 'h1',
  State: 'span',
  Title: 'span',
  Meta: 'div',
  Grid: 'div',
  Field: 'div',
  Label: 'span',
  Fault: 'p',
})
let { Head, State, Title, Meta, Grid, Field, Label, Fault } = Frame

let Config = (
  { e, comp, prop, name }: {
    e: Ent
    comp: 'role' | 'spawn'
    prop: string
    name: string
  },
) => (
  <Field>
    <Label>{name}</Label>
    <Prop
      eid={e.eid}
      comp={comp}
      prop={prop}
      name={name}
      editable
    />
  </Field>
)

export let Role = ({ e }: { e: Ent }) => {
  let r = e.role!
  return (
    <Frame>
      <Head>
        <State mod={r.state}>{r.state}</State>
        <Title>
          <TitleEdit eid={e.eid} />
        </Title>
      </Head>
      <Meta>
        <Id e={e} />
        {r.applied_at && <Stamp at={r.applied_at} label='applied' />}
        {r.stopped_at && <Stamp at={r.stopped_at} label='stopped' />}
        {r.applied_hash && <span>{r.applied_hash.slice(0, 8)}</span>}
      </Meta>
      <Grid>
        <Config e={e} comp='role' prop='state' name='state' />
        <Config e={e} comp='role' prop='surface' name='surface' />
        <Config e={e} comp='role' prop='scope_eid' name='project' />
        <Config e={e} comp='spawn' prop='provider' name='provider' />
        <Config e={e} comp='spawn' prop='model' name='model' />
        <Config e={e} comp='spawn' prop='effort' name='effort' />
        <Config e={e} comp='spawn' prop='persona_eid' name='persona' />
      </Grid>
      {e.error?.message && <Fault>{e.error.message}</Fault>}
      <Entity eid={e.eid} view='Body' />
      <Entity eid={e.eid} view='Dependencies' />
      <Entity eid={e.eid} view='Relate' />
      <Entity eid={e.eid} view='Runs' />
      <Entity eid={e.eid} view='Comments' />
    </Frame>
  )
}
