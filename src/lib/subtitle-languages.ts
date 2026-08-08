export const SUBTITLE_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "he", name: "Hebrew" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "ja", name: "Japanese" },
  { code: "ar", name: "Arabic" },
] as const;

export type SubtitleLanguageCode = (typeof SUBTITLE_LANGUAGES)[number]["code"];

export const DEFAULT_SUBTITLE_LANGUAGE_ORDER = SUBTITLE_LANGUAGES.map(
  ({ code }) => code
);

export function orderSubtitleLanguages(codes: readonly string[]) {
  const positions = new Map(codes.map((code, index) => [code, index]));
  return [...SUBTITLE_LANGUAGES].sort(
    (a, b) =>
      (positions.get(a.code) ?? Number.MAX_SAFE_INTEGER) -
      (positions.get(b.code) ?? Number.MAX_SAFE_INTEGER)
  );
}
