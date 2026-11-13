/** @jsxImportSource preact */
// The landing page for an organization's office (variant.ts `organization`):
// a church, a club, a town office or a small business that has a website and
// nobody on staff to look after it. It pitches the Pro plan as a web person
// on staff, and says what the office asked of that pitch: what the
// organization gets, who is behind it and who fixes its mistakes. Only its
// own address shows it, so that address is its canonical one.
//
// Its box is the churches page's, a first build with no sign-up from the web
// address of the site they have now (newcomer.ts `worded`, `REBUILDING`).
// Everything it promises is read from where it is done: the forms, directory
// and calendar from forms.ts, @yaks/people and calendar.ts; errors, the
// kept versions and the restores from docs/errors.md; support from
// support.ts; the numbers its copy says from meter.ts, versions.ts, recover.ts
// and directory.ts.
import type { ComponentChildren } from 'preact'
import { Button, Card, Field, Form } from '@yaks/ui'
import { GET_PLAN } from '@yaks/platform/routes'
import { START } from '../newcomer.ts'
import { PRICE } from '../meter.ts'
import { Page } from './frame.tsx'
import { attr, type Slots, text } from './copy.ts'

/** Where the page lives. */
export let PATH = '/organizations'

/** What a person types what they pay for, each a tool the Pro plan's site
 * holds in its place. */
let PAID = ['website', 'forms', 'directory', 'calendar']

let sample = (slug: string, key: string) => (
  <a
    href={`https://yourname.yaks.app/${slug}/`}
    data-cta='examples'
    {...text(key, { arrow: <span aria-hidden='true'>↗</span> })}
  />
)

let domain = <b {...text('organizations.example')} />

// The exchange the page shows took place: an email sent to the demo space's
// assistant on 2026-11-11 about its visitor card
// (https://yourname.yaks.app/visitors/), and the answer that came back 39
// seconds later, each word for word. The people in it are made up. To show
// another, email yourname@yaks.app from a member's address and copy both
// letters from the mailbox they arrive in into the copy.
let ASKED = 'organizations.letters.asked'
let ANSWERED = 'organizations.letters.answered'

// A letter as its reader got it, each part a snippet under `letter`: who sent
// it, its subject and addresses, and its body, drawn as @yaks/mail `html`
// draws a letter's markdown.
let Letter = (
  { letter, back, children }: {
    letter: string
    back?: boolean
    children: ComponentChildren
  },
) => (
  <Card as='div' class={`Letter${back ? ' Letter-back' : ''}`}>
    <p class='Letter_By' {...text(`${letter}.by`)} />
    <p
      class='Letter_Head'
      {...text(`${letter}.head`, {
        subject: <b {...text(`${letter}.subject`)} />,
        line: <br />,
      })}
    />
    <div class='Letter_Body'>{children}</div>
  </Card>
)

export let Organizations = () => (
  <Page
    copy='organizations'
    path={PATH}
    kind='Home'
    head={
      <>
        <script src='cta.js' defer />
        <script src='saving.js' defer />
      </>
    }
  >
    <section class='Hello' aria-labelledby='hello'>
      <div class='Hello_Copy'>
        <p class='Hello_Kicker' {...text('organizations.hello.kicker')} />
        <h1
          class='Title Title-hero'
          id='hello'
          {...text('organizations.hello.title')}
        />
        <p class='Note' {...text('organizations.hello.note')} />
        <Form method='post' action={START} id='start'>
          <input type='hidden' name='org' value='organization' />
          <Form.Field>
            <Form.Label for='say' {...text('organizations.hello.label')} />
            <Form.Line>
              <Field
                id='say'
                name='say'
                required
                maxLength={4000}
                autocapitalize='none'
                autocorrect='off'
                spellcheck={false}
                enterkeyhint='go'
                aria-describedby='try'
                {...attr('placeholder', 'organizations.hello.hint')}
              />
              <Button
                mod='go'
                type='submit'
                data-cta='start'
                {...text('organizations.hello.go')}
              />
            </Form.Line>
            <Form.Hint id='try' {...text('organizations.hello.try')} />
          </Form.Field>
        </Form>
      </div>
      <div class='Letters' role='group' aria-labelledby='asked'>
        <p
          class='Note Note-small'
          id='asked'
          {...text('organizations.letters.title')}
        />
        <Letter letter={ASKED}>
          <p {...text(`${ASKED}.body`)} />
        </Letter>
        <Letter letter={ANSWERED} back>
          <p {...text(`${ANSWERED}.done`)} />
          <p {...text(`${ANSWERED}.waiting`)} />
          <ul>
            <li>
              <strong {...text(`${ANSWERED}.visitor.name`)} />
            </li>
            {['phone', 'email', 'note'].map((field) => (
              <li {...text(`${ANSWERED}.visitor.${field}`)} />
            ))}
          </ul>
          <p {...text(`${ANSWERED}.sign`, { line: <br /> })} />
        </Letter>
      </div>
    </section>
    <section class='Yours' aria-labelledby='missing'>
      <h2 class='Title' id='missing' {...text('organizations.missing.title')} />
      <dl class='Yours_List'>
        {Object.entries<Slots>({
          forms: {
            sample: sample('potluck', 'organizations.missing.forms.sample'),
          },
          directory: {
            sample: sample(
              'directory',
              'organizations.missing.directory.sample',
            ),
          },
          calendar: {},
        }).map(([item, slots]) => (
          <div>
            <dt
              class='Yours_Term'
              {...text(`organizations.missing.${item}.term`)}
            />
            <dd
              class='Yours_Detail'
              {...text(`organizations.missing.${item}.detail`, slots)}
            />
          </div>
        ))}
      </dl>
      <p class='Note Note-small' {...text('organizations.missing.note')} />
    </section>
    <section class='How' aria-labelledby='together'>
      <h2
        class='Title'
        id='together'
        {...text('organizations.together.title')}
      />
      <p class='Note' {...text('organizations.together.note')} />
      <ul class='Plan_List'>
        {['form', 'added', 'calendar'].map((item) => (
          <li
            class='Plan_Item'
            {...text(`organizations.together.${item}`)}
          />
        ))}
      </ul>
    </section>
    <section class='Cost' aria-labelledby='saving'>
      <h2 class='Title' id='saving' {...text('organizations.saving.title')} />
      <p class='Note' {...text('organizations.saving.note')} />
      <Form
        as='div'
        class='Saving'
        data-saving={PRICE.pro}
        {...attr('data-less', 'organizations.saving.less')}
        {...attr('data-same', 'organizations.saving.same')}
        hidden
      >
        <p
          class='Form_Label'
          id='paying'
          {...text('organizations.saving.paying')}
        />
        <div class='Saving_Fields' role='group' aria-labelledby='paying'>
          {PAID.map((name) => (
            <Form.Field>
              <Form.Label
                for={`pay-${name}`}
                {...text(`organizations.saving.paid.${name}`)}
              />
              <Field
                id={`pay-${name}`}
                type='number'
                inputmode='decimal'
                min='0'
                step='any'
                {...attr('placeholder', 'organizations.saving.hint')}
              />
            </Form.Field>
          ))}
        </div>
        <output class='Saving_Said' aria-live='polite' />
        <Form.Hint {...text('organizations.saving.private')} />
      </Form>
    </section>
    <section class='How' aria-labelledby='how'>
      <h2 class='Title' id='how' {...text('organizations.how.title')} />
      <ol class='Steps'>
        {Object.entries<Slots>({
          start: {},
          ask: {},
          online: { domain },
        }).map(([step, slots]) => (
          <li class='Steps_Item'>
            <h3 class='Step_Name' {...text(`organizations.how.${step}.name`)} />
            <p
              class='Note'
              {...text(`organizations.how.${step}.detail`, slots)}
            />
          </li>
        ))}
      </ol>
    </section>
    <section class='Yours' aria-labelledby='behind'>
      <h2 class='Title' id='behind' {...text('organizations.behind.title')} />
      <p class='Note' {...text('organizations.behind.note')} />
      <dl class='Yours_List Yours_List-pairs'>
        {Object.entries<Slots>({
          broken: {},
          ours: {},
          wrong: {},
          back: {},
          yours: {
            privacy: (
              <a
                href='/privacy'
                {...text('organizations.behind.yours.privacy')}
              />
            ),
          },
          write: {
            mail: <a href='mailto:hello@yaks.app'>hello@yaks.app</a>,
          },
        }).map(([item, slots]) => (
          <div>
            <dt
              class='Yours_Term'
              {...text(`organizations.behind.${item}.term`)}
            />
            <dd
              class='Yours_Detail'
              {...text(`organizations.behind.${item}.detail`, slots)}
            />
          </div>
        ))}
      </dl>
    </section>
    <section class='Cost' aria-labelledby='cost'>
      <h2 class='Title' id='cost' {...text('organizations.cost.title')} />
      <div class='Plans'>
        <Card as='div' class='Plan Plan-pro'>
          <h3
            class='Plan_Price'
            {...text('home.cost.pro.price', {
              per: <span class='Plan_Per' {...text('home.cost.per')} />,
            })}
          />
          <p class='Note Note-small' {...text('organizations.cost.note')} />
          <ul class='Plan_List'>
            {Object.entries<Slots>({
              asks: {},
              people: {},
              domain: { domain },
              ai: {},
              emails: {},
              support: {},
            }).map(([item, slots]) => (
              <li
                class='Plan_Item'
                {...text(`organizations.cost.${item}`, slots)}
              />
            ))}
          </ul>{' '}
          <Button
            mod='go'
            href={GET_PLAN}
            data-cta='pro'
            {...text('home.cost.pro.go')}
          />
        </Card>
      </div>
      <p
        class='Note Note-small'
        {...text('organizations.cost.limits', {
          plans: <a href='/pricing' {...text('organizations.cost.plans')} />,
        })}
      />
    </section>
    <Card class='Join' aria-labelledby='join'>
      <h2 class='Title' id='join' {...text('organizations.join.title')} />
      <p class='Join_Doors'>
        <Button
          mod='go'
          href='#say'
          data-cta='join'
          {...text('organizations.join.go')}
        />
      </p>
      <p class='Note Note-small' {...text('organizations.join.note')} />
    </Card>
  </Page>
)
