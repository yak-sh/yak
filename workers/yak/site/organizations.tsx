/** @jsxImportSource react */
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
import type { ReactNode } from 'react'
import { Button, Card, Field, Form } from '@yaks/ui'
import { GET_PLAN } from '@yaks/platform/routes'
import { START } from '../newcomer.ts'
import { PRICE } from '@yaks/platform/plans'
import { Page } from './frame.tsx'
import { attr, list, type Slots, text } from './copy.ts'
import { SupportContract } from './home.tsx'

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
    children: ReactNode
  },
) => (
  <Card as='div' className={`Letter${back ? ' Letter-back' : ''}`}>
    <p className='Letter_By' {...text(`${letter}.by`)} />
    <p
      className='Letter_Head'
      {...text(`${letter}.head`, {
        subject: <b {...text(`${letter}.subject`)} />,
        line: <br />,
      })}
    />
    <div className='Letter_Body'>{children}</div>
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
    <section className='Hello' aria-labelledby='hello'>
      <div className='Hello_Copy'>
        <p className='Hello_Kicker' {...text('organizations.hello.kicker')} />
        <h1
          className='Title Title-hero'
          id='hello'
          {...text('organizations.hello.title')}
        />
        <p className='Note' {...text('organizations.hello.note')} />
        <Form method='post' action={START} id='start'>
          <Form.Hidden name='org' value='organization' />
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
      <div className='Letters' role='group' aria-labelledby='asked'>
        <p
          className='Note Note-small'
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
    <section className='Yours' aria-labelledby='missing'>
      <h2
        className='Title'
        id='missing'
        {...text('organizations.missing.title')}
      />
      <dl className='Yours_List'>
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
              className='Yours_Term'
              {...text(`organizations.missing.${item}.term`)}
            />
            <dd
              className='Yours_Detail'
              {...text(`organizations.missing.${item}.detail`, slots)}
            />
          </div>
        ))}
      </dl>
      <p className='Note Note-small' {...text('organizations.missing.note')} />
    </section>
    <section className='How' aria-labelledby='together'>
      <h2
        className='Title'
        id='together'
        {...text('organizations.together.title')}
      />
      <p className='Note' {...text('organizations.together.note')} />
      <ul
        className='Plan_List'
        {...list(
          'organizations.together.items',
          (says) => <li className='Plan_Item'>{says}</li>,
        )}
      />
    </section>
    <section className='Cost' aria-labelledby='saving'>
      <h2
        className='Title'
        id='saving'
        {...text('organizations.saving.title')}
      />
      <p className='Note' {...text('organizations.saving.note')} />
      <Form
        as='div'
        className='Saving'
        data-saving={PRICE.pro}
        {...attr('data-less', 'organizations.saving.less')}
        {...attr('data-same', 'organizations.saving.same')}
        hidden
      >
        <p
          className='Form_Label'
          id='paying'
          {...text('organizations.saving.paying')}
        />
        <div className='Saving_Fields' role='group' aria-labelledby='paying'>
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
        <output className='Saving_Said' aria-live='polite' />
        <Form.Hint {...text('organizations.saving.private')} />
      </Form>
    </section>
    <section className='How' aria-labelledby='how'>
      <h2 className='Title' id='how' {...text('organizations.how.title')} />
      <ol className='Steps'>
        {Object.entries<Slots>({
          start: {},
          ask: {},
          online: { domain },
        }).map(([step, slots]) => (
          <li className='Steps_Item'>
            <h3
              className='Step_Name'
              {...text(`organizations.how.${step}.name`)}
            />
            <p
              className='Note'
              {...text(`organizations.how.${step}.detail`, slots)}
            />
          </li>
        ))}
      </ol>
    </section>
    <section className='Yours' aria-labelledby='behind'>
      <h2
        className='Title'
        id='behind'
        {...text('organizations.behind.title')}
      />
      <p className='Note' {...text('organizations.behind.note')} />
      <dl className='Yours_List Yours_List-pairs'>
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
              className='Yours_Term'
              {...text(`organizations.behind.${item}.term`)}
            />
            <dd
              className='Yours_Detail'
              {...text(`organizations.behind.${item}.detail`, slots)}
            />
          </div>
        ))}
      </dl>
    </section>
    <section className='Cost' aria-labelledby='cost'>
      <h2 className='Title' id='cost' {...text('organizations.cost.title')} />
      <div className='Plans'>
        <Card as='div' className='Plan Plan-pro'>
          <h3
            className='Plan_Price'
            {...text('home.cost.pro.price', {
              per: <span className='Plan_Per' {...text('home.cost.per')} />,
            })}
          />
          <p className='Note Note-small' {...text('organizations.cost.note')} />
          <ul className='Plan_List'>
            {Object.entries<Slots>({
              asks: {},
              people: {},
              domain: { domain },
              ai: {},
              emails: {},
              support: {},
            }).map(([item, slots]) => (
              <li
                className='Plan_Item'
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
        className='Note Note-small'
        {...text('organizations.cost.limits', {
          plans: <a href='/pricing' {...text('organizations.cost.plans')} />,
        })}
      />
      <SupportContract />
    </section>
    <Card className='Join' aria-labelledby='join'>
      <h2 className='Title' id='join' {...text('organizations.join.title')} />
      <p className='Join_Doors'>
        <Button
          mod='go'
          href='#say'
          data-cta='join'
          {...text('organizations.join.go')}
        />
      </p>
      <p className='Note Note-small' {...text('organizations.join.note')} />
    </Card>
  </Page>
)
