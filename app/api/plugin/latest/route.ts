import { NextResponse } from "next/server";
import { latestPluginInfo } from "@/lib/plugin-release";
import { SITE } from "@/lib/site";

// Public: the agentscope-core plugin asks this once a day. The download address is the app's own (SITE.url), never
// taken from the request, since the answer is cached publicly.
export function GET() {
  return NextResponse.json(latestPluginInfo(SITE.url), { headers: { "Cache-Control": "public, max-age=3600" } });
}
