# Demo video script (target 2:40, hard limit 3:00)

Record at 1080p in Chrome (voice input needs Chrome or Edge) on https://nairahome-mcp.vercel.app, with system audio on so the spoken answers are captured. English narration, no third-party music. Use **New household** first so you start clean. Rates change daily: read the live rate off the screen and use the example chips (they're placed just under today's live rate).

| Time | Show | Say (narration) |
|---|---|---|
| 0:00-0:15 | Title card or the idle display | "I'm Joshua, a builder in Nigeria. Every month millions of us abroad send money home: Mum's upkeep, school fees, rent. NairaHome is an Alexa+ MCP server that remembers that household, prices every transfer honestly and plans the month." |
| 0:15-0:30 | Click **Load the sample family**. Open the MCP log panel. | "This is a simulated Alexa+ smart display. Everything it says comes from real MCP tool calls to my server, protocol 2025-11-25 over Streamable HTTP: here's the traffic." |
| 0:30-1:00 | Press the mic: **"Plan my month with 600 pounds."** Let the plan card render and the answer play. | "The planner reads what's due, converts at the live mid-market rate (source and timestamp on the card), funds essentials first, groups it into one transfer per person, and warns me that rent is due in January with a monthly set-aside." |
| 1:00-1:35 | Mic: **"I'm sending [X] pounds to Ada."** → it asks for the rate → **"[rate], fee is 1.99, on Lemfi."** | "It never invents a provider's rate; it asks what my app shows. Then it shows the true cost: the fee I can see, plus the markup hidden in the rate, against the UN 3% target." |
| 1:35-1:50 | Click **Compare …** chip | "Comparing two apps, fees included, ranked by naira delivered." |
| 1:50-2:10 | Mic: **"I've sent it to Ada."** then **"Household summary."** | "Logging it marks Ada's school fees and data as paid, rolls them to February, and learns my real transfer cost for next month's plan." |
| 2:10-2:25 | Reload the page, say **"Household summary"** again | "New MCP session, same household: state persists across sessions, so Alexa+ can pick this up next month." |
| 2:25-2:40 | Terminal: run the MCP Inspector one-liner from the README against the live endpoint | "And it's a standard MCP server: here's the official MCP Inspector calling the same endpoint. Code, tests and setup are on GitHub, MIT licensed." |

Tips: keep each spoken request short; if a recognition misfires, type it instead (the typed path calls the same tools). Don't show the household id for long, and don't show any real account details.

## Recorded demo
The submitted video (2:50) follows this script. It was made on a Linux box: Playwright drives Chrome on Xvfb against the live site, ffmpeg records the screen, edge-tts provides the narration and voices, and the MCP Inspector beat is a real run in a terminal. Every answer on screen came from the live endpoint.
