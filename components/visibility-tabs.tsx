import { useTranslations } from "next-intl";
import { Tabs } from "./tabs";

const TABS = [
  { key: "", label: "tabQa" },
  { key: "/profile", label: "tabProfile" },
  { key: "/share", label: "tabShare" },
  { key: "/citations", label: "tabCitations" },
] as const;

export function VisibilityTabs({ storeId, active }: { storeId: string; active: string }) {
  const t = useTranslations("visibilityPage");
  return <Tabs label={t("title")} active={active} items={TABS.map((x) => ({ key: x.key, href: `/stores/${storeId}/visibility${x.key}`, label: t(x.label) }))} />;
}
