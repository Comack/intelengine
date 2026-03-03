export function miniSparkline(data: number[] | undefined, change: number | null, w = 50, h = 16): string {
  if (!data || data.length < 2) return '';
  const safeData = data.filter(Number.isFinite);
  if (safeData.length < 2) return '';
  const min = safeData.reduce((a, b) => a < b ? a : b, safeData[0]!);
  const max = safeData.reduce((a, b) => a > b ? a : b, safeData[0]!);
  const range = max - min || 1;
  const color = change != null && change >= 0 ? 'var(--green)' : 'var(--red)';
  const points = safeData.map((v, i) => {
    const x = (i / (safeData.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="mini-sparkline"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
