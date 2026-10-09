// Scenarios for the desktop-plugin benchmark. Each check returns { ok, detail }.
// Checks look for the facts the user needs, so a cheaper answer that drops
// them doesn't count as a win.
import fs from "node:fs";
import path from "node:path";

const has = (text, ...res) => res.every((re) => re.test(text));
const any = (text, ...res) => res.some((re) => re.test(text));
const words = (t) => String(t || "").split(/\s+/).filter(Boolean).length;

export const SINGLE = {
  docqa: {
    title: "Question about a long document",
    prompt:
      "I attached contract.md (our vendor agreement). What's the notice period to terminate for convenience, " +
      "the interest on late payments, and the general liability cap?",
    check: (dir, out) => {
      const ok = has(out, /90|ninety/i, /1\.5\s?%/, /12|twelve/i);
      return { ok, detail: `facts:${ok} words:${words(out)}` };
    },
  },
  qa: {
    title: "General knowledge question",
    prompt: "What's the difference between optimistic and pessimistic locking in databases, and when should I use each?",
    check: (dir, out) => {
      const points = [/version|timestamp/i, /compare|cas\b|check/i, /lock/i, /contention|conflict/i, /retry|retries/i, /for update|row.?lock|exclusive/i];
      const hit = points.filter((re) => re.test(out)).length;
      return { ok: hit >= 4, detail: `points ${hit}/6 words:${words(out)}` };
    },
  },
  revise: {
    title: "Revise one paragraph of an email",
    prompt: "In email.md, the third paragraph sounds too aggressive. Rewrite it to be polite but still clear about the deadline, and show me the result.",
    check: (dir, out) => {
      const file = fs.readFileSync(path.join(dir, "email.md"), "utf8");
      const text = out + "\n" + file;
      const facts = has(text, /March 14/i, /4[,.]?200/, /Friday/i);
      const softened = !/mess|frankly/i.test(out) || (!/mess/i.test(file) && file !== "");
      return { ok: facts && softened, detail: `facts:${facts} softened:${softened} words:${words(out)}` };
    },
  },
};

// A 9-message conversation about the contract. Handoff happens after message 5.
export const CONVERSATION = {
  title: "9-message conversation about the contract",
  handoffAfter: 5,
  turns: [
    { q: "I attached contract.md, our vendor agreement with Northwind. Give me a short overview of the main commercial terms." },
    { q: "What happens if they miss the uptime SLA?", check: (o) => any(o, /99\.9/) && any(o, /credit/i) },
    { q: "We want to leave at the end of the current term. What do we need to do, and by when?", check: (o) => any(o, /60|sixty/i) },
    { q: "Draft a short email to Northwind giving notice of non-renewal." },
    { q: "Make it firmer, and ask them to confirm how we get our data back." },
    { q: "What's our maximum exposure if we breach confidentiality?", check: (o) => any(o, /2x|two times|twice|2 ×|2×|double/i) },
    { q: "Which law governs disputes, and where would they be heard?", check: (o) => any(o, /Netherlands|Dutch/i) && any(o, /Amsterdam/i) },
    { q: "How long do we have to export our data after the contract ends?", check: (o) => any(o, /30|thirty/i) },
    {
      q: "List every deadline and number we've discussed in this conversation, one line each.",
      check: (o) => any(o, /60|sixty/i) && any(o, /30|thirty/i) && any(o, /99\.9/),
    },
  ],
};
