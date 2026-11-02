/** Narrow corrections for audited Chaoxing question fonts. */
const FONT_CORRECTIONS: Readonly<Record<string, Readonly<Record<number, string>>>> = Object.freeze({
  c973db604b203c35d5a1eb5123130b5d783da025627414225fb3aaca49ba41f8: Object.freeze({
    [0x5c10]: '\u98de',
  }),
});

/** Return a correction only for an exact audited font and source codepoint. */
export function resolveKnownFontCorrection(fontSha256: string | undefined, sourceCodepoint: number): string | undefined {
  if (!fontSha256) return undefined;
  return FONT_CORRECTIONS[fontSha256.toLowerCase()]?.[sourceCodepoint];
}
