import { handleHealth } from "../src/http.js";

export function GET() {
  return handleHealth();
}
