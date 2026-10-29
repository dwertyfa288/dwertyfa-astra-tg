export interface UiAutoReplyRule {
  id: string;
  triggers: string[];
  response: string;
}

export function loginTimerView(
  state: { codeRequestedAt: number; codeResendWaitSeconds: number; codeResendAllowed: boolean },
  now: number,
  receivedAt: number,
): { text: string; disabled: boolean } {
  const elapsed = Math.max(0, Math.floor((now - state.codeRequestedAt) / 1000));
  const remaining = Math.max(0, state.codeResendWaitSeconds - Math.floor(Math.max(0, now - receivedAt) / 1000));
  const seconds = state.codeResendAllowed && remaining > 0 ? remaining : elapsed;
  const time = String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  if (!state.codeResendAllowed) return { text: "Ждём код · " + time, disabled: true };
  if (remaining > 0) return { text: "Повтор через " + time, disabled: true };
  return { text: "Запросить код повторно", disabled: false };
}

export function consumeAutoReplyTriggerInput(
  value: string,
  commitAll: boolean,
): { committed: string[]; remainder: string } {
  const parts = value.split(",");
  const shouldCommit = commitAll ? parts : parts.slice(0, -1);
  const committed = shouldCommit
    .map((part) => part.trim().replace(/\s+/gu, " ").slice(0, 300))
    .filter(Boolean);
  const remainder = commitAll ? "" : String(parts.at(-1) ?? "").slice(0, 300);
  return { committed, remainder };
}

export function validateAutoReplyRulesForSave(
  enabled: boolean,
  rules: UiAutoReplyRule[],
): string {
  if (!enabled) return "";
  if (!rules.length) return "Добавьте хотя бы одно правило автоответчика";
  if (rules.some((rule) => !rule.triggers.length || !rule.response.trim())) {
    return "Заполните триггеры и ответ во всех правилах автоответчика";
  }
  return "";
}

export function renderAppHtml(): string {
  return String.raw`<!doctype html>
<html lang="ru">
<head>
  <script src="http://astra-plugin.localhost/bridge/astra-bridge.js"></script>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TG for Astra</title>
  <style>
    :root {
      color-scheme: normal;
      --canvas: transparent;
      --canvas-soft: color-mix(in srgb, var(--color-surface, #0d0d15) 65%, transparent);
      --surface: color-mix(in srgb, var(--color-surface, #14141f) 78%, transparent);
      --surface-strong: color-mix(in srgb, var(--color-surface, #1b1b2a) 92%, transparent);
      --surface-hover: var(--color-surface-hover, rgba(34, 34, 51, .88));
      --text: var(--color-text, #f7f6ff);
      --text-soft: color-mix(in srgb, var(--color-text, #f7f6ff) 78%, transparent);
      --muted: var(--color-text-muted, #89869b);
      --stroke: var(--color-border, rgba(255, 255, 255, .09));
      --stroke-strong: var(--edge-control, rgba(255, 255, 255, .16));
      --violet: var(--color-accent, #8b5cf6);
      --violet-bright: #a78bfa;
      --blue: #48a8ff;
      --cyan: #5ce1e6;
      --pink: #ec78bb;
      --success: #58dfa5;
      --warning: #ffc76b;
      --danger: #ff7185;
      --shadow: 0 24px 80px rgba(0, 0, 0, .38);
      --radius-xl: 26px;
      --radius-lg: 19px;
      --radius-control: var(--radius-md, 13px);
    }

    * { box-sizing: border-box; }
    * { scrollbar-width: none; }
    *::-webkit-scrollbar { display: none; }
    html { min-height: 100%; background: transparent; }
    body {
      color-scheme: light dark;
      min-height: 100vh;
      margin: 0;
      overflow-x: hidden;
      background: transparent;
      color: var(--text);
      font: 14px/1.5 var(--font-sans, Inter, "SF Pro Display", "Segoe UI", system-ui, sans-serif);
      -webkit-font-smoothing: antialiased;
      user-select: none;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      z-index: -3;
      pointer-events: none;
      opacity: .22;
      background-image:
        linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
      background-size: 44px 44px;
      mask-image: linear-gradient(to bottom, black, transparent 84%);
    }

    .ambient { position: fixed; inset: 0; z-index: -2; overflow: hidden; pointer-events: none; }
    .orb { position: absolute; border-radius: 50%; filter: blur(2px); opacity: .4; will-change: transform; }
    .orb.one {
      width: 520px; height: 520px; top: -280px; left: -120px;
      background: radial-gradient(circle, rgba(113, 75, 219, .52), rgba(113,75,219,0) 68%);
      animation: driftOne 16s ease-in-out infinite alternate;
    }
    .orb.two {
      width: 450px; height: 450px; top: 26%; right: -250px;
      background: radial-gradient(circle, rgba(47, 146, 230, .36), rgba(47,146,230,0) 70%);
      animation: driftTwo 20s ease-in-out infinite alternate;
    }
    .orb.three {
      width: 330px; height: 330px; bottom: -210px; left: 34%;
      background: radial-gradient(circle, rgba(218, 88, 165, .22), rgba(218,88,165,0) 70%);
      animation: driftThree 18s ease-in-out infinite alternate;
    }

    button, input, textarea { font: inherit; }
    button { -webkit-tap-highlight-color: transparent; }
    input::placeholder, textarea::placeholder { color: #666477; }
    ::selection { background: rgba(139, 92, 246, .42); color: #fff; }
    input, textarea { user-select: text; }
    [hidden] { display: none !important; }

    .shell { width: min(1180px, 100%); margin: 0 auto; padding: 34px 28px 70px; }
    .hero {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      padding: 8px 4px 28px;
      animation: enter .65s cubic-bezier(.2,.8,.2,1) both;
    }
    .brand { display: flex; align-items: center; gap: 17px; min-width: 0; }
    .brand-mark {
      position: relative;
      display: grid;
      place-items: center;
      width: 58px;
      height: 58px;
      flex: 0 0 auto;
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 19px;
      background:
        linear-gradient(145deg, rgba(255,255,255,.16), rgba(255,255,255,.035)),
        linear-gradient(145deg, rgba(125, 85, 235, .7), rgba(38, 137, 224, .58));
      box-shadow: 0 15px 44px rgba(95, 65, 205, .3), inset 0 1px rgba(255,255,255,.2);
      overflow: hidden;
    }
    .brand-mark::after {
      content: "";
      position: absolute;
      width: 74px; height: 18px;
      border: 1px solid rgba(255,255,255,.3);
      border-radius: 50%;
      transform: rotate(-32deg);
      animation: orbit 9s linear infinite;
    }
    .brand-mark svg { position: relative; z-index: 1; width: 31px; height: 31px; filter: drop-shadow(0 3px 8px rgba(0,0,0,.25)); }
    .brand-copy { min-width: 0; }
    .brand-copy h1 { margin: 0; font-size: clamp(25px, 3vw, 34px); letter-spacing: -.035em; line-height: 1.08; font-weight: 760; }
    .brand-copy p { margin: 7px 0 0; color: var(--muted); font-size: 13px; letter-spacing: .01em; }
    .astra-word {
      background: linear-gradient(95deg, #c9b7ff 4%, #81c6ff 58%, #79ebe9);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      min-height: 38px;
      padding: 8px 13px;
      border: 1px solid var(--stroke);
      border-radius: 999px;
      background: rgba(16,16,25,.72);
      color: var(--muted);
      box-shadow: inset 0 1px rgba(255,255,255,.035), 0 10px 32px rgba(0,0,0,.18);
      backdrop-filter: blur(18px);
      white-space: nowrap;
      transition: border-color .3s ease, background .3s ease, color .3s ease, transform .3s ease;
    }
    .status:hover { transform: translateY(-1px); border-color: var(--stroke-strong); }
    .status-dot { position: relative; width: 8px; height: 8px; border-radius: 50%; background: #656273; box-shadow: 0 0 0 4px rgba(101,98,115,.09); }
    .status.ok { color: #a9f2d0; border-color: rgba(88,223,165,.26); background: rgba(32,91,67,.18); }
    .status.ok .status-dot { background: var(--success); box-shadow: 0 0 0 4px rgba(88,223,165,.1), 0 0 18px rgba(88,223,165,.7); animation: pulse 2.2s ease-out infinite; }
    .status.warn { color: #ffe0a7; border-color: rgba(255,199,107,.25); background: rgba(105,76,25,.16); }
    .status.warn .status-dot { background: var(--warning); box-shadow: 0 0 0 4px rgba(255,199,107,.09); animation: breathe 1.8s ease-in-out infinite; }
    .status.error { color: #ffc0ca; border-color: rgba(255,113,133,.25); background: rgba(99,32,43,.18); }
    .status.error .status-dot { background: var(--danger); box-shadow: 0 0 14px rgba(255,113,133,.55); }

    .overview {
      display: grid;
      grid-template-columns: repeat(3, minmax(0,1fr));
      gap: 11px;
      margin-bottom: 16px;
      animation: enter .65s .08s cubic-bezier(.2,.8,.2,1) both;
    }
    .metric {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 67px;
      padding: 12px 14px;
      border: 1px solid var(--stroke);
      border-radius: 17px;
      background: rgba(17,17,27,.54);
      box-shadow: inset 0 1px rgba(255,255,255,.025);
      backdrop-filter: blur(14px);
    }
    .metric-icon { display: grid; place-items: center; width: 37px; height: 37px; flex: 0 0 auto; border-radius: 12px; color: #c9b9ff; background: rgba(139,92,246,.12); border: 1px solid rgba(139,92,246,.16); }
    .metric:nth-child(2) .metric-icon { color: #97d3ff; background: rgba(72,168,255,.11); border-color: rgba(72,168,255,.16); }
    .metric:nth-child(3) .metric-icon { color: #8eebe6; background: rgba(92,225,230,.1); border-color: rgba(92,225,230,.15); }
    .metric-icon svg { width: 18px; height: 18px; }
    .metric-copy { min-width: 0; }
    .metric-label { display: block; margin-bottom: 2px; color: #716e82; font-size: 10px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
    .metric-value { display: block; overflow: hidden; color: var(--text-soft); font-size: 13px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }

    .dashboard { display: grid; grid-template-columns: minmax(0, .92fr) minmax(0, 1.08fr); gap: 16px; }
    .card {
      position: relative;
      min-width: 0;
      padding: 23px;
      overflow: hidden;
      border: 1px solid var(--stroke);
      border-radius: var(--radius-xl);
      background:
        linear-gradient(145deg, rgba(255,255,255,.045), transparent 40%),
        var(--surface);
      box-shadow: var(--shadow), inset 0 1px rgba(255,255,255,.045);
      backdrop-filter: blur(24px) saturate(1.08);
      transition: border-color .35s ease, transform .35s cubic-bezier(.2,.8,.2,1), box-shadow .35s ease;
      animation: cardEnter .7s var(--delay, .12s) cubic-bezier(.2,.8,.2,1) both;
    }
    .card::before {
      content: "";
      position: absolute;
      top: -1px;
      left: 8%;
      width: 45%;
      height: 1px;
      opacity: .65;
      background: linear-gradient(90deg, transparent, var(--card-glow, rgba(167,139,250,.75)), transparent);
    }
    .card::after {
      content: "";
      position: absolute;
      width: 180px; height: 180px;
      top: -120px; right: -100px;
      border-radius: 50%;
      background: radial-gradient(circle, var(--card-aura, rgba(139,92,246,.1)), transparent 70%);
      pointer-events: none;
      transition: transform .5s ease, opacity .5s ease;
    }
    .card:hover { transform: translateY(-2px); border-color: rgba(255,255,255,.14); box-shadow: 0 30px 90px rgba(0,0,0,.43), inset 0 1px rgba(255,255,255,.06); }
    .card:hover::after { transform: scale(1.18); opacity: 1.35; }
    .chat-card { --card-glow: rgba(72,168,255,.7); --card-aura: rgba(72,168,255,.12); }
    .settings-card { --card-glow: rgba(92,225,230,.6); --card-aura: rgba(92,225,230,.09); }
    .voice-card { --card-glow: rgba(236,120,187,.58); --card-aura: rgba(236,120,187,.09); }
    .wide { grid-column: 1 / -1; }

    .card-head { position: relative; z-index: 1; display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 19px; }
    .section-title { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
    .section-index {
      display: grid;
      place-items: center;
      width: 31px; height: 31px;
      flex: 0 0 auto;
      border: 1px solid rgba(167,139,250,.18);
      border-radius: 10px;
      background: rgba(139,92,246,.11);
      color: #c8b8ff;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .04em;
    }
    .chat-card .section-index { color: #9bd6ff; background: rgba(72,168,255,.1); border-color: rgba(72,168,255,.17); }
    .settings-card .section-index { color: #9aeeea; background: rgba(92,225,230,.09); border-color: rgba(92,225,230,.15); }
    .voice-card .section-index { color: #f4add4; background: rgba(236,120,187,.09); border-color: rgba(236,120,187,.15); }
    .card h2 { margin: 1px 0 3px; font-size: 17px; line-height: 1.25; letter-spacing: -.012em; font-weight: 700; }
    .subtitle { margin: 0; color: var(--muted); font-size: 12px; }
    .card-icon { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 auto; color: #777388; }
    .card-icon svg { width: 21px; height: 21px; }

    .notice {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 16px;
      padding: 12px 13px;
      border: 1px solid rgba(72,168,255,.12);
      border-radius: var(--radius-control);
      background: rgba(72,168,255,.055);
      color: #a7a4b7;
      font-size: 11px;
    }
    .notice svg { width: 16px; height: 16px; flex: 0 0 auto; margin-top: 1px; color: #79beff; }
    .notice b { color: #d9d7e3; font-weight: 650; }
    .muted, .hint { color: var(--muted); }
    .hint { margin: 7px 0 0; font-size: 11px; }
    .hint b { color: var(--text-soft); }
    .error {
      margin-top: 13px;
      padding: 10px 12px;
      border: 1px solid rgba(255,113,133,.18);
      border-radius: 11px;
      background: rgba(255,113,133,.075);
      color: #ffb4c0;
      font-size: 12px;
      white-space: pre-wrap;
      animation: shake .32s ease both;
    }
    .error:empty { display: none; }

    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { min-width: 0; }
    .field.full { grid-column: 1 / -1; }
    label.field-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 7px; color: #aaa7b8; font-size: 11px; font-weight: 680; letter-spacing: .025em; }
    .field-note { color: #625f70; font-size: 9px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
    input, textarea {
      width: 100%;
      border: 1px solid var(--stroke);
      border-radius: 12px;
      outline: none;
      background: rgba(8,8,14,.52);
      color: var(--text);
      box-shadow: inset 0 1px 2px rgba(0,0,0,.16);
      transition: border-color .22s ease, box-shadow .22s ease, background .22s ease, transform .22s ease;
    }
    input { height: 43px; padding: 0 12px; }
    textarea { min-height: 88px; padding: 11px 12px; resize: vertical; }
    input:hover, textarea:hover { border-color: rgba(255,255,255,.14); background: rgba(11,11,18,.68); }
    input:focus, textarea:focus {
      border-color: rgba(139,92,246,.68);
      background: rgba(12,11,21,.86);
      box-shadow: 0 0 0 4px rgba(139,92,246,.1), 0 12px 28px rgba(0,0,0,.18);
      transform: translateY(-1px);
    }
    .chat-card input:focus { border-color: rgba(72,168,255,.66); box-shadow: 0 0 0 4px rgba(72,168,255,.09); }

    .auth-stage { margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,.065); animation: unfold .35s ease both; }
    .actions { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-top: 15px; }
    button {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 39px;
      padding: 8px 14px;
      overflow: hidden;
      border: 1px solid var(--stroke-strong);
      border-radius: 11px;
      background: rgba(255,255,255,.055);
      color: #d8d6e1;
      box-shadow: inset 0 1px rgba(255,255,255,.045);
      font-size: 12px;
      font-weight: 680;
      cursor: pointer;
      transition: transform .2s ease, border-color .2s ease, background .2s ease, box-shadow .2s ease, color .2s ease;
    }
    button::before {
      content: "";
      position: absolute;
      inset: 0;
      transform: translateX(-115%);
      background: linear-gradient(100deg, transparent 20%, rgba(255,255,255,.14), transparent 80%);
      transition: transform .55s ease;
    }
    button:hover { transform: translateY(-1px); border-color: rgba(255,255,255,.24); background: rgba(255,255,255,.085); color: #fff; box-shadow: 0 10px 24px rgba(0,0,0,.2); }
    button:hover::before { transform: translateX(115%); }
    button:active { transform: translateY(0) scale(.985); }
    button:disabled { opacity: .52; cursor: wait; transform: none; }
    button svg { width: 15px; height: 15px; flex: 0 0 auto; }
    button.primary {
      border-color: rgba(159,128,255,.62);
      background: linear-gradient(135deg, #8a5cf1, #5c70e7 52%, #3d9adc);
      color: #fff;
      box-shadow: 0 10px 30px rgba(100,72,215,.28), inset 0 1px rgba(255,255,255,.22);
    }
    button.primary:hover { border-color: rgba(190,169,255,.82); background: linear-gradient(135deg, #956af7, #687aee 52%, #4aa8e8); box-shadow: 0 14px 36px rgba(100,72,215,.38), inset 0 1px rgba(255,255,255,.25); }
    button.danger { color: #ff9ead; border-color: rgba(255,113,133,.22); background: rgba(255,113,133,.07); }
    button.danger:hover { color: #ffc0ca; border-color: rgba(255,113,133,.38); background: rgba(255,113,133,.12); }
    button.is-busy { color: transparent !important; }
    button.is-busy::after {
      content: "";
      position: absolute;
      width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,.35);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin .75s linear infinite;
    }

    .account {
      display: flex;
      align-items: center;
      gap: 13px;
      padding: 15px;
      border: 1px solid rgba(88,223,165,.16);
      border-radius: 16px;
      background: linear-gradient(135deg, rgba(88,223,165,.08), rgba(72,168,255,.045));
      animation: connected .55s cubic-bezier(.2,.8,.2,1) both;
    }
    .avatar { position: relative; display: grid; place-items: center; width: 46px; height: 46px; flex: 0 0 auto; border-radius: 15px; background: linear-gradient(145deg,#46bdff,#4777e7); box-shadow: 0 10px 25px rgba(50,139,220,.25); }
    .avatar svg { width: 25px; height: 25px; }
    .avatar::after { content: ""; position: absolute; right: -2px; bottom: -2px; width: 10px; height: 10px; border: 3px solid #151822; border-radius: 50%; background: var(--success); box-shadow: 0 0 10px rgba(88,223,165,.65); }
    .account-copy { min-width: 0; flex: 1; }
    .account-copy strong { display: block; overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
    .account-copy span { display: block; margin-top: 2px; font-size: 11px; }
    .verified { display: inline-flex; align-items: center; gap: 5px; color: #8ce9bd; font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
    .icon-btn { width: 36px; min-height: 36px; padding: 0; flex: 0 0 auto; border-radius: 12px; }
    .icon-btn svg { width: 17px; height: 17px; }
    .icon-btn .eye-off { display: none; }
    button.on { color: #9bd6ff; border-color: rgba(72,168,255,.38); background: rgba(72,168,255,.12); }
    .icon-btn.on .eye-on { display: none; }
    .icon-btn.on .eye-off { display: block; }
    .masked { color: #8b8899 !important; letter-spacing: .18em; }

    .chat-tools { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-bottom: 10px; }
    .search-wrap { position: relative; flex: 1 1 150px; min-width: 0; }
    .search-wrap svg { position: absolute; z-index: 1; top: 50%; left: 12px; width: 15px; height: 15px; color: #6e6b7d; transform: translateY(-50%); pointer-events: none; }
    .search-wrap input { padding-left: 36px; }
    .chat-list {
      min-height: 198px;
      max-height: 328px;
      overflow: auto;
      border: 1px solid rgba(255,255,255,.07);
      border-radius: 15px;
      background: rgba(7,7,12,.36);
    }
    .chat {
      position: relative;
      display: flex;
      align-items: center;
      gap: 11px;
      min-height: 57px;
      padding: 9px 11px;
      border-bottom: 1px solid rgba(255,255,255,.055);
      cursor: pointer;
      transition: background .2s ease, padding-left .2s ease;
      animation: listItem .38s calc(var(--i, 0) * 28ms) ease both;
    }
    .chat:last-child { border-bottom: 0; }
    .chat:hover { padding-left: 14px; background: rgba(72,168,255,.055); }
    .chat.selected { background: linear-gradient(90deg, rgba(72,168,255,.095), rgba(139,92,246,.05)); }
    .chat.selected::before { content: ""; position: absolute; inset: 9px auto 9px 0; width: 2px; border-radius: 4px; background: linear-gradient(var(--blue), var(--violet)); box-shadow: 0 0 12px rgba(72,168,255,.5); }
    .chat input[type="checkbox"] {
      appearance: none;
      display: grid;
      place-items: center;
      width: 18px;
      height: 18px;
      flex: 0 0 auto;
      margin: 0;
      padding: 0;
      border: 1px solid rgba(255,255,255,.18);
      border-radius: 6px;
      background: rgba(255,255,255,.025);
      box-shadow: none;
      cursor: pointer;
      transition: all .2s ease;
    }
    .chat input[type="checkbox"]::after { content: ""; width: 8px; height: 5px; border: 2px solid white; border-top: 0; border-right: 0; opacity: 0; transform: rotate(-45deg) scale(.5) translateY(-1px); transition: opacity .16s ease, transform .2s cubic-bezier(.2,.8,.2,1); }
    .chat input[type="checkbox"]:checked { border-color: #679cf7; background: linear-gradient(145deg, var(--blue), var(--violet)); box-shadow: 0 0 0 3px rgba(72,168,255,.08), 0 5px 15px rgba(72,168,255,.16); }
    .chat input[type="checkbox"]:checked::after { opacity: 1; transform: rotate(-45deg) scale(1) translateY(-1px); }
    .chat-avatar { display: grid; place-items: center; width: 35px; height: 35px; flex: 0 0 auto; border: 1px solid rgba(255,255,255,.1); border-radius: 12px; background: linear-gradient(145deg, rgba(72,168,255,.2), rgba(139,92,246,.14)); color: #cbe8ff; font-size: 12px; font-weight: 760; text-transform: uppercase; }
    .chat-name { min-width: 0; flex: 1; overflow: hidden; color: #d5d3df; font-size: 12px; font-weight: 630; text-overflow: ellipsis; white-space: nowrap; }
    .chat-kind { display: block; margin-top: 2px; color: #6f6c7d; font-size: 9px; font-weight: 680; letter-spacing: .09em; text-transform: uppercase; }
    .count { flex: 0 0 auto; color: #888596; font-size: 10px; font-weight: 620; }
    .unread { display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 99px; background: rgba(72,168,255,.12); color: #9cd4ff; }
    .empty-state { display: grid; place-items: center; min-height: 196px; padding: 20px; text-align: center; color: #706d7d; }
    .empty-state svg { width: 34px; height: 34px; margin-bottom: 10px; color: #565365; }
    .empty-state strong { display: block; margin-bottom: 3px; color: #aaa7b5; font-size: 12px; }
    .selected-summary { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; padding: 5px 9px; border: 1px solid rgba(72,168,255,.12); border-radius: 99px; background: rgba(72,168,255,.055); color: #96cffa; }

    .monitored-panel { margin-top: 12px; padding: 13px 14px; border: 1px solid rgba(72,168,255,.14); border-radius: 15px; background: rgba(72,168,255,.045); animation: unfold .3s ease both; }
    .monitored-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 9px; color: #9ecffa; font-size: 10px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
    .monitored-tags { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; max-height: 154px; overflow: auto; }
    .monitored-tag { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 5px 9px; border: 1px solid rgba(255,255,255,.09); border-radius: 99px; background: rgba(255,255,255,.045); color: #d3d1de; font-size: 11px; }
    .monitored-tag i { width: 5px; height: 5px; flex: 0 0 auto; border-radius: 50%; background: var(--success); box-shadow: 0 0 8px rgba(88,223,165,.6); }
    .monitored-tag span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .monitored-empty { color: #777486; font-size: 11px; }
    .monitored-note { margin: 9px 0 0; color: #777486; font-size: 10px; }
    .monitored-note:empty { display: none; }

    .dialog-veil {
      position: fixed;
      z-index: 20;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 20px;
      background: rgba(6,6,11,.62);
      backdrop-filter: blur(6px);
      animation: unfold .2s ease both;
    }
    .dialog {
      width: min(430px, 100%);
      padding: 20px;
      border: 1px solid var(--stroke-strong);
      border-radius: 19px;
      background: linear-gradient(150deg, rgba(255,255,255,.05), transparent 42%), rgba(18,18,28,.97);
      box-shadow: 0 30px 90px rgba(0,0,0,.5), inset 0 1px rgba(255,255,255,.06);
    }
    .dialog h3 { margin: 0 0 8px; font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
    .dialog p { margin: 0; color: #a9a6b8; font-size: 12px; }
    .dialog .actions { justify-content: flex-end; margin-top: 18px; }
    .dialog-path {
      display: block;
      margin-top: 11px;
      padding: 9px 10px;
      overflow-wrap: anywhere;
      border: 1px solid rgba(139,92,246,.18);
      border-radius: 10px;
      background: rgba(139,92,246,.07);
      color: #c8b8ff;
      font: 11px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
      user-select: text;
    }

    .monitor-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; padding: 13px 14px; border: 1px solid rgba(92,225,230,.1); border-radius: 14px; background: rgba(92,225,230,.035); }
    .monitor-copy strong { display: block; color: #d9d7e1; font-size: 12px; }
    .monitor-copy span { display: block; margin-top: 2px; color: #777486; font-size: 10px; }
    .toggle { position: relative; display: inline-flex; align-items: center; flex: 0 0 auto; cursor: pointer; }
    .toggle input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    .switch { position: relative; width: 43px; height: 24px; border: 1px solid rgba(255,255,255,.14); border-radius: 99px; background: rgba(255,255,255,.075); transition: all .25s ease; }
    .switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #8c8998; box-shadow: 0 3px 8px rgba(0,0,0,.35); transition: transform .28s cubic-bezier(.2,.8,.2,1), background .25s ease, box-shadow .25s ease; }
    .toggle input:checked + .switch { border-color: rgba(92,225,230,.4); background: linear-gradient(90deg, rgba(92,225,230,.62), rgba(95,122,237,.72)); box-shadow: 0 0 18px rgba(92,225,230,.12); }
    .toggle input:checked + .switch::after { transform: translateX(19px); background: white; box-shadow: 0 2px 9px rgba(0,0,0,.32), 0 0 10px rgba(255,255,255,.45); }
    .template-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .reply-grid { display: grid; grid-template-columns: 1.1fr .9fr; gap: 12px; margin-top: 14px; }
    .tool-send-field { margin-top: 14px; }
    .broadcast-panel {
      position: relative;
      margin-top: 14px;
      padding: 15px;
      overflow: hidden;
      border: 1px solid rgba(139,92,246,.18);
      border-radius: 16px;
      background:
        linear-gradient(135deg, rgba(139,92,246,.085), rgba(72,168,255,.04) 56%, rgba(92,225,230,.035)),
        rgba(8,8,14,.34);
      box-shadow: inset 0 1px rgba(255,255,255,.035);
    }
    .broadcast-panel::after {
      content: "";
      position: absolute;
      width: 150px;
      height: 150px;
      top: -105px;
      right: -60px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(139,92,246,.18), transparent 68%);
      pointer-events: none;
      animation: breathe 3.6s ease-in-out infinite;
    }
    .broadcast-head { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 13px; }
    .broadcast-title { display: flex; align-items: center; gap: 9px; color: #e2dcff; font-size: 12px; font-weight: 720; }
    .broadcast-title svg { width: 17px; height: 17px; color: #ab94ff; }
    .broadcast-badge { padding: 3px 7px; border: 1px solid rgba(92,225,230,.16); border-radius: 999px; background: rgba(92,225,230,.065); color: #8ee5e2; font-size: 9px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    .broadcast-grid { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0,1.5fr) minmax(105px,.5fr) minmax(105px,.5fr); gap: 10px; }
    .broadcast-status {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      padding: 9px 11px;
      border: 1px solid rgba(88,223,165,.14);
      border-radius: 11px;
      background: rgba(88,223,165,.055);
      color: #a8ddc4;
      font-size: 11px;
    }
    .broadcast-status::before { content: ""; width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--success); box-shadow: 0 0 12px rgba(88,223,165,.6); }
    .broadcast-status.sending { border-color: rgba(72,168,255,.18); background: rgba(72,168,255,.06); color: #add8f8; }
    .broadcast-status.sending::before { background: var(--blue); box-shadow: 0 0 0 4px rgba(72,168,255,.09), 0 0 15px rgba(72,168,255,.7); animation: pulse 1.4s ease-out infinite; }
    .broadcast-status.failed { border-color: rgba(255,199,107,.2); background: rgba(255,199,107,.06); color: #f1d29d; }
    .broadcast-status.failed::before { background: var(--warning); box-shadow: 0 0 12px rgba(255,199,107,.55); }
    .auto-responder {
      position: relative;
      z-index: 1;
      margin-top: 14px;
      padding: 14px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,.085);
      border-radius: 15px;
      background: linear-gradient(145deg, rgba(255,255,255,.035), transparent 46%), rgba(6,7,14,.38);
      transition: border-color .3s ease, background .3s ease, box-shadow .3s ease;
    }
    .auto-responder::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 2px;
      opacity: .35;
      background: linear-gradient(transparent, var(--violet-bright), var(--cyan), transparent);
      transition: opacity .3s ease, box-shadow .3s ease;
    }
    .auto-responder.enabled { border-color: rgba(139,92,246,.22); background: linear-gradient(145deg, rgba(139,92,246,.06), rgba(92,225,230,.025)), rgba(6,7,14,.42); box-shadow: inset 0 1px rgba(255,255,255,.035), 0 18px 50px rgba(12,8,32,.15); }
    .auto-responder.enabled::before { opacity: .9; box-shadow: 0 0 18px rgba(139,92,246,.48); }
    .auto-responder-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .auto-responder-copy { min-width: 0; }
    .auto-responder-copy strong { display: flex; align-items: center; gap: 8px; color: #ded9ed; font-size: 12px; }
    .auto-responder-copy strong::before { content: ""; width: 8px; height: 8px; border-radius: 3px; background: linear-gradient(145deg, var(--violet-bright), var(--blue)); box-shadow: 0 0 14px rgba(139,92,246,.48); transform: rotate(45deg); }
    .auto-responder-copy span { display: block; max-width: 700px; margin-top: 3px; color: #777486; font-size: 10px; }
    .auto-responder-status { display: inline-flex; align-items: center; gap: 7px; margin-top: 11px; padding: 6px 9px; border: 1px solid rgba(255,255,255,.08); border-radius: 9px; background: rgba(255,255,255,.025); color: #858193; font-size: 10px; transition: all .3s ease; }
    .auto-responder-status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #5e5a69; }
    .auto-responder-status.waiting { color: #d5c4ff; border-color: rgba(139,92,246,.18); background: rgba(139,92,246,.055); }
    .auto-responder-status.waiting::before { background: var(--violet-bright); box-shadow: 0 0 10px rgba(167,139,250,.55); animation: breathe 1.8s ease-in-out infinite; }
    .auto-responder-status.active { color: #a7ead0; border-color: rgba(88,223,165,.18); background: rgba(88,223,165,.055); }
    .auto-responder-status.active::before { background: var(--success); box-shadow: 0 0 12px rgba(88,223,165,.65); animation: pulse 2s ease-out infinite; }
    .auto-rule-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 13px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,.06); }
    .auto-rule-toolbar span { color: #777486; font-size: 10px; }
    .add-rule { min-height: 32px; padding: 6px 10px; color: #cabaff; border-color: rgba(139,92,246,.2); background: rgba(139,92,246,.07); }
    .add-rule svg { width: 14px; height: 14px; }
    .auto-rule-list { display: grid; gap: 9px; margin-top: 10px; }
    .auto-rule-empty { padding: 18px 14px; border: 1px dashed rgba(255,255,255,.09); border-radius: 12px; color: #6f6c7e; text-align: center; font-size: 10px; }
    .auto-rule-card {
      position: relative;
      padding: 12px;
      border: 1px solid rgba(255,255,255,.085);
      border-radius: 13px;
      background: linear-gradient(145deg, rgba(255,255,255,.035), transparent), rgba(13,13,23,.54);
      box-shadow: inset 0 1px rgba(255,255,255,.025);
      animation: ruleEnter .36s calc(var(--rule-index, 0) * 35ms) cubic-bezier(.2,.8,.2,1) both;
      transition: border-color .25s ease, transform .25s ease, box-shadow .25s ease;
    }
    .auto-rule-card:hover { border-color: rgba(139,92,246,.2); transform: translateY(-1px); box-shadow: inset 0 1px rgba(255,255,255,.035), 0 12px 32px rgba(0,0,0,.14); }
    .auto-rule-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
    .auto-rule-number { display: inline-flex; align-items: center; gap: 7px; color: #a9a4b7; font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .auto-rule-number i { display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid rgba(139,92,246,.18); border-radius: 8px; background: rgba(139,92,246,.07); color: #bca8ff; font-style: normal; font-size: 9px; }
    .rule-delete { width: 28px; height: 28px; padding: 0; color: #817c8d; border-color: transparent; background: transparent; }
    .rule-delete:hover { color: #ff9bab; border-color: rgba(255,113,133,.16); background: rgba(255,113,133,.07); }
    .rule-delete svg { width: 14px; height: 14px; }
    .auto-rule-fields { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 10px; }
    .trigger-editor { min-height: 72px; padding: 8px; border: 1px solid var(--stroke-strong); border-radius: var(--radius-control); background: color-mix(in srgb, var(--surface-strong) 80%, transparent); transition: border-color .25s ease, box-shadow .25s ease; }
    .trigger-editor:focus-within { border-color: rgba(139,92,246,.55); box-shadow: 0 0 0 3px rgba(139,92,246,.095), 0 8px 24px rgba(0,0,0,.12); }
    .trigger-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .trigger-chip { display: inline-flex; align-items: center; max-width: 100%; border: 1px solid rgba(139,92,246,.2); border-radius: 8px; background: linear-gradient(135deg, rgba(139,92,246,.13), rgba(72,168,255,.065)); color: #cbbcff; box-shadow: inset 0 1px rgba(255,255,255,.04); animation: chipIn .24s cubic-bezier(.2,.8,.2,1) both; }
    .trigger-chip-edit { min-width: 0; max-width: 100%; padding: 5px 4px 5px 8px; overflow: hidden; border: 0; border-radius: 8px 0 0 8px; background: transparent; color: inherit; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
    .trigger-chip-remove { width: 24px; min-height: 24px; padding: 0; border: 0; border-radius: 0 8px 8px 0; background: transparent; color: #8f83ab; font-size: 14px; }
    .trigger-chip-remove:hover { background: rgba(255,113,133,.09); color: #ff9cac; }
    .trigger-input { width: 100%; min-height: 28px; margin-top: 6px; padding: 4px 3px; border: 0; outline: 0; background: transparent; box-shadow: none; color: var(--text-soft); font-size: 11px; }
    .auto-response { min-height: 108px; resize: vertical; }
    .auto-rule-hint { margin: 6px 0 0; color: #686577; font-size: 9px; }
    @keyframes ruleEnter { from { opacity: 0; transform: translateY(7px) scale(.99); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @keyframes chipIn { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: scale(1); } }
    .time-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
    .variables { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 8px; color: #6f6c7e; font-size: 10px; }
    .code { display: inline-flex; align-items: center; min-height: 21px; padding: 2px 7px; border: 1px solid rgba(139,92,246,.15); border-radius: 7px; background: rgba(139,92,246,.065); color: #bda9ff; font: 10px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .copy-code { gap: 6px; margin: 0; appearance: none; cursor: pointer; vertical-align: middle; transition: color .2s ease, border-color .2s ease, background .2s ease, transform .2s ease, box-shadow .2s ease; }
    .copy-code svg { width: 12px; height: 12px; flex: 0 0 auto; opacity: .62; transition: opacity .2s ease, transform .2s ease; }
    .copy-code:hover { color: #ded3ff; border-color: rgba(139,92,246,.42); background: rgba(139,92,246,.14); box-shadow: 0 0 16px rgba(139,92,246,.1); transform: translateY(-1px); }
    .copy-code:hover svg { opacity: 1; }
    .copy-code.copied { color: #8ef0d3; border-color: rgba(92,225,190,.38); background: rgba(92,225,190,.11); }
    .copy-code.copied svg { opacity: 1; transform: scale(1.08); }
    .activity { display: flex; align-items: center; gap: 8px; min-height: 31px; margin: 14px 0 0; color: #777486; font-size: 10px; }
    .activity::before { content: ""; width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: #4d4a59; box-shadow: 0 0 0 4px rgba(77,74,89,.08); }

    .voice-layout { display: grid; grid-template-columns: minmax(0,1.45fr) minmax(220px,.55fr); gap: 22px; align-items: center; }
    .steps { counter-reset: step; margin: 0; padding: 0; list-style: none; }
    .steps li { counter-increment: step; position: relative; min-height: 56px; padding: 0 0 16px 46px; color: #9794a5; font-size: 11px; }
    .steps li:last-child { min-height: auto; padding-bottom: 0; }
    .steps li::before { content: counter(step); position: absolute; z-index: 1; top: -3px; left: 0; display: grid; place-items: center; width: 29px; height: 29px; border: 1px solid rgba(236,120,187,.19); border-radius: 10px; background: rgba(236,120,187,.075); color: #ec9cca; font-size: 10px; font-weight: 800; }
    .steps li::after { content: ""; position: absolute; top: 28px; bottom: -1px; left: 14px; width: 1px; background: linear-gradient(rgba(236,120,187,.25), rgba(139,92,246,.09)); }
    .steps li:last-child::after { display: none; }
    .steps b { color: #e5e2ec; font-weight: 650; }
    .voice-orb-wrap { position: relative; display: grid; place-items: center; min-height: 190px; }
    .voice-orb {
      position: relative;
      display: grid;
      place-items: center;
      width: 104px;
      height: 104px;
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 50%;
      background:
        radial-gradient(circle at 36% 28%, rgba(255,255,255,.22), transparent 23%),
        linear-gradient(145deg, rgba(161,100,236,.82), rgba(58,124,224,.74) 52%, rgba(77,218,217,.62));
      box-shadow: 0 0 52px rgba(117,82,218,.27), inset 0 1px 5px rgba(255,255,255,.26);
      animation: float 4s ease-in-out infinite;
    }
    .voice-orb::before, .voice-orb::after { content: ""; position: absolute; border: 1px solid rgba(152,124,242,.2); border-radius: 50%; animation: wave 2.8s ease-out infinite; }
    .voice-orb::before { inset: -18px; }
    .voice-orb::after { inset: -36px; animation-delay: 1.4s; }
    .waveform { display: flex; align-items: center; gap: 3px; height: 34px; }
    .waveform i { display: block; width: 3px; border-radius: 9px; background: rgba(255,255,255,.9); box-shadow: 0 0 8px rgba(255,255,255,.25); animation: bar 1.1s ease-in-out infinite alternate; }
    .waveform i:nth-child(1), .waveform i:nth-child(7) { height: 10px; animation-delay: -.7s; }
    .waveform i:nth-child(2), .waveform i:nth-child(6) { height: 20px; animation-delay: -.35s; }
    .waveform i:nth-child(3), .waveform i:nth-child(5) { height: 29px; animation-delay: -.85s; }
    .waveform i:nth-child(4) { height: 18px; animation-delay: -.1s; }
    .voice-caption { position: absolute; bottom: 4px; color: #777486; font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }

    .footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 18px; padding: 0 5px; color: #504d5d; font-size: 9px; letter-spacing: .04em; }
    .footer-brand { display: flex; align-items: center; gap: 6px; }
    .footer-brand i { width: 5px; height: 5px; border-radius: 50%; background: linear-gradient(var(--violet),var(--blue)); box-shadow: 0 0 9px rgba(139,92,246,.6); }

    .toast {
      position: fixed;
      z-index: 10;
      right: 24px;
      bottom: 24px;
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: min(430px, calc(100vw - 32px));
      padding: 12px 15px;
      border: 1px solid rgba(88,223,165,.23);
      border-radius: 14px;
      background: rgba(21,28,29,.92);
      color: #baf4d7;
      box-shadow: 0 20px 55px rgba(0,0,0,.48), inset 0 1px rgba(255,255,255,.06);
      backdrop-filter: blur(22px);
      opacity: 0;
      pointer-events: none;
      transform: translateY(14px) scale(.97);
      transition: opacity .25s ease, transform .35s cubic-bezier(.2,.8,.2,1);
    }
    .toast::before { content: ""; width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: var(--success); box-shadow: 0 0 13px rgba(88,223,165,.65); }
    .toast.show { opacity: 1; transform: translateY(0) scale(1); }
    .toast.bad { border-color: rgba(255,113,133,.25); background: rgba(36,21,26,.94); color: #ffc0ca; }
    .toast.bad::before { background: var(--danger); box-shadow: 0 0 13px rgba(255,113,133,.6); }

    @keyframes enter { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: none; } }
    @keyframes cardEnter { from { opacity: 0; transform: translateY(20px) scale(.985); } to { opacity: 1; transform: none; } }
    @keyframes listItem { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
    @keyframes unfold { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
    @keyframes connected { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: scale(1); } }
    @keyframes driftOne { to { transform: translate(150px, 90px) scale(1.14); } }
    @keyframes driftTwo { to { transform: translate(-120px, 100px) scale(.9); } }
    @keyframes driftThree { to { transform: translate(110px, -80px) scale(1.15); } }
    @keyframes orbit { to { transform: rotate(328deg); } }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(88,223,165,.35), 0 0 18px rgba(88,223,165,.5); } 70%,100% { box-shadow: 0 0 0 8px rgba(88,223,165,0), 0 0 18px rgba(88,223,165,.5); } }
    @keyframes breathe { 50% { opacity: .55; transform: scale(.82); } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes float { 50% { transform: translateY(-7px) scale(1.025); box-shadow: 0 10px 64px rgba(117,82,218,.36), inset 0 1px 5px rgba(255,255,255,.3); } }
    @keyframes wave { 0% { opacity: .55; transform: scale(.78); } 80%,100% { opacity: 0; transform: scale(1.14); } }
    @keyframes bar { to { transform: scaleY(.48); opacity: .72; } }
    @keyframes shake { 25% { transform: translateX(-3px); } 50% { transform: translateX(3px); } 75% { transform: translateX(-2px); } }

    @media (max-width: 880px) {
      .shell { padding: 25px 18px 54px; }
      .dashboard { grid-template-columns: 1fr; }
      .wide { grid-column: auto; }
      .voice-layout { grid-template-columns: 1fr; }
      .voice-orb-wrap { min-height: 170px; }
    }
    @media (max-width: 650px) {
      .shell { padding: 20px 13px 44px; }
      .hero { align-items: flex-start; flex-direction: column; gap: 17px; }
      .status { align-self: stretch; justify-content: center; }
      .overview { grid-template-columns: 1fr; }
      .metric { min-height: 57px; }
      .card { padding: 18px; border-radius: 21px; }
      .fields, .template-grid, .reply-grid, .broadcast-grid, .auto-rule-fields, .time-grid { grid-template-columns: 1fr; }
      .field.full { grid-column: auto; }
      .chat-tools { flex-direction: column; align-items: stretch; }
      .chat-tools button { width: 100%; }
      .monitor-row { align-items: flex-start; }
      .footer { align-items: flex-start; flex-direction: column; }
      .toast { right: 16px; bottom: 16px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
    }
    .qr-image { display: block; width: min(100%, 280px); height: auto; aspect-ratio: 1; background: #fff; border-radius: var(--radius-control); }
    .qr-timer, #resendBtn { font-variant-numeric: tabular-nums; }
    #resendBtn:disabled { opacity: 1; color: var(--text-soft); cursor: default; }
  </style>
</head>
<body>
  <div class="ambient" aria-hidden="true"><i class="orb one"></i><i class="orb two"></i><i class="orb three"></i></div>
  <main class="shell">
    <header class="hero">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none"><path d="M6.2 15.3 25.1 7.8c1-.4 1.8.4 1.5 1.5l-3.2 15.2c-.2 1.1-1 1.4-1.9.8l-5-3.7-2.4 2.4c-.3.3-.5.5-1 .5l.4-5.1 9.2-8.3c.4-.4-.1-.6-.6-.2l-11.4 7.2-4.9-1.5c-1.1-.3-1.1-1.1.4-1.7Z" fill="white"/><path d="m8.3 7.1.8-2.3.8 2.3 2.3.8-2.3.8-.8 2.3-.8-2.3L6 7.9l2.3-.8Z" fill="#BFF4FF"/></svg>
        </div>
        <div class="brand-copy"><h1>TG <span class="astra-word">for Astra</span></h1><p>Сообщения, голос и быстрые ответы — в одном потоке.</p></div>
      </div>
      <div id="topStatus" class="status"><span class="status-dot"></span><span id="topStatusText">Подключение…</span></div>
    </header>

    <section class="overview" aria-label="Состояние плагина">
      <div class="metric"><span class="metric-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7.5 11a4.5 4.5 0 1 1 9 0v2.5a4.5 4.5 0 0 1-9 0V11Z"/><path d="M5 13.5a7 7 0 0 0 14 0M12 20.5V23"/></svg></span><span class="metric-copy"><span class="metric-label">Аккаунт</span><span id="accountMini" class="metric-value">Проверяем сессию</span></span></div>
      <div class="metric"><span class="metric-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 5.5h16v11H9l-5 4v-15Z"/><path d="M8 9h8M8 12.5h5"/></svg></span><span class="metric-copy"><span class="metric-label">Мониторинг</span><span id="chatMini" class="metric-value">Чаты не выбраны</span></span></div>
      <div class="metric"><span class="metric-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3.2 2M18.5 3v5h-5"/></svg></span><span class="metric-copy"><span class="metric-label">Голосовой ответ</span><span id="replyMini" class="metric-value">Ответ через AI tool</span></span></div>
    </section>

    <div class="dashboard">
      <section class="card account-card" style="--delay:.14s">
        <div class="card-head">
          <div class="section-title"><span class="section-index">01</span><div><h2>Telegram-аккаунт</h2><p class="subtitle">Безопасное подключение личной сессии</p></div></div>
          <span class="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55"><path d="M5 10V8a7 7 0 0 1 14 0v2"/><rect x="3.5" y="10" width="17" height="11" rx="3"/><path d="M12 14v3"/></svg></span>
        </div>
        <div id="accountConnected" hidden>
          <div class="account">
            <div class="avatar"><svg viewBox="0 0 32 32" fill="none"><path d="M6.2 15.3 25.1 7.8c1-.4 1.8.4 1.5 1.5l-3.2 15.2c-.2 1.1-1 1.4-1.9.8l-5-3.7-2.4 2.4c-.3.3-.5.5-1 .5l.4-5.1 9.2-8.3c.4-.4-.1-.6-.6-.2l-11.4 7.2-4.9-1.5c-1.1-.3-1.1-1.1.4-1.7Z" fill="white"/></svg></div>
            <div class="account-copy"><strong id="accountName"></strong><span id="accountPhone" class="muted"></span></div>
            <button id="privacyBtn" class="icon-btn" type="button" title="Скрыть имя и номер" aria-label="Скрыть имя и номер" aria-pressed="false"><svg class="eye-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2.6 12S6 5.9 12 5.9 21.4 12 21.4 12 18 18.1 12 18.1 2.6 12 2.6 12Z"/><circle cx="12" cy="12" r="3.1"/></svg><svg class="eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 4l16 16"/><path d="M9.9 5.4A9.6 9.6 0 0 1 12 5.2c6 0 9.4 6.1 9.4 6.1a18 18 0 0 1-2.7 3.5M6.4 7.3A17.7 17.7 0 0 0 2.6 11.3S6 17.4 12 17.4c1.2 0 2.3-.2 3.3-.6"/><path d="M9.7 9.8a3.1 3.1 0 0 0 4.3 4.4"/></svg></button>
            <span class="verified">● online</span>
          </div>
          <div class="actions"><button id="logoutBtn" class="danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"/></svg>Выйти из Telegram</button></div>
        </div>
        <div id="accountLogin">
          <div class="fields">
            <div class="field full"><label class="field-label" for="phone">Номер телефона <span class="field-note">Любая страна</span></label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+1 202 555 0123"><p class="hint">Введите <b>+код страны и номер</b>: +1, +44, +49, +380, +7 или другой международный код. Вместо + можно использовать 00; пробелы, скобки, дефисы и точки допустимы. Для номеров +7 также поддерживается начало с 8. Способ доставки кода выбирает Telegram; если он указал приложение, ищите код в служебном чате «Telegram» нужного аккаунта.</p></div>
          </div>
          <div class="actions"><button id="sendCodeBtn" class="primary">Продолжить<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14M14 7l5 5-5 5"/></svg></button><button id="qrLoginBtn" type="button">Войти по QR-коду</button></div>
          <div id="qrBlock" class="auth-stage" hidden><p class="hint">Номер вводить не нужно — QR-вход доступен для аккаунтов с любым кодом страны. Выберите нужный аккаунт в Telegram на телефоне: <b>Настройки → Устройства → Подключить устройство</b>. Отсканируйте QR-код и подтвердите вход.</p><img id="qrImage" class="qr-image" alt="QR-код для входа в Telegram" width="280" height="280" hidden><p id="qrStatus" class="hint qr-timer" role="timer" aria-live="off">Получаем QR-код…</p><button id="cancelQrBtn" type="button">Вернуться к входу по номеру</button></div>
          <div id="codeBlock" class="auth-stage" hidden><div class="field"><label class="field-label" for="code">Код из Telegram <span class="field-note">Одноразовый</span></label><input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="•••••"></div><p id="codeHint" class="hint"></p><p class="hint">Если код не приходит, можно войти по QR-коду — кнопка находится рядом с «Продолжить».</p><div class="actions"><button id="codeBtn" class="primary">Подтвердить код</button><button id="resendBtn">Запросить код заново</button></div></div>
          <div id="passwordBlock" class="auth-stage" hidden><div class="field"><label class="field-label" for="password">Пароль 2FA <span class="field-note">Не сохраняется</span></label><input id="password" type="password" autocomplete="current-password" placeholder="Пароль двухэтапной защиты"></div><div id="passwordHint" class="hint"></div><div class="actions"><button id="passwordBtn" class="primary">Войти в аккаунт</button></div></div>
          <div id="authError" class="error"></div>
        </div>
      </section>

      <section class="card chat-card" style="--delay:.2s">
        <div class="card-head">
          <div class="section-title"><span class="section-index">02</span><div><h2>Чаты для мониторинга</h2><p class="subtitle">Личные диалоги, группы и каналы · до <span id="maxChats">1000</span></p></div></div>
          <span class="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55"><path d="M4 6h16v11H9l-5 4V6Z"/><path d="M8 10h8M8 13h5"/></svg></span>
        </div>
        <div class="chat-tools"><div class="search-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg><input id="chatSearch" placeholder="Найти чат"></div><button id="loadChatsBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 8.5A7 7 0 0 1 18.8 7M17.9 15.5A7 7 0 0 1 5.2 17"/></svg>Загрузить</button><button id="monitorAllBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 12.5l3.5 3.5L20 4"/><path d="M4 19h11"/></svg>Мониторить все</button><button id="monitoredBtn" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2.6 12S6 5.9 12 5.9 21.4 12 21.4 12 18 18.1 12 18.1 2.6 12 2.6 12Z"/><circle cx="12" cy="12" r="3.1"/></svg>Активные чаты</button></div>
        <div id="chatList" class="chat-list"><div class="empty-state"><div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45"><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M9 9h6M9 12h4"/></svg><strong>Сначала подключите Telegram</strong><span>После входа здесь появятся ваши чаты</span></div></div></div>
        <div id="monitoredPanel" class="monitored-panel" hidden><div class="monitored-head"><span>Сейчас мониторятся</span><span id="monitoredCount"></span></div><div id="monitoredTags" class="monitored-tags"></div><p id="monitoredNote" class="monitored-note"></p></div>
        <div class="actions"><button id="saveChatsBtn" class="primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 4h12l2 2v14H5V4Z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/></svg>Сохранить</button><span id="selectedCount" class="count selected-summary">0 / 1000</span></div>
      </section>

      <section class="card voice-card wide" style="--delay:.26s">
        <div class="card-head">
          <div class="section-title"><span class="section-index">03</span><div><h2>Команды Astra</h2><p class="subtitle">Настройте озвучивание входящих: импортируйте одну команду или соберите её вручную</p></div></div>
          <span class="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55"><path d="M4 12h2l2-6 4 12 3-9 2 3h3"/></svg></span>
        </div>
        <div class="voice-layout">
          <div>
            <div class="notice"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.7v.6"/></svg><span>Плагин не может создавать команды сам — этот шаг Astra оставляет за вами. Кнопка ниже готовит файл с командой озвучивания, а <b>«Импорт»</b> в разделе «Команды» добавляет её. Ответы работают через AI tools.</span></div>
            <ol class="steps">
              <li>Нажмите <b>«Подготовить команды»</b>. Плагин сохранит файл <b>tg-astra-commands.astra</b> и покажет полный путь к нему.</li>
              <li>Откройте раздел <b>«Команды»</b> в Astra и выберите <b>«Импорт»</b>, затем укажите этот файл.</li>
              <li>В списке появится <b>«тг»</b> — озвучивание сообщений и проигрывание голосовых. Включите её. Если раньше импортировали <b>«тг ответ»</b>, удалите или отключите эту старую команду: она больше не нужна.</li>
            </ol>
            <div class="actions">
              <button id="commandsBtn" class="primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 4v11M8 11.5l4 4 4-4"/><path d="M5 19h14"/></svg>Подготовить команды</button>
              <button id="manualBtn" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M4 12h16M4 17h10"/></svg>Собрать вручную</button>
            </div>
            <p id="commandsResult" class="hint"></p>
            <div id="manualBlock" hidden>
              <div class="monitor-row" style="margin-top:18px"><div class="monitor-copy"><strong>Команда озвучивания</strong><span>Нужна одна команда «тг» с тремя соединёнными узлами</span></div></div>
              <ol class="steps" style="margin-top:14px">
                <li>Откройте <b>«Команды»</b>, создайте одну команду <b>«тг»</b> и нажмите <b>«+ Узлы» → «Новое сообщение Telegram»</b>. Внутри триггера ничего вводить не нужно — оставьте статус <b>«Включён»</b>.</li>
                <li>Добавьте действие <b>«Произнести»</b>. В поле <b>«Текст»</b> вставьте <button type="button" class="code copy-code" data-copy="{announcement}">{announcement}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button>, включите <b>«Использовать голос из настроек»</b> и оставьте отмеченным <b>«Ждать завершения»</b>.</li>
                <li>Добавьте действие плагина <b>«Проиграть голосовое Telegram»</b>. Настраивать внутри ничего не нужно: плагин сам берёт следующее загруженное голосовое. Для текстовых сообщений шаг тихо пропускается.</li>
                <li>Проверьте соединения: <b>Новое сообщение Telegram → Произнести → Проиграть голосовое Telegram</b>. Затем включите переключатель самой команды. Шаблоны озвучивания задаются в блоке <b>«Озвучивание и быстрый ответ»</b> ниже.</li>
              </ol>
              <p class="hint">Отдельную команду ответа и текстовый триггер создавать не нужно. Если осталась старая <b>«тг ответ»</b>, отключите или удалите её. После входящего скажите, например: <b>«Астра, ответь ему, что буду через час»</b> — нейронка выберет инструмент и отправит ответ сразу, без подтверждения. Фраза и окно ответа настраиваются ниже.</p>
              <p class="hint">Для нового сообщения скажите <b>«Астра, напиши Андрюхе, что скоро буду»</b>. Нейронка сама сопоставит имя с реальными контактами; при неоднозначности уточнит адресата. Новые сообщения и рассылки отправляются после подтверждения черновика.</p>
            </div>
          </div>
          <div class="voice-orb-wrap" aria-hidden="true"><div class="voice-orb"><span class="waveform"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span></div><span class="voice-caption">Astra voice engine</span></div>
        </div>
      </section>

      <section class="card settings-card wide" style="--delay:.32s">
        <div class="card-head">
          <div class="section-title"><span class="section-index">04</span><div><h2>Озвучивание и быстрый ответ</h2><p class="subtitle">Настройте анонсы, ответы и отправку через AI tools</p></div></div>
          <span class="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55"><path d="M12 3a4 4 0 0 0-4 4v5a4 4 0 0 0 8 0V7a4 4 0 0 0-4-4Z"/><path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V22M8.5 22h7"/></svg></span>
        </div>
        <div class="monitor-row"><div class="monitor-copy"><strong>Фоновый мониторинг</strong><span>Плагин реагирует только на выбранные выше чаты</span></div><label class="toggle" aria-label="Мониторинг включён"><input id="enabled" type="checkbox"><span class="switch"></span></label></div>
        <div class="template-grid">
          <div class="field"><label class="field-label" for="textTemplate">Текстовое сообщение <span class="field-note">Голос Astra</span></label><textarea id="textTemplate" placeholder="Вам написал {sender}. {message}"></textarea></div>
          <div class="field"><label class="field-label" for="voiceTemplate">Перед голосовым <span class="field-note">Анонс</span></label><textarea id="voiceTemplate" placeholder="Вам прислал голосовое сообщение {sender}"></textarea></div>
        </div>
        <div class="variables"><span>Нажмите, чтобы скопировать</span><button type="button" class="code copy-code" data-copy="{sender}">{sender}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button><button type="button" class="code copy-code" data-copy="{chat}">{chat}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button><button type="button" class="code copy-code" data-copy="{message}">{message}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button></div>
        <div class="field"><label class="field-label" for="replyCommandPhrase">Фраза для ответа <span class="field-note">AI tool</span></label><input id="replyCommandPhrase" maxlength="80" placeholder="ответь"><p class="hint">Например: «Астра, ответь: буду через час». Короткий ответ отправляется на последнее входящее без подтверждения. Для другого отправителя назовите его. Это подсказка нейронке: синонимы тоже допустимы, отдельная команда Astra не нужна.</p></div>
        <div class="reply-grid">
          <div class="field"><label class="field-label" for="replyWindow">Окно ответа <span class="field-note">Сек.</span></label><input id="replyWindow" type="number" min="10" max="3600"><p class="hint">В течение этого времени можно попросить Astra ответить на входящее. Ответ отправляется сразу, без подтверждения.</p></div>
          <div class="field"><label class="field-label" for="replyConfirmationTemplate">После отправки ответа <span class="field-note">Голос Astra</span></label><textarea id="replyConfirmationTemplate" placeholder="Ответ отправлен."></textarea><p class="hint">Что Astra скажет после успешной отправки в Telegram. Можно использовать {sender}, {chat} и {message}; оставьте поле пустым, чтобы ничего не произносить.</p></div>
        </div>
        <div class="field tool-send-field"><label class="field-label" for="sendCommandPhrase">Фраза для одного чата <span class="field-note">AI tool</span></label><input id="sendCommandPhrase" maxlength="80" placeholder="напиши"><p class="hint">Например: «Астра, напиши Андрюхе, что буду через час». Нейронка сама выбирает реальный чат, учитывая склонения, варианты имён и русское/английское написание. Если подходят несколько контактов, она уточнит адресата. Перед отправкой Astra обязательно покажет черновик.</p></div>
        <div class="broadcast-panel">
          <div class="broadcast-head"><span class="broadcast-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h11M4 12h8M4 17h6"/><path d="m15 14 5 3-5 3v-6Z"/></svg>Массовая отправка</span><span class="broadcast-badge">до 10 чатов</span></div>
          <div class="broadcast-grid">
            <div class="field"><label class="field-label" for="broadcastCommandPhrase">Фраза для рассылки <span class="field-note">AI tool</span></label><input id="broadcastCommandPhrase" maxlength="80" placeholder="разошли"></div>
            <div class="field"><label class="field-label" for="broadcastDelayMinSeconds">Задержка от <span class="field-note">Сек.</span></label><input id="broadcastDelayMinSeconds" type="number" min="1" max="60"></div>
            <div class="field"><label class="field-label" for="broadcastDelayMaxSeconds">Задержка до <span class="field-note">Сек.</span></label><input id="broadcastDelayMaxSeconds" type="number" min="1" max="60"></div>
          </div>
          <p class="hint">Назовите несколько чатов, @username или целую <b>папку Telegram</b>: нейронка сама выберет массовый инструмент. После общего подтверждения сообщение отправляется каждому отдельно со случайной задержкой из диапазона.</p>
          <div id="broadcastStatus" class="broadcast-status" hidden></div>
          <div id="autoResponderPanel" class="auto-responder">
            <div class="auto-responder-head">
              <div class="auto-responder-copy"><strong>Автоответчик после рассылки</strong><span>Отвечает только в личных чатах последней кампании и работает до ручного отключения.</span></div>
              <label class="toggle" aria-label="Автоответчик после рассылки"><input id="autoResponderEnabled" type="checkbox"><span class="switch"></span></label>
            </div>
            <div id="autoResponderStatus" class="auto-responder-status">Автоответчик выключен</div>
            <div class="auto-rule-toolbar"><span>Триггеры могут быть словами или целыми предложениями</span><button id="addAutoReplyRuleBtn" type="button" class="add-rule"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>Добавить правило</button></div>
            <div id="autoReplyRules" class="auto-rule-list"></div>
          </div>
        </div>
        <div class="actions"><button id="saveSettingsBtn" class="primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 4h12l2 2v14H5V4Z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/></svg>Сохранить настройки</button></div>
        <p id="activity" class="activity">Ожидаем состояние плагина</p>
      </section>
    </div>
    <footer class="footer"><span class="footer-brand"><i></i>Astra Telegram Bridge</span><span>Личная MTProto-сессия хранится локально</span></footer>
  </main>
  <div id="dialogVeil" class="dialog-veil" hidden>
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialogTitle">
      <h3 id="dialogTitle"></h3>
      <p id="dialogText"></p>
      <code id="dialogPath" class="dialog-path" hidden></code>
      <div class="actions"><button id="dialogCancel">Отмена</button><button id="dialogConfirm" class="primary">Продолжить</button></div>
    </div>
  </div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <script>
  (() => {
    const astra = window.astra;
    const $ = (id) => document.getElementById(id);
    const consumeAutoReplyTriggerInput = ${consumeAutoReplyTriggerInput.toString()};
    const loginTimerView = ${loginTimerView.toString()};
    let stateReceivedAt = Date.now();
    const validateAutoReplyRulesForSave = ${validateAutoReplyRulesForSave.toString()};
    let state = null;
    let chats = [];
    let selected = new Set();
    let autoReplyRules = [];
    const autoReplyDrafts = new Map();
    let selectionDirty = false;
    let settingsDirty = false;
    let refreshing = false;
    let privacyHidden = false;
    let monitoredOpen = false;
    let dialogResolve = null;

    function api(method, params = {}, timeoutMs = 12000) {
      if (!astra || typeof astra.callBackend !== 'function') {
        return Promise.reject(new Error('Мост Astra не загрузился. Перезапустите плагин.'));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Плагин долго не отвечает. Попробуйте ещё раз.')), timeoutMs);
        Promise.resolve().then(() => astra.callBackend(method, params)).then(
          (value) => { clearTimeout(timer); resolve(value); },
          (error) => { clearTimeout(timer); reject(error); },
        );
      });
    }

    function toast(message, bad = false) {
      const box = $('toast');
      box.textContent = message;
      box.className = 'toast show' + (bad ? ' bad' : '');
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => box.className = 'toast', 3500);
    }

    async function copyValue(button) {
      const value = button.dataset.copy || '';
      try {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(value);
      } catch (_) {
        const helper = document.createElement('textarea');
        helper.value = value;
        helper.setAttribute('readonly', '');
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        const copied = document.execCommand('copy');
        helper.remove();
        if (!copied) return toast('Не удалось скопировать значение', true);
      }
      document.querySelectorAll('.copy-code.copied').forEach((item) => item.classList.remove('copied'));
      button.classList.add('copied');
      clearTimeout(button.copyTimer);
      button.copyTimer = setTimeout(() => button.classList.remove('copied'), 1200);
      toast('Скопировано: ' + value);
    }

    function setBusy(button, busy) {
      button.disabled = busy;
      button.classList.toggle('is-busy', busy);
    }

    // The iframe is sandboxed, so window.confirm() is blocked and returns
    // nothing: a button gated on it never runs. This is the replacement.
    function ask(title, text, confirmLabel = 'Продолжить') {
      $('dialogTitle').textContent = title;
      $('dialogText').textContent = text;
      $('dialogPath').hidden = true;
      $('dialogConfirm').textContent = confirmLabel;
      $('dialogCancel').hidden = false;
      $('dialogVeil').hidden = false;
      $('dialogConfirm').focus();
      return new Promise((resolve) => { dialogResolve = resolve; });
    }

    function tell(title, text, path = '') {
      $('dialogTitle').textContent = title;
      $('dialogText').textContent = text;
      $('dialogPath').textContent = path;
      $('dialogPath').hidden = !path;
      $('dialogConfirm').textContent = 'Понятно';
      $('dialogCancel').hidden = true;
      $('dialogVeil').hidden = false;
      $('dialogConfirm').focus();
      return new Promise((resolve) => { dialogResolve = resolve; });
    }

    function closeDialog(answer) {
      $('dialogVeil').hidden = true;
      const resolve = dialogResolve;
      dialogResolve = null;
      if (resolve) resolve(answer);
    }

    function renderState(next) {
      const previousConnected = state?.connected;
      const previousSelected = new Set(selected);
      state = next;
      stateReceivedAt = Date.now();
      const connected = next.connected;
      $('accountConnected').hidden = !connected;
      $('accountLogin').hidden = connected;
      $('phone').value ||= next.phone || '';
      $('authError').textContent = next.authError || '';
      $('codeBlock').hidden = next.authStage !== 'awaiting_code';
      $('codeHint').textContent = codeHint(next);
      renderLoginTimers();
      $('passwordBlock').hidden = next.authStage !== 'awaiting_password';
      $('passwordHint').textContent = next.passwordHint ? 'Подсказка Telegram: ' + next.passwordHint : '';
      $('maxChats').textContent = next.maxSelectedChats;

      const p = next.preferences;
      privacyHidden = p.hideIdentity === true;
      renderIdentity();
      if (!selectionDirty) selected = new Set(p.selectedChatIds || []);
      const selectionChanged = previousSelected.size !== selected.size || [...previousSelected].some((id) => !selected.has(id));
      if (!settingsDirty) {
        $('enabled').checked = p.enabled;
        $('textTemplate').value = p.textTemplate;
        $('voiceTemplate').value = p.voiceTemplate;
        $('replyWindow').value = p.replyWindowSeconds;
        $('replyCommandPhrase').value = p.replyCommandPhrase;
        $('replyConfirmationTemplate').value = p.replyConfirmationTemplate;
        $('sendCommandPhrase').value = p.sendCommandPhrase;
        $('broadcastCommandPhrase').value = p.broadcastCommandPhrase;
        $('broadcastDelayMinSeconds').value = p.broadcastDelayMinSeconds;
        $('broadcastDelayMaxSeconds').value = p.broadcastDelayMaxSeconds;
        $('autoResponderEnabled').checked = p.autoResponderEnabled === true;
        autoReplyRules = (p.autoReplyRules || []).map((rule) => ({
          id: String(rule.id || ''),
          triggers: Array.isArray(rule.triggers) ? rule.triggers.map(String) : [],
          response: String(rule.response || ''),
        }));
        autoReplyDrafts.clear();
        renderAutoReplyRules();
      }

      $('activity').textContent = next.lastActivity + (next.replyTarget ? ' · Ответ для «' + next.replyTarget.chat + '» доступен ещё ' + next.replyTarget.secondsLeft + ' сек.' : '');
      const broadcast = next.broadcastStatus || {phase:'idle',total:0,sent:0,failed:[]};
      const broadcastStatus = $('broadcastStatus');
      broadcastStatus.hidden = broadcast.phase === 'idle';
      broadcastStatus.className = 'broadcast-status';
      if (broadcast.phase === 'sending') {
        broadcastStatus.classList.add('sending');
        broadcastStatus.textContent = 'Рассылка выполняется: отправлено ' + broadcast.sent + ' из ' + broadcast.total;
      } else if (broadcast.phase === 'completed' && (broadcast.failed || []).length) {
        broadcastStatus.classList.add('failed');
        broadcastStatus.textContent = 'Рассылка завершена: ' + broadcast.sent + ' из ' + broadcast.total + '. Не отправлено: ' + broadcast.failed.join(', ');
      } else if (broadcast.phase === 'completed') {
        broadcastStatus.textContent = 'Рассылка завершена: ' + broadcast.sent + ' из ' + broadcast.total;
      }
      renderAutoResponderStatus(next.autoResponderStatus || {phase:'disabled',recipients:0,repliesSent:0});
      $('chatMini').textContent = p.selectedChatIds.length ? p.selectedChatIds.length + ' из ' + next.maxSelectedChats + ' чатов' : 'Чаты не выбраны';
      $('replyMini').textContent = 'Ответ через AI tool';

      const top = $('topStatus');
      $('topStatusText').textContent = connected ? (next.monitoring ? 'Мониторинг активен' : 'Telegram подключён') : authStageLabel(next.authStage);
      top.className = 'status ' + (next.monitoring ? 'ok' : next.authStage === 'error' ? 'error' : connected || next.authStage.includes('awaiting') || next.authStage.includes('verifying') || next.authStage === 'sending_code' || next.authStage === 'restoring' ? 'warn' : '');
      if (previousConnected !== connected || selectionChanged) renderChats();
      else updateSelected();
    }

    function renderAutoResponderStatus(summary) {
      const box = $('autoResponderStatus');
      box.className = 'auto-responder-status ' + (summary.phase || 'disabled');
      if (summary.phase === 'active') {
        box.textContent = 'Активен: ' + summary.recipients + ' личных чатов · автоответов ' + summary.repliesSent;
      } else if (summary.phase === 'waiting') {
        box.textContent = 'Включён · ждёт новую подтверждённую рассылку';
      } else {
        box.textContent = 'Выключен · активной кампании нет';
      }
      $('autoResponderPanel').classList.toggle('enabled', $('autoResponderEnabled').checked);
    }

    function createAutoReplyRuleId() {
      return 'rule-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
    }

    function autoReplyRule(ruleId) {
      return autoReplyRules.find((rule) => rule.id === ruleId);
    }

    function triggerKey(value) {
      return String(value || '').normalize('NFKC').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/g, ' ').trim();
    }

    function addTriggers(rule, values) {
      const known = new Set(rule.triggers.map(triggerKey));
      values.forEach((value) => {
        const trigger = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 300);
        const key = triggerKey(trigger);
        if (key && !known.has(key)) {
          known.add(key);
          rule.triggers.push(trigger);
        }
      });
    }

    function renderAutoReplyRules(focusRuleId = '') {
      const container = $('autoReplyRules');
      container.textContent = '';
      $('autoResponderPanel').classList.toggle('enabled', $('autoResponderEnabled').checked);
      if (!autoReplyRules.length) {
        const empty = document.createElement('div');
        empty.className = 'auto-rule-empty';
        empty.textContent = 'Правил пока нет. Добавьте триггеры и сохранённый ответ для новой рассылки.';
        container.appendChild(empty);
        return;
      }

      autoReplyRules.forEach((rule, index) => {
        const card = document.createElement('div');
        card.className = 'auto-rule-card';
        card.style.setProperty('--rule-index', String(index));

        const head = document.createElement('div');
        head.className = 'auto-rule-head';
        const number = document.createElement('span');
        number.className = 'auto-rule-number';
        const badge = document.createElement('i');
        badge.textContent = String(index + 1).padStart(2, '0');
        number.append(badge, document.createTextNode('Правило автоответа'));
        const removeRule = document.createElement('button');
        removeRule.type = 'button';
        removeRule.className = 'rule-delete';
        removeRule.dataset.deleteRule = rule.id;
        removeRule.title = 'Удалить правило';
        removeRule.setAttribute('aria-label', 'Удалить правило ' + (index + 1));
        removeRule.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>';
        head.append(number, removeRule);

        const fields = document.createElement('div');
        fields.className = 'auto-rule-fields';
        const triggerField = document.createElement('div');
        triggerField.className = 'field';
        const triggerLabel = document.createElement('label');
        triggerLabel.className = 'field-label';
        triggerLabel.textContent = 'Триггерные фразы';
        const triggerEditor = document.createElement('div');
        triggerEditor.className = 'trigger-editor';
        const chips = document.createElement('div');
        chips.className = 'trigger-chips';
        rule.triggers.forEach((trigger, triggerIndex) => {
          const chip = document.createElement('span');
          chip.className = 'trigger-chip';
          const edit = document.createElement('button');
          edit.type = 'button';
          edit.className = 'trigger-chip-edit';
          edit.dataset.editRule = rule.id;
          edit.dataset.triggerIndex = String(triggerIndex);
          edit.title = 'Изменить триггер';
          edit.textContent = trigger;
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'trigger-chip-remove';
          remove.dataset.removeRule = rule.id;
          remove.dataset.triggerIndex = String(triggerIndex);
          remove.title = 'Удалить триггер';
          remove.setAttribute('aria-label', 'Удалить триггер ' + trigger);
          remove.textContent = '×';
          chip.append(edit, remove);
          chips.appendChild(chip);
        });
        const triggerInput = document.createElement('input');
        triggerInput.className = 'trigger-input';
        triggerInput.dataset.triggerInput = rule.id;
        triggerInput.maxLength = 300;
        triggerInput.placeholder = 'Введите фразу, затем запятую или Enter';
        triggerInput.value = autoReplyDrafts.get(rule.id) || '';
        triggerEditor.append(chips, triggerInput);
        const triggerHint = document.createElement('p');
        triggerHint.className = 'auto-rule-hint';
        triggerHint.textContent = 'Пробел остаётся частью фразы. Кликните по чипу, чтобы изменить его.';
        triggerField.append(triggerLabel, triggerEditor, triggerHint);

        const responseField = document.createElement('div');
        responseField.className = 'field';
        const responseLabel = document.createElement('label');
        responseLabel.className = 'field-label';
        responseLabel.textContent = 'Сохранённый ответ';
        const response = document.createElement('textarea');
        response.className = 'auto-response';
        response.dataset.responseRule = rule.id;
        response.maxLength = 4096;
        response.placeholder = 'Этот текст отправится без изменений';
        response.value = rule.response;
        const responseHint = document.createElement('p');
        responseHint.className = 'auto-rule-hint';
        responseHint.textContent = 'Если совпадут несколько правил, нейронка только выберет один из сохранённых ответов.';
        responseField.append(responseLabel, response, responseHint);

        fields.append(triggerField, responseField);
        card.append(head, fields);
        container.appendChild(card);
      });

      if (focusRuleId) {
        const input = container.querySelector('[data-trigger-input="' + focusRuleId + '"]');
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }
    }

    function commitAutoReplyDraft(ruleId, commitAll, suppliedValue) {
      const rule = autoReplyRule(ruleId);
      if (!rule) return false;
      const input = $('autoReplyRules').querySelector('[data-trigger-input="' + ruleId + '"]');
      const value = suppliedValue === undefined
        ? String(input?.value ?? autoReplyDrafts.get(ruleId) ?? '')
        : String(suppliedValue);
      const parsed = consumeAutoReplyTriggerInput(value, commitAll);
      addTriggers(rule, parsed.committed);
      autoReplyDrafts.set(ruleId, parsed.remainder);
      return parsed.committed.length > 0;
    }

    function collectAutoReplyRules() {
      autoReplyRules.forEach((rule) => commitAutoReplyDraft(rule.id, true));
      renderAutoReplyRules();
      return autoReplyRules.map((rule) => ({
        id: rule.id,
        triggers: [...rule.triggers],
        response: rule.response.trim(),
      }));
    }

    function onAutoReplyRuleInput(event) {
      const target = event.target;
      const responseRuleId = target?.dataset?.responseRule;
      if (responseRuleId) {
        const rule = autoReplyRule(responseRuleId);
        if (rule) rule.response = target.value;
        settingsDirty = true;
        return;
      }
      const triggerRuleId = target?.dataset?.triggerInput;
      if (!triggerRuleId) return;
      autoReplyDrafts.set(triggerRuleId, target.value);
      settingsDirty = true;
      if (target.value.includes(',') && commitAutoReplyDraft(triggerRuleId, false, target.value)) {
        renderAutoReplyRules(triggerRuleId);
      }
    }

    function onAutoReplyRuleKeydown(event) {
      const ruleId = event.target?.dataset?.triggerInput;
      if (!ruleId || (event.key !== 'Enter' && event.key !== ',')) return;
      event.preventDefault();
      const value = event.key === ',' ? event.target.value + ',' : event.target.value;
      if (commitAutoReplyDraft(ruleId, event.key === 'Enter', value)) {
        settingsDirty = true;
        renderAutoReplyRules(ruleId);
      }
    }

    function onAutoReplyRuleClick(event) {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.deleteRule) {
        const ruleId = button.dataset.deleteRule;
        autoReplyRules = autoReplyRules.filter((rule) => rule.id !== ruleId);
        autoReplyDrafts.delete(ruleId);
        settingsDirty = true;
        renderAutoReplyRules();
        return;
      }
      const removeRuleId = button.dataset.removeRule;
      if (removeRuleId !== undefined) {
        const rule = autoReplyRule(removeRuleId);
        const index = Number(button.dataset.triggerIndex);
        if (rule && Number.isInteger(index)) rule.triggers.splice(index, 1);
        settingsDirty = true;
        renderAutoReplyRules(removeRuleId);
        return;
      }
      const editRuleId = button.dataset.editRule;
      if (editRuleId !== undefined) {
        const rule = autoReplyRule(editRuleId);
        const index = Number(button.dataset.triggerIndex);
        if (!rule || !Number.isInteger(index) || !rule.triggers[index]) return;
        autoReplyDrafts.set(editRuleId, rule.triggers[index]);
        rule.triggers.splice(index, 1);
        settingsDirty = true;
        renderAutoReplyRules(editRuleId);
      }
    }

    function maskValue(value) {
      const text = String(value || '');
      if (!text) return '';
      const visible = Array.from(text).slice(0, 2).join('');
      return visible + '•'.repeat(Math.max(3, Math.min(9, Array.from(text).length - visible.length)));
    }

    function renderIdentity() {
      const button = $('privacyBtn');
      button.classList.toggle('on', privacyHidden);
      button.setAttribute('aria-pressed', String(privacyHidden));
      const label = privacyHidden ? 'Показать имя и номер' : 'Скрыть имя и номер';
      button.title = label;
      button.setAttribute('aria-label', label);
      if (!state) return;

      const name = state.accountName || 'Telegram';
      const phone = state.phone || '';
      $('accountName').textContent = privacyHidden ? maskValue(name) : name;
      $('accountPhone').textContent = privacyHidden ? maskValue(phone) : phone;
      $('accountName').classList.toggle('masked', privacyHidden);
      $('accountPhone').classList.toggle('masked', privacyHidden);

      const connected = Boolean(state.connected);
      const mini = connected
        ? (state.accountName || 'Telegram подключён')
        : authStageLabel(state.authStage);
      $('accountMini').textContent = connected && privacyHidden ? maskValue(mini) : mini;
      $('accountMini').classList.toggle('masked', connected && privacyHidden);
    }

    async function togglePrivacy() {
      const button = $('privacyBtn');
      const next = !privacyHidden;
      setBusy(button, true);
      try {
        // The flag lives in the plugin's own state file. localStorage throws in
        // this sandboxed iframe, so nothing in the page can remember it.
        const result = await api('setHideIdentity', {hidden: next});
        renderState(result.state);
        toast(next ? 'Имя и номер скрыты' : 'Имя и номер показаны');
      } catch (error) {
        toast(error.message, true);
      } finally {
        setBusy(button, false);
      }
    }

    function renderMonitored() {
      const button = $('monitoredBtn');
      button.classList.toggle('on', monitoredOpen);
      button.setAttribute('aria-pressed', String(monitoredOpen));
      $('monitoredPanel').hidden = !monitoredOpen;
      if (!monitoredOpen) return;

      const names = state?.preferences?.selectedChatNames || {};
      const active = state?.preferences?.selectedChatIds || [];
      const titles = new Map(chats.map((chat) => [chat.id, chat.title]));
      const pending = active.length !== selected.size || active.some((id) => !selected.has(id));
      $('monitoredCount').textContent = active.length + ' / ' + (state?.maxSelectedChats || 1000);
      $('monitoredNote').textContent = !state?.preferences?.enabled
        ? 'Фоновый мониторинг выключен в блоке 03 — сообщения не озвучиваются.'
        : pending
          ? 'Ниже сохранённый список. Нажмите «Сохранить», чтобы применить текущий выбор.'
          : '';
      $('monitoredTags').innerHTML = active.length
        ? active
            .map((id) => ({ id, title: titles.get(id) || names[id] || 'Чат ' + id }))
            .sort((left, right) => left.title.localeCompare(right.title, 'ru'))
            .map((chat) => '<span class="monitored-tag" title="' + escapeHtml(chat.title) + '"><i></i><span>' + escapeHtml(chat.title) + '</span></span>')
            .join('')
        : '<span class="monitored-empty">Пока ни один чат не мониторится — выберите чаты выше и нажмите «Сохранить».</span>';
    }

    function authStageLabel(stage) {
      return ({logged_out:'Telegram не подключён',restoring:'Восстанавливаем сессию',sending_code:'Отправляем код',preparing_qr:'Получаем QR-код',awaiting_qr:'Ожидаем сканирования QR-кода',awaiting_code:'Ждём код Telegram',verifying_code:'Проверяем код',awaiting_password:'Нужен пароль 2FA',verifying_password:'Проверяем пароль',error:'Ошибка подключения'})[stage] || 'Telegram';
    }

    function renderLoginTimers() {
      if (!state) return;
      const now = Date.now();
      if (state.authStage === 'awaiting_code') {
        const timer = loginTimerView(state, now, stateReceivedAt);
        $('resendBtn').disabled = timer.disabled;
        $('resendBtn').textContent = timer.text;
      }
      const waitingQr = state.authStage === 'preparing_qr' || state.authStage === 'awaiting_qr';
      $('qrBlock').hidden = !waitingQr;
      const qr = waitingQr && state.qrLogin && state.qrLogin.expiresAt > now ? state.qrLogin : null;
      $('qrImage').hidden = !qr;
      if (qr) {
        if ($('qrImage').getAttribute('src') !== qr.image) $('qrImage').src = qr.image;
        $('qrStatus').textContent = 'QR-код обновится через ' + Math.max(0, Math.ceil((qr.expiresAt - now) / 1000)) + ' сек.';
      } else {
        $('qrImage').removeAttribute('src');
        $('qrStatus').textContent = state.authStage === 'preparing_qr' ? 'Получаем QR-код…' : 'Обновляем QR-код…';
      }
      $('qrLoginBtn').disabled = waitingQr;
    }

    function codeHint(next) {
      if (next.codeDelivery === 'app') {
        return 'Telegram указал доставку в приложение — ищите служебный чат «Telegram» в аккаунте с номером ' + (next.phone || 'из формы') + '. Это ответ на запрос, а не подтверждение получения кода. ' + (next.codeNextDelivery ? 'Если код не появится, после таймера можно запросить его повторно' + (next.codeNextDelivery === 'sms' ? ' по SMS.' : '.') : 'Telegram не предложил повторный запрос. Таймер показывает время ожидания, а не срок до разблокировки. Можно войти по QR-коду.');
      }
      if (next.codeDelivery === 'sms') return 'Код отправлен по SMS на ' + (next.phone || 'указанный номер') + '.';
      if (next.codeDelivery === 'call') return 'Telegram позвонит и продиктует код.';
      return '';
    }

    function escapeHtml(text) {
      const node = document.createElement('span');
      node.textContent = String(text || '');
      return node.innerHTML;
    }

    function chatKind(kind) {
      return ({user:'Личный чат',group:'Группа',channel:'Канал'})[kind] || 'Чат';
    }

    function renderChats() {
      const query = $('chatSearch').value.trim().toLocaleLowerCase('ru');
      const visible = chats.filter((chat) => chat.title.toLocaleLowerCase('ru').includes(query));
      const emptyTitle = state?.connected ? 'Загрузите список чатов' : 'Сначала подключите Telegram';
      const emptyText = state?.connected ? 'Нажмите «Загрузить», чтобы увидеть диалоги' : 'После входа здесь появятся ваши чаты';
      $('chatList').innerHTML = visible.length
        ? visible.map((chat, index) => {
            const initial = Array.from(chat.title.trim())[0] || 'T';
            const checked = selected.has(chat.id);
            return '<label class="chat' + (checked ? ' selected' : '') + '" style="--i:' + Math.min(index, 14) + '"><input type="checkbox" data-chat="' + escapeHtml(chat.id) + '" ' + (checked ? 'checked' : '') + '><span class="chat-avatar">' + escapeHtml(initial) + '</span><span class="chat-name">' + escapeHtml(chat.title) + '<span class="chat-kind">' + chatKind(chat.kind) + '</span></span>' + (chat.unreadCount ? '<span class="count unread">' + Number(chat.unreadCount) + '</span>' : '') + '</label>';
          }).join('')
        : '<div class="empty-state"><div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45"><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M9 9h6M9 12h4"/></svg><strong>' + emptyTitle + '</strong><span>' + emptyText + '</span></div></div>';
      updateSelected();
    }

    function onChatToggle(event) {
      const box = event.target;
      if (!box || !box.dataset || !box.dataset.chat) return;
      const limit = state?.maxSelectedChats || 1000;
      if (box.checked && selected.size >= limit) {
        box.checked = false;
        toast('Можно выбрать не больше ' + limit + ' чатов', true);
        return;
      }
      box.checked ? selected.add(box.dataset.chat) : selected.delete(box.dataset.chat);
      box.closest('.chat').classList.toggle('selected', box.checked);
      selectionDirty = true;
      updateSelected();
    }

    function updateSelected() {
      $('selectedCount').textContent = selected.size + ' / ' + (state?.maxSelectedChats || 1000);
      renderMonitored();
    }

    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try { renderState(await api('getState')); }
      catch (error) { toast(error.message, true); }
      finally { refreshing = false; }
    }

    async function savePreferences() {
      const autoResponderEnabled = $('autoResponderEnabled').checked;
      const savedAutoReplyRules = collectAutoReplyRules();
      const autoReplyError = validateAutoReplyRulesForSave(autoResponderEnabled, savedAutoReplyRules);
      if (autoReplyError) throw new Error(autoReplyError);
      const body = {
        enabled: $('enabled').checked,
        selectedChatIds: [...selected],
        selectedChatNames: selectedChatNames(),
        hideIdentity: privacyHidden,
        textTemplate: $('textTemplate').value,
        voiceTemplate: $('voiceTemplate').value,
        replyCommandPhrase: $('replyCommandPhrase').value,
        replyWindowSeconds: Number($('replyWindow').value),
        replyConfirmationTemplate: $('replyConfirmationTemplate').value,
        sendCommandPhrase: $('sendCommandPhrase').value,
        broadcastCommandPhrase: $('broadcastCommandPhrase').value,
        broadcastDelayMinSeconds: Number($('broadcastDelayMinSeconds').value),
        broadcastDelayMaxSeconds: Number($('broadcastDelayMaxSeconds').value),
        autoResponderEnabled,
        autoReplyRules: savedAutoReplyRules,
      };
      const result = await api('savePreferences', body);
      selectionDirty = false;
      settingsDirty = false;
      renderState(result.state);
      toast('Настройки сохранены');
    }

    function selectedChatNames() {
      const known = state?.preferences?.selectedChatNames || {};
      const titles = new Map(chats.map((chat) => [chat.id, chat.title]));
      const names = {};
      selected.forEach((id) => {
        const title = titles.get(id) || known[id];
        if (title) names[id] = title;
      });
      return names;
    }

    $('sendCodeBtn').onclick = async () => { const button=$('sendCodeBtn'); setBusy(button,true); try { const result=await api('beginLogin',{phone:$('phone').value},30000); renderState(result.state); } catch(error){toast(error.message,true);} finally{setBusy(button,false);} };
    $('qrLoginBtn').onclick = async () => {
      const button = $('qrLoginBtn');
      setBusy(button, true);
      try { const result = await api('beginQrLogin', {}, 30000); renderState(result.state); }
      catch (error) { toast(error.message, true); }
      finally { setBusy(button, false); }
    };
    $('cancelQrBtn').onclick = async () => {
      try { const result = await api('cancelQrLogin'); renderState(result.state); }
      catch (error) { toast(error.message, true); }
    };
    $('resendBtn').onclick = async () => {
      const button=$('resendBtn');
      setBusy(button,true);
      try {
        const result=await api('resendLoginCode',{},30000);
        $('code').value='';
        renderState(result.state);
        toast('Запросили код заново');
      } catch(error){toast(error.message,true);} finally{setBusy(button,false);}
    };
    $('codeBtn').onclick = async () => { const button=$('codeBtn'); setBusy(button,true); try { const result=await api('submitCode',{code:$('code').value}); $('code').value=''; renderState(result.state); } catch(error){toast(error.message,true);} finally{setBusy(button,false);} };
    $('passwordBtn').onclick = async () => { const button=$('passwordBtn'); setBusy(button,true); try { const result=await api('submitPassword',{password:$('password').value}); $('password').value=''; renderState(result.state); } catch(error){toast(error.message,true);} finally{setBusy(button,false);} };
    $('logoutBtn').onclick = async () => {
      if (!await ask('Выйти из Telegram?', 'Локальная сессия будет удалена. Можно войти заново по международному номеру или QR-коду другого аккаунта.', 'Выйти')) return;
      const button = $('logoutBtn');
      setBusy(button, true);
      try { await api('logout'); chats=[]; selectionDirty=false; settingsDirty=false; monitoredOpen=false; await refresh(); }
      catch (error) { toast(error.message, true); }
      finally { setBusy(button, false); }
    };
    $('privacyBtn').onclick = togglePrivacy;
    $('monitoredBtn').onclick = async () => {
      monitoredOpen = !monitoredOpen;
      renderMonitored();
      if (!monitoredOpen) return;
      $('monitoredPanel').scrollIntoView({block:'nearest', behavior:'smooth'});
      if (!state?.connected || chats.length) return;
      const names = state.preferences.selectedChatNames || {};
      if (!(state.preferences.selectedChatIds || []).some((id) => !names[id])) return;
      const button = $('monitoredBtn');
      setBusy(button, true);
      try { chats = (await api('listChats', {}, 45000)).chats; renderChats(); }
      catch (_) {}
      finally { setBusy(button, false); }
    };
    $('loadChatsBtn').onclick = async () => { const button=$('loadChatsBtn'); setBusy(button,true); try { const result=await api('listChats',{},45000); chats=result.chats; renderChats(); toast('Загружено чатов: ' + chats.length); } catch(error){toast(error.message,true);} finally{setBusy(button,false);} };
    $('monitorAllBtn').onclick = async () => {
      const button=$('monitorAllBtn');
      if (!state?.connected) return toast('Сначала подключите Telegram', true);
      if (!await ask('Мониторить все чаты?', 'Astra будет озвучивать сообщения из каждого доступного чата, включая каналы и группы. Выбор можно изменить в любой момент.', 'Включить')) return;
      setBusy(button,true);
      try {
        const result=await api('monitorAllChats',{},60000);
        chats=result.chats;
        selectionDirty=false;
        monitoredOpen=true;
        renderState(result.state);
        renderChats();
        toast('Мониторим все чаты: ' + result.state.preferences.selectedChatIds.length);
      } catch(error){toast(error.message,true);} finally{setBusy(button,false);}
    };
    $('commandsBtn').onclick = async () => {
      const button=$('commandsBtn');
      setBusy(button,true);
      try {
        const result=await api('exportCommandsFile',{},20000);
        $('commandsResult').textContent = 'Файл готов: ' + result.path + ' · команды: ' + result.names.join(', ');
        await tell('Файл команд готов', 'Откройте в Astra раздел «Команды» → «Импорт» и укажите этот файл. Внутри: ' + result.names.join(', ') + '.', result.path);
      } catch(error){ $('commandsResult').textContent=''; toast(error.message,true); }
      finally{setBusy(button,false);}
    };
    $('manualBtn').onclick = () => {
      const block=$('manualBlock');
      const open=block.hidden;
      block.hidden=!open;
      $('manualBtn').setAttribute('aria-expanded', String(open));
      $('manualBtn').classList.toggle('on', open);
    };
    $('dialogConfirm').onclick = () => closeDialog(true);
    $('dialogCancel').onclick = () => closeDialog(false);
    $('dialogVeil').addEventListener('click', (event) => { if (event.target === $('dialogVeil')) closeDialog(false); });
    document.addEventListener('keydown', (event) => {
      if ($('dialogVeil').hidden) return;
      if (event.key === 'Escape') closeDialog(false);
      if (event.key === 'Enter') closeDialog(true);
    });
    $('saveChatsBtn').onclick = async () => { try { await savePreferences(); } catch(error){toast(error.message,true);} };
    $('saveSettingsBtn').onclick = async () => { try { await savePreferences(); } catch(error){toast(error.message,true);} };
    $('chatSearch').oninput = renderChats;
    $('chatList').addEventListener('change', onChatToggle);
    $('addAutoReplyRuleBtn').onclick = () => {
      const id = createAutoReplyRuleId();
      autoReplyRules.push({id, triggers:[], response:''});
      autoReplyDrafts.set(id, '');
      settingsDirty = true;
      renderAutoReplyRules(id);
    };
    $('autoResponderEnabled').addEventListener('change', () => {
      settingsDirty = true;
      $('autoResponderPanel').classList.toggle('enabled', $('autoResponderEnabled').checked);
    });
    $('autoReplyRules').addEventListener('input', onAutoReplyRuleInput);
    $('autoReplyRules').addEventListener('keydown', onAutoReplyRuleKeydown);
    $('autoReplyRules').addEventListener('click', onAutoReplyRuleClick);
    document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', () => copyValue(button)));
    ['enabled','textTemplate','voiceTemplate','replyCommandPhrase','replyWindow','replyConfirmationTemplate','sendCommandPhrase','broadcastCommandPhrase','broadcastDelayMinSeconds','broadcastDelayMaxSeconds','autoResponderEnabled'].forEach((id) => $(id).addEventListener('input', () => { settingsDirty = true; }));
    renderAutoReplyRules();
    renderIdentity();
    refresh();
    setInterval(refresh, 2500);
    setInterval(renderLoginTimers, 1000);
  })();
  </script>
</body>
</html>`;
}

export function renderPlayerHtml(): string {
  return String.raw`<!doctype html><html lang="ru"><head><script src="http://astra-plugin.localhost/bridge/astra-bridge.js"></script><meta charset="utf-8"><title>Telegram voice player</title><style>:root{color-scheme:normal}html,body{margin:0;background:transparent}body{color-scheme:light dark}</style></head><body><script>
(() => {
  const astra = window.astra;
  let playing = false;
  let polling = false;
  let retryDelay = 0;
  const call = (method, params = {}, timeoutMs = 12000) => new Promise((resolve, reject) => {
    if (!astra || typeof astra.callBackend !== 'function') return reject(new Error('Astra bridge unavailable'));
    const timer = setTimeout(() => reject(new Error('Telegram voice backend timeout')), timeoutMs);
    Promise.resolve().then(() => astra.callBackend(method, params)).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
  async function loadVoice(item) {
    const parts = [];
    let offset = 0;
    let done = false;
    while (!done) {
      const chunk = await call('voiceChunk', {id:item.id, offset});
      const binary = atob(chunk.data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      parts.push(bytes);
      offset = chunk.nextOffset;
      done = chunk.done;
    }
    return new Blob(parts, {type:item.mime || 'audio/ogg'});
  }
  async function poll() {
    if (playing || polling || !astra) return;
    polling = true;
    try {
      const next = await call('nextVoice', {waitMs:25000}, 30000);
      if (!next.item) return;
      playing = true;
      const objectUrl = URL.createObjectURL(await loadVoice(next.item));
      const audio = new Audio(objectUrl);
      audio.preload = 'auto'; audio.autoplay = true;
      const done = async (played, error = '') => { URL.revokeObjectURL(objectUrl); try { await call('acknowledgeVoice', {id:next.item.id, played, error}); } catch(_){} playing=false; retryDelay=played?0:2000; };
      audio.onended = () => done(true); audio.onerror = () => done(false, audio.error?.message || 'формат аудио не поддерживается');
      try { await audio.play(); } catch (error) { await done(false, error?.message || String(error)); }
    } catch (_) { retryDelay = 2000; }
    finally { polling = false; setTimeout(poll, retryDelay); }
  }
  poll();
})();
</script></body></html>`;
}
