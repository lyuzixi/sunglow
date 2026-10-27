/* ---------------- nn.py ---------------- */
function nnPredict(feats, m) {
  if (!m || !m.W) return null;
  let h = feats.map((v, i) => (v - m.mean[i]) / (m.std[i] || 1.0));
  for (let i = 0; i < m.W.length; i++) {
    const Wi = m.W[i], Bi = m.B[i];
    const out = [];
    for (let k = 0; k < Wi[0].length; k++) {
      let s = Bi[k];
      for (let j = 0; j < h.length; j++) s += h[j] * Wi[j][k];
      out.push(s);
    }
    h = i < m.W.length - 1 ? out.map(v => Math.tanh(v)) : out;
  }
  const logitV = Math.max(-30.0, Math.min(30.0, h[0]));
  return 1.0 / (1.0 + Math.exp(-logitV));
}

