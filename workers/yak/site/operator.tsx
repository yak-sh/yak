/** @jsxImportSource preact */
// The home page that pitches the Operator (kept-page.ts OPERATOR): its first
// step is a number, which /login texts a code to, and the code lands a new
// person in their own space's chat with their Operator (identity.ts
// `backTo`). A number can be texted only once the platform texts strangers
// (phones.ts `textable`, off until the toll-free verification covers it,
// T-138775), so the page is drawn twice and Site serves the one that holds:
// asking for a number (`by='text'`), or for an email with that said beside it
// (`by='email'`). It is a home page of the split (variant.ts), served at `/`
// as well as its own address, so its canonical address is the home page's.
import { Button, Card, Field, Form } from '@yaks/ui'
import { Page, Yours } from './frame.tsx'
import { Examples } from './home.tsx'
import { Idle } from '../mascot.ts'
import { FREE, PRICE } from '../meter.ts'
import { CODE_NOTE } from '../signin.ts'

type By = 'text' | 'email'

let ASK = {
  text: {
    label: 'Start with your mobile number',
    field: (
      <Field
        id='address'
        name='address'
        type='tel'
        required
        autocomplete='tel'
        inputmode='tel'
        placeholder='269-555-0142'
        aria-describedby='by'
      />
    ),
    send: 'Text me a code',
    hint: (
      <>
        {CODE_NOTE} Terms: <a href='/terms'>yaks.app/terms</a> Privacy:{' '}
        <a href='/privacy'>yaks.app/privacy</a>
      </>
    ),
    first: ['We text you a code', 'Type its six digits on the next page.'],
    again: 'Start with your number',
  },
  email: {
    label: 'Start with your email',
    field: (
      <Field
        id='address'
        name='address'
        type='email'
        required
        autocomplete='email'
        placeholder='you@example.com'
        aria-describedby='by'
      />
    ),
    send: 'Email me a code',
    hint: (
      <>
        Signing up by text is not open yet, so we email your code. Once you are
        in, add your mobile number in your Operator's settings to text and call
        it.
      </>
    ),
    first: [
      'We email you a code',
      'Type its six digits on the next page, or press the link in the email.',
    ],
    again: 'Start with your email',
  },
}

export let Operator = ({ by }: { by: By }) => {
  let ask = ASK[by]
  return (
    <Page
      name='yaks.app — get an Operator that builds apps for you'
      title='yaks.app — get an Operator that builds apps for you'
      description='Get an Operator that builds apps for you. Tell it what you need, and it builds the app and puts it online at your own address.'
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
            <Idle base='.' />
          </div>
          <p class='Hello_Kicker'>Build, host and share web apps</p>
          <h1 class='Title Title-hero' id='hello'>
            Get an Operator that builds apps for you.
          </h1>
          <p class='Note Note-lead'>
            Tell it what you need, and it builds the app and puts it online at
            your own address.
          </p>
          <Form method='post' action='/login' id='start'>
            <Form.Field>
              <Form.Label for='address'>{ask.label}</Form.Label>
              <Form.Line>
                {ask.field}
                <Button mod='go' type='submit' data-cta='start'>
                  {ask.send}
                </Button>
              </Form.Line>
              <Form.Hint id='by'>{ask.hint}</Form.Hint>
            </Form.Field>
          </Form>
          <p class='Note Note-small'>
            Free to start, or <a href='#cost'>${PRICE.plus} a month</a>{' '}
            for more.
          </p>
        </div>
        <Examples>
          Your Operator can make apps like these. Open one to try it.{' '}
          <a href='/gallery'>See more in the gallery</a>.
        </Examples>
      </section>
      <section class='How' aria-labelledby='how'>
        <h2 class='Title' id='how'>From your first step to your first app</h2>
        <ol class='Steps'>
          <li>
            <h3 class='Step_Name'>{ask.first[0]}</h3>
            <p class='Note'>
              {ask.first[1]}{' '}
              There is no password to make and nothing to install.
            </p>
          </li>
          <li>
            <h3 class='Step_Name'>You meet your Operator</h3>
            <p class='Note'>
              You land in your own space, an address like <Yours />{' '}
              where your apps live, in a chat with your Operator.
            </p>
          </li>
          <li>
            <h3 class='Step_Name'>Ask for the app you want</h3>
            <p class='Note'>
              Like a chore chart for your household. Your Operator builds it and
              puts it online. Open it on any phone or computer, or send its link
              to the people it's for.
            </p>
          </li>
        </ol>
      </section>
      <section class='Yours' aria-labelledby='does'>
        <h2 class='Title' id='does'>What your Operator does for you</h2>
        <dl class='Yours_List'>
          <div>
            <dt>It changes and fixes your apps</dt>
            <dd>
              Ask for a new feature or a fix any time, and your Operator makes
              the change.
            </dd>
          </div>
          <div>
            <dt>You can text it or call it</dt>
            <dd>
              Agree to texts in its settings, then text or call your Operator
              from your phone. It texts you when it finishes a change or needs
              an answer from you.
            </dd>
          </div>
          <div>
            <dt>You choose who comes in</dt>
            <dd>
              Keep an app to yourself, share it with a link, or invite people to
              view or edit it, free.
            </dd>
          </div>
        </dl>
      </section>
      <section class='Cost' aria-labelledby='cost'>
        <h2 class='Title' id='cost'>
          Free to start, ${PRICE.plus} a month for more
        </h2>
        <p class='Note'>
          Your first space is free, with {FREE.apps}{' '}
          apps and your Operator. The Plus plan is ${PRICE.plus}{' '}
          a month for each space, with unlimited apps and your own domain.{' '}
          <a href='/pricing'>Compare plans and limits</a>.
        </p>
      </section>
      <Card class='Join' aria-labelledby='join'>
        <h2 class='Title' id='join'>
          What would you like your Operator to make?
        </h2>
        <p class='Join_Doors'>
          <Button mod='go' href='#start' data-cta='join'>
            {ask.again}
          </Button>
        </p>
        <p class='Note Note-small'>Free to start.</p>
      </Card>
    </Page>
  )
}
