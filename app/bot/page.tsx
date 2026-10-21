import type { Metadata } from "next";
import { PublicHeader } from "@/components/public-header";
import { LIMITS, PUBLIC_UA } from "@/lib/public-scan";

export const metadata: Metadata = { title: "AgentScopeBot – AgentScope", description: "Who AgentScopeBot is, what it checks and how to block it." };

export default function BotPage() {
  return (
    <>
      <PublicHeader />
      <main className="public-main">
        <div className="page-head">
          <h1>AgentScopeBot</h1>
          <p className="sub">The crawler behind AgentScope&apos;s free store check.</p>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Who we are</h2>
          <p>
            AgentScope helps WooCommerce store owners see whether AI assistants and shopping agents can read their store. When someone enters a store
            address in our free check, AgentScopeBot loads a few public pages of that store, once.
          </p>
          <p>User agent: <code className="inline">{PUBLIC_UA}</code>. Every request also carries the header <code className="inline">X-AgentScope-Check: 1</code>.</p>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>What it loads</h2>
          <ul>
            <li>robots.txt and llms.txt</li>
            <li>The home page, once with our user agent and once with each of four AI bot user agents (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot), to compare the answers</li>
            <li>A product sitemap if needed, and up to two product pages</li>
          </ul>
          <p>
            At most {LIMITS.httpRequests} requests per check, {LIMITS.gapMs / 1000} seconds apart, {LIMITS.timeoutMs / 1000}-second timeout, public pages only. The same store is
            checked at most once every {LIMITS.cacheHours} hours; repeated requests get the saved report. We never log in, submit forms or add to cart.
          </p>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>How to block it</h2>
          <p>Add this to your robots.txt. We then read only robots.txt and load no other page:</p>
          <pre className="card" style={{ background: "var(--slate-soft)", margin: 0 }}>User-agent: AgentScopeBot{"\n"}Disallow: /</pre>
          <p className="muted small">The bot-access comparison uses AI bots&apos; user agents for a single home page request; it follows the AgentScopeBot rules above, so blocking AgentScopeBot stops it too.</p>
        </div>
      </main>
    </>
  );
}
