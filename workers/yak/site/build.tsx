/** @jsxImportSource preact */
// The home page that leads with what a visitor gets, an app built from their
// description, and names the Operator only once the app is in hand. It is a
// home page `/` is split with (variant.ts `describe`), so its canonical
// address is the home page's, and its box and plans are the home page's own.
// Where it says what the home page says, it says it by the home page's keys.
import { Button, Card, Field } from '@yaks/ui'
import { START } from '../newcomer.ts'
import { attr, type Slots, text } from './copy.ts'
import { Page, Yours } from './frame.tsx'
import { arrow, Cost, Examples } from './home.tsx'
import { Idle } from '../mascot.ts'
import { BUILD } from '../demos.ts'

export let Build = () => (
  <Page
    copy='build'
    path='/'
    kind='Home'
    head={
      <>
        <script src='carousel.js' defer />
        <script src='wander.js' defer />
        <script src='cta.js' defer />
      </>
    }
  >
    <section class='Hello' aria-labelledby='hello'>
      <div class='Hello_Copy'>
        <div class='Hello_Yak' data-wander=''>
          <Idle class='Wander_Image' base='.' />
        </div>
        <p class='Hello_Kicker' {...text('build.hello.kicker')} />
        <h1 class='Title Title-hero' id='hello'>
          <label for='say' {...text('build.hello.title')} />
        </h1>
        <p class='Note' {...text('build.hello.lead')} />
        <form class='Hello_Ask' method='post' action={START}>
          <Field
            class='Hello_Field'
            lines
            id='say'
            name='say'
            required
            maxLength={4000}
            {...attr('placeholder', 'build.hello.hint')}
          />
          <Button
            mod='go'
            type='submit'
            data-cta='start'
            {...text('home.hello.go')}
          />
        </form>
        <p
          class='Note Note-small'
          {...text('build.hello.note', {
            examples: (
              <a
                href='#examples'
                data-cta='examples'
                {...text('home.hello.examples', { arrow: arrow('↓') })}
              />
            ),
          })}
        />
      </div>
      <Examples
        apps={BUILD}
        note='build.examples.note'
        slots={{
          gallery: <a href='/gallery' {...text('home.examples.gallery')} />,
        }}
      />
    </section>
    <section class='Yours' aria-labelledby='does'>
      <h2 class='Title' id='does' {...text('build.does.title')} />
      <dl class='Yours_List'>
        {['saves', 'opens', 'yours'].map((item) => (
          <div>
            <dt class='Yours_Term' {...text(`build.does.${item}.term`)} />
            <dd class='Yours_Detail' {...text(`build.does.${item}.detail`)} />
          </div>
        ))}
      </dl>
    </section>
    <section class='How' aria-labelledby='how'>
      <h2 class='Title' id='how' {...text('home.how.title')} />
      <ol class='Steps'>
        {Object.entries<Slots>({
          'build.how.describe': {},
          'build.how.builds': {},
          'home.how.keep': { yours: <Yours /> },
          'build.how.change': {},
        }).map(([step, slots]) => (
          <li class='Steps_Item'>
            <h3 class='Step_Name' {...text(`${step}.name`)} />
            <p class='Note' {...text(`${step}.detail`, slots)} />
          </li>
        ))}
      </ol>
      <p
        class='Note Note-small'
        {...text('home.how.agent', {
          agent: <a href='/agent' {...text('home.how.address')} />,
        })}
      />
    </section>
    <Cost />
    <Card class='Join' aria-labelledby='join'>
      <h2 class='Title' id='join' {...text('build.join.title')} />
      <p class='Join_Doors'>
        <Button
          mod='go'
          href='#say'
          data-cta='join'
          {...text('build.join.go')}
        />
      </p>
      <p class='Note Note-small' {...text('home.join.note')} />
    </Card>
  </Page>
)
