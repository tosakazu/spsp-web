// @ts-check
// src/pages/card_back_edit.js — カード編集 (p/edit.html) の「裏」タブ: 裏面の名前 (英字名) とシールを貼る (2026-10-20〜、前は p/badges.html の試作)
//   mountBackEditor(o) を p_edit.js が裏のタブを初めて開いたときに呼ぶ。変えたものは o.onChange({ back } / { latin }) で返し、
//   保存は表と同じ「適用」(カードの設定 back / latin、js/player_card_model.js・js/card_stickers.js)
//   持っているシール = 大会シールの判定 (spsp_scripts feat/stickers の spsp/stickers.py) で配られた色のうち、アイコンのある大会のもの
//   (大会 → アイコン = データの data/event_icons.json、js/card_stickers.js loadIcons)。下位クラスはクラスの文字を重ね、アイコンは親の大会のもの
//   持っているかは選手の大会記録の sticker (js/card_stickers.js loadOwnedStickers。ビルドに入る前は preview だけのプレビュー用の判定)。
//   保存のときサーバも確かめる (worker/src/api/card.ts)
//   1 つの大会で、一番上の色から下の色まで全部持つ (優勝なら 虹・金・銀・素 の 4 枚。素 = ホロなし)
//   貼ったシール: ドラッグで移動、角のつまみ (↻) で回転と大きさ、2 本指でも回転と大きさ。重ねてよい (並びの後ろほど上)
//   操作の欄は選んでいてもいなくても同じ高さ (一覧がずれない)。大きさ・回転・切り取りは 1 本のスライダーを切り替える。元に戻す・やり直すあり
//   一覧は大会ごと。大会を押すといちばん上の色を貼る (貼ってあれば、貼ってある中でいちばん上の色を選ぶ)、色の丸を押すとその色を貼る。一覧はページごとスクロールし、押すとカードの所へ戻る
//   透過なしのシールは形 (四角・角丸・丸・六角形・ひし形) と切り取り (絵の何割を見せるか) を選べる。切り取りは絵の縮尺を保ったまま
//   シールを小さくする (はさみで外側を切る)。ホロは見えている形いっぱいに縮む (js/holo_badge.js の shape / crop)
//   カードの土台は js/player_card.js renderBack (シールなし)。シールは 1 枚ずつ実際の大きさで描く (層ごと縮めると粗く見えるブラウザがある)
import SPSPI18n from '../../site/js/i18n.js';
import SPSPFormat from '../../site/js/format.js';
import SPSPPlayerCard from '../../site/js/player_card.js';
import { autoLatin, latinNameValid } from '../../site/js/latin_name.js';
import { isTransparent, renderBadge, reflatten, preloadAllHolo, SHAPES, CROP_MIN } from '../../site/js/holo_badge.js';
import { CARD_W as W, CARD_H as H, S_MIN, S_MAX, MAX_STICKERS, TIERS, IMG_BASE, TEXT_DX, TEXT_DY, TEXT_S_MIN, TEXT_S_MAX, normRot, normBack, normParts, loadIcons, loadOwnedStickers, tourKey } from '../../site/js/card_stickers.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** 貼ったときの大きさ (一辺、カードの px)。カードの高さの 3 分の 1 強 */
const S_DEF = 120;
const PAGE = 60;
/** 文言 (site/i18n の card_back.*) @param {string} k @param {Record<string, string | number>} [p] */
const i18n = (k, p) => SPSPI18n.t(k, p);
const TIERS_I18N = ['r', 'g', 's', 'n'];
/** 色の名前 (虹・金・銀・素) @param {number} v */
const tierName = v => { const k = TIERS_I18N[v]; return i18n('card_back.tier.' + k); };

/** @typedef {import('../../site/js/card_stickers.js').Sticker} Sticker */
/** @typedef {import('../../site/js/card_stickers.js').CardBack} CardBack */
/** @typedef {{ e: string, name: string, date: string, place: number | null, nent: number | null, file: string, variant: number, cls: string | null,
 *   pts?: number, eid?: number | null }} Badge */

const clampSize = (/** @type {number} */ s) => Math.max(S_MIN, Math.min(S_MAX, s));
const clampCrop = (/** @type {number} */ c) => Math.max(CROP_MIN, Math.min(1, Number(c) || 1));
// スライダー (0〜1000) ⇔ 大きさ (対数。小さい所も細かく選べるように)
const sizeToSlider = (/** @type {number} */ s) => Math.round(1000 * Math.log(s / S_MIN) / Math.log(S_MAX / S_MIN));
const sliderToSize = (/** @type {number} */ v) => S_MIN * Math.pow(S_MAX / S_MIN, v / 1000);
// 名前・二つ名・順位の大きさ (倍) も同じく対数で。真ん中 (500) が 1 倍
const textSizeToSlider = (/** @type {number} */ s) => Math.round(1000 * Math.log(s / TEXT_S_MIN) / Math.log(TEXT_S_MAX / TEXT_S_MIN));
const textSliderToSize = (/** @type {number} */ v) => { const s = TEXT_S_MIN * Math.pow(TEXT_S_MAX / TEXT_S_MIN, v / 1000); return Math.abs(s - 1) < 0.03 ? 1 : Math.round(s * 100) / 100; };


/** 出場大会 → 持っているシール (アイコンのある大会だけ。新しい大会から、同じ大会は上の色から)
 * @param {any[]} tours @param {{ f: string[], e: Record<string, number> } | null} icons
 * @param {Record<string, string> | null} got 判定の結果 {大会キー: 一番上の色 r|g|s|n} @returns {Badge[]} */
function badgesOf(tours, icons, got) {
  if (!icons || !got) return [];
  /** @type {Badge[]} */
  const out = [];
  const seen = new Set();
  for (const t of tours || []) {
    const key = tourKey(t);
    const top = key ? got[key] : undefined;
    if (!top || seen.has(key)) continue;
    const k = (t.event_id ? icons.e[String(t.event_id)] : undefined) ?? (t.parent_event_id ? icons.e[String(t.parent_event_id)] : undefined);
    if (k == null || !icons.f[k]) continue;
    seen.add(key);
    const place = Number.isFinite(t.place) ? Number(t.place) : null;
    for (let v = TIERS.indexOf(/** @type {any} */ (top)); v >= 0 && v < TIERS.length; v++) {
      out.push({ e: `${key}:${TIERS[v]}`, name: String(t.name || ''), date: String(t.date || ''), place, nent: t.nent ?? null, file: icons.f[k],
                 variant: v, cls: t.class_letter ? String(t.class_letter) : null,
                 pts: Number(t.tjpr_raw) || 0, eid: Number(t.event_id || t.parent_event_id) || null });
    }
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));   // 安定ソート: 同じ大会は上の色から
  return out;
}

/** 順位の表示 @param {Badge} b */
const placeText = b => (b.place == null ? '' : b.place === 1 ? i18n('card_back.win') : i18n('card_back.place', { n: b.place })) + (b.nent ? ' / ' + i18n('card_back.nent', { n: b.nent }) : '');

/** 大会ごとにまとめた一覧の 1 つ (色は持っているものだけ、上の色から)。pts = 順位評価ポイント (大会記録の tjpr_raw)、series はあとから
 * @typedef {{ key: string, name: string, date: string, place: number | null, nent: number | null, file: string, cls: string | null,
 *   tiers: Badge[], sample: boolean, pts: number, eid: number | null, series: string }} EventGroup */
/** シールのキー → 大会キー @param {string} e */
const groupKey = e => e.split(':')[0];

/** 押してから動かしたとみなすまでの距離 (画面の px)。これより小さい動きはタップ (選ぶだけ)。
 * 指は押しただけでもぶれるので広め、まだ選んでいなかったシール (選ぶつもりで押した) はさらに広め */
const slopOf = (/** @type {string} */ pointerType, /** @type {boolean} */ wasSel) =>
  (pointerType === 'mouse' ? 4 : 10) * (wasSel ? 1 : 1.8);
/** 回転を吸い付ける角度と幅 (度) */
const SNAP_ANGLES = [0, 90, -90, 180, -180, 45, -45, 135, -135];
const SNAP_DEG = 4;
const HISTORY_MAX = 100;

/**
 * @param {{ uid: number, data: any, back: CardBack | null, latin: string | null,
 *   model: (latin: string | null, back: CardBack | null) => import('../../site/js/player_card.js').PCardModel,
 *   onChange: (patch: { back?: CardBack | null, latin?: string | null }) => void }} o
 * @returns {Promise<{ refresh: () => void }>}
 */
export async function mountBackEditor(o) {
  const { uid, data } = o;
  const tours = (data.player && data.player.tournaments) || [];
  const [icons, owned] = await Promise.all([loadIcons(), loadOwnedStickers(uid, tours)]);
  const root = $('ce-pane-back');

  // ── 裏面の土台 (シールなし。名前・文字の影は今の値で) ──
  let latin = o.latin;
  let textTop = !!(o.back && o.back.text_top);
  let stickerText = !!(o.back && o.back.sticker_text);
  /** 名前・二つ名・順位の置き方 (真ん中からのずれ x・y、回転 r (度)、大きさ s (倍)) */
  let pose = SPSPPlayerCard.textPoseOf(o.back);
  const backPose = () => ({ text_xy: { x: pose.x, y: pose.y }, text_r: pose.r, text_s: pose.s, text_parts: pose.parts });
  /** 既定の置き方か (部品ごとのずれも無い) */
  const poseIsDefault = () => !pose.x && !pose.y && !pose.r && pose.s === 1 && !normParts(pose.parts);
  /** @typedef {'all' | 'name' | 'title' | 'rank'} TextTarget */
  /** 編集している所: all = 名前シール全体 (名前・二つ名・順位まとめて)、name・title・rank = その部品だけ (白フチのとき) @type {TextTarget} */
  let target = 'all';
  const DEF_POSE = { x: 0, y: 0, r: 0, s: 1 };
  /** 編集している所の置き方 (部品なら、全体の置き方に足すずれ) */
  const tp = () => {
    if (target === 'all') return { x: pose.x, y: pose.y, r: pose.r, s: pose.s };
    const q = (pose.parts && pose.parts[target]) || {};
    return { x: q.x || 0, y: q.y || 0, r: q.r || 0, s: q.s || 1 };
  };
  /** 画面 (カードの座標) での動き → 編集している所のずれの動き。部品のずれには全体の回転・大きさがかかるので戻す
   * @param {number} dx @param {number} dy */
  const toLocal = (dx, dy) => {
    if (target === 'all') return [dx, dy];
    const a = -pose.r * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [(dx * c - dy * s) / pose.s, (dx * s + dy * c) / pose.s];
  };
  /** 編集している所の置き方を変える @param {{ x: number, y: number, r: number, s: number }} p */
  const setTP = p => {
    if (target === 'all') pose = { ...pose, x: p.x, y: p.y, r: p.r, s: p.s };
    else pose = { ...pose, parts: { ...pose.parts, [target]: { x: p.x, y: p.y, r: p.r, s: p.s } } };
  };
  // 文字の影は、前に出していて白フチでないときだけ (js/card_stickers.js normBack と同じ。前に出した文字は裏面の複製 bz-text に描く)
  const baseModel = () => o.model(latin, { stickers: [], text_top: false, outline: textTop && !stickerText, sticker_text: stickerText, ...backPose() });
  const renderBase = () => {
    const m = baseModel();
    SPSPPlayerCard.renderBack($('bz-card'), m);
    if (textTop) SPSPPlayerCard.renderBack($('bz-text'), m);
    if (textSel) paintTextSel();
  };
  /** 名前・二つ名・順位の位置だけを描いてある裏面に写す (ドラッグ中は描き直さない) */
  const showTextPos = () => {
    SPSPPlayerCard.setTextPos($('bz-card'), pose);
    SPSPPlayerCard.setTextPos($('bz-text'), pose);
    paintTextSel();
  };
  // 名前・二つ名・順位を選んでいるか (タップで選び、点線の枠を出す。シールを選ぶと外れる)
  let textSel = false;
  const tframe = document.createElement('div');
  tframe.className = 'bz-frame bz-tframe';
  tframe.style.display = 'none';
  tframe.innerHTML = `<span class="bz-h bz-h-rot" title="${i18n('card_back.handle_rot')}">↻</span>`;
  $('bz-over').appendChild(tframe);
  /** 文字の箱 (白フチならその絵) をまとめた画面の四角。無ければ null */
  const textQuery = () => !$('bz-card').querySelector('.pcb-sx') ? '.pcb-title, .pcb-name-t, .pcb-rank'
    : target === 'all' ? '.pcb-sx-l' : `.pcb-sx-l[data-part="${target}"]`;
  const textRect = () => {
    const card = $('bz-card');
    const rs = Array.from(card.querySelectorAll(textQuery())).map(n => n.getBoundingClientRect()).filter(r => r.width && r.height);
    if (!rs.length) return null;
    return { left: Math.min(...rs.map(r => r.left)), top: Math.min(...rs.map(r => r.top)), right: Math.max(...rs.map(r => r.right)), bottom: Math.max(...rs.map(r => r.bottom)) };
  };
  function paintTextSel() {
    const r = textSel ? textRect() : null;
    tframe.style.display = r ? '' : 'none';
    if (!r) return;
    const o = $('bz-over').getBoundingClientRect(), m = 3;
    tframe.style.left = r.left - o.left - m + 'px';
    tframe.style.top = r.top - o.top - m + 'px';
    tframe.style.width = r.right - r.left + 2 * m + 'px';
    tframe.style.height = r.bottom - r.top + 2 * m + 'px';
  }

  // ── 名前・二つ名・順位をシールの上に出す (裏面の複製の文字だけを、シールの層の上に重ねる) ──
  const textTopBtn = $('bz-text-top');
  const paintTextTop = () => {
    textTopBtn.setAttribute('aria-pressed', String(textTop));
    $('bz-text').style.display = textTop ? '' : 'none';
  };
  textTopBtn.addEventListener('click', () => {
    textTop = !textTop;
    paintTextTop(); renderBase(); emit();
    toast(textTop ? i18n('card_back.toast.text_top_on') : i18n('card_back.toast.text_top_off'));
  });


  // ── 名前・二つ名・順位を白フチのシールにする (Figma「work」Frame 52) ──
  const sxBtn = $('bz-sticker-text');
  const paintSx = () => {
    sxBtn.setAttribute('aria-pressed', String(stickerText));
    // 1 つずつの編集は白フチのときだけ (二つ名は付けているときだけ)
    $('bz-text-name').hidden = $('bz-text-rank').hidden = !stickerText;
    $('bz-text-title').hidden = !stickerText || !$('bz-card').querySelector('.pcb-sx-l[data-part="title"]');
  };
  sxBtn.addEventListener('click', () => {
    stickerText = !stickerText;
    // 普通の文字に戻したら、名前の位置・回転・大きさも既定に戻す (白フチ用に傾けたままだと崩れて見えた。戻したあとも編集はできる)
    if (!stickerText) {
      pose = { ...DEF_POSE };
      if (target !== 'all') { target = 'all'; textSel = false; paintTextSel(); }
    }
    renderBase(); paintSx(); emit();
    commit(true); paintTools();
    toast(stickerText ? i18n('card_back.toast.sticker_text_on') : i18n('card_back.toast.sticker_text_off'));
  });
  paintTextTop(); renderBase(); paintSx();

  // ── 裏面の名前 (英字名、カードの設定 latin)。欄には最初から今の名前 (未設定なら名前から自動で作ったもの、js/latin_name.js)。
  //    自動と同じ・空なら設定なし (= 自動)。正しい形のときだけカードと設定に、使えない文字のときは理由を出す ──
  const latinEl = /** @type {HTMLInputElement} */ ($('bz-latin'));
  const latinNote = $('bz-latin-note');
  const auto = autoLatin(SPSPFormat.stripTeamTag(data.rec.display), data.readings);
  latinEl.value = latin || auto;
  latinEl.placeholder = auto;
  latinEl.addEventListener('input', () => {
    const v = latinEl.value.trim();
    const ok = v === '' || latinNameValid(v);
    latinEl.classList.toggle('bad', !ok);
    latinNote.textContent = ok ? '' : SPSPI18n.t('card_edit.latin_bad');
    latinNote.classList.toggle('bad', !ok);
    if (!ok) return;
    const next = v === '' || v === auto ? null : v;
    if (next === latin) return;
    latin = next;
    renderBase();
    o.onChange({ latin });
  });
  // 空のまま離れたら自動の名前を入れて見せる
  latinEl.addEventListener('blur', () => { if (!latinEl.value.trim()) { latinEl.value = auto; latinEl.classList.remove('bad'); latinNote.classList.remove('bad'); } });
  latinEl.addEventListener('keydown', e => { if (e.key === 'Enter') latinEl.blur(); });

  // ── 持っているシール ──
  const badges = badgesOf(tours, icons, owned);
  const byE = new Map(badges.map(b => [b.e, b]));
  /** 大会ごと (新しい順) @type {EventGroup[]} */
  const groups = [];
  /** @type {Map<string, EventGroup>} */
  const groupOf = new Map();
  for (const b of badges) {
    const sample = false;
    const k = groupKey(b.e);
    let g = groupOf.get(k);
    if (!g) {
      g = { key: k, name: b.name, date: b.date, place: b.place, nent: b.nent, file: b.file, cls: b.cls, tiers: [], sample,
            pts: b.pts || 0, eid: b.eid ?? null, series: '' };
      groupOf.set(k, g); groups.push(g);
    }
    g.tiers.push(b);
  }

  /** @type {Sticker[]} */
  let stickers = (o.back ? o.back.stickers.map(s => ({ ...s })) : []).filter(s => byE.has(s.e));
  /** @type {string | null} 選んでいるシール (シールのキー) */
  let sel = null;
  /** 今の裏面 (シール・文字を前に・文字の影) をカードの設定に返す */
  function emit() { o.onChange({ back: normBack({ stickers, text_top: textTop, sticker_text: stickerText, ...backPose() }) }); }

  // ── 元に戻す・やり直す (続けて動かしたものは 1 回にまとめる) ──
  const snap = () => JSON.stringify({ stickers, pose });
  /** @type {string[]} */
  const past = [snap()];
  /** @type {string[]} */
  let future = [];
  /** @type {ReturnType<typeof setTimeout> | null} */
  let histTimer = null;
  const flushHistory = () => {
    if (histTimer) { clearTimeout(histTimer); histTimer = null; }
    const now = snap();
    if (now !== past[past.length - 1]) {
      past.push(now);
      if (past.length > HISTORY_MAX) past.shift();
      future = [];
      emit();
    }
    paintHistory();
  };
  const paintHistory = () => {
    /** @type {HTMLButtonElement} */ ($('bz-undo')).disabled = past.length < 2 && snap() === past[0];
    /** @type {HTMLButtonElement} */ ($('bz-redo')).disabled = !future.length;
    /** @type {HTMLButtonElement} */ ($('bz-text-center')).disabled = poseIsDefault();
  };
  /** 変えたものを履歴に積み、カードの設定に返す。続けて動かすもの (スライダー・ドラッグ・矢印) は手が止まってから 1 回に、
   * 押すだけの操作 (貼る・剥がす・形・重なり順・既定に戻す) はすぐ 1 回に @param {boolean} [now] */
  const commit = (now = false) => {
    if (histTimer) clearTimeout(histTimer);
    if (now) flushHistory();
    else { histTimer = setTimeout(flushHistory, 400); paintHistory(); }
  };
  /** @param {string} json */
  const restore = json => {
    const j = JSON.parse(json);
    stickers = j.stickers;
    pose = j.pose;
    showTextPos();
    if (sel != null && !stickers.some(s => s.e === sel)) sel = null;
    emit();
    place(); paintTray(); paintHistory();
  };
  const undo = () => {
    flushHistory();
    if (past.length < 2) return;
    future.push(/** @type {string} */ (past.pop()));
    restore(past[past.length - 1]);
  };
  const redo = () => {
    flushHistory();
    const next = future.pop();
    if (next == null) return;
    past.push(next);
    restore(next);
  };
  $('bz-undo').addEventListener('click', undo);
  $('bz-redo').addEventListener('click', redo);
  // 名前・二つ名・順位の表示を元に戻す (真ん中・まっすぐ・元の大きさ。その他のメニュー)
  $('bz-text-center').addEventListener('click', () => {
    if (poseIsDefault()) return;
    pose = { ...DEF_POSE };
    showTextPos(); paintTools(); commit(true);
    /** @type {HTMLDetailsElement} */ ($('bz-menu')).open = false;
    toast(i18n('card_back.toast.text_reset'), i18n('card_back.undo'), undo);
  });
  // 名前・二つ名・順位の表示を編集する (その他のメニューから選ぶ。カードを押しただけでは選ばない: シールを触るとき邪魔なので)
  // 「名前シールの配置を編集」は全体、「名前だけを編集」などは白フチのときだけ、その部品だけを動かす
  for (const [id, t] of /** @type {[string, TextTarget][]} */ ([['bz-text-edit', 'all'], ['bz-text-name', 'name'], ['bz-text-title', 'title'], ['bz-text-rank', 'rank']])) {
    $(id).addEventListener('click', () => {
      /** @type {HTMLDetailsElement} */ ($('bz-menu')).open = false;
      target = t;
      selectText(true);
    });
  }

  // ── 貼る層: 位置・大きさはカードの座標 (514×333) で持ち、画面には表示幅に合わせた px で置く
  //    (層ごと transform で縮めると、ブラウザによってはシールが粗く見えるので、1 枚ずつ実際の大きさで描く) ──
  const stage = $('bz-stage');
  const layer = $('bz-layer');   // シール (カードからはみ出した所は切る)
  const frame = $('bz-frame');
  let scale = 0;   // 画面の px / カードの px
  const fitLayer = () => {
    const k = stage.clientWidth / W || 1;
    if (k === scale) return;
    scale = k;
    place();
  };

  /** 画面の座標 → カードの座標 @param {number} cx @param {number} cy */
  const toCard = (cx, cy) => {
    const r = layer.getBoundingClientRect();
    return { x: (cx - r.left) / scale, y: (cy - r.top) / scale };
  };

  const cur = () => stickers.find(s => s.e === sel) || null;
  /** @type {Map<string, HTMLElement>} */
  const els = new Map();
  /** シールを描き直す関数 (形・切り取りを変えたとき) @type {Map<string, () => void>} */
  const paints = new Map();
  // ホロの素材は最初に全部読んでおく (形・種類を変えても取りに行かない)
  preloadAllHolo();
  /** 透過ありのアイコンのシール (形・切り取りは選べない) @type {Set<string>} */
  const trans = new Set();
  // 強制ダークモード対策でキャンバスに描いたシール (js/holo_badge.js の flatten) は、描いたときの大きさの絵なので、
  // 大きくしたら手が止まってから今の大きさで描き直す (そのままだと引き伸ばされて粗くなる)
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reflatTimer = null;
  const scheduleReflatten = () => {
    if (reflatTimer) clearTimeout(reflatTimer);
    reflatTimer = setTimeout(() => {
      for (const el of els.values()) {
        const hb = /** @type {HTMLElement | null} */ (el.querySelector('.hb'));
        if (hb) reflatten(hb);
      }
    }, 250);
  };
  /** 1 枚の要素を作る (中身のホロは透過かどうか分かってから) @param {Sticker} s */
  function makeEl(s) {
    const b = /** @type {Badge} */ (byE.get(s.e));
    const el = document.createElement('div');
    el.className = 'bz-st';
    el.dataset.e = String(s.e);
    el.innerHTML = '<div class="bz-badge"></div>';
    const src = IMG_BASE + b.file;
    let holder = /** @type {HTMLElement} */ (el.querySelector('.bz-badge'));
    const paintBadge = () => {
      const now = stickers.find(x => x.e === s.e) || s;
      const tr = trans.has(s.e);
      el.classList.toggle('bz-shape', tr);
      // 描き直すときは要素ごと作り直す: Android の Chrome で、別の形にしてから丸にするとホロが消えた (最初から丸なら出る。2026-10-21)
      if (el.dataset.kc) {
        const fresh = document.createElement('div');
        fresh.className = 'bz-badge';
        holder.replaceWith(fresh);
        holder = fresh;
      }
      el.dataset.kc = `${now.k}|${now.c}`;
      renderBadge(holder, { src, variant: b.variant, transparent: tr, cls: b.cls, shape: now.k, crop: now.c });
    };
    paints.set(s.e, paintBadge);
    paintBadge();
    isTransparent(src).then(tr => { if (tr) { trans.add(s.e); paintBadge(); paintTools(); } });
    return el;
  }
  /** 位置・大きさ・回転・重なり順を要素に写す */
  function place() {
    stickers.forEach((s, i) => {
      let el = els.get(s.e);
      if (!el) { el = makeEl(s); els.set(s.e, el); }
      else if (el.dataset.kc !== `${s.k}|${s.c}`) paints.get(s.e)?.();
      el.style.left = s.x * scale + 'px';
      el.style.top = s.y * scale + 'px';
      el.style.width = el.style.height = s.s * scale + 'px';
      el.style.transform = `translate(-50%, -50%) rotate(${s.r}deg)`;
      el.style.zIndex = String(i + 1);
      el.classList.toggle('on', s.e === sel);
      if (layer.children[i] !== el) layer.insertBefore(el, layer.children[i] || null);
    });
    for (const [e, el] of els) if (!stickers.some(s => s.e === e)) { el.remove(); els.delete(e); paints.delete(e); }
    const s = cur();
    frame.style.display = s ? '' : 'none';
    if (s) {
      frame.style.left = s.x * scale + 'px';
      frame.style.top = s.y * scale + 'px';
      frame.style.width = frame.style.height = s.s * scale + 'px';
      frame.style.transform = `translate(-50%, -50%) rotate(${s.r}deg)`;
    }
    stage.classList.toggle('bz-has-sel', !!s);
    paintTextSel();
    paintTools();
    scheduleReflatten();
  }
  /** 選ぶ (null = 外す)。一覧の印も変わる @param {string | null} e */
  const select = e => {
    if (e != null && textSel) { textSel = false; paintTextSel(); }
    if (sel === e) return;
    sel = e;
    place();
    paintTray();
  };

  // ── 操作の欄: 形・重なり順・剥がす、大きさ/回転/切り取りは 1 本のスライダーを切り替えて使う ──
  const tools = $('bz-tools');
  const slider = /** @type {HTMLInputElement} */ ($('bz-slider'));
  /** @type {'size' | 'rot' | 'crop'} */
  let tab = 'size';
  const TAB_LABEL = { size: i18n('card_back.tab.size'), rot: i18n('card_back.tab.rot'), crop: i18n('card_back.tab.crop') };
  /** スライダーの範囲と今の値 @param {Sticker} s */
  const sliderOf = s => tab === 'size' ? { min: 0, max: 1000, v: sizeToSlider(s.s), text: Math.round(s.s / S_DEF * 100) + '%' }
    : tab === 'rot' ? { min: -180, max: 180, v: Math.round(s.r), text: Math.round(s.r) + '°' }
    : { min: Math.round(CROP_MIN * 100), max: 100, v: Math.round(s.c * 100), text: Math.round(s.c * 100) + '%' };
  function paintTools() {
    const s = cur();
    tools.classList.toggle('bz-none', !s && !textSel);
    const name = $('bz-sel-name');
    name.classList.toggle('bz-hint', !s);
    const btn = (/** @type {string} */ id) => /** @type {HTMLButtonElement} */ ($(id));
    if (!s && textSel) {
      // 名前・二つ名・順位: 大きさと回転だけ (形・切り取り・重なり順・剥がすは無い)
      name.classList.remove('bz-hint');
      name.textContent = i18n('card_back.text_label.' + target);
      for (const x of $('bz-shapes').querySelectorAll('button')) { x.classList.remove('on'); /** @type {HTMLButtonElement} */ (x).disabled = true; }
      btn('bz-up').disabled = btn('bz-front').disabled = btn('bz-down').disabled = btn('bz-backmost').disabled = btn('bz-del').disabled = true;
      /** @type {HTMLButtonElement} */ ($('bz-tabs').querySelector('[data-t="crop"]')).disabled = true;
      if (tab === 'crop') tab = 'size';
      for (const x of $('bz-tabs').querySelectorAll('button')) x.classList.toggle('on', /** @type {HTMLElement} */ (x).dataset.t === tab);
      const p = tp();
      const sv = tab === 'size' ? { min: 0, max: 1000, v: textSizeToSlider(p.s), text: Math.round(p.s * 100) + '%' }
        : { min: -180, max: 180, v: Math.round(p.r), text: Math.round(p.r) + '°' };
      slider.min = String(sv.min); slider.max = String(sv.max);
      if (document.activeElement !== slider) slider.value = String(sv.v);
      slider.setAttribute('aria-label', TAB_LABEL[tab]);
      $('bz-val').textContent = sv.text;
      $('bz-val').title = tab === 'size' ? i18n('card_back.val.text_size') : i18n('card_back.val.text_rot');
      return;
    }
    btn('bz-del').disabled = false;
    if (!s) {
      name.textContent = stickers.length ? '' : i18n('card_back.hint_empty');   // 貼ってあれば何も出さない (高さは保つ)
      return;
    }
    const b = /** @type {Badge} */ (byE.get(s.e));
    name.textContent = `${b.name}${b.cls ? ' ' + i18n('card_back.cls', { c: b.cls }) : ''} · ${tierName(b.variant)}${b.place != null ? ' · ' + placeText(b) : ''}`;
    const tr = trans.has(s.e);
    for (const x of $('bz-shapes').querySelectorAll('button')) {
      const btn = /** @type {HTMLButtonElement} */ (x);
      btn.classList.toggle('on', !tr && btn.dataset.k === s.k);
      btn.disabled = tr;
      btn.title = tr ? i18n('card_back.shape_locked') : String(btn.dataset.title || btn.title);
    }
    const cropBtn = /** @type {HTMLButtonElement} */ ($('bz-tabs').querySelector('[data-t="crop"]'));
    cropBtn.disabled = tr;
    if (tr && tab === 'crop') tab = 'size';
    for (const x of $('bz-tabs').querySelectorAll('button')) x.classList.toggle('on', /** @type {HTMLElement} */ (x).dataset.t === tab);
    const sv = sliderOf(s);
    slider.min = String(sv.min); slider.max = String(sv.max);
    if (document.activeElement !== slider) slider.value = String(sv.v);
    slider.setAttribute('aria-label', TAB_LABEL[tab]);
    $('bz-val').textContent = sv.text;
    $('bz-val').title = i18n('card_back.val.' + tab);
    const i = stickers.indexOf(s);
    /** @type {HTMLButtonElement} */ ($('bz-up')).disabled = /** @type {HTMLButtonElement} */ ($('bz-front')).disabled = i === stickers.length - 1;
    /** @type {HTMLButtonElement} */ ($('bz-down')).disabled = /** @type {HTMLButtonElement} */ ($('bz-backmost')).disabled = i === 0;
  }
  for (const x of $('bz-shapes').querySelectorAll('button')) /** @type {HTMLElement} */ (x).dataset.title = /** @type {HTMLElement} */ (x).title;
  /** @param {boolean} [now] 押すだけの操作 (履歴をすぐ区切る) */
  const changed = (now = false) => { place(); commit(now); };
  for (const btn of $('bz-tabs').querySelectorAll('button')) {
    btn.addEventListener('click', () => { tab = /** @type {any} */ (/** @type {HTMLElement} */ (btn).dataset.t); paintTools(); });
  }
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    if (!cur() && textSel) {
      setTP(tab === 'size' ? { ...tp(), s: textSliderToSize(v) } : { ...tp(), r: snapRot(v) });
      showTextPos(); paintTools(); commit();
      return;
    }
    const s = cur(); if (!s) return;
    if (tab === 'size') s.s = clampSize(sliderToSize(v));
    else if (tab === 'rot') s.r = snapRot(v);
    else {
      // 切り取り: 絵の縮尺はそのまま、外側を切った分だけシールが小さくなる
      const c = clampCrop(v / 100);
      s.s = clampSize(s.s * c / s.c);
      s.c = c;
    }
    changed();
  });
  // 値を押すと既定に戻す
  $('bz-val').addEventListener('click', () => {
    if (!cur() && textSel) {
      setTP(tab === 'size' ? { ...tp(), s: 1 } : { ...tp(), r: 0 });
      showTextPos(); paintTools(); commit(true);
      return;
    }
    const s = cur(); if (!s) return;
    if (tab === 'size') s.s = S_DEF;
    else if (tab === 'rot') s.r = 0;
    else { s.s = clampSize(s.s / s.c); s.c = 1; }
    changed(true);
  });
  for (const btn of $('bz-shapes').querySelectorAll('button')) {
    btn.addEventListener('click', () => { const s = cur(); if (s) { s.k = String(/** @type {HTMLElement} */ (btn).dataset.k); changed(true); } });
  }
  /** 重なり順を動かす @param {number} to 動かす先 (-Infinity = いちばん下、Infinity = いちばん上、±1 = 1 つ) */
  const move = to => {
    const s = cur(); if (!s) return;
    const i = stickers.indexOf(s);
    const j = to === Infinity ? stickers.length - 1 : to === -Infinity ? 0 : Math.max(0, Math.min(stickers.length - 1, i + to));
    stickers.splice(i, 1);
    stickers.splice(j, 0, s);
    changed(true);
  };
  $('bz-up').addEventListener('click', () => move(1));
  $('bz-down').addEventListener('click', () => move(-1));
  $('bz-front').addEventListener('click', () => move(Infinity));
  $('bz-backmost').addEventListener('click', () => move(-Infinity));
  const remove = (/** @type {string} */ e) => {
    stickers = stickers.filter(s => s.e !== e);
    if (sel === e) sel = null;
    changed(true); paintTray();
    toast(i18n('card_back.toast.removed'), i18n('card_back.undo'), undo);
  };
  $('bz-del').addEventListener('click', () => { if (sel != null) remove(sel); });

  // その他のメニュー
  const menu = /** @type {HTMLDetailsElement} */ ($('bz-menu'));
  document.addEventListener('pointerdown', e => { if (menu.open && !menu.contains(/** @type {Node} */ (e.target))) menu.open = false; });
  // ランダムに k 枚貼る (まだ貼っていないシールのある大会 (下位クラスも同じ大会) から k 大会。大会が足りなければ同じ大会から 2 枚目、…。貼れる枚数の残りまで)。k は − / + で 1〜貼れる上限、最初は 5
  let randK = 5;
  const paintRandK = () => {
    $('bz-rand-k').textContent = String(randK);
    /** @type {HTMLButtonElement} */ ($('bz-rand-minus')).disabled = randK <= 1;
    /** @type {HTMLButtonElement} */ ($('bz-rand-plus')).disabled = randK >= MAX_STICKERS;
  };
  $('bz-rand-minus').addEventListener('click', () => { randK = Math.max(1, randK - 1); paintRandK(); });
  $('bz-rand-plus').addEventListener('click', () => { randK = Math.min(MAX_STICKERS, randK + 1); paintRandK(); });
  paintRandK();
  $('bz-rand').addEventListener('click', async () => {
    menu.open = false;
    const room = MAX_STICKERS - stickers.length;
    if (room <= 0) { toast(i18n('card_back.toast.max', { n: MAX_STICKERS })); return; }
    // ランダムに選ぶのは大会 (下位クラスも同じ大会)。その大会のシールは、まだ貼っていないものの中で一番上のもの:
    // 色 (虹 > 金 > 銀 > 素)、同じ色なら本戦 > 下位クラス (B > C > …)
    const rank = (/** @type {Badge} */ b) => b.variant * 10 + (b.cls ? ' ABCDE'.indexOf(b.cls) : 0);
    // 大会ごとに、まだ貼っていないシールを上から並べる
    /** @type {Map<string, Badge[]>} */
    const byTour = new Map();
    for (const b of badges) {
      if (stickers.some(s => s.e === b.e)) continue;
      const t = b.e.replace(/[A-E]?:.*$/, '');
      const l = byTour.get(t);
      if (l) l.push(b); else byTour.set(t, [b]);
    }
    const lists = [...byTour.values()].map(l => l.sort((x, y) => rank(x) - rank(y)));
    if (!lists.length) { toast(i18n('card_back.toast.none_left')); return; }
    /** 混ぜる (Fisher–Yates) @template T @param {T[]} a */
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    // 1 周目は大会ごとに 1 枚 (一番上)。k に足りなければ、2 周目は残っている大会から次のものを、… (周ごとに大会の順を混ぜ直す)
    const want = Math.min(randK, room);
    /** @type {Badge[]} */
    const pick = [];
    for (let r = 0; pick.length < want; r++) {
      const round = shuffle(lists.filter(l => l.length > r));
      if (!round.length) break;
      for (const l of round) { if (pick.length >= want) break; pick.push(l[r]); }
    }
    const trs = await Promise.all(pick.map(b => isTransparent(IMG_BASE + b.file)));
    let n = 0;
    pick.forEach((b, i) => {
      if (stickers.length >= MAX_STICKERS || stickers.some(s => s.e === b.e)) return;
      stickers.push(randomSticker(b.e, trs[i]));
      n++;
    });
    if (!n) return;
    sel = null;
    changed(true);
    paintTray();
    const why = n >= randK ? 'placed' : stickers.length >= MAX_STICKERS ? 'placed_max' : 'placed_all';
    toast(i18n('card_back.toast.' + why, { n }), i18n('card_back.undo'), undo);
  });
  $('bz-clear').addEventListener('click', () => {
    menu.open = false;
    if (!stickers.length) return;
    stickers = []; sel = null; changed(true); paintTray();
    toast(i18n('card_back.toast.cleared'), i18n('card_back.undo'), undo);
  });

  // ── 一時的なお知らせ (取り消しのボタン付き) ──
  /** @type {HTMLElement | null} */
  let toastEl = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let toastTimer = null;
  /** @param {string} text @param {string} [action] @param {() => void} [fn] */
  function toast(text, action, fn) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'bz-toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = '';
    toastEl.append(text);
    if (action && fn) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'bz-toast-act'; b.textContent = action;
      b.addEventListener('click', () => { fn(); hideToast(); });
      toastEl.append(b);
    }
    toastEl.style.opacity = '1';
    toastEl.style.pointerEvents = action ? 'auto' : 'none';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 4000);
  }
  function hideToast() { if (toastEl) { toastEl.style.opacity = '0'; toastEl.style.pointerEvents = 'none'; } }

  // ── ドラッグ (移動)・つまみ (回転と大きさ)・2 本指 (回転と大きさ) ──
  /** @type {Map<number, { x: number, y: number }>} 押している指 (カードの座標) */
  const ptrs = new Map();
  /** 名前・二つ名・順位の所か (描いてある裏面の文字の箱。白フチならその絵、少し広め) @param {number} cx @param {number} cy */
  const textHit = (cx, cy) => {
    return Array.from($('bz-card').querySelectorAll(textQuery())).some(n => {
      const r = n.getBoundingClientRect(), m = 4;
      return cx >= r.left - m && cx <= r.right + m && cy >= r.top - m && cy <= r.bottom + m;
    });
  };
  /** 名前・二つ名・順位を選ぶ / 外す @param {boolean} on */
  const selectText = on => {
    if (on) select(null);
    textSel = on;
    if (!on) target = 'all';
    paintTextSel(); paintTools();
  };
  /** @type {null | { kind: 'text', x0: number, y0: number, px: number, py: number, sx: number, sy: number, moved: boolean, slop: number }
   *          | { kind: 'trot', a0: number, d0: number, r0: number, s0: number, c: { x: number, y: number }, sx: number, sy: number, moved: boolean, slop: number }
   *          | { kind: 'tpinch', a0: number, d0: number, r0: number, s0: number, c0: { x: number, y: number }, x0: number, y0: number, moved: boolean }
   *          | { kind: 'move', s: Sticker, dx: number, dy: number, sx: number, sy: number, moved: boolean, slop: number }
   *          | { kind: 'rot', s: Sticker, a0: number, d0: number, r0: number, s0: number, sx: number, sy: number, moved: boolean, slop: number }
   *          | { kind: 'pinch', s: Sticker, a0: number, d0: number, r0: number, s0: number, c0: { x: number, y: number }, x0: number, y0: number, moved: boolean }} */
  let drag = null;
  const angle = (/** @type {{x:number,y:number}} */ a, /** @type {{x:number,y:number}} */ b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const dist = (/** @type {{x:number,y:number}} */ a, /** @type {{x:number,y:number}} */ b) => Math.hypot(b.x - a.x, b.y - a.y);
  /** 0°・90°・45° の刻みの近くは吸い付ける (まっすぐ・斜めに合わせやすく) @param {number} r */
  function snapRot(r) {
    const n = normRot(r);
    for (const a of SNAP_ANGLES) if (Math.abs(n - a) < SNAP_DEG) return normRot(a);
    return n;
  }
  /** 名前・二つ名・順位の回転・大きさの軸 (カードの座標)。全体はカードの真ん中 + ずれ、部品はその絵の真ん中 */
  const pivot = () => {
    if (target === 'all') return { x: W / 2 + pose.x, y: H / 2 + pose.y };
    const r = textRect();
    return r ? toCard((r.left + r.right) / 2, (r.top + r.bottom) / 2) : { x: W / 2, y: H / 2 };
  };
  const clampTS = (/** @type {number} */ v) => Math.max(TEXT_S_MIN, Math.min(TEXT_S_MAX, Math.round(v * 100) / 100));
  const startPinch = () => {
    const s = cur();
    const [p, q] = [...ptrs.values()];
    if (!s && textSel && p && q) {
      const t0 = tp();
      drag = { kind: 'tpinch', a0: angle(p, q), d0: Math.max(1, dist(p, q)), r0: t0.r, s0: t0.s, c0: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, x0: t0.x, y0: t0.y, moved: false };
      return;
    }
    if (!s || !p || !q) return;
    drag = { kind: 'pinch', s, a0: angle(p, q), d0: Math.max(1, dist(p, q)), r0: s.r, s0: s.s, c0: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, x0: s.x, y0: s.y, moved: false };
  };
  stage.addEventListener('pointerdown', e => {
    const pt = toCard(e.clientX, e.clientY);
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.closest('.bz-h-del')) { e.preventDefault(); if (sel != null) remove(sel); return; }
    const onRot = !!t.closest('.bz-h-rot');
    if (onRot && t.closest('.bz-tframe')) {
      // 名前・二つ名・順位のつまみ: 軸 (カードの真ん中 + ずれ) のまわりで回し、軸からの距離で大きさ
      ptrs.set(e.pointerId, pt);
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 取れなくても動く */ }
      e.preventDefault();
      const c = pivot();
      drag = { kind: 'trot', a0: angle(c, pt), d0: Math.max(1, dist(c, pt)), r0: tp().r, s0: tp().s, c, sx: e.clientX, sy: e.clientY, moved: false, slop: slopOf(e.pointerType, true) };
      return;
    }
    const stEl = /** @type {HTMLElement | null} */ (t.closest('.bz-st'));
    ptrs.set(e.pointerId, pt);
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 取れなくても動く */ }
    if (ptrs.size === 2) { startPinch(); return; }
    if (ptrs.size > 2) return;
    // 名前・二つ名・順位: 「名前の表示を編集」で選んでいる間だけ、シールより先に掴める
    if (!onRot && textSel && textHit(e.clientX, e.clientY)) {
      e.preventDefault();
      drag = { kind: 'text', x0: tp().x, y0: tp().y, px: pt.x, py: pt.y, sx: e.clientX, sy: e.clientY, moved: false, slop: slopOf(e.pointerType, true) };
      selectText(true);
      return;
    }
    const s = onRot ? cur() : stEl ? stickers.find(x => x.e === stEl.dataset.e) : null;
    if (!s) { drag = null; select(null); selectText(false); return; }
    e.preventDefault();
    const slop = slopOf(e.pointerType, sel === s.e);
    if (onRot) {
      drag = { kind: 'rot', s, a0: angle(s, pt), d0: Math.max(1, dist(s, pt)), r0: s.r, s0: s.s, sx: e.clientX, sy: e.clientY, moved: false, slop: slopOf(e.pointerType, true) };
    } else {
      drag = { kind: 'move', s, dx: pt.x - s.x, dy: pt.y - s.y, sx: e.clientX, sy: e.clientY, moved: false, slop };
    }
    select(s.e);
  });
  stage.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const pt = toCard(e.clientX, e.clientY);
    ptrs.set(e.pointerId, pt);
    if (!drag) return;
    if (drag.kind === 'trot') {
      const c = drag.c;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < drag.slop) return;
        drag.moved = true;
        drag.a0 = angle(c, pt); drag.d0 = Math.max(1, dist(c, pt));
        return;
      }
      setTP({ ...tp(), r: snapRot(drag.r0 + angle(c, pt) - drag.a0), s: clampTS(drag.s0 * dist(c, pt) / drag.d0) });
      showTextPos(); paintTools();
      return;
    }
    if (drag.kind === 'tpinch') {
      const [p, q] = [...ptrs.values()];
      if (!p || !q) return;
      const c = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      if (!drag.moved) {
        if (Math.abs(dist(p, q) / drag.d0 - 1) < 0.06 && Math.abs(normRot(angle(p, q) - drag.a0)) < 4 && dist(c, drag.c0) * scale < 10) return;
        drag.moved = true;
        drag.a0 = angle(p, q); drag.d0 = Math.max(1, dist(p, q)); drag.c0 = c;
        return;
      }
      const [ldx, ldy] = toLocal(c.x - drag.c0.x, c.y - drag.c0.y);
      setTP({ x: Math.max(-TEXT_DX, Math.min(TEXT_DX, Math.round((drag.x0 + ldx) * 10) / 10)),
              y: Math.max(-TEXT_DY, Math.min(TEXT_DY, Math.round((drag.y0 + ldy) * 10) / 10)),
              r: snapRot(drag.r0 + angle(p, q) - drag.a0), s: clampTS(drag.s0 * dist(p, q) / drag.d0) });
      showTextPos(); paintTools();
      return;
    }
    if (drag.kind === 'text') {
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < drag.slop) return;
        drag.moved = true;
        drag.px = pt.x; drag.py = pt.y;
        return;
      }
      // 真ん中の近く (4px) は真ん中に吸い付ける (戻しやすく)
      const snap0 = (/** @type {number} */ v) => (Math.abs(v) < 4 ? 0 : Math.round(v * 10) / 10);
      const [ldx, ldy] = toLocal(pt.x - drag.px, pt.y - drag.py);
      const x = snap0(Math.max(-TEXT_DX, Math.min(TEXT_DX, drag.x0 + ldx)));
      const y = snap0(Math.max(-TEXT_DY, Math.min(TEXT_DY, drag.y0 + ldy)));
      setTP({ ...tp(), x, y });
      showTextPos();
      return;
    }
    const s = drag.s;
    if (drag.kind === 'move') {
      // 少し動くまではタップ (選ぶだけ) とみなして動かさない (押しただけでずれないように)。
      // 動き始めたら、その時の指の位置から追う (遊びの分だけ飛ばないように)
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < drag.slop) return;
        drag.moved = true;
        drag.dx = pt.x - s.x; drag.dy = pt.y - s.y;
        return;
      }
      s.x = Math.max(0, Math.min(W, pt.x - drag.dx));
      s.y = Math.max(0, Math.min(H, pt.y - drag.dy));
    } else if (drag.kind === 'rot') {
      // つまみも同じ: 少し動くまでは回さない。動き始めた所を基準に
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < drag.slop) return;
        drag.moved = true;
        drag.a0 = angle(s, pt); drag.d0 = Math.max(1, dist(s, pt));
        return;
      }
      s.r = snapRot(drag.r0 + angle(s, pt) - drag.a0);
      s.s = clampSize(drag.s0 * dist(s, pt) / drag.d0);
    } else {
      const [p, q] = [...ptrs.values()];
      if (!p || !q) return;
      // 2 本指も、置いただけのぶれ (間隔 6%・角度 4°・中心 10px 未満) では変えない。超えたらそこを基準に
      if (!drag.moved) {
        const c = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        if (Math.abs(dist(p, q) / drag.d0 - 1) < 0.06 && Math.abs(normRot(angle(p, q) - drag.a0)) < 4 && dist(c, drag.c0) * scale < 10) return;
        drag.moved = true;
        drag.a0 = angle(p, q); drag.d0 = Math.max(1, dist(p, q)); drag.c0 = c;
        return;
      }
      s.r = snapRot(drag.r0 + angle(p, q) - drag.a0);
      s.s = clampSize(drag.s0 * dist(p, q) / drag.d0);
      s.x = Math.max(0, Math.min(W, drag.x0 + (p.x + q.x) / 2 - drag.c0.x));
      s.y = Math.max(0, Math.min(H, drag.y0 + (p.y + q.y) / 2 - drag.c0.y));
    }
    place();
  });
  const end = (/** @type {PointerEvent} */ e) => {
    if (!ptrs.delete(e.pointerId)) return;
    if (drag) commit();
    // 2 本指の片方を離したら、残った指で移動を続ける
    if (ptrs.size === 1 && drag && drag.kind === 'pinch' && drag.s) {
      const [p] = [...ptrs.values()];
      drag = { kind: 'move', s: drag.s, dx: p.x - drag.s.x, dy: p.y - drag.s.y, sx: 0, sy: 0, moved: true, slop: 0 };
    } else if (ptrs.size === 1 && drag && drag.kind === 'tpinch') {
      const [p] = [...ptrs.values()];
      drag = { kind: 'text', x0: tp().x, y0: tp().y, px: p.x, py: p.y, sx: 0, sy: 0, moved: true, slop: 0 };
    } else if (!ptrs.size) drag = null;
  };
  stage.addEventListener('pointerup', end);
  // カードの外を押したら選択を外す (何も無い所・名前の欄・シールの検索や一覧も)。選んでいるものを変える操作 (操作の欄のボタンとスライダー・
  // 元に戻す・文字を前に・白フチ・その他のメニュー) だけは外さない
  document.addEventListener('pointerdown', e => {
    if (!root.offsetParent || (sel == null && !textSel)) return;
    const t = /** @type {HTMLElement} */ (e.target);
    if (!t || !t.closest || stage.contains(t)
        || t.closest('.bz-tools button, .bz-tools input, #bz-menu, #bz-undo, #bz-text-top, #bz-sticker-text, #ce-apply')) return;
    select(null); selectText(false);
  });
  stage.addEventListener('pointercancel', end);

  // ── キーボード (パソコン): 矢印で 1px (Shift で 10px)、Delete で剥がす、Esc で外す、Ctrl+Z / Ctrl+Shift+Z ──
  document.addEventListener('keydown', e => {
    if (!root.offsetParent) return;   // 表のタブを見ているとき
    const t = /** @type {HTMLElement} */ (e.target);
    if (t && (t.tagName === 'INPUT' && /** @type {HTMLInputElement} */ (t).type !== 'range' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    const s = cur();
    if (!s && textSel && !(t && t.tagName === 'INPUT')) {
      if (e.key === 'Escape') { selectText(false); return; }
      const d = e.shiftKey ? 10 : 1;
      const mv = /** @type {Record<string, [number, number]>} */ ({ ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] })[e.key];
      if (!mv) return;
      e.preventDefault();
      const t0 = tp();
      const [ldx, ldy] = toLocal(mv[0], mv[1]);
      const x = Math.max(-TEXT_DX, Math.min(TEXT_DX, t0.x + ldx)), y = Math.max(-TEXT_DY, Math.min(TEXT_DY, t0.y + ldy));
      setTP({ ...t0, x, y });
      showTextPos(); commit();
      return;
    }
    if (!s) return;
    if (t && t.tagName === 'INPUT') return;   // スライダーの矢印はスライダーに
    if (e.key === 'Escape') { select(null); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(s.e); return; }
    const d = e.shiftKey ? 10 : 1;
    const mv = /** @type {Record<string, [number, number]>} */ ({ ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] })[e.key];
    if (mv) {
      e.preventDefault();
      s.x = Math.max(0, Math.min(W, s.x + mv[0]));
      s.y = Math.max(0, Math.min(H, s.y + mv[1]));
      changed();
    }
  });

  // ── 持っているシールの一覧 (大会ごと。色の丸で色を選ぶ) ──
  /** 絞り込み: all / r g s n (その大会で取ったいちばん上の色) / placed */
  let filter = 'all';
  let shown = PAGE;
  const tray = $('bz-tray');
  const topV = (/** @type {EventGroup} */ g) => g.tiers[0].variant;
  const real = groups.filter(g => !g.sample);
  const isPlaced = (/** @type {EventGroup} */ g) => g.tiers.some(b => stickers.some(s => s.e === b.e));
  // 検索 (大会名・シリーズ・クラス)・シリーズ・並べ替え。色の絞り込みの件数は検索とシリーズを掛けたあとの数
  let query = '';
  let seriesSel = '';
  let sortKey = 'new';
  /** @type {Record<string, (a: EventGroup, b: EventGroup) => number>} */
  const SORTS = {
    new: (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0),
    old: (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
    pts: (a, b) => b.pts - a.pts,
    place: (a, b) => (a.place ?? 1e9) - (b.place ?? 1e9) || (b.nent ?? 0) - (a.nent ?? 0),
    nent: (a, b) => (b.nent ?? 0) - (a.nent ?? 0),
  };
  const norm = (/** @type {string} */ x) => x.normalize('NFKC').toLowerCase();
  const matches = (/** @type {EventGroup} */ g) => (!seriesSel || g.series === seriesSel)
    && (!query || norm(`${g.name} ${g.series} ${g.cls ? g.cls + 'クラス class ' + g.cls : ''}`).includes(query));
  const listOf = (/** @type {string} */ f) => {
    const base = (f === 'placed' ? groups.filter(isPlaced) : real).filter(g => g.sample || matches(g));
    const l = f === 'all' || f === 'placed' ? base : base.filter(g => topV(g) === TIERS.indexOf(/** @type {any} */ (f)));
    return sortKey === 'new' ? l : [...l].sort(SORTS[sortKey]);   // groups は新しい順に並んでいる
  };
  const searchIn = /** @type {HTMLInputElement} */ ($('bz-q'));
  const sortIn = /** @type {HTMLSelectElement} */ ($('bz-sort'));
  const seriesIn = /** @type {HTMLSelectElement} */ ($('bz-series'));
  const relist = () => { shown = PAGE; paintTray(); };
  searchIn.addEventListener('input', () => { query = norm(searchIn.value.trim()); relist(); });
  sortIn.addEventListener('change', () => { sortKey = sortIn.value; relist(); });
  seriesIn.addEventListener('change', () => { seriesSel = seriesIn.value; relist(); });
  // シリーズ: 大会一覧 (data/tournaments.json) の series を event_id で引く (下位クラスは親の大会)。後から届く
  fetch(SPSP.data + 'data/tournaments.json').then(r => (r.ok ? r.json() : null)).then(j => {
    if (!j || !Array.isArray(j.tournaments)) return;
    /** @type {Map<number, string>} */
    const se = new Map(j.tournaments.map((/** @type {any} */ t) => [Number(t.event_id), String(t.series || '')]));
    /** @type {Map<string, number>} */
    const cnt = new Map();
    for (const g of real) {
      g.series = (g.eid != null && se.get(g.eid)) || '';
      if (g.series) cnt.set(g.series, (cnt.get(g.series) || 0) + 1);
    }
    for (const [name, n] of [...cnt].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))) {
      const o = document.createElement('option');
      o.value = name; o.textContent = `${name} (${n})`;
      seriesIn.appendChild(o);
    }
    seriesIn.disabled = !cnt.size;
    paintTray();
  }).catch(() => { /* シリーズなしで使う */ });
  const paintCounts = () => {
    for (const btn of $('bz-filters').querySelectorAll('button')) {
      const f = String(/** @type {HTMLElement} */ (btn).dataset.f);
      let n = btn.querySelector('.bz-n');
      if (!n) { n = document.createElement('span'); n.className = 'bz-n'; btn.appendChild(n); }
      n.textContent = String(listOf(f).length);
    }
  };
  for (const btn of $('bz-filters').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      filter = String(/** @type {HTMLElement} */ (btn).dataset.f);
      shown = PAGE;
      for (const x of $('bz-filters').querySelectorAll('button')) x.classList.toggle('on', x === btn);
      paintTray();
    });
  }
  $('bz-more').addEventListener('click', () => { shown += PAGE; paintTray(); });
  // 一覧の下まで来たら続きを出す (「もっと見る」を押さなくても)
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(es => {
      if (es.some(x => x.isIntersecting) && $('bz-more').style.display !== 'none') { shown += PAGE; paintTray(); }
    }, { rootMargin: '400px' }).observe($('bz-more'));
  }
  // 色の丸の中の 1 文字 (虹 金 銀 素 / R G S P)
  const TIER_SHORT = TIERS_I18N.map(t => i18n('card_back.tier_short.' + t));
  // 一覧の絵は本物のシール (ホロ・クラスの文字) で描く。重いので、一覧の箱の中で見える近くに来たものだけ
  /** @param {HTMLElement} tb */
  const paintThumb = tb => {
    if (tb.dataset.done) return;
    tb.dataset.done = '1';
    const src = String(tb.dataset.src), variant = Number(tb.dataset.v), cls = tb.dataset.cls || null;
    const holder = document.createElement('div');
    tb.appendChild(holder);
    renderBadge(holder, { src, variant, transparent: false, cls });
    isTransparent(src).then(tr => {
      if (!tr || !holder.isConnected) return;
      tb.classList.add('bz-shape');
      renderBadge(holder, { src, variant, transparent: true, cls });
    });
  };
  const thumbIO = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(es => {
      for (const x of es) if (x.isIntersecting) { thumbIO?.unobserve(x.target); paintThumb(/** @type {HTMLElement} */ (x.target)); }
    }, { rootMargin: '300px 0px' })
    : null;
  /** @param {HTMLElement} tb */
  const watchThumb = tb => { if (thumbIO) thumbIO.observe(tb); else paintThumb(tb); };
  /** 順位評価ポイントの表示の倍率 (プレイヤーページの出場大会と同じ) */
  const PTS_SCALE = (data.meta.params && data.meta.params.TJPR_ELO_SCALE) || 17.5;
  function paintTray() {
    const on = new Set(stickers.map(s => s.e));
    const list = listOf(filter);
    tray.innerHTML = '';
    if (!list.length) {
      tray.innerHTML = `<div class="bz-empty">${query || seriesSel ? i18n('card_back.empty.found') : filter === 'placed' ? i18n('card_back.empty.placed') : i18n('card_back.empty.none')}</div>`;
    }
    for (const g of list.slice(0, shown)) {
      const it = document.createElement('div');
      it.className = 'bz-ev' + (g.tiers.some(b => b.e === sel) ? ' on' : '');
      it.innerHTML = `<button type="button" class="bz-thumb"><span class="bz-tb"></span></button>
        <div class="bz-tiers"></div><span class="bz-iname"></span><span class="bz-imeta"></span>`;
      // 大会を押す: その大会のシールを貼ってあれば、貼ってある中でいちばん上の色を選ぶ (新しく貼らない)。まだ 1 枚も無ければいちばん上の色を貼る。
      // 下の色を貼りたいときは色の丸を押す (2026-10-25 ユーザー指定)。見本の絵もその色
      const placed = g.tiers.find(b => on.has(b.e));
      const next = placed || g.tiers[0];
      const thumb = /** @type {HTMLButtonElement} */ (it.querySelector('.bz-thumb'));
      const tp = { name: g.name, tier: tierName(next.variant) };
      thumb.title = placed ? i18n('card_back.thumb.select', tp) : i18n('card_back.thumb.place', tp);
      thumb.addEventListener('click', () => addOrSelect(next));
      const tb = /** @type {HTMLElement} */ (it.querySelector('.bz-tb'));
      tb.dataset.src = IMG_BASE + g.file;
      tb.dataset.v = String(next.variant);
      if (g.cls) tb.dataset.cls = g.cls;
      watchThumb(tb);
      const tiers = /** @type {HTMLElement} */ (it.querySelector('.bz-tiers'));
      for (const b of g.tiers) {
        const d = document.createElement('button');
        d.type = 'button';
        d.className = `bz-tier t${b.variant}` + (on.has(b.e) ? ' on' : '');
        d.textContent = TIER_SHORT[b.variant];
        d.title = on.has(b.e) ? i18n('card_back.dot.on', { tier: tierName(b.variant) }) : i18n('card_back.dot.place', { tier: tierName(b.variant) });
        d.addEventListener('click', () => addOrSelect(b));
        tiers.appendChild(d);
      }
      /** @type {HTMLElement} */ (it.querySelector('.bz-iname')).textContent = g.name + (g.cls ? ` ${g.cls}` : '');
      // 下の行: 日付・順位、並べ替えに使っている値 (ポイント・人数) は太く
      const meta = /** @type {HTMLElement} */ (it.querySelector('.bz-imeta'));
      if (g.date) {
        const placeT = g.place == null ? '' : g.place === 1 ? i18n('card_back.win') : i18n('card_back.place', { n: g.place });
        const extra = sortKey === 'pts' ? i18n('card_back.pts', { v: (g.pts * PTS_SCALE).toFixed(1) }) : sortKey === 'nent' && g.nent ? i18n('card_back.nent', { n: g.nent }) : '';
        meta.textContent = `${g.date.replace(/-/g, '/')} ${placeT}${g.nent && sortKey === 'place' ? '/' + i18n('card_back.nent', { n: g.nent }) : ''}`;
        if (extra) { const b = document.createElement('b'); b.textContent = ' ' + extra; meta.appendChild(b); }
      }
      tray.appendChild(it);
    }
    $('bz-more').style.display = list.length > shown ? '' : 'none';
    paintCounts();
  }
  /** 貼るときの大きさ・場所・角度・形 (ランダム)。大きさは標準の 0.75〜1.35 倍 (小さすぎ・大きすぎにはしない)、
   * 場所は半分より多くはカードの外に出ない所 (重なるのは気にしない)、角度は ±40°、形は透過なしなら 5 種類から (切り取りは標準のまま)
   * @param {string} e @param {boolean} tr 透過あり @returns {Sticker} */
  const randomSticker = (e, tr) => {
    const size = S_DEF * Math.exp(Math.log(0.75) + Math.random() * Math.log(1.35 / 0.75));
    const h = size / 2;
    // 見えている割合 (回転は考えない) = 横の割合 × 縦の割合
    const seen = (/** @type {number} */ c, /** @type {number} */ L) => (Math.min(L, c + h) - Math.max(0, c - h)) / size;
    let x = W / 2, y = H / 2;
    for (let i = 0; i < 50; i++) {
      const tx = -h + Math.random() * (W + size), ty = -h + Math.random() * (H + size);
      if (seen(tx, W) * seen(ty, H) >= 0.5) { x = tx; y = ty; break; }
    }
    const kinds = Object.keys(SHAPES);
    return { e, x, y, s: size, r: Math.round((Math.random() * 2 - 1) * 40), k: tr ? 'square' : kinds[Math.floor(Math.random() * kinds.length)], c: 1 };
  };
  /** 一覧から押した: まだなら貼る (大きさ・場所・角度・形はランダム)、貼ってあれば選ぶ。
   * 一覧はページごとスクロールするので、押したらページの上 (カード・操作) へ戻る @param {Badge} b */
  async function addOrSelect(b) {
    const top = root.getBoundingClientRect().top + window.scrollY - 8;
    if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
    if (!stickers.some(s => s.e === b.e)) {
      if (stickers.length >= MAX_STICKERS) { toast(i18n('card_back.toast.max', { n: MAX_STICKERS })); return; }
      // 透過かどうか (形を選べるか)。一覧の絵を描いたときに調べてあるので、たいていすぐ分かる
      const tr = await isTransparent(IMG_BASE + b.file);
      if (stickers.some(s => s.e === b.e)) { select(b.e); return; }   // 待つ間に 2 回押した
      if (stickers.length >= MAX_STICKERS) { toast(i18n('card_back.toast.max', { n: MAX_STICKERS })); return; }
      stickers.push(randomSticker(b.e, tr));
      sel = b.e;
      place();
      const el = els.get(b.e);
      if (el) { el.classList.remove('bz-pop'); void el.offsetWidth; el.classList.add('bz-pop'); }
      commit(true);
      paintTray();
    } else select(b.e);
  }

  fitLayer();
  if (typeof ResizeObserver === 'function') new ResizeObserver(fitLayer).observe(stage);
  place();
  paintTray();
  paintHistory();
  // 表のタブで変えたもの (色・二つ名など) を裏のカードにも出す (裏のタブに戻ったときに p_edit.js が呼ぶ)
  return { refresh: () => { renderBase(); paintTextSel(); } };
}

