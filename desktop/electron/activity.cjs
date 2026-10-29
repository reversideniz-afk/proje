// Oynanan oyunu bulma: çalışan programların adları bilinen oyunlarla
// eşleştiriliyor (Windows: tasklist). Sadece oyunun adı arayüze gidiyor;
// program listesinin kendisi hiçbir yere gönderilmiyor. Ayarlar >
// Masaüstü'nden kapatılabiliyor.
const { execFile } = require("child_process");

const CHECK_EVERY_MS = 15_000;

// Program adı (küçük harf) -> oyunun görünen adı.
const KNOWN_GAMES = {
  "valorant-win64-shipping.exe": "VALORANT",
  "cs2.exe": "Counter-Strike 2",
  "league of legends.exe": "League of Legends",
  "dota2.exe": "Dota 2",
  "r5apex.exe": "Apex Legends",
  "r5apex_dx12.exe": "Apex Legends",
  "fortniteclient-win64-shipping.exe": "Fortnite",
  "rocketleague.exe": "Rocket League",
  "gta5.exe": "Grand Theft Auto V",
  "gta5_enhanced.exe": "Grand Theft Auto V",
  "rdr2.exe": "Red Dead Redemption 2",
  "eldenring.exe": "ELDEN RING",
  "overwatch.exe": "Overwatch 2",
  "robloxplayerbeta.exe": "Roblox",
  "minecraft.windows.exe": "Minecraft",
  "rainbowsix.exe": "Rainbow Six Siege",
  "rainbowsix_vulkan.exe": "Rainbow Six Siege",
  "tslgame.exe": "PUBG: BATTLEGROUNDS",
  "cod.exe": "Call of Duty",
  "cyberpunk2077.exe": "Cyberpunk 2077",
  "witcher3.exe": "The Witcher 3",
  "among us.exe": "Among Us",
  "phasmophobia.exe": "Phasmophobia",
  "lethal company.exe": "Lethal Company",
  "deadbydaylight-win64-shipping.exe": "Dead by Daylight",
  "helldivers2.exe": "HELLDIVERS 2",
  "marvel-win64-shipping.exe": "Marvel Rivals",
  "terraria.exe": "Terraria",
  "stardew valley.exe": "Stardew Valley",
  "valheim.exe": "Valheim",
  "eurotrucks2.exe": "Euro Truck Simulator 2",
  "rust.exe": "Rust",
  "metin2client.exe": "Metin2",
  "knightonline.exe": "Knight Online",
  "zula.exe": "Zula",
  "wolfteam.bin": "Wolfteam",
};

function gameFromProcesses(names) {
  for (const name of names) {
    const game = KNOWN_GAMES[name.toLowerCase()];
    if (game) return game;
  }
  return null;
}

// Windows'ta çalışan programların adları ("tasklist" CSV çıktısının ilk sütunu).
function listProcesses() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve([]);
    execFile("tasklist", ["/fo", "csv", "/nh"], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(stdout.split(/\r?\n/).map((line) => line.split('","')[0].replace(/^"/, "")).filter(Boolean));
    });
  });
}

// onChange(oyunAdı | null): oyun değişince. setEnabled(true) ile başlıyor;
// kapatılınca son oyun null olarak bildiriliyor. listProcesses testlerde
// değiştirilebiliyor.
function createActivityDetector(onChange, options = {}) {
  const state = { enabled: false, current: null, timer: null, listProcesses: options.listProcesses || listProcesses };

  async function check() {
    if (!state.enabled) return;
    const game = gameFromProcesses(await state.listProcesses());
    if (!state.enabled || game === state.current) return;
    state.current = game;
    onChange(game);
  }

  return {
    check,
    setEnabled(enabled) {
      if (enabled === state.enabled) return;
      state.enabled = enabled;
      clearInterval(state.timer);
      state.timer = null;
      if (enabled) {
        state.timer = setInterval(check, CHECK_EVERY_MS);
        check();
      } else if (state.current) {
        state.current = null;
        onChange(null);
      }
    },
    setProcessLister(lister) {
      state.listProcesses = lister;
    },
    stop() {
      state.enabled = false;
      clearInterval(state.timer);
    },
  };
}

module.exports = { createActivityDetector, gameFromProcesses, KNOWN_GAMES };
