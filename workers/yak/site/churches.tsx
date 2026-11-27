/** @jsxImportSource react */
// The landing page for a church office (variant.ts `church`): what a church
// gets in the words its office uses, what yaks.app has built for one, and the
// one plan a church pays for. Only its own address shows it, which is where an
// ad for churches points, so that address is its canonical one. Its box is the
// home page's, a first build with no sign-up, asking for the web address of
// the site the church has now: the Operator reads it and builds theirs from
// it (newcomer.ts `worded`, `rebuilding`). Words typed in the box are built as
// an idea, as the home page's are.
//
// The about 3 minutes its copy says a church's site takes, from the button to
// the Operator saying it is live, is two live builds of a church's own site:
// 2 minutes 50 seconds through this page's box, and 3 minutes 40 seconds
// before the Operator was told how (newcomer.ts `rebuilding`). The page first
// showed after 83 and 81 seconds.
import type { ReactElement } from 'react'
import { Button, Card, Field, Form } from '@yaks/ui'
import { GET_PLAN } from '@yaks/platform/routes'
import { START } from '../newcomer.ts'
import { Page, Yours } from './frame.tsx'
import { attr, type Slots, text } from './copy.ts'
import { SupportContract } from './home.tsx'

/** Where the page lives. */
export let PATH = '/churches'

// A plan's card: its price, its note, its list and its button, each item a
// snippet's key and the slots it takes.
let Plan = (
  { mod, price, note, items, go }: {
    mod?: string
    price: string
    note: string
    items: Array<[string, Slots?]>
    go: ReactElement
  },
) => (
  <Card as='div' className={mod ? `Plan ${mod}` : 'Plan'}>
    <h3
      className='Plan_Price'
      {...text(price, {
        per: <span className='Plan_Per' {...text('home.cost.per')} />,
      })}
    />
    <p className='Note Note-small' {...text(note)} />
    <ul className='Plan_List'>
      {items.map(([item, slots]) => (
        <li className='Plan_Item' {...text(item, slots)} />
      ))}
    </ul>{' '}
    {go}
  </Card>
)

let yours = <Yours name='yourchurch' />
let domain = <b {...text('churches.cost.example')} />

export let Churches = () => (
  <Page
    copy='churches'
    path={PATH}
    kind='Home'
    head={<script src='cta.js' defer />}
  >
    <section className='Hello' aria-labelledby='hello'>
      <div className='Hello_Copy'>
        <p className='Hello_Kicker' {...text('churches.hello.kicker')} />
        <h1 className='Title Title-hero' id='hello'>
          <label for='say' {...text('churches.hello.title')} />
        </h1>
        <p className='Note' {...text('churches.hello.note')} />
        <form className='Hello_Ask' method='post' action={START}>
          <Form.Hidden name='org' value='church' />
          <Field
            className='Hello_Field Hello_Field-line'
            id='say'
            name='say'
            required
            maxLength={4000}
            autocapitalize='none'
            autocorrect='off'
            spellcheck={false}
            enterkeyhint='go'
            {...attr('placeholder', 'churches.hello.hint')}
          />
          <Button
            mod='go'
            type='submit'
            data-cta='start'
            {...text('churches.hello.go')}
          />
        </form>
        <p className='Note Note-small' {...text('churches.hello.try')} />
      </div>
    </section>
    <section className='How' aria-labelledby='how'>
      <h2 className='Title' id='how' {...text('churches.how.title')} />
      <ol className='Steps'>
        {['watch', 'keep', 'ask', 'private'].map((step) => (
          <li className='Steps_Item'>
            <h3 className='Step_Name' {...text(`churches.how.${step}.name`)} />
            <p className='Note' {...text(`churches.how.${step}.detail`)} />
          </li>
        ))}
      </ol>
    </section>
    <section className='Yours' aria-labelledby='built'>
      <h2 className='Title' id='built' {...text('churches.built.title')} />
      <dl className='Yours_List'>
        {Object.entries<Slots>({
          forms: {},
          directory: {
            sample: (
              <a
                href='https://yourname.yaks.app/directory/'
                data-cta='examples'
                {...text('churches.built.directory.sample', {
                  arrow: <span aria-hidden='true'>↗</span>,
                })}
              />
            ),
          },
          calendar: {},
        }).map(([item, slots]) => (
          <div>
            <dt
              className='Yours_Term'
              {...text(`churches.built.${item}.term`)}
            />
            <dd
              className='Yours_Detail'
              {...text(`churches.built.${item}.detail`, slots)}
            />
          </div>
        ))}
      </dl>
    </section>
    <section className='Cost' aria-labelledby='cost'>
      <h2 className='Title' id='cost' {...text('churches.cost.title')} />
      <p className='Note' {...text('churches.cost.note', { yours, domain })} />
      <div className='Plans'>
        <Plan
          price='home.cost.free.price'
          note='churches.cost.free.note'
          items={[
            ['home.cost.free.ai'],
            ['home.cost.free.apps'],
            ['home.cost.free.visitors'],
            ['home.cost.free.address', { yours }],
          ]}
          go={<Button mod='go' href='/login' {...text('home.cost.free.go')} />}
        />
        <Plan
          mod='Plan-pro'
          price='home.cost.pro.price'
          note='home.cost.pro.note'
          items={[
            ['home.cost.pro.credit'],
            ['home.cost.pro.ai'],
            ['home.cost.pro.apps'],
            ['churches.cost.pro.invited'],
            ['home.cost.pro.domain'],
            ['home.cost.pro.change'],
          ]}
          go={
            <Button
              mod='go'
              href={GET_PLAN}
              data-cta='pro'
              {...text('home.cost.pro.go')}
            />
          }
        />
      </div>
      <p
        className='Note Note-small'
        {...text('churches.cost.limits', {
          plans: <a href='/pricing' {...text('home.cost.plans')} />,
          behind: (
            <a
              href='/organizations#behind'
              {...text('churches.cost.behind')}
            />
          ),
        })}
      />
      <SupportContract />
    </section>
    <Card className='Join' aria-labelledby='join'>
      <h2 className='Title' id='join' {...text('churches.join.title')} />
      <p className='Join_Doors'>
        <Button
          mod='go'
          href='#say'
          data-cta='join'
          {...text('churches.join.go')}
        />
      </p>
      <p className='Note Note-small' {...text('churches.join.note')} />
    </Card>
  </Page>
)
