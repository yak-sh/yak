/** @jsxImportSource preact */
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
import type { VNode } from 'preact'
import { Button, Card, Field } from '@yaks/ui'
import { GET_PLAN } from '@yaks/platform/routes'
import { START } from '../newcomer.ts'
import { Page, Yours } from './frame.tsx'
import { attr, type Slots, text } from './copy.ts'

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
    go: VNode
  },
) => (
  <Card as='div' class={mod ? `Plan ${mod}` : 'Plan'}>
    <h3
      class='Plan_Price'
      {...text(price, {
        per: <span class='Plan_Per' {...text('home.cost.per')} />,
      })}
    />
    <p class='Note Note-small' {...text(note)} />
    <ul class='Plan_List'>
      {items.map(([item, slots]) => (
        <li class='Plan_Item' {...text(item, slots)} />
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
    <section class='Hello' aria-labelledby='hello'>
      <div class='Hello_Copy'>
        <p class='Hello_Kicker' {...text('churches.hello.kicker')} />
        <h1 class='Title Title-hero' id='hello'>
          <label for='say' {...text('churches.hello.title')} />
        </h1>
        <p class='Note' {...text('churches.hello.note')} />
        <form class='Hello_Ask' method='post' action={START}>
          <input type='hidden' name='org' value='church' />
          <Field
            class='Hello_Field Hello_Field-line'
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
        <p class='Note Note-small' {...text('churches.hello.try')} />
      </div>
    </section>
    <section class='How' aria-labelledby='how'>
      <h2 class='Title' id='how' {...text('churches.how.title')} />
      <ol class='Steps'>
        {['watch', 'keep', 'ask', 'private'].map((step) => (
          <li class='Steps_Item'>
            <h3 class='Step_Name' {...text(`churches.how.${step}.name`)} />
            <p class='Note' {...text(`churches.how.${step}.detail`)} />
          </li>
        ))}
      </ol>
    </section>
    <section class='Yours' aria-labelledby='built'>
      <h2 class='Title' id='built' {...text('churches.built.title')} />
      <dl class='Yours_List'>
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
            <dt class='Yours_Term' {...text(`churches.built.${item}.term`)} />
            <dd
              class='Yours_Detail'
              {...text(`churches.built.${item}.detail`, slots)}
            />
          </div>
        ))}
      </dl>
    </section>
    <section class='Cost' aria-labelledby='cost'>
      <h2 class='Title' id='cost' {...text('churches.cost.title')} />
      <p class='Note' {...text('churches.cost.note', { yours, domain })} />
      <div class='Plans'>
        <Plan
          price='home.cost.free.price'
          note='churches.cost.free.note'
          items={[
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
            ['home.cost.pro.apps'],
            ['churches.cost.pro.invited'],
            ['home.cost.pro.domain', { domain }],
            ['churches.cost.pro.ai'],
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
        class='Note Note-small'
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
    </section>
    <Card class='Join' aria-labelledby='join'>
      <h2 class='Title' id='join' {...text('churches.join.title')} />
      <p class='Join_Doors'>
        <Button
          mod='go'
          href='#say'
          data-cta='join'
          {...text('churches.join.go')}
        />
      </p>
      <p class='Note Note-small' {...text('churches.join.note')} />
    </Card>
  </Page>
)
