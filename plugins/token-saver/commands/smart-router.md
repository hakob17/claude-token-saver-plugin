---
description: Turn the routing proxy's smart routing on/off (off = keep using the routing proxy, but always the model you picked), or show its status
argument-hint: "on | off | status"
allowed-tools: Bash
---

Run exactly this command and nothing else:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/smart-router.mjs" $ARGUMENTS
```

If the path above came through empty, find this plugin's `scripts/smart-router.mjs` (for example with `--plugin-dir`, or under `~/.claude/plugins`) and run that with the same argument.

Then reply with its output only, unchanged. Don't explain further unless the output contains an error.
