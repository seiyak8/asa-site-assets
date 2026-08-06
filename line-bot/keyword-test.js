/*
 * キーワードと言語判定の確認。
 *
 *   node line-bot/keyword-test.js
 *
 * Code.gs をそのまま読み込み、判定に関わる関数だけを動かす。
 * スプレッドシートもLINEも触らないので、実行しても誰にも何も送らない。
 * キーワードを足したり削ったりしたら、貼り替える前にこれを通すこと。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
vm.runInThisContext(src);

let STORED = null;
globalThis.getStoredLang_ = function () { return STORED; };

let fail = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) fail++;
  console.log((ok ? 'ok  ' : 'NG  ') + label + ' → ' + got + (ok ? '' : ' (期待: ' + want + ')'));
}

function lang(text, stored) {
  STORED = stored || null;
  return detectLanguage_(text, 'U_test');
}

console.log('--- 今回の不具合（シートの11〜14行目）');
check('"I want a refund." 前回ja', lang('I want a refund.', 'ja'), 'en');
check('"I want to refund" 前回ja', lang('I want to refund', 'ja'), 'en');
check('"I want a refund." 前回th', lang('I want a refund.', 'th'), 'en');
check('"返金してほしい"', lang('返金してほしい', null), 'ja');

console.log('\n--- 記憶を残すべき短い相槌（英語に流れてはいけない）');
check('"OK" 前回ja', lang('OK', 'ja'), 'ja');
check('"thanks" 前回ja', lang('thanks', 'ja'), 'ja');
check('"OK" 前回th', lang('OK', 'th'), 'th');
check('"👍" 前回th', lang('👍', 'th'), 'th');

console.log('\n--- 言語の名指し');
check('"日本語でお願いします"', lang('日本語でお願いします', 'th'), 'ja');
check('"English please"', lang('English please', 'ja'), 'en');
check('"ภาษาไทย"', lang('ภาษาไทย', 'ja'), 'th');
check('"Can I get it in Thai?"', lang('Can I get it in Thai?', 'ja'), 'th');
check('"英語できますか"（日本語で答えるべき）', lang('英語できますか', null), 'ja');
check('"タイ語できますか"（日本語で答えるべき）', lang('タイ語できますか', null), 'ja');
check('"Do you have Japanese classes?"', lang('Do you have Japanese classes?', null), 'en');

console.log('\n--- 文字種');
check('タイ文字', lang('สนใจคลาสทดลองเรียนค่ะ', 'ja'), 'th');
check('かな', lang('体験レッスンについて教えてください', 'th'), 'ja');
check('漢字のみ 記憶なし', lang('体験希望', null), 'ja');

console.log('\n--- ローマ字');
check('ローマ字の日本語', lang('taiken ikura desu ka', null), 'ja');
check('ローマ字のタイ語', lang('sawasdee kha yak sonjai rian', null), 'th');
check('英語の文 記憶なし', lang('How much is the monthly fee?', null), 'en');

console.log('\n--- 問い合わせキーワード（シーン1）');
const scene1 = [
  ['ja', '料金はいくらですか'], ['ja', '駐車場はありますか'], ['ja', '何歳から通えますか'],
  ['ja', '見学したいです'], ['ja', 'かけっこを習わせたい'],
  ['en', 'How much is the monthly fee?'], ['en', 'Where are you located?'],
  ['en', 'Can I book a trial for my daughter?'], ['en', 'What time are the classes?'],
  ['th', 'สนใจเรียนค่ะ'], ['th', 'ค่าเรียนเท่าไหร่คะ'], ['th', 'ที่ไหนคะ'],
  ['th', 'ลูกอายุ 5 ขวบเรียนได้ไหมคะ']
];
for (const [l, text] of scene1) {
  const hit = SCENE1_TRIAL_INQUIRY[l].keywords.some(function (k) { return containsKeyword_(text, k); });
  check('[' + l + '] "' + text + '"', hit, true);
}

console.log('\n--- 人が対応すべき（要対応になるべき）');
const human = [
  '返金してほしい', 'I want a refund.', 'คืนเงินได้ไหมคะ',
  '来月は休会したいです', '子どもが練習中に怪我をしました', '発熱したので休みます',
  'My son was injured during practice', 'I want to pause my membership',
  'This is terrible service', 'ลูกบาดเจ็บที่คลาสค่ะ', 'ขอหยุดเรียนเดือนหน้าค่ะ'
];
for (const text of human) check('"' + text + '"', needsHuman_(text), true);

console.log('\n--- 人に回してはいけない（自動返信すべき）');
const auto = [
  '体験を希望します', '感謝しています', 'ありがとうございました',
  'How much do you charge?', 'What time does the class stop?',
  'I am interested in the trial', 'สนใจคลาสทดลองเรียนค่ะ', 'ทีมแพ้เมื่อวานครับ'
];
for (const text of auto) check('"' + text + '"', needsHuman_(text), false);

console.log('\n--- フォーム送信の申告');
for (const [l, text] of [['ja', 'フォーム送信しました'], ['ja', '入力できました'],
                         ['en', 'I just submitted the form'], ['en', 'all done'],
                         ['th', 'กรอกฟอร์มแล้วค่ะ'], ['th', 'ส่งแล้วค่ะ']]) {
  check('[' + l + '] "' + text + '"', isFormCompletionMessage_(text, l), true);
}
for (const [l, text] of [['en', 'Are you done for the day?'], ['ja', '体験を希望します']]) {
  check('[' + l + '] "' + text + '" は誤爆しない', isFormCompletionMessage_(text, l), false);
}

console.log('\n' + (fail === 0 ? 'すべて期待どおり' : fail + ' 件が期待と違う'));
process.exit(fail === 0 ? 0 : 1);
