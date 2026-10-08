// SessionStart: inject a short set of token-economy rules. Kept tiny on purpose:
// this text is sent on every turn of the session.
import fs from "node:fs";
import path from "node:path";
import { readStdin, addContext } from "./lib.mjs";

const input = readStdin();
const cwd = input.cwd || process.cwd();

let rules = `Token budget is limited. Work economically:
- Be terse. No preamble, no recap of what you did, no restating the question. Explain only when asked.
- Edit with targeted Edit calls; never rewrite whole files. Show diffs, not full files.
- Locate code with Grep/Glob first, then Read only the relevant range (offset/limit). Don't re-read files already in context.
- For broad codebase searches, delegate to the token-saver:scout agent (Haiku) and use its summary.
- For mechanical bulk edits (renames, boilerplate, formatting), delegate to the token-saver:grunt agent (Haiku).
- Run builds/tests quietly and only show failures (e.g. mvn -q ... 2>&1 | tail -60).
- If stuck after 2 attempts, stop and ask instead of looping.`;

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
