---
name: notes
description: "The notes an app keeps (yaks.app). NOTES.md beside index.html, where an app keeps what its person wants written down about how it is kept — where the file goes, what belongs in it and what does not, the size ceiling, how about and the prompt of the app's own name hand it over, and what an installed copy carries."
---

# The notes an app keeps

An app's person says a thing once — "recipes in grams" — and then says it again
next week, to a different agent, because the first one's conversation ended.
`NOTES.md` beside `index.html` is where that rule goes to stop being said. It is
prose, it is the app's own, and every agent who can reach the app can be handed
it.

This page is that file: where it goes, what belongs in it, what does not, the
ceiling on it, and the three places it is handed over.

The map is at <https://yaks.app/guide.md>.

## Where it goes

`NOTES.md`, at the app's root, beside `index.html` and `vocab.json`:

    app_files { app: 'recipes', path: 'NOTES.md', content: '…' }

It is the app's INSIDE, not one of its pages. `GET /recipes/NOTES.md` is a 404
on the web, the same as `vocab.json`, `tools.json` and `worker.js`; a member
reads it back with `app_files`:

    app_files { app: 'recipes', op: 'read', path: 'NOTES.md' }

Anyone who can reach the app can read it, which is everyone in the space. A
stranger with the link cannot, whatever the app's access is.

The file was called `AGENTS.md` before, and an app that still carries one goes
on working: `NOTES.md` is read first and the old name is read where there is no
new one. Nothing migrates by itself, and an app with both is the new name. Write
the new one.

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
- **Nothing the graph already holds.** The components, the commands, the address
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

    NOTES.md is 5200 bytes — 4096 at most. Every agent that can reach the
    app is handed it, so keep it to the app's own notes, not the reasoning
    behind them.

The ceiling is there because this text is paid for by everyone in the space who
asks for it. A page of rules is plenty; a document is a sign the rules want to
be a `vocab.json` instead — a column an app declares is a rule the store itself
enforces, and no agent can forget it.

## Where it is handed over

**Three doors, one text.**

At the connector, `initialize` hands the model a passage naming every app the
person can reach, one heading each, with what the app holds and its own
commands, and a line where the app keeps notes:

    ## kitchen/recipes
    https://kitchen.yaks.app/recipes/ — Recipes, holds recipes. Commands:
    add_recipe, find_recipe. Keeps notes of its own, which about hands over.

    ## kitchen/chores
    https://kitchen.yaks.app/chores/ — Chores, holds chores.

The passage says how to use those names, too: an app's own verbs are commands
rather than tools of the connector's list, run with the `command` tool and read
with `commands`.

That passage is why an agent asked to "add this recipe" knows there is a recipe
app to add it to, rather than making a second one. It is made fresh at every
connection, and it names the apps but never quotes what their people wrote.

The notes themselves are what `about` hands over — the same roster with each
app's own words underneath it, and anything the person has said in the space
along with them. Ask for it before you build on an app or add to one. It is also
how a conversation that has run long enough for the apps to have moved under it
catches up: an app made this morning is news `about` carries, not news the tool
list does.

Second, a person can invoke one by name. It is offered as a prompt called after
the app — `recipes`, or `recipes__notes` where that word is already spoken for —
titled "Recipes: notes", so somebody picking from a menu can pull the app's
rules into a conversation deliberately.

Third, the builder here reads them before it builds on an app that has some.

## It travels

`app_publish` and `app_install` copy an app's files, and `NOTES.md` is one of
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
<https://yaks.app/guide/components.md>, its own commands in
<https://yaks.app/guide/tools.md>, and its files in
<https://yaks.app/guide/files.md>.
