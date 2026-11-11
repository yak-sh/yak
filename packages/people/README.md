# @yaks/people

An app's own people: the members, guests and relatives a church directory keeps,
as `individual`, `household` and `relation` rows. The pure functions read rows
the caller already read: who a phone, an address and a name belong to, what a
person's empty properties take from answers, and a typed postal address as a
household's parts. `./graph` is the rule a sign-up's people settle by.

```ts
import { address, matching, whose } from '@yaks/people'
import { equal } from '@yaks/testing'

let ann = {
  entity: { eid: 'ann' },
  individual: { first: 'Ann', email: 'ann@example.org, bo@example.org' },
  phone: { number: '+15555550100' },
}
equal(matching([ann], { first: 'ann', phone: '555-555-0100' }), ann)
equal(matching([ann], { first: 'Bo', phone: '555-555-0100' }), undefined)
equal(whose([ann], { email: 'bo@example.org' }), ann)
equal(address('12 Elm St\nSpringfield, IL 62704'), {
  street: '12 Elm St',
  city: 'Springfield',
  region: 'IL',
  postal: '62704',
})
```

## Components

| Component    | Properties                                                                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `individual` | `first`, `middle`, `last`, `maiden`, `nickname`, `suffix`, `gender`, `born`, `deceased`, `died`, `phone`, `email`, `photo`, `status`, `title`, `joined`, `household`, `position`, `slug`, `sample` |
| `household`  | `name`, `street`, `street2`, `city`, `region`, `postal`, `phone`, `email`, `photo`, `unlisted`, `slug`, `sample`                                                                                   |
| `relation`   | `kind` (`parent`, `spouse`, `sibling`), `a`, `b`, `type`, `married`, `ended`, `ended_on`, `sample`                                                                                                 |

A `parent` relation reads "a is b's parent". A person's typed `phone` is also
kept as @yaks/phone's `phone{number}` in E.164 form, which is what a sign-up by
phone is matched on (`numbered`).

## Which stores keep people

A yaks app names the package in its package.json (`"@yaks/people":
"platform"`)
and its store is lent the words. An app that declares the words itself keeps
them as its own; `speaks(vocab, word)` says whether a store's declaration agrees
with this package's, property by property, and `unlike` lists the words that do
not, which a deploy tells the app. The rule runs only in a store that speaks
`individual`, and writes households and relations only where it speaks those
too, so an app that means something else by the word is left alone.

## The sign-up rule

`plugins({ vocab })` from `@yaks/people/graph` returns the rule, which runs in
the write that saves a registration (@yaks/forms), so the sign-up and the
directory changes it entails commit together:

1. The person the sign-up names is matched by phone, else email, when the first
   names agree (`matching`), allowing a short form (Matt, Matthew).
2. With no match it adds a guest, `individual{status: 'guest'}` wearing
   `form_guest{registration}`, at an eid derived from the sign-up, so a retry or
   a later answer finds the same guest again.
3. Each answer whose question `fills` a person's property fills it only where it
   is empty; a list gains the items it lacks. `household` alone on an `address`
   question fills the street, city, region and postal code of the person's
   household, making one when they have none.
4. Each entry of a repeat whose question `relates` them is a relative: one
   already listed under the person is found again by name and birthday
   (`named`), and any other is a guest with the relation between them.
5. A guest the sign-up made before its contact arrived, which turns out to be a
   member, is folded into that member.

A registration wearing `held` (a sign-up the form's door took for a bot's) fills
nothing until it is accepted. Forms depend on this package only through data:
`question.fills` and `registration.person`.
