// Numbers abbreviate past 10,000 (design bible section 7): K, M, B, T, Qa, Qi...
const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

export function formatAmount(n: number): string {
  const sign = n < 0 ? '-' : '';
  let v = Math.abs(n);
  if (v < 10000) return sign + Math.floor(v).toLocaleString('en-US');
  let i = 0;
  while (v >= 1000 && i < SUFFIXES.length - 1) {
    v /= 1000;
    i++;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  const text = (Math.floor(v * 10 ** digits) / 10 ** digits).toFixed(digits).replace(/\.?0+$/, '');
  return sign + text + SUFFIXES[i];
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
