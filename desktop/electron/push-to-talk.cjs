// Global bas-konuş: Disco arka plandayken (oyundayken, tepsideyken) de
// bas-konuş tuşunu algılıyor. İşletim sisteminin klavye/fare kancası
// (uiohook) sadece bir tuş atanmışken çalışıyor ve sadece o tuşun basılıp
// bırakıldığı bildiriliyor; başka hiçbir tuş hiçbir yere gitmiyor.
const { uIOhook, UiohookKey } = require("uiohook-napi");

// Tarayıcının KeyboardEvent.code adları -> uiohook tuş kodları. Harf, rakam,
// F tuşları, sayısal tuş takımı ve noktalama aynı adı taşıyor.
const RENAMED = {
  ControlLeft: "Ctrl",
  ControlRight: "CtrlRight",
  AltLeft: "Alt",
  AltRight: "AltRight",
  ShiftLeft: "Shift",
  ShiftRight: "ShiftRight",
  MetaLeft: "Meta",
  MetaRight: "MetaRight",
};

// Atanan tuş: { keycode } ya da { button }. Fare: 'Mouse4' / 'Mouse5'
// (uiohook'ta fare tuşları 1'den başlıyor: 4 geri, 5 ileri).
function bindingFor(code) {
  const mouse = /^Mouse([45])$/.exec(code);
  if (mouse) return { button: Number(mouse[1]) };
  const name = RENAMED[code] || code.replace(/^Key|^Digit/, "");
  const keycode = UiohookKey[name];
  return typeof keycode === "number" ? { keycode } : null;
}

// onChange(basılı mı) tuş durumu değişince çağrılıyor.
function createPushToTalk(onChange) {
  let binding = null;
  let pressed = false;
  let running = false;

  const update = (down) => {
    if (down === pressed) return; // basılı tutunca tekrar eden olaylar
    pressed = down;
    onChange(down);
  };
  uIOhook.on("keydown", (e) => binding?.keycode === e.keycode && update(true));
  uIOhook.on("keyup", (e) => binding?.keycode === e.keycode && update(false));
  uIOhook.on("mousedown", (e) => binding?.button === e.button && update(true));
  uIOhook.on("mouseup", (e) => binding?.button === e.button && update(false));

  return {
    uIOhook,
    // code: KeyboardEvent.code ya da 'Mouse4'/'Mouse5'; null kancayı kapatır.
    // Tanınmayan bir tuşsa false döner.
    setKey(code) {
      if (pressed) update(false);
      binding = code ? bindingFor(code) : null;
      if (binding && !running) {
        try {
          uIOhook.start();
          running = true;
        } catch (err) {
          console.error("[bas-konuş] klavye kancası başlatılamadı:", err?.message || err);
          binding = null;
          return false;
        }
      } else if (!binding && running) {
        uIOhook.stop();
        running = false;
      }
      return !code || !!binding;
    },
    isRunning: () => running,
    stop() {
      binding = null;
      if (running) uIOhook.stop();
      running = false;
    },
  };
}

module.exports = { createPushToTalk, bindingFor };
