import { handleMcp } from "../src/http.js";

export const maxDuration = 30;

export function POST(req: Request) {
  return handleMcp(req);
}
export function GET(req: Request) {
  return handleMcp(req);
}
export function DELETE(req: Request) {
  return handleMcp(req);
}
export function OPTIONS(req: Request) {
  return handleMcp(req);
}
