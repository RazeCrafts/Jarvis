(async () => {
  const out = { devices: [], gum: null, level: null, recorder: null };
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    out.devices = list.filter(d => d.kind === 'audioinput').map(d => ({ id: d.deviceId.slice(0, 8), label: d.label }));
  } catch (e) { out.devices = 'error:' + e; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    out.gum = { ok: true, tracks: stream.getAudioTracks().map(t => ({ label: t.label, state: t.readyState })) };
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    let peak = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      an.getByteTimeDomainData(buf);
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      await new Promise(r => setTimeout(r, 50));
    }
    out.level = peak;
    await ctx.close();
    stream.getTracks().forEach(t => t.stop());
    out.gum.ok = true;
  } catch (e) { out.gum = { ok: false, error: String(e) }; }
  return out;
})()
