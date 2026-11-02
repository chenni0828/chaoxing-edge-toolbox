import { unzlibSync } from 'fflate';
import { referenceData, referenceSha256 } from './reference.generated';
import { referenceSkiaData } from './reference-skia.generated';

export interface GlyphFeature { bits: Uint8Array; bounds: readonly number[]; }
export interface GlyphCandidate extends GlyphFeature { codepoint: number; variants?: readonly Uint8Array[]; }
export interface GlyphMatch { character?: string; distance: number; margin: number; }
const popcount = Uint8Array.from({ length: 256 }, (_, value) => {
  let bits = 0; for (let n = value; n; n &= n - 1) bits += 1; return bits;
});
let reference: GlyphCandidate[] | undefined;

export function readReferenceTable(bytes: Uint8Array): GlyphCandidate[] {
  if (bytes.length < 8 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'QFR1') throw new Error('本地字体参考表不完整。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(4, true);
  if (count < 1 || count > 100_000 || bytes.length !== 8 + count * 84) throw new Error('本地字体参考表格式错误。');
  return Array.from({ length: count }, (_, index) => {
    const offset = 8 + index * 84;
    const codepoint = view.getUint32(offset, true);
    if (codepoint > 0x10ffff || (codepoint >= 0xd800 && codepoint <= 0xdfff)) throw new Error('本地字体参考表字符错误。');
    return { codepoint, bounds: Array.from({ length: 4 }, (_, i) => view.getInt16(offset + 4 + i * 2, true)), bits: bytes.subarray(offset + 12, offset + 84) };
  });
}
export function getQuestionFontReference(): GlyphCandidate[] {
  if (!reference) {
    const compressed = Uint8Array.from(atob(referenceData), ch => ch.charCodeAt(0));
    const base = readReferenceTable(unzlibSync(compressed));
    const delta = unzlibSync(Uint8Array.from(atob(referenceSkiaData), ch => ch.charCodeAt(0)));
    reference = addReferenceVariants(base, delta, referenceSha256);
  }
  return reference;
}

/** QFD1 stores each Skia bitmap as an XOR delta against the pinned Pillow table. */
export function addReferenceVariants(base: GlyphCandidate[], delta: Uint8Array, digest: string): GlyphCandidate[] {
  if (delta.length < 40 || String.fromCharCode(...delta.subarray(0, 4)) !== 'QFD1') throw new Error('本地字体参考变体不完整。');
  const count = new DataView(delta.buffer, delta.byteOffset, delta.byteLength).getUint32(4, true);
  const baseDigest = Array.from(delta.subarray(8, 40), value => value.toString(16).padStart(2, '0')).join('');
  if (count !== base.length || delta.length !== 40 + count * 73 || baseDigest !== digest) throw new Error('本地字体参考变体不匹配。');
  return base.map((candidate, index) => {
    const offset = 40 + index * 73; const available = delta[offset];
    if (available > 1 || candidate.bits.length !== 72) throw new Error('本地字体参考变体格式错误。');
    if (!available) return candidate;
    const bits = Uint8Array.from(candidate.bits, (value, byte) => value ^ delta[offset + 1 + byte]);
    return bits.some((value, byte) => value !== candidate.bits[byte]) ? { ...candidate, variants: [bits] } : candidate;
  });
}

/** Reject distant, tied and poorly separated matches. Never select a mere nearest neighbour. */
export function matchGlyph(feature: GlyphFeature, candidates = getQuestionFontReference()): GlyphMatch {
  if (feature.bits.length !== 72 || feature.bounds.length !== 4) return { distance: 1, margin: 0 };
  let best = Infinity; let second = Infinity; let winner: number | undefined;
  const distances = new Map<number, number>();
  for (const candidate of candidates) {
    // Exact legacy-font geometry is also required. This prevents an unknown shape being forced
    // into a visually similar reference character after normalizing its bitmap size.
    if (candidate.bits.length !== 72 || candidate.bounds.length !== 4 || candidate.bounds.some((value, index) => Math.abs(value - feature.bounds[index]) > 3)) continue;
    let distance = Infinity;
    for (const bits of [candidate.bits, ...(candidate.variants ?? [])]) {
      if (bits.length !== 72) continue;
      let variantDistance = 0;
      for (let index = 0; index < 72; index += 1) variantDistance += popcount[bits[index] ^ feature.bits[index]];
      distance = Math.min(distance, variantDistance);
    }
    distances.set(candidate.codepoint, Math.min(distance, distances.get(candidate.codepoint) ?? Infinity));
  }
  // Renderer variants belong to one character. Confidence compares different
  // characters, including when callers supply repeated entries for a codepoint.
  for (const [codepoint, distance] of distances) {
    if (distance < best) { second = best; best = distance; winner = codepoint; }
    else if (distance < second) second = distance;
  }
  const normalized = best / 576;
  const margin = best === second || second === 0 ? 0 : second === Infinity ? 1 : 1 - best / second;
  return {
    character: winner !== undefined && normalized <= 0.045 && margin >= 0.3 ? String.fromCodePoint(winner) : undefined,
    distance: Number.isFinite(normalized) ? normalized : 1,
    margin,
  };
}

export { pixelsToFeature } from './pixels';
