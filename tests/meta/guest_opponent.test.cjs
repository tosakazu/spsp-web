// start.gg のアカウントが無い相手との試合 (opp_guest) の名前: js/player_data.js の assemble が、名前の無い行にだけ
// 決まった文言を入れる。名前のある行・普通の相手の行はそのまま (そういう行が無ければ配列ごと同じもの)。
const test = require('node:test');
const assert = require('node:assert');
const mod = require('../../site/js/player_data.js');
const PD = mod.default || mod;

test('アカウントの無い相手: 名前が無ければ文言、あればそのまま', () => {
  const stable = {
    display: 'A', tournaments: [],
    recent_matches: [
      { opp_uid: 5, opp_display: 'B', won: true },
      { opp_uid: null, opp_guest: true, opp_display: '', won: true },
      { opp_uid: null, opp_guest: true, opp_display: 'ゆうき', won: false },
    ],
    top_bt_gains: [{ opp_uid: null, opp_guest: true, opp_display: '', won: true }],
  };
  const out = PD.assemble(stable, {}, [], {});
  assert.strictEqual(out.recent_matches[0], stable.recent_matches[0]);
  assert.ok(out.recent_matches[1].opp_display.length > 0);
  assert.strictEqual(out.recent_matches[1].opp_uid, null);
  assert.strictEqual(out.recent_matches[2].opp_display, 'ゆうき');
  assert.ok(out.top_bt_gains[0].opp_display.length > 0);
  assert.strictEqual(stable.recent_matches[1].opp_display, '');   // 元は書き換えない
});

test('アカウントの無い相手がいなければ配列はそのまま', () => {
  const stable = { display: 'A', tournaments: [], recent_matches: [{ opp_uid: 5, opp_display: 'B' }] };
  const out = PD.assemble(stable, {}, [], {});
  assert.strictEqual(out.recent_matches, stable.recent_matches);
});
