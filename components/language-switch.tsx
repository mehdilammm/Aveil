import { getLocale, getTranslations } from "next-intl/server";
import { setLocale } from "@/i18n/actions";
import { LOCALES } from "@/i18n/config";

export async function LanguageSwitch() {
  const [locale, t] = await Promise.all([getLocale(), getTranslations("language")]);
  return (
    <form action={setLocale} className="row language-switch" aria-label={t("label")}>
      {LOCALES.map((l) => (
        <button key={l} name="locale" value={l} className="linklike small" aria-pressed={l === locale} disabled={l === locale}>
          {t(l)}
        </button>
      ))}
    </form>
  );
}
