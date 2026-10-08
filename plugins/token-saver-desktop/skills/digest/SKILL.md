---
name: digest
description: >
  This skill should be used when the user invokes /digest, or asks to "make a digest of this document",
  "extract what matters from this file so I don't have to attach it again", "condense these attachments",
  with one or more long attachments. Produces a compact, reusable notes version of long material.
metadata:
  version: "0.1.0"
---

# Digest long material

Attaching the same long PDF, spreadsheet or document to chat after chat burns credits every time. Produce a compact digest the user can paste or attach instead.

## Steps

1. If the user gave a purpose ("for the contract review", "for questions about pricing"), keep only what serves it. Otherwise ask once what the digest will be used for, unless it's obvious from the conversation.
2. Read the material selectively: skim structure first (headings, table of contents, sheet names), then read only the relevant sections.
3. Write the digest:
   - **Source**: file name(s), and date/version if shown
   - **Summary**: 3–5 sentences
   - **Key facts**: numbers, dates, names, definitions, obligations — exact values, with page/section/sheet references
   - **Tables**: only the rows and columns that matter, as compact markdown tables
   - **Open questions**: what the material doesn't settle
   Aim for 5–10% of the original's length; never more than about 800 words unless asked.
4. Paraphrase rather than copy long passages. Quote only short wording where the exact words matter (definitions, clauses), with a reference.
5. Save it as a markdown file named `<source-name>-digest.md` and hand it to the user, plus one line: `Attach or paste this digest in future chats instead of the original.`
