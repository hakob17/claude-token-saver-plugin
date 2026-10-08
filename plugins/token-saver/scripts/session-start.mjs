// SessionStart: inject a short set of token-economy rules. Kept tiny on purpose:
// this text is sent on every turn of the session.
import fs from "node:fs";
import path from "node:path";
import { readStdin, addContext, rememberModel, routerEnabled, EXPENSIVE_MODEL } from "./lib.mjs";

const input = readStdin();
const cwd = input.cwd || process.cwd();
rememberModel(input.session_id, input.model);
const modelName = typeof input.model === "string" ? input.model : input.model?.id || input.model?.display_name || "";

let rules = `Token budget is limited. Work economically:
- Be terse. No preamble, no recap of what you did, no restating the question. Explain only when asked.
- Edit with targeted Edit calls; never rewrite whole files. Show diffs, not full files.
- Locate code with Grep/Glob first, then Read only the relevant range (offset/limit). Don't re-read files already in context.
- For broad codebase searches, delegate to the token-saver:scout agent (Haiku) and use its summary.
- For mechanical bulk edits (renames, boilerplate, formatting), delegate to the token-saver:grunt agent (Haiku).
- Run builds/tests quietly and only show failures (e.g. mvn -q ... 2>&1 | tail -60).
- If stuck after 2 attempts, stop and ask instead of looping.`;

if (routerEnabled(cwd)) {
  rules += `\n- If you are running on Opus/Fable, decide BEFORE writing any code: if the implementation is large (roughly 150+ new lines or 3+ files), don't write it yourself — plan, then delegate to the token-saver:coder agent (Sonnet) in 1-4 area-based tasks whose specs state intent, not code; send mechanical changes to token-saver:grunt in one batch; then review via git diff. If it's smaller, just do it yourself: delegation overhead would cost more than it saves.`;
}

// Resume from a previous /token-saver:handoff if present.
const handoff = path.join(cwd, ".claude", "handoff.md");
if (input.source === "clear" || input.source === "startup") {
  try {
    const st = fs.statSync(handoff);
    if (Date.now() - st.mtimeMs < 3 * 24 * 3600 * 1000) {
      rules += `\n\nA handoff note exists at .claude/handoff.md (from an earlier session). If the user wants to continue previous work, read it instead of re-exploring.`;
    }
  } catch {
    /* none */
  }
}

addContext("SessionStart", rules);
