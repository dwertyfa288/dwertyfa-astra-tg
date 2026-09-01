export function renderAppHtml(): string {
  return String.raw`<!doctype html>
<html lang="ru">
<head>
  <script src="http://astra-plugin.localhost/bridge/astra-bridge.js"></script>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Telegram для Astra</title>
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

    .chat-tools { display: grid; grid-template-columns: 1fr auto; gap: 9px; margin-bottom: 10px; }
    .search-wrap { position: relative; }
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
      .fields, .template-grid, .reply-grid, .time-grid { grid-template-columns: 1fr; }
      .field.full { grid-column: auto; }
      .chat-tools { grid-template-columns: 1fr; }
      .chat-tools button { width: 100%; }
      .monitor-row { align-items: flex-start; }
      .footer { align-items: flex-start; flex-direction: column; }
      .toast { right: 16px; bottom: 16px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
    }
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
        <div class="brand-copy"><h1>Telegram <span class="astra-word">для Astra</span></h1><p>Сообщения, голос и быстрые ответы — в одном потоке.</p></div>
      </div>
      <div id="topStatus" class="status"><span class="status-dot"></span><span id="topStatusText">Подключение…</span></div>
    </header>

    <section class="overview" aria-label="Состояние плагина">
      <div class="metric"><span class="metric-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7.5 11a4.5 4.5 0 1 1 9 0v2.5a4.5 4.5 0 0 1-9 0V11Z"/><path d="M5 13.5a7 7 0 0 0 14 0M12 20.5V23"/></svg></span><span class="metric-copy"><span class="metric-label">Аккаунт</span><span id="accountMini" class="metric-value">Проверяем сессию</span></span></div>
      <div class="metric"><span class="metric-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 5.5h16v11H9l-5 4v-15Z"/><path d="M8 9h8M8 12.5h5"/></svg></span><span class="metric-copy"><span class="metric-label">Мониторинг</span><span id="chatMini" class="metric-value">Чаты не выбраны</span></span></div>
      <div class="metric"><span class="metric-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3.2 2M18.5 3v5h-5"/></svg></span><span class="metric-copy"><span class="metric-label">Голосовой ответ</span><span id="replyMini" class="metric-value">Команда задаётся в Astra</span></span></div>
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
            <span class="verified">● online</span>
          </div>
          <div class="actions"><button id="logoutBtn" class="danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"/></svg>Выйти из Telegram</button></div>
        </div>
        <div id="accountLogin">
          <div class="fields">
            <div class="field full"><label class="field-label" for="phone">Номер телефона <span class="field-note">Международный формат</span></label><input id="phone" autocomplete="tel" placeholder="+7 999 123-45-67"><p class="hint">API-параметры и защищённое подключение настраиваются автоматически — вам нужен только номер.</p></div>
          </div>
          <div class="actions"><button id="sendCodeBtn" class="primary">Продолжить<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14M14 7l5 5-5 5"/></svg></button></div>
          <div id="codeBlock" class="auth-stage" hidden><div class="field"><label class="field-label" for="code">Код из Telegram <span class="field-note">Одноразовый</span></label><input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="•••••"></div><div class="actions"><button id="codeBtn" class="primary">Подтвердить код</button></div></div>
          <div id="passwordBlock" class="auth-stage" hidden><div class="field"><label class="field-label" for="password">Пароль 2FA <span class="field-note">Не сохраняется</span></label><input id="password" type="password" autocomplete="current-password" placeholder="Пароль двухэтапной защиты"></div><div id="passwordHint" class="hint"></div><div class="actions"><button id="passwordBtn" class="primary">Войти в аккаунт</button></div></div>
          <div id="authError" class="error"></div>
        </div>
      </section>

      <section class="card chat-card" style="--delay:.2s">
        <div class="card-head">
          <div class="section-title"><span class="section-index">02</span><div><h2>Чаты для мониторинга</h2><p class="subtitle">Личные диалоги, группы и каналы · до <span id="maxChats">10</span></p></div></div>
          <span class="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55"><path d="M4 6h16v11H9l-5 4V6Z"/><path d="M8 10h8M8 13h5"/></svg></span>
        </div>
        <div class="chat-tools"><div class="search-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg><input id="chatSearch" placeholder="Найти чат"></div><button id="loadChatsBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 8.5A7 7 0 0 1 18.8 7M17.9 15.5A7 7 0 0 1 5.2 17"/></svg>Загрузить</button></div>
        <div id="chatList" class="chat-list"><div class="empty-state"><div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45"><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M9 9h6M9 12h4"/></svg><strong>Сначала подключите Telegram</strong><span>После входа здесь появятся ваши чаты</span></div></div></div>
        <div class="actions"><button id="saveChatsBtn" class="primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 4h12l2 2v14H5V4Z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/></svg>Сохранить</button><span id="selectedCount" class="count selected-summary">0 / 10</span></div>
      </section>

      <section class="card settings-card wide" style="--delay:.26s">
        <div class="card-head">
          <div class="section-title"><span class="section-index">03</span><div><h2>Озвучивание и быстрый ответ</h2><p class="subtitle">Настройте анонсы, подтверждение и окно ответа</p></div></div>
          <span class="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55"><path d="M12 3a4 4 0 0 0-4 4v5a4 4 0 0 0 8 0V7a4 4 0 0 0-4-4Z"/><path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V22M8.5 22h7"/></svg></span>
        </div>
        <div class="monitor-row"><div class="monitor-copy"><strong>Фоновый мониторинг</strong><span>Плагин реагирует только на выбранные выше чаты</span></div><label class="toggle" aria-label="Мониторинг включён"><input id="enabled" type="checkbox"><span class="switch"></span></label></div>
        <div class="template-grid">
          <div class="field"><label class="field-label" for="textTemplate">Текстовое сообщение <span class="field-note">Голос Astra</span></label><textarea id="textTemplate" placeholder="Вам написал {sender}. {message}"></textarea></div>
          <div class="field"><label class="field-label" for="voiceTemplate">Перед голосовым <span class="field-note">Анонс</span></label><textarea id="voiceTemplate" placeholder="Вам прислал голосовое сообщение {sender}"></textarea></div>
        </div>
        <div class="variables"><span>Нажмите, чтобы скопировать</span><button type="button" class="code copy-code" data-copy="{sender}">{sender}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button><button type="button" class="code copy-code" data-copy="{chat}">{chat}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button><button type="button" class="code copy-code" data-copy="{message}">{message}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button></div>
        <div class="reply-grid">
          <div class="field"><label class="field-label" for="replyWindow">Окно ответа <span class="field-note">Сек.</span></label><input id="replyWindow" type="number" min="10" max="3600"><p class="hint">Командное слово задаётся только в текстовом триггере Astra. Например: «Астра, напиши привет».</p></div>
          <div class="field"><label class="field-label" for="replyConfirmationTemplate">После отправки ответа <span class="field-note">Голос Astra</span></label><textarea id="replyConfirmationTemplate" placeholder="Ответ отправлен."></textarea><p class="hint">Что Astra скажет после успешной отправки в Telegram. Можно использовать {sender}, {chat} и {message}; оставьте поле пустым, чтобы ничего не произносить.</p></div>
        </div>
        <div class="actions"><button id="saveSettingsBtn" class="primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 4h12l2 2v14H5V4Z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/></svg>Сохранить настройки</button></div>
        <p id="activity" class="activity">Ожидаем состояние плагина</p>
      </section>

      <section class="card voice-card wide" style="--delay:.32s">
        <div class="card-head">
          <div class="section-title"><span class="section-index">04</span><div><h2>Настройка команды Astra</h2><p class="subtitle">Соберите эту цепочку один раз — дальше сообщения запускают её автоматически</p></div></div>
          <span class="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55"><path d="M4 12h2l2-6 4 12 3-9 2 3h3"/></svg></span>
        </div>
        <div class="voice-layout">
          <div>
            <ol class="steps">
              <li>Откройте <b>«Команды»</b>, создайте или выберите команду и нажмите <b>«+ Узлы» → «Новое сообщение Telegram»</b>. Внутри триггера ничего вводить не нужно — оставьте статус <b>«Включён»</b>.</li>
              <li>Добавьте действие <b>«Произнести»</b>. В поле <b>«Текст»</b> вставьте <button type="button" class="code copy-code" data-copy="{announcement}">{announcement}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button>, включите <b>«Использовать голос из настроек»</b> и оставьте отмеченным <b>«Ждать завершения»</b>.</li>
              <li>Добавьте действие плагина <b>«Проиграть голосовое Telegram»</b>. Настраивать внутри ничего не нужно: плагин сам берёт следующее загруженное голосовое. Для текстовых сообщений шаг тихо пропускается.</li>
              <li>Проверьте соединения: <b>Новое сообщение Telegram → Произнести → Проиграть голосовое Telegram</b>. Затем включите переключатель самой команды.</li>
            </ol>
            <div class="monitor-row" style="margin-top:18px"><div class="monitor-copy"><strong>Чтобы Astra могла ответить в Telegram</strong><span>Отдельная команда передаёт произнесённый ответ плагину</span></div></div>
            <ol class="steps" style="margin-top:14px">
              <li>Создайте <b>вторую команду</b>, например <b>«Ответ Telegram»</b>, и добавьте триггер <b>«Текстовая фраза»</b>.</li>
              <li>Впишите любое удобное <b>одно командное слово</b>, например <button type="button" class="code copy-code" data-copy="ответь">ответь<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button> или <button type="button" class="code copy-code" data-copy="напиши">напиши<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button>. Отключите точное совпадение, чтобы команда принимала продолжение: «напиши привет».</li>
              <li>Добавьте единственное действие плагина <b>«Перехватить ответ Telegram»</b>, соедините с триггером и включите команду. Узлы <b>«Произнести»</b> и <b>«Проиграть голосовое»</b> в эту вторую команду добавлять не нужно.</li>
            </ol>
          </div>
          <div class="voice-orb-wrap" aria-hidden="true"><div class="voice-orb"><span class="waveform"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span></div><span class="voice-caption">Astra voice engine</span></div>
        </div>
      </section>
    </div>
    <footer class="footer"><span class="footer-brand"><i></i>Astra Telegram Bridge</span><span>Личная MTProto-сессия хранится локально</span></footer>
  </main>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <script>
  (() => {
    const astra = window.astra;
    const $ = (id) => document.getElementById(id);
    let state = null;
    let chats = [];
    let selected = new Set();
    let selectionDirty = false;
    let settingsDirty = false;
    let refreshing = false;

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

    function renderState(next) {
      const previousConnected = state?.connected;
      const previousSelected = new Set(selected);
      state = next;
      const connected = next.connected;
      $('accountConnected').hidden = !connected;
      $('accountLogin').hidden = connected;
      $('accountName').textContent = next.accountName || 'Telegram';
      $('accountPhone').textContent = next.phone || '';
      $('phone').value ||= next.phone || '';
      $('authError').textContent = next.authError || '';
      $('codeBlock').hidden = next.authStage !== 'awaiting_code';
      $('passwordBlock').hidden = next.authStage !== 'awaiting_password';
      $('passwordHint').textContent = next.passwordHint ? 'Подсказка Telegram: ' + next.passwordHint : '';
      $('maxChats').textContent = next.maxSelectedChats;

      const p = next.preferences;
      if (!selectionDirty) selected = new Set(p.selectedChatIds || []);
      const selectionChanged = previousSelected.size !== selected.size || [...previousSelected].some((id) => !selected.has(id));
      if (!settingsDirty) {
        $('enabled').checked = p.enabled;
        $('textTemplate').value = p.textTemplate;
        $('voiceTemplate').value = p.voiceTemplate;
        $('replyWindow').value = p.replyWindowSeconds;
        $('replyConfirmationTemplate').value = p.replyConfirmationTemplate;
      }

      $('activity').textContent = next.lastActivity + (next.replyTarget ? ' · Ответ для «' + next.replyTarget.chat + '» доступен ещё ' + next.replyTarget.secondsLeft + ' сек.' : '');
      $('accountMini').textContent = connected ? (next.accountName || 'Telegram подключён') : authStageLabel(next.authStage);
      $('chatMini').textContent = p.selectedChatIds.length ? p.selectedChatIds.length + ' из ' + next.maxSelectedChats + ' чатов' : 'Чаты не выбраны';
      $('replyMini').textContent = 'Команда задаётся в Astra';

      const top = $('topStatus');
      $('topStatusText').textContent = connected ? (next.monitoring ? 'Мониторинг активен' : 'Telegram подключён') : authStageLabel(next.authStage);
      top.className = 'status ' + (next.monitoring ? 'ok' : next.authStage === 'error' ? 'error' : connected || next.authStage.includes('awaiting') || next.authStage.includes('verifying') || next.authStage === 'sending_code' || next.authStage === 'restoring' ? 'warn' : '');
      if (previousConnected !== connected || selectionChanged) renderChats();
      else updateSelected();
    }

    function authStageLabel(stage) {
      return ({logged_out:'Telegram не подключён',restoring:'Восстанавливаем сессию',sending_code:'Отправляем код',awaiting_code:'Ждём код Telegram',verifying_code:'Проверяем код',awaiting_password:'Нужен пароль 2FA',verifying_password:'Проверяем пароль',error:'Ошибка подключения'})[stage] || 'Telegram';
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
            return '<label class="chat' + (checked ? ' selected' : '') + '" style="--i:' + index + '"><input type="checkbox" data-chat="' + escapeHtml(chat.id) + '" ' + (checked ? 'checked' : '') + '><span class="chat-avatar">' + escapeHtml(initial) + '</span><span class="chat-name">' + escapeHtml(chat.title) + '<span class="chat-kind">' + chatKind(chat.kind) + '</span></span>' + (chat.unreadCount ? '<span class="count unread">' + Number(chat.unreadCount) + '</span>' : '') + '</label>';
          }).join('')
        : '<div class="empty-state"><div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45"><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M9 9h6M9 12h4"/></svg><strong>' + emptyTitle + '</strong><span>' + emptyText + '</span></div></div>';

      $('chatList').querySelectorAll('[data-chat]').forEach((box) => box.addEventListener('change', () => {
        if (box.checked && selected.size >= state.maxSelectedChats) {
          box.checked = false;
          toast('Можно выбрать не больше ' + state.maxSelectedChats + ' чатов', true);
          return;
        }
        box.checked ? selected.add(box.dataset.chat) : selected.delete(box.dataset.chat);
        box.closest('.chat').classList.toggle('selected', box.checked);
        selectionDirty = true;
        updateSelected();
      }));
      updateSelected();
    }

    function updateSelected() {
      $('selectedCount').textContent = selected.size + ' / ' + (state?.maxSelectedChats || 10);
    }

    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try { renderState(await api('getState')); }
      catch (error) { toast(error.message, true); }
      finally { refreshing = false; }
    }

    async function savePreferences() {
      const body = {
        enabled: $('enabled').checked,
        selectedChatIds: [...selected],
        textTemplate: $('textTemplate').value,
        voiceTemplate: $('voiceTemplate').value,
        replyWindowSeconds: Number($('replyWindow').value),
        replyConfirmationTemplate: $('replyConfirmationTemplate').value,
      };
      const result = await api('savePreferences', body);
      selectionDirty = false;
      settingsDirty = false;
      renderState(result.state);
      toast('Настройки сохранены');
    }

    $('sendCodeBtn').onclick = async () => { const button=$('sendCodeBtn'); setBusy(button,true); try { const result=await api('beginLogin',{phone:$('phone').value}); renderState(result.state); } catch(error){toast(error.message,true);} finally{setBusy(button,false);} };
    $('codeBtn').onclick = async () => { const button=$('codeBtn'); setBusy(button,true); try { const result=await api('submitCode',{code:$('code').value}); $('code').value=''; renderState(result.state); } catch(error){toast(error.message,true);} finally{setBusy(button,false);} };
    $('passwordBtn').onclick = async () => { const button=$('passwordBtn'); setBusy(button,true); try { const result=await api('submitPassword',{password:$('password').value}); $('password').value=''; renderState(result.state); } catch(error){toast(error.message,true);} finally{setBusy(button,false);} };
    $('logoutBtn').onclick = async () => { if(!confirm('Выйти из Telegram и удалить локальную сессию?')) return; await api('logout'); chats=[]; selectionDirty=false; settingsDirty=false; await refresh(); };
    $('loadChatsBtn').onclick = async () => { const button=$('loadChatsBtn'); setBusy(button,true); try { const result=await api('listChats'); chats=result.chats; renderChats(); toast('Чаты загружены'); } catch(error){toast(error.message,true);} finally{setBusy(button,false);} };
    $('saveChatsBtn').onclick = async () => { try { await savePreferences(); } catch(error){toast(error.message,true);} };
    $('saveSettingsBtn').onclick = async () => { try { await savePreferences(); } catch(error){toast(error.message,true);} };
    $('chatSearch').oninput = renderChats;
    document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', () => copyValue(button)));
    ['enabled','textTemplate','voiceTemplate','replyWindow','replyConfirmationTemplate'].forEach((id) => $(id).addEventListener('input', () => { settingsDirty = true; }));
    refresh();
    setInterval(refresh, 2500);
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
