import { type Ent } from '../../types.ts'
import { block } from '@yaks/ui'
import { TitleEdit } from '../title.tsx'
import { Edit } from '@yaks/ux'
import { bundle } from '../registry.ts'
import { Entity } from '../Entity.tsx'
import { Id } from './Inline.tsx'

// Historical role configuration and run receipts remain readable after
// operator retirement. Sessions retain their links to the original role.
let Frame = block('div', 'Role', {
  Head: 'h1',
  Title: 'span',
  Meta: 'div',
  Grid: 'div',
  Field: 'div',
  Label: 'span',
})
let { Head, Title, Meta, Grid, Field, Label } = Frame

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
    <Edit
      e={bundle(e)}
      comp={comp}
      prop={prop}
      name={name}
    />
  </Field>
)

export let Role = ({ e }: { e: Ent }) => (
  <Frame>
    <Head>
      <Title>
        <TitleEdit eid={e.eid} />
      </Title>
    </Head>
    <Meta>
      <Id e={e} />
    </Meta>
    <Grid>
      <Config e={e} comp='role' prop='surface' name='surface' />
      <Config e={e} comp='role' prop='scope' name='scope' />
      <Config e={e} comp='spawn' prop='provider' name='provider' />
      <Config e={e} comp='spawn' prop='model' name='model' />
      <Config e={e} comp='spawn' prop='effort' name='effort' />
      <Config e={e} comp='spawn' prop='persona' name='persona' />
    </Grid>
    <Entity eid={e.eid} view='Body' />
    <Entity eid={e.eid} view='Dependencies' />
    <Entity eid={e.eid} view='Relate' />
    <Entity eid={e.eid} view='Runs' />
    <Entity eid={e.eid} view='Comments' />
  </Frame>
)
