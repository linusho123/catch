# Catch scope — findings held for after the cold read

Written 2026-10-15 by the interviewer's post-draft adversarial pass (scope SKILL.md, `layers.md`). The gate is cold (D109): drafting defects were fixed before the read; the items below are contract-level and are revealed only after the visionary's read closes. None is a ruling until the visionary makes it one. This file lives outside `features/` so no lint reads it as a deliverable.

## Candidate questions (blind:surface)

1. **What the lens shows when a tap keeps the conversation.** D40 says a tap confirms; it does not say what the wearer sees. The draft shows only the dot afterwards (derived from D14), and relies on "a further swipe up shows `already kept`" (D54) as the observable. Candidate: show `kept` in dim text for a second and a half, parallel to `already kept`. (kept-conversations.feature, "A tap keeps the conversation")
2. **The promises page with nothing promised.** D43 rules the names page then the promises page on a swipe down; nothing rules what the promises page shows when names are held but no promise is. Candidate: `no promises yet`. (holding.feature)
3. **Two unnamed people who both promise.** D26 names an owed promise "they" until a name is caught. Two unnamed promisers in one conversation give two "they" entries and no way to tell them apart, and a later name attaches to both or neither. Candidate: number them (`they (1)`, `they (2)`) and attach a caught name only to the most recent. (promises.feature)
4. **Kept-conversation notification on an unreachable phone.** D38 rules that promises wait however long; it says nothing about the kept-conversation notification (D24) and the jogger. The draft assumes they wait too. Candidate: extend D38 to every notification. (phone-handoff.feature, kept-conversations.feature)
5. **The website has no scenarios of its own.** D103 rules it a full second surface with the same three screens and tick-off, but every Then in phone-handoff.feature names the phone. Candidate: turn the three screen scenarios (D39/D98, D100) into an outline over `<surface>` with rows phone and website, so the website is bound and tested rather than assumed. (phone-handoff.feature)
6. **The 25-minute jogger's arrival time.** The outline "A kept conversation of any length gets a jogger" gives 30 seconds for 25 minutes, interpolated from D52 (20 minutes, 30 seconds) and D74 (a short one, 30 seconds; three hours, a few minutes). D24 itself is silent. Candidate: confirm 30 seconds as the bound for anything under an hour. (kept-conversations.feature)
7. **Notification wording carries the time word.** D28 was ruled before D89 added "tonight" to the summary; the draft writes the notification as "Send Dev the deck tonight". D89 touches D28 and says the notification carries the same wording, so this is a reading, not a change; confirm it. (phone-handoff.feature, "One notification carries both lines")

## Notes for the build (cino family, not questions)

- **cino:assertion on deletion (D76).** The scenario's ground truth is the server's own store. The binding must read storage directly (the table or bucket), never the API whose job is to delete; otherwise it measures a mirror.
- **cino:binding on the lens.** Every "the wearer sees" Then must bind to the container state the Even bridge was actually sent (the text and brightness in the last `createStartUpPageContainer` / `textContainerUpgrade` call), under mutation: a doctored world where the catch did not fire must turn the step red. "The SDK call returned success" is not the lens showing anything (Even's own docs say success means accepted, not displayed).
- **cino:code on the loud-versus-quiet split.** The split is the seam every promise, thread and own-name scenario drives (D29, D35, D89, D91). One fixture with a louder wearer will light every path; the build must also run a fixture where the other person is the louder one, so that the half-lighting tell (`layers.md`) cannot hide there.
- **Half-lighting on surfaces.** If finding 5 is accepted, the website rows must drive the website, not the phone app's view model through a second route.
- **Glyph check before the demo.** The dot, the dash, the ellipsis, the middle dot, the down arrow and the box-drawing in page headers must be confirmed on the real lens font; Even drops missing glyphs silently (DESIGN.md, chosen).

## Verified during the pass

- Every `[ruled: …]` tag in DESIGN.md resolves to an in-effect docket entry (strict lint, traceability 0).
- Every need has a status and every feature file appears in a need's coverage (USER-NEEDS.md, bidirectional check).
- The swap test holds for every need statement; N11's "short guide" is the visionary's own means.
- Bound scenarios touched: none; no Sanctioned changes section is needed.
