import { NextResponse } from "next/server";
import { latestPluginInfo } from "@/lib/plugin-release";

// Public: the agentscope-core plugin asks this once a day. It reads nothing from the request but its host.
export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return NextResponse.json(latestPluginInfo(origin), { headers: { "Cache-Control": "public, max-age=3600" } });
}
