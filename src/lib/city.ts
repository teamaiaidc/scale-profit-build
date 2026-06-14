import { DEFAULT_EVENTS } from "./events";

// City aliases — map common variants/regions to a canonical event slug.
const CITY_ALIASES: Record<string, string[]> = {
  boston: ["boston", "massachusetts", "ma", "bos"],
  nashville: ["nashville", "tennessee", "tn", "nash"],
  california: [
    "california",
    "ca",
    "cali",
    "los-angeles",
    "la",
    "orange-county",
    "oc",
    "san-diego",
    "sd",
    "san-francisco",
    "sf",
    "bay-area",
    "anaheim",
    "long-beach",
  ],
};

const slugify = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const isMergeTag = (value: string) => /{{|}}/.test(value);

/**
 * Normalize any city-ish input (slug, city name, region, alias) to a canonical
 * event slug. Recognizes every event defined in DEFAULT_EVENTS plus known
 * regional aliases. Returns undefined when the value is empty / a merge tag.
 */
export function normalizeCity(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || isMergeTag(trimmed)) return undefined;
  const raw = slugify(trimmed);
  if (!raw) return undefined;

  // 1) Exact match against any known event slug or city name.
  for (const event of DEFAULT_EVENTS) {
    if (raw === event.slug || raw === slugify(event.city)) return event.slug;
  }

  // 2) Aliases — substring match so "los-angeles-ca" still resolves.
  for (const [canonical, aliases] of Object.entries(CITY_ALIASES)) {
    if (aliases.some((alias) => raw === alias || raw.includes(alias))) {
      return canonical;
    }
  }

  // 3) Fall back to the slug itself so unknown-but-valid cities still flow through.
  return raw;
}
