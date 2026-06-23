# Polo

Group-native AI coordination layer. See `POLO_VISION.md` for the product constitution.

## Commands

- `POLO_MOCK=1 npm start` — Launch CLI harness in mock mode (no API key needed)
- `npm start` — Launch CLI harness with live Claude API
- `npm run dev` — Watch mode for development
- `npm run typecheck` — Type check without emitting
- `npm run build` — Compile TypeScript
- `POLO_MOCK=1 npx tsx src/harness/test-scenario.ts` — Run automated full-loop scenario

## Architecture

```
src/
  domain/types.ts      — Core domain types (Group, Member, Plan, Constraint, Collection, etc.)
  transport/types.ts   — Messaging transport abstraction (send, react, poll, private, card)
  governor/            — Participation state machine (when Polo should speak)
  ai/                  — Claude API integration (constraint extraction, response generation, option discovery)
  plan/                — Plan orchestrator + phase advancement + poll + availability
  privacy/             — Privacy context (group-safe filtering, scope enforcement)
  store/               — In-memory state with event log (groups, plans, messages, collections)
  harness/             — CLI test harness for simulating group conversations
```

## Key Design Decisions

- **Transport abstraction**: All messaging goes through `Transport` interface. Currently CLI, later Photon/Spectrum.
- **Participation governor**: Deterministic state machine. AI does not decide whether to speak — the governor does.
- **Three memory domains**: Shared (group decisions), Private (individual calendars), Ephemeral (task-scoped). All three implemented.
- **AI for interpretation, not authority**: Claude extracts constraints and generates responses. It never invents consensus or authority.
- **Plan lifecycle**: gathering_intent → collecting_constraints → finding_options → polling → decided → following_through → complete
- **Collections**: Generic mechanism for gathering input (constraints, availability, poll votes, RSVPs) with participant tracking and visibility control.
- **Event log**: Every state change is recorded as a GroupEvent for auditability and replay.
- **Plan routing**: Messages, polls, and cards are linked to plans via routes, enabling multi-plan groups.
- **Phase advancement**: Deterministic rules in `plan/advance.ts` decide when to move forward. No AI involvement in phase transitions.

## Environment

- `ANTHROPIC_API_KEY` — Required for live mode
- `POLO_MOCK=1` — Enables deterministic mock mode (regex-based constraint extraction, canned options)
