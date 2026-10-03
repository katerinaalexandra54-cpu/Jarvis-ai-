// Small safe expression evaluator for the calculator (no eval).
export function evaluate(input) {
  let s = input.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, '');
  const open = (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
  s += ')'.repeat(Math.max(0, open));
  let i = 0;
  const peek = () => s[i];
  function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; }
  function term() { let v = factor(); while (peek() === '*' || peek() === '/') { const op = s[i++]; const r = factor(); v = op === '*' ? v * r : v / r; } return v; }
  function factor() {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    let v = atom();
    while (peek() === '%') { i++; v /= 100; }
    return v;
  }
  function atom() {
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error('bad'); i++; return v; }
    const m = /^\d*\.?\d+/.exec(s.slice(i)) || /^\d+\.?/.exec(s.slice(i));
    if (!m) throw new Error('bad');
    i += m[0].length; return parseFloat(m[0]);
  }
  const out = expr();
  if (i !== s.length || !Number.isFinite(out)) throw new Error('bad');
  return out;
}
export const fmt = n => new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(n);
