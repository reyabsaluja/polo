# Polo

Group-native AI coordination layer. See `POLO_VISION.md` for the product constitution.

## Commands

- `npm run start` — Launch the CLI test harness (simulated group chat)
- `npm run dev` — Watch mode for development
- `npm run typecheck` — Type check without emitting
- `npm run build` — Compile TypeScript

## Architecture

```
src/
  domain/types.ts    — Core domain types (Group, Member, Plan, Constraint, etc.)
  transport/types.ts — Messaging transport abstraction
  governor/          — Participation state machine (when Polo should speak)
  ai/               — Claude API integration (constraint extraction, response generation)
  plan/             — Plan orchestrator (ties governor + AI + store together)
  store/            — In-memory state (groups, plans, messages, shared memory)
  harness/          — CLI test harness for simulating group conversations
```

## Key Design Decisions

- **Transport abstraction**: All messaging goes through `Transport` interface. Currently CLI, later Photon/Spectrum.
- **Participation governor**: Deterministic state machine. AI does not decide whether to speak — the governor does.
- **Three memory domains**: Shared (group decisions), Private (individual data), Ephemeral (task-scoped). Currently only shared is implemented.
- **AI for interpretation, not authority**: Claude extracts constraints and generates responses. It never invents consensus or authority.
- **Plan lifecycle**: gathering_intent → collecting_constraints → finding_options → polling → decided → following_through → complete

## Environment

Requires `ANTHROPIC_API_KEY` environment variable.
