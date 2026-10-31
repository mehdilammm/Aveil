import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { PLUGIN_RELEASE, pluginDownloadPath } from "@/lib/plugin-release";
import { BasisBadge, formatDate } from "./badges";

type Props = {
  connected: { lastIngestAt: string | null } | null;
  // Where step 3's connection code comes from: on Settings it is created right below; elsewhere, a link to Settings.
  codeHere?: boolean;
  children?: React.ReactNode;
};

// Download, install and connect the agentscope-core WordPress plugin, with the connection status.
export function PluginOnboarding({ connected, codeHere = false, children }: Props) {
  const locale = useLocale();
  const t = useTranslations("pluginSteps");
  return (
    <div className="onboarding">
      <p className="small">
        {connected ? (
          <><BasisBadge basis="observed" /> {t("connected")} · {t("last", { date: connected.lastIngestAt ? formatDate(connected.lastIngestAt, locale) : t("none") })}</>
        ) : (
          <><BasisBadge basis="unavailable" /> {t("notConnected")}</>
        )}
      </p>
      <a className="button" href={pluginDownloadPath()} download>{t("download", { version: PLUGIN_RELEASE.version })}</a>
      <ol className="steps">
        <li>{t("s1")}</li>
        <li>{t("s2")}</li>
        <li>{t("s3")} {codeHere ? t("s3here") : <Link href="/settings">{t("s3link")}</Link>}</li>
        <li>{t("s4")}</li>
      </ol>
      {children}
    </div>
  );
}
