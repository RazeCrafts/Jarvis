(async () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return { supported: false };
  const log = [];
  const started = { ok: false, error: null };
  const rec = new SR();
  rec.lang = 'en-US';
  rec.continuous = false;
  rec.interimResults = true;
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { rec.stop(); } catch (e) {}
      resolve({ outcome: 'timeout', log });
    }, 9000);
    rec.onstart = () => log.push('start');
    rec.onaudiostart = () => log.push('audiostart');
    rec.onspeechend = () => log.push('speechend');
    rec.onresult = (e) => {
      log.push('result:' + String(e.results[0][0].transcript));
    };
    rec.onerror = (e) => {
      log.push('error:' + e.error);
      clearTimeout(timer);
      resolve({ outcome: 'error', error: e.error, log });
    };
    rec.onend = () => {
      log.push('end');
      clearTimeout(timer);
      resolve({ outcome: 'end', log });
    };
    try {
      rec.start();
      started.ok = true;
    } catch (e) {
      clearTimeout(timer);
      resolve({ outcome: 'throw', error: String(e), log });
    }
  });
  // Also probe TTS with a boundary/end event.
  const tts = await new Promise((resolve) => {
    try {
      const u = new SpeechSynthesisUtterance('test');
      u.volume = 0.01;
      u.onend = () => resolve({ ok: true, event: 'end' });
      u.onerror = (e) => resolve({ ok: false, event: 'error', error: String(e.error || e) });
      setTimeout(() => resolve({ ok: false, event: 'timeout' }), 5000);
      window.speechSynthesis.speak(u);
    } catch (e) {
      resolve({ ok: false, event: 'throw', error: String(e) });
    }
  });
  return { supported: true, started, result, tts };
})()
