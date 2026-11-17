// 404 inside a brokerage site (unknown listing or page), in the site's language
import { extraDict } from "@/lib/i18n/extra";
import { SUPPORTED_LANGUAGES } from "@/lib/i18n/languages";
import NotFoundView from "@/components/site/NotFoundView";

export default function SiteNotFound() {
  // not-found receives no params: hand the few strings of every language to the view, which reads the route
  const texts = Object.fromEntries(SUPPORTED_LANGUAGES.map(l => [l.code, extraDict(l.code).site.notFound]));
  return <NotFoundView texts={texts} pathMode={!process.env.PLATFORM_DOMAIN} />;
}
