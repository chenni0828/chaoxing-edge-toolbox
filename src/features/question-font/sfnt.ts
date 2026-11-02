/** Bounded SFNT reader. Only cmap and metrics are read; glyph code is never executed. */
export interface FontGlyph { id: number; bounds: [number, number, number, number]; }
export interface ParsedQuestionFont { unitsPerEm: number; glyphs: Map<number, FontGlyph>; }

export function parseQuestionFont(bytes: Uint8Array): ParsedQuestionFont {
  if (bytes.length < 28 || bytes.length > 2_000_000) throw new Error('字体数据大小不受支持。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const range = (start: number, length: number): void => {
    if (!Number.isInteger(start) || start < 0 || length < 0 || start + length > bytes.length) throw new Error('字体数据不完整。');
  };
  const u16 = (offset: number): number => { range(offset, 2); return view.getUint16(offset); };
  const i16 = (offset: number): number => { range(offset, 2); return view.getInt16(offset); };
  const u32 = (offset: number): number => { range(offset, 4); return view.getUint32(offset); };
  if (u32(0) !== 0x00010000) throw new Error('此加密字体格式暂不支持。');
  const count = u16(4);
  if (count < 1 || count > 64) throw new Error('字体目录不受支持。');
  const tables = new Map<string, { offset: number; length: number }>();
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 16; range(at, 16);
    const tag = String.fromCharCode(...bytes.subarray(at, at + 4));
    const offset = u32(at + 8); const length = u32(at + 12); range(offset, length);
    if (tables.has(tag)) throw new Error('字体目录重复。');
    tables.set(tag, { offset, length });
  }
  function table(tag: string, minimum: number): number {
    const entry = tables.get(tag);
    if (!entry || entry.length < minimum) throw new Error('字体缺少必要的数据。');
    return entry.offset;
  }
  const head = table('head', 54); const unitsPerEm = u16(head + 18);
  const glyphCount = u16(table('maxp', 6) + 4);
  if (unitsPerEm < 16 || unitsPerEm > 16384 || glyphCount < 1) throw new Error('字体尺寸不受支持。');
  const longLoca = i16(head + 50);
  if (longLoca !== 0 && longLoca !== 1) throw new Error('字体索引不受支持。');
  const loca = table('loca', (glyphCount + 1) * (longLoca ? 4 : 2));
  const glyf = table('glyf', 0); const glyphLength = tables.get('glyf')!.length;
  const glyph = (id: number): FontGlyph | undefined => {
    if (!id || id >= glyphCount) return undefined;
    const offset = longLoca ? u32(loca + id * 4) : u16(loca + id * 2) * 2;
    const end = longLoca ? u32(loca + (id + 1) * 4) : u16(loca + (id + 1) * 2) * 2;
    if (end < offset || end > glyphLength) throw new Error('字形索引越界。');
    if (end - offset < 10) return undefined;
    return { id, bounds: [i16(glyf + offset + 2), i16(glyf + offset + 4), i16(glyf + offset + 6), i16(glyf + offset + 8)] };
  };
  const cmap = table('cmap', 4); const cmapEnd = cmap + tables.get('cmap')!.length;
  const subCount = u16(cmap + 2);
  if (subCount > 64 || cmap + 4 + subCount * 8 > cmapEnd) throw new Error('字符索引不完整。');
  const subtables: number[] = [];
  for (let index = 0; index < subCount; index += 1) {
    const at = cmap + 4 + index * 8; const platform = u16(at); const encoding = u16(at + 2);
    if (platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))) {
      const offset = cmap + u32(at + 4);
      if (offset < cmap || offset + 2 > cmapEnd) throw new Error('字符索引越界。');
      subtables.push(offset);
    }
  }
  const mappings = new Map<number, number>();
  const selected = subtables.find(offset => u16(offset) === 12) ?? subtables.find(offset => u16(offset) === 4);
  if (selected === undefined) throw new Error('字符映射格式暂不支持。');
  if (u16(selected) === 12) {
    const length = u32(selected + 4); const groups = u32(selected + 12);
    if (length < 16 || selected + length > cmapEnd || groups > 65536 || 16 + groups * 12 > length) throw new Error('字符映射不完整。');
    for (let index = 0; index < groups; index += 1) {
      const at = selected + 16 + index * 12; const start = u32(at); const end = u32(at + 4); const id = u32(at + 8);
      if (start > end || end > 0x10ffff || end - start > 65536 || mappings.size + end - start + 1 > 65536) throw new Error('字符映射过大。');
      for (let cp = start; cp <= end; cp += 1) mappings.set(cp, id + cp - start);
    }
  } else {
    const length = u16(selected + 2); const segments = u16(selected + 6) / 2;
    if (!Number.isInteger(segments) || segments < 1 || length < 16 + segments * 8 || selected + length > cmapEnd) throw new Error('字符映射不完整。');
    const ends = selected + 14; const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2; const offsets = deltas + segments * 2;
    for (let index = 0; index < segments; index += 1) {
      const start = u16(starts + index * 2); const end = u16(ends + index * 2);
      if (start > end || mappings.size + end - start + 1 > 65536) throw new Error('字符映射过大。');
      for (let cp = start; cp <= end && cp < 0xffff; cp += 1) {
        const delta = i16(deltas + index * 2); const offset = u16(offsets + index * 2);
        let id: number;
        if (offset) {
          const at = offsets + index * 2 + offset + (cp - start) * 2;
          if (at + 2 > selected + length) throw new Error('字符映射越界。');
          id = u16(at); if (id) id = (id + delta) & 0xffff;
        } else id = (cp + delta) & 0xffff;
        mappings.set(cp, id);
      }
    }
  }
  const glyphs = new Map<number, FontGlyph>();
  for (const [cp, id] of mappings) { const value = glyph(id); if (value) glyphs.set(cp, value); }
  return { unitsPerEm, glyphs };
}
