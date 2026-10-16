// @ts-check
// latin_name.js — カードの裏面に出す英字の名前 (Figma「back」は「kaworu」のように英字で組む)。
//   autoLatin(name)          名前から自動で作る:
//                              英数字だけ → そのまま / かな・カナ → ローマ字 (ヘボン式、小文字) / 漢字 → 漢字はそのまま、まわりのかなだけローマ字
//                              「日本語/英字」(「たいけい/Taikei」「マイルドなH.O/Mild na H.O」) → 英字の側だけ
//   cardLatinName(name, own) 本人がカード編集で登録した英字名 (own) があればそれ、無ければ autoLatin
// 伸ばす音「ー」は書かない (「スノー」→「suno」、パスポートと同じ)。読みの分からない漢字や、本人の綴りと違うときは、カード編集で英字名を登録してもらう

/** 2 文字の組 (拗音・外来語の音) */
const DIGRAPH = /** @type {Record<string, string>} */ ({
  キャ: 'kya', キュ: 'kyu', キョ: 'kyo', ギャ: 'gya', ギュ: 'gyu', ギョ: 'gyo',
  シャ: 'sha', シュ: 'shu', ショ: 'sho', シェ: 'she', ジャ: 'ja', ジュ: 'ju', ジョ: 'jo', ジェ: 'je',
  チャ: 'cha', チュ: 'chu', チョ: 'cho', チェ: 'che', ヂャ: 'ja', ヂュ: 'ju', ヂョ: 'jo',
  ニャ: 'nya', ニュ: 'nyu', ニョ: 'nyo', ヒャ: 'hya', ヒュ: 'hyu', ヒョ: 'hyo',
  ビャ: 'bya', ビュ: 'byu', ビョ: 'byo', ピャ: 'pya', ピュ: 'pyu', ピョ: 'pyo',
  ミャ: 'mya', ミュ: 'myu', ミョ: 'myo', リャ: 'rya', リュ: 'ryu', リョ: 'ryo',
  ファ: 'fa', フィ: 'fi', フェ: 'fe', フォ: 'fo', フュ: 'fyu',
  ティ: 'ti', テュ: 'tyu', ディ: 'di', デュ: 'dyu', トゥ: 'tu', ドゥ: 'du',
  ウィ: 'wi', ウェ: 'we', ウォ: 'wo', イェ: 'ye',
  ヴァ: 'va', ヴィ: 'vi', ヴェ: 've', ヴォ: 'vo', ヴュ: 'vyu',
  ツァ: 'tsa', ツィ: 'tsi', ツェ: 'tse', ツォ: 'tso',
  クァ: 'kwa', クィ: 'kwi', クェ: 'kwe', クォ: 'kwo', グァ: 'gwa',
  スィ: 'si', ズィ: 'zi',
});
/** 1 文字 */
const MONO = /** @type {Record<string, string>} */ ({
  ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o',
  カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko', ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go',
  サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so', ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo',
  タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to', ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do',
  ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no',
  ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho', バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo',
  パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po',
  マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo', ヤ: 'ya', ユ: 'yu', ヨ: 'yo',
  ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro', ワ: 'wa', ヰ: 'i', ヱ: 'e', ヲ: 'wo', ン: 'n', ヴ: 'vu',
  ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o', ャ: 'ya', ュ: 'yu', ョ: 'yo', ヮ: 'wa', ヵ: 'ka', ヶ: 'ke',
  '・': ' ', '〜': '~', '、': ',', '。': '.', '「': ' ', '」': ' ', '『': ' ', '』': ' ', '【': ' ', '】': ' ',
});

/** 日本語の文字 (かな・カナ・漢字・和文の記号) を含むか */
const JA = /[　-〿぀-ヿㇰ-ㇿ㐀-鿿豈-﫿ｦ-ﾟ]/;

/** ひらがな → カタカナ @param {string} s */
const toKata = s => s.replace(/[ぁ-ゖゝゞ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));

/** かな・カナをローマ字にする (ほかの文字はそのまま) @param {string} s */
function kanaToRoman(s) {
  const k = toKata(s);
  let out = '';
  let sokuon = false;   // 「ッ」: 次の子音を重ねる
  for (let i = 0; i < k.length; i++) {
    const c = k[i];
    if (c === 'ッ') { sokuon = true; continue; }
    if (c === 'ー') { sokuon = false; continue; }
    let r = DIGRAPH[c + (k[i + 1] || '')];
    if (r) i++;
    else r = MONO[c];
    if (r === undefined) { sokuon = false; out += c; continue; }   // 漢字・英字・記号はそのまま
    if (sokuon && /^[a-z]/.test(r) && !/^[aiueon]/.test(r)) r = (r.startsWith('ch') ? 't' : r[0]) + r;
    sokuon = false;
    out += r;
  }
  return out;
}

/** @param {string} s */
const tidy = s => s.replace(/\s+/g, ' ').trim();

/** 名前から英字の名前を自動で作る (上の説明) @param {string} name */
export function autoLatin(name) {
  // 全角の英数字・記号・空白と半角カナだけ普通の幅にする (ほかの記号「º」などは NFKC で変わってしまうので触らない)
  const s = tidy(String(name || '').replace(/[\u3000\uff01-\uff9f]+/g, c => c.normalize('NFKC')));
  if (!JA.test(s)) return s;
  // 「日本語/英字」: 日本語を含まない側だけ (両側とも日本語なら全体をローマ字に)
  const parts = s.split('/').map(tidy).filter(Boolean);
  if (parts.length > 1) {
    const latin = parts.filter(p => !JA.test(p));
    if (latin.length && latin.length < parts.length) return latin.join('/');
  }
  return tidy(kanaToRoman(s));
}

/** 本人が登録した英字名があればそれ、無ければ自動 @param {string} name @param {string | null | undefined} [own] */
export function cardLatinName(name, own) {
  const o = tidy(String(own || ''));
  return o || autoLatin(name);
}

/** カード編集で登録できる英字名か (サーバの worker/src/api/card.ts と同じ: 半角の英数字・記号・空白、1〜30 文字) @param {string} s */
export const latinNameValid = s => /^[\x20-\x7e]{1,30}$/.test(s) && s.trim() === s && !/\s{2,}/.test(s);
export const LATIN_NAME_MAX = 30;

const API = { autoLatin, cardLatinName, latinNameValid, LATIN_NAME_MAX };
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspLatinName = API;
export default API;
