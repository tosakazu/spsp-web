// テスト用の二つ名の一覧 (本物の一覧は編集ページから書き出すので、件数も id も変わる)。
// Worker のテストはこの 8 件 (と北米の 4 件) を前提にする。ほかの import より先に読むこと
import * as T from '../../site/js/titles.js';

T.TITLES.ja = [
  { id: 'ja-0001', part: 'pre', text: '1000年に1度の', unlock: 'initial', added: '2026-10-01' },
  { id: 'ja-0002', part: 'pre', text: 'SSQMの', unlock: 'random', added: '2026-10-01' },
  { id: 'ja-0003', part: 'both', text: 'プロ観戦勢', unlock: 'random', added: '2026-10-01' },
  { id: 'ja-0004', part: 'pre', text: '発生', unlock: 'random', added: '2026-10-01' },
  { id: 'ja-0005', part: 'post', text: 'トリックスター', unlock: 'initial', added: '2026-10-01' },
  { id: 'ja-0006', part: 'post', text: '支配者', unlock: 'random', added: '2026-10-01' },
  { id: 'ja-0007', part: 'post', text: '!みんな元気でね!', unlock: 'random', added: '2026-10-01' },
  { id: 'ja-0008', part: 'post', text: '1f', unlock: 'random', added: '2026-10-01' },
];
