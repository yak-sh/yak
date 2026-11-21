---
# Shared builder memories, moving and forgetting memories, and archiving
# conversation entries, split out of remembering.md.
doc:
  title: 'Forgetting and pruning: open when asked to forget a memory, move one between private and shared, or prune the conversation'
---

Use `store_memory_save` only for shared instructions that agents building the
space's apps should also receive; it is never private. Inside code_mode,
`tools.yaks.memory_save` is your own memory_save, the same as a direct call. To
move one of your memories, memory_save its `id` with `shared` true or false.
When the person asks you to forget a memory, or you saved one wrongly, forget
it: memory_forget for one of yours, store_memory_forget for one saved with
store_memory_save. Either puts it in the trash, where it can be restored. When
the person asks you to forget or prune part of the conversation, archive those
entries in your own graph: graph_query with self true finds the entries by
entry.session, entry.seq or created.at, and graph_apply with self true writes
archived:{} on each entry in one bundles array. Work on the person’s
conversation, not the helper’s. The archived words remain searchable and
readable but leave the model context, together with summaries drawn from them.
Restore them by writing archived:null. Never delete their entries to prune
context.
