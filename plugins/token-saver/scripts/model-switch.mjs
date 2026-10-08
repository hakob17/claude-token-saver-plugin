// PostModelSwitch: remember the new main-thread model for the router.
import { readStdin, rememberModel } from "./lib.mjs";
const input = readStdin();
rememberModel(input.session_id, input.to_model);
process.exit(0);
