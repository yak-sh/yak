# Standing instructions for an app

An app's person says a thing once — "recipes in grams" — and then says it again
next week, to a different agent, because the first one's conversation ended.
`AGENTS.md` beside `index.html` is where that rule goes to stop being said. It
is prose, it is the app's own, and every agent who can reach the app is handed
it at the start of every conversation.

This page is that file: where it goes, what belongs in it, what does not, the
ceiling on it, and the three places it is read.

The map is at <https://yaks.app/guide.md>.

## Where it goes

`AGENTS.md`, at the app's root, beside `index.html` and `vocab.json`:

    app_files { app: 'recipes', path: 'AGENTS.md', content: '…' }

It is the app's INSIDE, not one of its pages. `GET /recipes/AGENTS.md` is a 404
on the web, the same as `vocab.json`, `tools.json` and `worker.js`; a member
reads it back with `app_files`:

    app_files { app: 'recipes', op: 'read', path: 'AGENTS.md' }

Anyone who can reach the app can read it, which is everyone in the space. A
stranger with the link cannot, whatever the app's access is.

## The recipe example

The whole shape, for the app this platform gets asked for more than any other:

    # Recipes

    Weights in grams, never cups. Say the oven in °C with °F in brackets.

    Every ingredient's amount is repeated in the step that uses it — "add the
    200 g flour", not "add the flour" — so nobody scrolls back mid-cook.

    One photo per recipe, of the finished dish, uploaded not linked.

    A recipe that came from somewhere says where in `source`, with the URL.

    Tag by meal (breakfast, dinner, pudding), never by cuisine.

Four things make that a good one, and they are the whole test:

- **Every line is a rule somebody could break.** "Weights in grams" is a rule.
  "This app holds recipes" is not — the door already says that.
- **It is about the DATA, not the code.** How a recipe is written down outlives
  whatever the page looks like this month.
- **No reasoning.** The person knows why they want grams. An agent that reads
  the rule does not need the argument for it.
- **Nothing the graph already holds.** The components, the tools, the address
  and what the app holds are all said for you (below). A rule that restates them
  is a second copy that will drift.

## What it is not

Not documentation of the app. Not a changelog. Not a place to leave notes for
the next agent about what you were in the middle of — that is what the app's own
store is for, and a task in it outlives a paragraph here.

Not a way to make an agent do something it would refuse. It is the person's
standing preference, read as input like anything else in a store.

## The ceiling

4096 bytes. A larger write is refused, with the number:

    AGENTS.md is 5200 bytes — 4096 at most. It is read on every connection
    by every agent that can reach the app, so keep it to the rules
    themselves, not the reasoning behind them.

The ceiling is there because this text is paid for on every connection by
everyone in the space. A page of rules is plenty; a document is a sign the rules
want to be a `vocab.json` instead — a column an app declares is a rule the store
itself enforces, and no agent can forget it.

## Where it is read

**Three doors, one text.**

At the connector, `initialize` hands the model a passage naming every app the
person can reach, one heading each, with what the app holds, its own tools and
its `AGENTS.md` underneath:

    ## kitchen/recipes
    https://kitchen.yaks.app/recipes/ — Recipes, holds recipes. Tools:
    recipes__add.

    # Recipes

    Weights in grams, never cups. …

    ## kitchen/chores
    https://kitchen.yaks.app/chores/ — Chores, holds chores.

That passage is why an agent asked to "add this recipe" knows there is a recipe
app to add it to, rather than making a second one. `about` says it again, for a
conversation that has run long enough for the apps to have moved under it — and
when they do move, a later reply says so.

Second, a person can invoke one by name. It is offered as a prompt called after
the app — `recipes` — so somebody picking from a menu can pull the app's rules
into a conversation deliberately.

Third, the builder here reads it before it builds on an app that has one.

## It travels

`app_publish` and `app_install` copy an app's files, and `AGENTS.md` is one of
them. Somebody who installs a published recipe box gets its rules along with its
pages — the publisher's rules, in the installer's own copy, which they can then
rewrite with `app_files` like any other file of theirs.

## Writing one without being asked to

When the person states a rule that will outlive the conversation, write it down.
"Use grams" said in passing is a standing rule; "make this one metric" is not.
If you are not sure, ask in one line — and if they say it twice, that settles
it.

Read it back before you edit it, and add to it rather than replacing it: the
lines already there are theirs.

---

Back to the map: <https://yaks.app/guide.md>. Nearby: the app's own words in
<https://yaks.app/guide/components.md>, its own tools in
<https://yaks.app/guide/tools.md>, and its files in
<https://yaks.app/guide/files.md>.
