/** Crop to actual ink, then compute the same integral-grid features as the offline generator. */
export function pixelsToFeature(data: Uint8ClampedArray, width: number, height: number): Uint8Array | undefined {
  if (width < 1 || height < 1 || width > 1024 || height > 1024 || data.length !== width * height * 4) return undefined;
  let left = width; let right = -1; let top = height; let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 40) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
  }
  if (right < left || bottom < top) return undefined;
  const w = right - left + 1; const h = bottom - top + 1; const stride = w + 1;
  const sums = new Uint32Array((h + 1) * stride);
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) {
      row += data[((top + y) * width + left + x) * 4 + 3];
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  const bits = new Uint8Array(72);
  for (let y = 0; y < 24; y += 1) {
    const y0 = Math.floor(y * h / 24); const y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / 24));
    for (let x = 0; x < 24; x += 1) {
      const x0 = Math.floor(x * w / 24); const x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / 24));
      const total = sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0];
      const index = y * 24 + x;
      if (total > 96 * (x1 - x0) * (y1 - y0)) bits[index >> 3] |= 1 << (7 - (index & 7));
    }
  }
  return bits;
}
