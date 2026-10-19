# Product feedback, feature requests and friction log

> Draft for the Devpost "Product feedback" and "Friction log" fields. Joshua: edit into your own words and keep only what matches your experience.

## Tools, APIs and SDKs used

| Tool | Used for |
|---|---|
| Model Context Protocol, spec 2025-11-25 | The Alexa+ integration surface: tools with `outputSchema` + `structuredContent`, annotations, resources, prompts, Streamable HTTP. |
| `@modelcontextprotocol/sdk` (TypeScript) 1.32.1 | `McpServer`, `WebStandardStreamableHTTPServerTransport` (stateless, JSON responses), the client in tests and the smoke script. |
| MCP Apps (`ui://` resource, `text/html;profile=mcp-app`) | The visual card for multimodal Alexa+ devices; the web simulator hosts it. |
| MCP Inspector v2 (CLI) | Verifying the hosted endpoint as a standard MCP server. |
| Web Speech API | Voice in/out in the simulated Alexa+ experience. |
| Vercel Functions + Vercel Blob (free tier) | Hosting the MCP endpoint and durable household storage. |
| ExchangeRate-API open access | Live mid-market naira reference rate. |

**What worked well**
- The 2025-11-25 SDK made a spec-compliant server short. `registerTool` with zod input/output schemas gives validated `structuredContent` for free, which is exactly what a voice + screen client needs.
- The Web-standard Streamable HTTP transport in stateless mode runs unchanged on serverless and on plain Node, which made "self-hosted" easy to satisfy and to test (the integration tests drive the real transport through `fetch`).
- MCP being the open standard meant every MCP client (Inspector, IDE agents) could test the same endpoint Alexa+ would call.

**What needs work**
- There's no way for a non-Preview developer to point real Alexa+ at a self-hosted MCP server, so the end-to-end voice experience had to be simulated.
- The Alexa+ docs available to hackathon entrants don't say how Alexa+ identifies the customer to an MCP server (account linking? OAuth 2.1 per the MCP auth spec? a per-user header?), so I had to design a stand-in.
- It isn't clear which Alexa+ devices render MCP Apps / `ui://` resources, or which MCP Apps protocol version they expect.

**Onboarding (zero to hello world):** about an hour from the MCP docs to a working tool, longer to confirm which SDK version actually speaks 2025-11-25 (I checked `LATEST_PROTOCOL_VERSION` in the SDK source).

**Would I build with it again?** Yes. Voice is the natural interface for this household-money job, and MCP means the same server also serves any agent the user already has.

## Feature requests

1. **Alexa+ MCP developer sandbox** (Critical): let any developer register a self-hosted MCP URL against their own Alexa+ account or a console simulator, so voice flows can be tested for real.
2. **Documented identity/auth model for Alexa+ MCP servers** (Critical): account linking or OAuth 2.1 flow, which claims arrive, how to scope per household member.
3. **MCP Apps support matrix for Echo Show / Fire TV** (Important): which devices render `ui://` cards and with what size and theme context.
4. **Proactive notifications from MCP servers** (Important): a rate alert or "school fees due Friday" reminder should be able to reach the user without them asking first.
5. **Locale guidance for en-NG and naira formatting in speech** (Nice-to-have).

## Friction log

| # | Task attempted | Steps taken | Expected | Actual | Severity | Workaround | Suggestion |
|---|---|---|---|---|---|---|---|
| 1 | Test my MCP server inside Alexa+ | Read the track page and rules; looked for a way to register a self-hosted MCP URL | A console or simulator to attach a dev MCP server to Alexa+ | Alexa+ MCP integrations are for brands in Preview; no self-serve path | High | Built a simulated Alexa+ display that calls the real MCP server | Ship a dev sandbox or let the Alexa Simulator call a registered MCP URL |
| 2 | Identify the customer's household | Looked for how Alexa+ passes user identity to an MCP server | A documented OAuth/account-linking flow | Not documented for entrants | High | Household id header + optional bearer token | Publish the auth model and a sample token |
| 3 | Confirm SDK support for spec 2025-11-25 | Checked the npm package, then read the SDK's `types.js` | A version table per SDK language on the hackathon resources page | Had to read source to confirm `LATEST_PROTOCOL_VERSION = '2025-11-25'` | Medium | Pinned `@modelcontextprotocol/sdk@1.32.1` | Add "minimum SDK versions for 2025-11-25" to the Alexa+ track resources |
| 4 | Show a visual card on a smart display | Implemented an MCP App `ui://` resource | Guidance on whether Alexa+ renders MCP Apps and how | No device guidance | Medium | Simulator acts as the MCP Apps host | Document MCP Apps support per device |
| 5 | Validate with MCP Inspector | `npx @modelcontextprotocol/inspector --cli …` | Works on Node 20 | npx picked a cached v1 that rejects URL targets; v2 needs Node 22+ | Low | `npx -p node@22 -p @modelcontextprotocol/inspector …` | Mention the Node 22 requirement in the getting-started guide |
| 6 | Use AWS for hosting | Read the AWS credit section of the rules | Request credits | Credit codes ran out on Oct 7 | Low | Free hosting elsewhere | Note remaining free-tier paths for late joiners |
