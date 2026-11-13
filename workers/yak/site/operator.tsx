/** @jsxImportSource preact */
// The home page that pitches the Operator (kept-page.ts OPERATOR): its first
// step is a number, which /login texts a code to, and the code lands a new
// person in their own space's chat with their Operator (identity.ts
// `backTo`). A number can be texted only once the platform texts strangers
// (phones.ts `textable`, off until the toll-free verification covers it,
// T-138775), so the page is drawn twice and Site serves the one that holds:
// asking for a number (`by='text'`), or for an email with that said beside it
// (`by='email'`). Each says its own words under `operator.<by>`, and the
// words both say under `operator`. It is a home page of the split
// (variant.ts), served at `/` as well as its own address, so its canonical
// address is the home page's.
import { Button, Card, Field, Form } from '@yaks/ui'
import { attr, type Slots, text } from './copy.ts'
import { Page, Yours } from './frame.tsx'
import { Examples } from './home.tsx'
import { Idle } from '../mascot.ts'
import type { VNode } from 'preact'

type By = 'text' | 'email'

// What each way in asks for: its box, and the links its hint names.
let ASK: Record<By, { field: VNode; hint: Slots }> = {
  text: {
    field: (
      <Field
        id='address'
        name='address'
        type='tel'
        required
        autocomplete='tel'
        inputmode='tel'
        {...attr('placeholder', 'operator.text.placeholder')}
        aria-describedby='by'
      />
    ),
    hint: {
      terms: <a href='/terms' {...text('operator.text.terms')} />,
      privacy: <a href='/privacy' {...text('operator.text.privacy')} />,
    },
  },
  email: {
    field: (
      <Field
        id='address'
        name='address'
        type='email'
        required
        autocomplete='email'
        {...attr('placeholder', 'operator.email.placeholder')}
        aria-describedby='by'
      />
    ),
    hint: {},
  },
}

export let Operator = ({ by }: { by: By }) => {
  let ask = ASK[by]
  let own = (key: string) => `operator.${by}.${key}`
  return (
    <Page
      copy='operator'
      path='/'
      kind='Home'
      head={
        <>
          <script src='cta.js' defer />
          <script src='carousel.js' defer />
          <script src='wander.js' defer />
        </>
      }
    >
      <section class='Hello' aria-labelledby='hello'>
        <div class='Hello_Copy'>
          <div class='Hello_Yak' data-wander=''>
            <Idle class='Wander_Image' base='.' />
          </div>
          <p class='Hello_Kicker' {...text('operator.hello.kicker')} />
          <h1 class='Title Title-hero' id='hello'>
            <label for='address' {...text(own('label'))} />
          </h1>
          <Form method='post' action='/login' id='start'>
            <Form.Field>
              <Form.Line>
                {ask.field}
                <Button
                  mod='go'
                  type='submit'
                  data-cta='start'
                  {...text(own('send'))}
                />
              </Form.Line>
              <Form.Hint id='by' {...text(own('hint'), ask.hint)} />
            </Form.Field>
          </Form>
          <p
            class='Note Note-small'
            {...text('operator.hello.note', {
              price: <a href='#cost' {...text('operator.hello.price')} />,
            })}
          />
        </div>
        <Examples
          note='operator.examples.note'
          slots={{
            gallery: <a href='/gallery' {...text('home.examples.gallery')} />,
          }}
        />
      </section>
      <section class='How' aria-labelledby='how'>
        <h2 class='Title' id='how' {...text('operator.how.title')} />
        <ol class='Steps'>
          {Object.entries<Slots>({
            [own('first')]: {},
            'operator.how.meet': { yours: <Yours /> },
            'operator.how.ask': {},
          }).map(([step, slots]) => (
            <li class='Steps_Item'>
              <h3 class='Step_Name' {...text(`${step}.name`)} />
              <p class='Note' {...text(`${step}.detail`, slots)} />
            </li>
          ))}
        </ol>
      </section>
      <section class='Yours' aria-labelledby='does'>
        <h2 class='Title' id='does' {...text('operator.does.title')} />
        <dl class='Yours_List'>
          {['changes', 'calls', 'share'].map((item) => (
            <div>
              <dt class='Yours_Term' {...text(`operator.does.${item}.term`)} />
              <dd
                class='Yours_Detail'
                {...text(`operator.does.${item}.detail`)}
              />
            </div>
          ))}
        </dl>
      </section>
      <section class='Cost' aria-labelledby='cost'>
        <h2 class='Title' id='cost' {...text('operator.cost.title')} />
        <p
          class='Note'
          {...text('operator.cost.note', {
            plans: <a href='/pricing' {...text('home.cost.plans')} />,
          })}
        />
      </section>
      <Card class='Join' aria-labelledby='join'>
        <h2 class='Title' id='join' {...text('operator.join.title')} />
        <p class='Join_Doors'>
          <Button
            mod='go'
            href='#start'
            data-cta='join'
            {...text(own('again'))}
          />
        </p>
        <p class='Note Note-small' {...text('home.join.note')} />
      </Card>
    </Page>
  )
}
