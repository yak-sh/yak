#compdef task
# zsh completion for the `task` CLI. It delegates every candidate to
# `task complete`, which reads the one declaration table (src/tabcomplete.ts), so
# the completion never drifts from the verbs, options and enums that actually
# run. Install: put this file on your $fpath (e.g. ~/.zsh/completions/_task) and
# ensure `autoload -U compinit && compinit` runs in ~/.zshrc.
#
# zsh keeps `--model=opus` as one $words entry (no `=` word-splitting), so the
# words array IS complete()'s contract: everything after `task`, the last being
# the word under the cursor.
_task() {
  local -a cands
  cands=(${(f)"$(task complete -- "${(@)words[2,$CURRENT]}" 2>/dev/null)"})
  compadd -- $cands
}
_task "$@"
