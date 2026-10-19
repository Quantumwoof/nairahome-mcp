# Devpost submission copy: NairaHome

**Hackathon:** Build, Ship, Shape: Amazon Developer Hackathon (amazonappdev2026.devpost.com)
**Deadline:** Fri 23 Oct 2026, 12:00 PM PDT = **8:00 PM WAT**
**Primary track:** Alexa+ (self-hosted MCP server, spec 2025-11-25, Streamable HTTP; demo through a simulated Alexa+ smart display)
**Mini challenges:** none claimed (see "Optional extras" at the bottom)

---

## Title
NairaHome

## Tagline (≤ 200 chars)
An Alexa+ MCP server that remembers the family you support in Nigeria, shows what each transfer really costs, and plans every month's money home.

## Links
- Repo (public, MIT): https://github.com/Quantumwoof/nairahome-mcp
- Try it (simulated Alexa+ display): https://nairahome-mcp.vercel.app
- MCP endpoint: https://nairahome-mcp.vercel.app/mcp (header `x-nairahome-household: <any 8-64 char id>`)
- Demo video: **TODO: YouTube/Vimeo link, public, under 3 min**

---

## Inspiration
<!-- Joshua: personalise this with your own story before submitting. -->
I'm a builder in Nigeria, and I've spent this year building remittance tools. The same picture keeps coming up from the receiving side: someone abroad keeping a household running from their phone. Mum's upkeep, a younger sibling's school fees, a parent's medication, the yearly rent that always seems to arrive as an emergency. It lives in WhatsApp threads and memory. And the apps that move the money often advertise "zero fees" while the real cost is hidden in the exchange rate. Nigeria is the largest remittance destination in sub-Saharan Africa, and sending money home still costs well above the UN's 3% target (SDG 10.c). These conversations happen out loud in the kitchen, so I wanted the household memory and the honest calculator to be there too, on Alexa+.

## What it does
NairaHome is an Alexa+ integration built as a self-hosted MCP server. It remembers the household (who you support and what they need: monthly upkeep, termly school fees, yearly rent, one-off repairs, essential or flexible) and turns it into three things:

- **A monthly plan.** "Alexa, plan my money home with 600 pounds." NairaHome reads everything due this month (and anything overdue), converts it at the live mid-market naira rate adjusted by *your real transfer cost learnt from transfers you've logged*, funds essentials first, groups it into one transfer per person, and warns you about big bills coming in the next six months with a monthly set-aside ("Mum's rent, ₦1.2 million, is due 5 January; set aside £233 a month").
- **The true cost of a transfer.** "I'm sending £290 to Ada." "What naira rate is your app offering?" "1,745, fee is 1.99, on Lemfi." NairaHome shows the naira delivered, the fee you can see, the markup hidden in the rate, the all-in percentage, and a verdict against the UN 3% target. It can rank several apps' offers too. It never invents a provider's price: you tell it what your app shows.
- **A memory that carries over.** "I've sent it to Ada" marks her school fees and data allowance paid and rolls them to their next due date. Rate alerts ("tell me when the pound hits ₦1,810") are reported the next time you ask for a rate or a plan. Next month, a new session picks up exactly where you left off.

On screens, each answer comes with a card (an MCP App) showing the plan, the cost breakdown and the live rate's source and timestamp.

## How we built it
- **MCP server** in TypeScript on the official `@modelcontextprotocol/sdk` 1.32.1, negotiating protocol **2025-11-25** over **Streamable HTTP** (`WebStandardStreamableHTTPServerTransport`, stateless, JSON responses). It runs unchanged as a Vercel Function or a plain Node server.
- **14 tools** with zod input schemas, **output schemas** and `structuredContent`, plus MCP **annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) so Alexa+ knows which calls are safe and which need confirmation. Destructive tools require `confirm: true`.
- **Voice-first answers:** every tool returns a `speech` line written to be spoken ("₦1.2 million", "£233 a month"), a `kind` for the card, and `data` for the screen.
- **MCP App card** (`ui://nairahome/card.html`, `text/html;profile=mcp-app`) linked from tools via `_meta.ui.resourceUri`, for Echo Show-style displays.
- **Resources and prompts:** `nairahome://household` and two workflow prompts (`monthly_check_in`, `before_i_send`).
- **Live data:** mid-market rates from ExchangeRate-API's open endpoint, cached for 30 minutes, with source and timestamp in every answer. If it's down, NairaHome says so instead of guessing. A labelled `FX_MODE=demo` exists for offline work.
- **Durable household memory:** private Vercel Blob objects on the hosted demo, JSON files when self-hosted; households keyed by a header (optional bearer token and Origin allow-list for self-hosters).
- **Simulated Alexa+ display** (the rules' simulated-experience path, since Alexa+ MCP is in brand Preview): a web app with voice in/out (Web Speech API) that speaks MCP over HTTP itself, shows the live JSON-RPC traffic, and hosts the server's MCP App card. A small rule-based intent router with multi-turn slot filling stands in for Alexa+'s language model; every number comes from the real server.
- **Quality:** 19 automated tests (quote maths, planner, recurrence, intent router, and a full MCP client ↔ server flow across sessions), a smoke script that drives the hosted endpoint with the official MCP client, and verification with MCP Inspector v2.

## Challenges we ran into
- **No self-serve Alexa+ MCP testing.** I couldn't attach my server to a real Alexa+ account, so I built a faithful simulator: it speaks the real protocol, hosts the real MCP App, and is honest about which part is simulated.
- **Identity.** The track docs don't say how Alexa+ identifies the customer to an MCP server, so I keyed households by a header and kept OAuth for the roadmap.
- **State on serverless.** Stateless Streamable HTTP is perfect for serverless but needs durable storage for "remembers across sessions"; I added a pluggable store (Blob / file / memory).
- **Honesty without provider APIs.** Live provider quotes aren't openly available, so NairaHome takes the rate the user reads off their app and prices it against the live mid-market rate, with a sanity check that catches a wrong currency.
- **Voice numbers.** "₦1,234,567.00" is unspeakable; every amount has a spoken form.

## Accomplishments that we're proud of
- A planner that does real agentic work in one call: budget fitting, essentials-first triage, per-person grouping, set-asides, and a transfer-cost estimate it *learns* from your own history.
- The "hidden in the rate" number. Seeing that a "zero fee" transfer still cost the family thousands of naira is the moment the product clicks.
- It's a standard MCP server: the same endpoint works in Alexa+, MCP Inspector, and any agent that speaks MCP.

## What we learned
- Designing for voice means designing the *answer*: one sentence, the number that matters, then the next step.
- MCP's structured output plus annotations is a good contract between a model like Alexa+ and a domain service: the model chooses, the server stays the source of truth.
- Stateless Streamable HTTP makes self-hosting nearly free.

## What's next for NairaHome
- OAuth 2.1 account linking per the MCP authorization spec, and shared households (siblings splitting Mum's costs).
- Alexa+ proactive notifications for rate alerts and "school fees due Friday" reminders.
- Provider integrations where APIs and terms allow, so quotes can be fetched rather than read out.
- More corridors (Ghana cedi, Kenyan shilling) on the same planner.

## Built with
`alexa+` `model-context-protocol` `mcp-2025-11-25` `streamable-http` `mcp-apps` `typescript` `node.js` `zod` `vercel` `vercel-blob` `web-speech-api` `exchangerate-api` `html` `css`

---

## Testing instructions (for judges)
1. Open https://nairahome-mcp.vercel.app in Chrome or Edge (voice input) or any browser (typing). No login.
2. Click the chips in order: **Load the sample family → Plan my month with 600 pounds → I'm sending … to Ada … → I've sent it to Ada → Household summary.** Watch the MCP traffic panel on the right.
3. Reload: the household is still there (new MCP session, same household id stored in your browser). **New household** gives a clean slate.
4. Any MCP client: Streamable HTTP, `https://nairahome-mcp.vercel.app/mcp`, header `x-nairahome-household: <any 8-64 char id>`. A one-line MCP Inspector command is in the README.
5. Locally: `npm install && npm start` (or `FX_MODE=demo npm start` offline), `npm test`.

## Built during the submission window?
Yes. NairaHome was created from scratch during the hackathon (first commit 19 Oct 2026). It is a new codebase, not an update of my earlier remittance projects.

## Product feedback (required field)
Paste and edit from `docs/FEEDBACK.md`: tools used and for what, what worked, what needs work, onboarding, would build again (yes, and why).

## Feature requests (optional) and friction log (optional, up to 10% bonus)
Paste from `docs/FEEDBACK.md`.

## Optional extras not claimed
- **AWS Builder mini challenge:** needs documented use of an AWS service (Bedrock, AgentCore, Strands, SageMaker) or Kiro Crew. Not used in this build.
- **Open Source mini challenge:** needs a *new, additional* open-source project or a contribution (fork/branch/PR) alongside this one, with its URL. Not done yet.
