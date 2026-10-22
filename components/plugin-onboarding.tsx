import Link from "next/link";
import { PLUGIN_RELEASE, pluginDownloadPath } from "@/lib/plugin-release";

type Props = {
  connected: { lastIngestAt: string | null } | null;
  // Where step 3's connection code comes from: on Settings it is created right below; elsewhere, a link to Settings.
  codeHere?: boolean;
  children?: React.ReactNode;
};

// Download, install and connect the agentscope-core WordPress plugin, with the connection status.
export function PluginOnboarding({ connected, codeHere = false, children }: Props) {
  return (
    <div className="onboarding">
      <p className="small">
        {connected ? (
          <><span className="badge basis-observed">Connected</span> Last data received: {connected.lastIngestAt ? new Date(connected.lastIngestAt).toUTCString() : "none yet"}</>
        ) : (
          <><span className="badge basis-unavailable">Not connected</span> The plugin counts real visits from AI bots and assistants on your WordPress site.</>
        )}
      </p>
      <a className="button" href={pluginDownloadPath()} download>Download plugin (v{PLUGIN_RELEASE.version})</a>
      <ol className="steps">
        <li>In WordPress: <strong>Plugins → Add New → Upload Plugin</strong>, choose the zip, <strong>Install Now</strong>.</li>
        <li><strong>Activate</strong> AgentScope Core.</li>
        <li>
          Paste the <strong>connection code</strong> in <strong>AgentScope → Settings → Connection token</strong>
          {codeHere ? " (create it below)." : <> (create it in <Link href="/settings">Settings → AI traffic plugin</Link>).</>}
        </li>
        <li>Click <strong>Connect</strong>. Later updates show up in WordPress like any plugin update.</li>
      </ol>
      {children}
    </div>
  );
}
