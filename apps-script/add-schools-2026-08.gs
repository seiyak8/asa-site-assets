/**
 * Outreach シートへの学校追加（2026年8月・26校）
 *
 * 一度だけ実行する使い捨ての関数。実行後はこのファイルを消してよい。
 *
 * 使い方
 *   1. Apps Scriptエディタに貼り付けて保存
 *   2. 上部の関数ドロップダウンで addBangkokSchools2026 を選ぶ
 *   3. 「▶ 実行」
 *
 * 既にある学校名は飛ばすので、間違って2回実行しても重複しない。
 * メールアドレスは空欄で入る。空欄の行は下書き作成も送信もされないため、
 * アドレスを調べて B列に入れるまでは何も起きない。
 *
 * 除外したもの
 *   - 泰日協会学校（バンコク日本人学校）… 個別に連絡するため
 *   - 女子校4校（Saint Joseph Convent / Mater Dei / Wattana Wittaya /
 *     Sacred Heart Convent）… U-12女子チームの有無が未確認のため
 */

/**
 * 追加する学校。[学校名, メールアドレス, 言語, 備考]
 *
 * メールアドレスは、学校の公式サイトに出ているものだけを入れてある。
 * 空欄は未確認。推測で埋めていない。存在しない宛先に一斉送信すると
 * 送信ドメインの評判が落ち、正しく送った分まで迷惑メール扱いになるため。
 *
 * 空欄の行は下書き作成も送信も自動で飛ばされるので、置いたままで害はない。
 */
const SCHOOLS_TO_ADD_2026_08 = [
  // インターナショナルスクール
  ['Wellington College International School Bangkok', 'admissions@wellingtoncollege.ac.th', 'en', '公式サイトの Contact より'],
  ['King\'s College International School Bangkok', 'admissions@kingsbangkok.ac.th', 'en', '公式サイトの Contact より'],
  ['Ascot International School', 'admissions@ascot.ac.th', 'en', '公式サイトの Contact より'],
  ['Charter International School', '', 'en', '要調査 charter.ac.th'],
  ['Heathfield International School', '', 'en', '要調査'],
  ['Rasami British International School', '', 'en', '要調査'],
  ['Modern International School Bangkok (MISB)', '', 'en', '要調査'],
  ['Thai Sikh International School (TSI)', '', 'en', '要調査 tsi.ac.th'],
  ['Grace International School Bangkok', '', 'en', '要調査'],
  ['Rising Oaks International School Bangkok', '', 'en', '要調査'],
  ['The British School of Bangkok', '', 'en', '要調査'],
  ['International Pioneers School (IPS)', '', 'en', '要調査'],
  ['RIS Swiss Section - Deutschsprachige Schule Bangkok', '', 'en', '要調査 ris-swiss-section.org'],
  ['Lycee Francais International de Bangkok (LFIB)', '', 'en', '要調査 lfib.ac.th'],
  ['Korean International School of Bangkok', '', 'en', '要調査'],
  ['Satit Kaset International Programme', '', 'en', '要調査 kusip.ac.th'],
  ['Dulwich College Bangkok', '', 'en', '要調査 2026年8月開校。9/20時点でU-12チームがあるか要確認'],

  // 日系
  ['Josuikan Bangkok International School', '', 'ja', '要調査 日本の学校法人系。日本語で連絡可'],

  // タイ私立・附属校
  ['Assumption College Thonburi', '', 'th', '要調査 act.ac.th / U-13 Chang Junior Cup 2018優勝。サッカー強豪。優先度高'],
  ['Assumption College Samrong', '', 'th', '要調査'],
  ['Amnuay Silpa School (ANS)', '', 'th', '要調査 タイ英バイリンガル校'],
  ['Sarasas Ektra School', '', 'th', '要調査 サラサス系列。系列校が多数あり横展開可能'],
  ['Sarasas Witaed Suksa School', '', 'th', '要調査 サラサス系列'],
  ['Chulalongkorn University Demonstration School (Satit Chula)', '', 'th', '要調査 名門附属校'],
  ['Kasetsart University Laboratory School (Satit Kaset)', '', 'th', '要調査 名門附属校']

  // VERSO International School は 2026年7月31日で閉校したため入れていない。
];

function addBangkokSchools2026() {
  const sheet = getOutreachSheet_();
  const data = sheet.getDataRange().getValues();

  // 既にある学校名を集める。2回実行しても重複しないようにする。
  const existing = {};
  for (let i = 1; i < data.length; i++) {
    const name = (data[i][0] || '').toString().trim().toLowerCase();
    if (name) existing[name] = true;
  }

  const rows = [];
  let duplicated = 0;

  SCHOOLS_TO_ADD_2026_08.forEach(function (school) {
    if (existing[school[0].trim().toLowerCase()]) {
      Logger.log('スキップ（既にあります）: ' + school[0]);
      duplicated++;
      return;
    }
    // schoolName, email, lang, contact, status, sentAt, note
    rows.push([school[0], school[1], school[2], '', '', '', school[3]]);
  });

  if (!rows.length) {
    Logger.log('追加する学校がありません。すべて既にシートに入っています。');
    return;
  }

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, OUTREACH_HEADER.length).setValues(rows);

  Logger.log('--- 完了 ---');
  Logger.log(rows.length + '校を ' + startRow + '行目から追加しました。' +
             (duplicated ? '（重複 ' + duplicated + '件はスキップ）' : ''));
  Logger.log('メールアドレスは空欄です。B列に入力するまで、下書き作成も送信も行われません。');
}

/* ============================================================
 * 追加済みの行にアドレスを後から書き込む
 * ============================================================
 * addBangkokSchools2026 をアドレス空欄の状態で先に実行してしまった場合、
 * 学校名の重複チェックに引っかかって上書きされない。その修正用。
 *
 * 既にB列に何か入っている行は触らない。手で直した内容を消さないため。
 */

/** [学校名, メールアドレス, 備考] */
const EMAIL_FIXES_2026_08 = [
  ['Wellington College International School Bangkok', 'admissions@wellingtoncollege.ac.th', '公式サイトの Contact より'],
  ['King\'s College International School Bangkok', 'admissions@kingsbangkok.ac.th', '公式サイトの Contact より'],
  ['Ascot International School', 'admissions@ascot.ac.th', '公式サイトの Contact より']
];

/** 閉校などで送ってはいけない学校。[学校名, 理由] */
const CLOSED_SCHOOLS_2026_08 = [
  ['VERSO International School', '2026年7月31日で閉校']
];

function fixOutreachEmails2026() {
  const sheet = getOutreachSheet_();
  const data = sheet.getDataRange().getValues();

  // 学校名から行番号を引けるようにする。
  const rowOf = {};
  for (let i = 1; i < data.length; i++) {
    const name = (data[i][0] || '').toString().trim().toLowerCase();
    if (name && !rowOf[name]) rowOf[name] = i + 1;
  }

  let filled = 0;
  let closed = 0;

  EMAIL_FIXES_2026_08.forEach(function (fix) {
    const rowNumber = rowOf[fix[0].trim().toLowerCase()];
    if (!rowNumber) {
      Logger.log('★ 見つかりません: ' + fix[0]);
      return;
    }

    const current = (data[rowNumber - 1][1] || '').toString().trim();
    if (current) {
      Logger.log('スキップ（既にアドレスあり）: ' + fix[0] + ' → ' + current);
      return;
    }

    sheet.getRange(rowNumber, 2).setValue(fix[1]);
    sheet.getRange(rowNumber, 7).setValue(fix[2]);
    Logger.log(rowNumber + '行目 記入: ' + fix[0] + ' → ' + fix[1]);
    filled++;
  });

  CLOSED_SCHOOLS_2026_08.forEach(function (item) {
    const rowNumber = rowOf[item[0].trim().toLowerCase()];
    if (!rowNumber) return;

    sheet.getRange(rowNumber, 5).setValue('skipped');
    sheet.getRange(rowNumber, 7).setValue(item[1]);
    Logger.log(rowNumber + '行目 除外: ' + item[0] + '（' + item[1] + '）');
    closed++;
  });

  Logger.log('--- 完了 ---');
  Logger.log('アドレスを ' + filled + '件記入 / 除外指定 ' + closed + '件');
  if (filled) {
    Logger.log('この' + filled + '校は「④ 下書きを作成する」の対象になります。');
  }
}
