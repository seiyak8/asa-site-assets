/**
 * Advance Sports Academy — LINE 自動応答（日本語 / English / ภาษาไทย）
 *
 * ============================================================
 * 設定：スクリプトプロパティに以下の「キー」で保存する
 * ============================================================
 *   LINE_CHANNEL_ACCESS_TOKEN … LINEチャネルアクセストークン
 *   QUEUE_SHEET_ID            … キュー用スプレッドシートのID
 *
 * ★ トークンやシートIDをこのコードに直接書かないこと。
 *   スクリプトプロパティにのみ保存する（GASエディタ左の歯車 →
 *   プロジェクトの設定 → スクリプト プロパティ）。
 *
 * ============================================================
 * シート構成
 * ============================================================
 *   Queue         A:timestamp B:userId C:keyword D:replyText E:sent F:担当者
 *   KnownContacts A:userId    B:memo
 *   UserLang      A:userId    B:lang   C:updatedAt
 *   NoAutoReply   A:userId    B:reason C:addedAt   … 自動送信しない相手
 *   Followers     A:userId    B:followedAt         … 友だち追加を記録できた相手
 *
 *   ★ 自動送信は「Followers に載っていて、NoAutoReply に載っていない人」だけ。
 *     貼り替えたら markAllCurrentFollowersAsExisting() を一度実行すること。
 *
 *   ★ Queue の F列「担当者」
 *     スタッフが手動対応する案件は担当者名を記入する。記入がある行は
 *     自動送信をスキップ（保留）する。空欄に戻せば次回実行で送信される。
 */

/* ============================================================
 * 基本設定
 * ============================================================ */

/**
 * 返信のタイミング。
 *   'immediate' … 問い合わせを受けた瞬間に返信する（推奨）
 *   'queue'     … Queueに積み、定時実行(processQueue)でまとめて送る
 *
 * 'queue' だと最大1時間お待たせすることになる。体験の問い合わせは
 * 反応速度がそのまま申込率に効くため、既定を 'immediate' にしている。
 * スタッフが全件を事前確認したい場合のみ 'queue' に戻すこと。
 */
const REPLY_MODE = 'immediate';

const PROP_TOKEN = 'LINE_CHANNEL_ACCESS_TOKEN';
const PROP_SHEET_ID = 'QUEUE_SHEET_ID';

function getChannelAccessToken_() {
  const token = PropertiesService.getScriptProperties().getProperty(PROP_TOKEN);
  if (!token) {
    throw new Error(
      'スクリプトプロパティ ' + PROP_TOKEN + ' が未設定です。' +
      'GASエディタ → プロジェクトの設定 → スクリプト プロパティ で設定してください。'
    );
  }
  return token;
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(PROP_SHEET_ID);
  if (!id) {
    throw new Error(
      'スクリプトプロパティ ' + PROP_SHEET_ID + ' が未設定です。' +
      'キュー用スプレッドシートのIDを設定してください。'
    );
  }
  return SpreadsheetApp.openById(id);
}

function getOrCreateSheet_(name, header) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(header);
  }
  return sheet;
}

function getQueueSheet_() {
  return getOrCreateSheet_('Queue',
    ['timestamp', 'userId', 'keyword', 'replyText', 'sent', '担当者']);
}

function getKnownContactsSheet_() {
  return getOrCreateSheet_('KnownContacts', ['userId', 'memo']);
}

function getUserLangSheet_() {
  return getOrCreateSheet_('UserLang', ['userId', 'lang', 'updatedAt']);
}

function isKnownContact_(userId) {
  const data = getKnownContactsSheet_().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId) return true;
  }
  return false;
}

/* ============================================================
 * 自動送信の禁止リスト
 * ============================================================
 * 一度でも人が応対したお客様に「初めまして」を送ると、それまでの
 * やり取りがなかったことになる。体験に来て、双子のお子さんのことで
 * 何度も質問をくださった方に初回案内が出てしまい、代表が
 * 「誤送信失礼いたしました」と謝る事故が実際に起きた。
 *
 * ★ このリストに載っているユーザーには、どのトリガーでも自動送信しない。
 *
 * ボットはLINE公式アカウントマネージャー上での手動のやり取りを
 * 見ることができない（webhookに流れてこない）。そのため
 * 「人が対応したか」を後から判定する手段がない。
 * そこで発想を逆にして、次の条件を満たす人**だけ**を自動送信の対象にする。
 *
 *   このアカウントを友だち追加した瞬間をボットが記録できている人
 *
 * 追加の瞬間を見ていない相手は、いつからいるのか、誰が何を話したのかが
 * 分からない。分からない相手には送らない。
 */
const SHEET_NO_AUTO_REPLY = 'NoAutoReply';
const SHEET_FOLLOWERS = 'Followers';

function getNoAutoReplySheet_() {
  return getOrCreateSheet_(SHEET_NO_AUTO_REPLY, ['userId', 'reason', 'addedAt']);
}

/** 友だち追加をボットが記録できた人。ここに載っている人だけが自動送信の対象。 */
function getFollowersSheet_() {
  return getOrCreateSheet_(SHEET_FOLLOWERS, ['userId', 'followedAt']);
}

function isAutoReplyBlocked_(userId) {
  const data = getNoAutoReplySheet_().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId) return true;
  }
  return isKnownContact_(userId);
}

function isTrackedFollower_(userId) {
  const data = getFollowersSheet_().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId) return true;
  }
  return false;
}

/** 禁止リストに加える。すでに載っていれば何もしない。 */
function blockAutoReply_(userId, reason) {
  if (isAutoReplyBlocked_(userId)) return;
  getNoAutoReplySheet_().appendRow([userId, reason || '', new Date()]);
  Logger.log('自動送信の禁止リストに追加: ' + userId + '（' + reason + '）');
}

function recordFollower_(userId) {
  if (isTrackedFollower_(userId)) return;
  getFollowersSheet_().appendRow([userId, new Date()]);
}

/**
 * このお客様に自動送信してよいか。
 *
 * 迷ったら送らない。送らなければ人が答えるだけだが、
 * 誤って送れば取り消せない。
 */
function mayAutoSend_(userId) {
  if (isAutoReplyBlocked_(userId)) return false;

  if (!isTrackedFollower_(userId)) {
    // 友だち追加を見ていない＝この変更より前からいるお客様。
    // 代表が手動で応対している可能性があるので、以後も送らない。
    blockAutoReply_(userId, '友だち追加の記録がないため（既存のお客様とみなす）');
    return false;
  }
  return true;
}

/* ============================================================
 * 言語判定
 * ============================================================ */

/**
 * 言語をはっきり指定した言い方。1語でも当たれば即座にその言語にする。
 *
 * ここに入れてよいのは「その言語で応対してほしい」という依頼だけ。
 * 「英語」「タイ語」のような、日本語の文中に出てくる言語名は入れない。
 * 「英語できますか」は英語で答えてほしいのではなく、日本語で答えてほしい
 * 問い合わせなので、入れると取り違える。同じ理由で 'japanese' 単体ではなく
 * 'in japanese' の形にしてある。
 */
const LANG_SWITCH = [
  { lang: 'ja', words: ['日本語', 'にほんご', 'ニホンゴ', 'nihongo', 'in japanese', 'japanese please'] },
  { lang: 'en', words: ['English', 'in english', 'english please'] },
  { lang: 'th', words: ['ภาษาไทย', 'ไทย', 'pasa thai', 'phasa thai', 'in thai', 'thai please'] }
];

/**
 * 言語のヒント語。
 *
 * 文字種では決まらない文——英語の文、ローマ字書きの日本語やタイ語——を
 * どの言語とみなすかの手がかり。2語以上当たった言語を採用する。
 *
 * 1語で切り替えないのは、日本語のお客様の「OK」「thanks」程度の相槌で
 * 英語扱いになるのを避けるため。逆に「I want a refund.」のような文は
 * 4語当たるので確実に英語になる。
 */
const LANG_HINT_MIN = 2;

const LANG_HINTS = {
  ja: [
    // ローマ字書きの日本語
    'desu', 'masu', 'desuka', 'arigatou', 'arigato', 'onegaishimasu', 'onegai',
    'sumimasen', 'konnichiwa', 'ohayou', 'moushikomi', 'taiken', 'ikura',
    'kodomo', 'musuko', 'musume', 'nanji', 'doko', 'itsu', 'shitai', 'hoshii'
  ],
  en: [
    // よく出る機能語。文になっていればまず2語以上当たる
    'i', 'you', 'we', 'my', 'your', 'the', 'a', 'is', 'are', 'do', 'does', 'did',
    'can', 'could', 'would', 'will', 'want', 'need', 'have', 'has', 'not',
    'how', 'what', 'when', 'where', 'which', 'why', 'who',
    'and', 'for', 'to', 'with', 'about', 'from', 'this', 'that',
    // 問い合わせでよく使う内容語
    'please', 'thank', 'thanks', 'hello', 'sorry', 'child', 'children', 'kid',
    'kids', 'son', 'daughter', 'age', 'old', 'year', 'years', 'time', 'day',
    'week', 'month', 'much', 'many', 'price', 'cost', 'class', 'lesson',
    'trial', 'schedule', 'join', 'refund', 'available', 'possible'
  ],
  th: [
    // ローマ字書きのタイ語
    'sawasdee', 'sawaddee', 'sawatdee', 'khrap', 'krap', 'kha', 'khun',
    'chai mai', 'mai chai', 'arai', 'thao rai', 'tao rai', 'yak', 'dek', 'luk',
    'rian', 'sonjai', 'son jai', 'mee mai', 'wan nai', 'gee mong'
  ]
};

/** その言語のヒント語がいくつ当たったか。 */
function countLangHints_(text, lang) {
  return (LANG_HINTS[lang] || []).filter(function (w) {
    return containsKeyword_(text, w);
  }).length;
}

function getStoredLang_(userId) {
  const data = getUserLangSheet_().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId) return data[i][1];
  }
  return null;
}

function saveLang_(userId, lang) {
  const sheet = getUserLangSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      if (data[i][1] !== lang) {
        sheet.getRange(i + 1, 2).setValue(lang);
        sheet.getRange(i + 1, 3).setValue(new Date());
      }
      return;
    }
  }
  sheet.appendRow([userId, lang, new Date()]);
}

/**
 * 判定の順序。上ほど強い根拠とみなす。
 *
 *   1. 言語を名指しした依頼（「日本語でお願いします」）
 *   2. 文字種（タイ文字・かな）
 *   3. ヒント語が2語以上当たった言語
 *   4. そのお客様の前回の言語
 *   5. 漢字があれば ja、なければ en
 *
 * 3 を 4 より先に置いているのが要点。以前は逆で、日本語で問い合わせた方が
 * 次に英語で書き直しても、記憶していた日本語で返していた。英語に切り替える
 * のは「日本語では通じなかったかもしれない」と思われたときなので、
 * そこで日本語を返すのが一番まずい。
 */
function detectLanguage_(text, userId) {
  for (const entry of LANG_SWITCH) {
    for (const w of entry.words) {
      if (containsKeyword_(text, w)) return entry.lang;
    }
  }
  if (/[฀-๿]/.test(text)) return 'th';
  if (/[぀-ヿ]/.test(text)) return 'ja';

  const stored = userId ? getStoredLang_(userId) : null;

  const scores = ['ja', 'th', 'en'].map(function (lang) {
    return { lang: lang, hits: countLangHints_(text, lang) };
  });
  const best = Math.max.apply(null, scores.map(function (s) { return s.hits; }));
  if (best >= LANG_HINT_MIN) {
    const top = scores.filter(function (s) { return s.hits === best; });
    // 同点なら、そのお客様の前回の言語を優先する。それも決め手にならなければ
    // ja → th → en の順（scores の並び順）で先頭を採る。
    const keep = top.filter(function (s) { return s.lang === stored; });
    return (keep.length ? keep[0] : top[0]).lang;
  }

  if (stored) return stored;

  if (/[一-鿿]/.test(text)) return 'ja';
  return 'en';
}

/* ============================================================
 * シーン1：体験レッスンの問い合わせ
 * ============================================================ */

const TRIAL_FORM = {
  baseUrl: 'https://forms.gle/b9WfqjbGprrhJZJeA',
  entryId: 'entry.370446376'
};

/**
 * 初回案内に添えるクラススケジュールの画像。
 *
 * 「一番早い体験はいつですか」は最初の問い合わせでよく聞かれる。曜日・時間・
 * 場所を先に見せておけば、人が答えるまでの待ち時間が申込率を削らずに済む。
 *
 * ★ LINEの画像メッセージの条件
 *   ・公開されたHTTPSのURL（認証を要求するURLは不可）
 *   ・JPEGかPNG。originalContentUrl は10MBまで、previewImageUrl は1MBまで
 *   ・Googleドライブの共有リンクは画像そのものではなくHTMLを返すので使えない
 *
 * ここでは1言語につき1ファイルを使い、1MB以下にしておくことで
 * original と preview を兼ねさせている。ファイルを差し替えたら
 * testScheduleImages() を実行して、3言語とも200が返ることを確かめること。
 *
 * URLを空にすると、その言語では画像を送らずテキストだけ返す。
 */
const SCHEDULE_IMAGE_BASE =
  'https://raw.githubusercontent.com/seiyak8/asa-site-assets/main/assets/images/';

const SCENE1_SCHEDULE_IMAGE = {
  ja: SCHEDULE_IMAGE_BASE + 'schedule-ja.jpg',
  en: SCHEDULE_IMAGE_BASE + 'schedule-en.jpg',
  th: SCHEDULE_IMAGE_BASE + 'schedule-th.jpg'
};

const SCENE1_TRIAL_INQUIRY = {
  ja: {
    keywords: [
      // あいさつ・書き出し
      'はじめまして', '初めまして', 'こんにちは', 'こんばんは', 'おはよう',
      '日本語', '問い合わせ', 'お聞きしたい', '質問', '教えてください', '教えて',
      // 体験・入会
      '体験', 'たいけん', 'トライアル', 'お試し', '申し込み', '申込', 'もうしこみ',
      '入会', '入りたい', '通いたい', '始めたい', 'はじめたい', '興味', '検討',
      'レッスン', 'クラス', '見学', '習い事', '習わせ', '参加',
      // 料金
      '料金', '費用', '月謝', '入会金', 'いくら', '価格', '会費', 'プラン',
      // 日時・場所
      '日程', '曜日', '時間', '何時', 'スケジュール', '空き', '予約',
      '場所', '住所', 'アクセス', '行き方', '駐車場',
      // 対象・種目
      '何歳', '年齢', '対象', '幼児', '小学生', '子ども', '子供',
      'サッカー', 'フットサル', '体操', '陸上', 'かけっこ', '走り方',
      '運動', 'スポーツ', '教室', 'コーチ'
    ],
    body:
      '初めまして！\n' +
      'お問い合わせいただき、ありがとうございます。\n' +
      '体験をお申し込みの場合は下記リンクより申し込みフォームにご記入いただけますと幸いです。\n\n' +
      '体験お申し込みフォーム\n{{FORM_LINK}}\n\n' +
      'ご不明な点がございましたら、いつでもお気軽にお問い合わせください。\n\n' +
      'よろしくお願いいたします。\nAdvance Sports Academy'
  },
  en: {
    // 照合は containsKeyword_ が大文字小文字を無視し、単語境界で行う
    keywords: [
      // greetings / openers
      'English', 'hello', 'hi', 'good morning', 'good evening',
      'inquiry', 'enquiry', 'question', 'asking', 'wondering',
      // trial / joining
      'trial', 'try', 'apply', 'application', 'sign up', 'signup',
      'join', 'joining', 'enroll', 'enrol', 'register', 'registration',
      'class', 'classes', 'lesson', 'lessons', 'session', 'sessions',
      'membership', 'member', 'interested', 'start', 'visit', 'watch',
      'book', 'booking', 'reserve', 'available', 'availability',
      // pricing
      'price', 'prices', 'fee', 'fees', 'cost', 'how much', 'monthly', 'ticket',
      // time / place
      'schedule', 'timetable', 'time', 'times', 'day', 'days', 'when',
      'where', 'location', 'address', 'parking', 'directions',
      // who / what
      'age', 'ages', 'old', 'child', 'children', 'kid', 'kids', 'son', 'daughter',
      'football', 'soccer', 'futsal', 'gymnastics', 'athletics', 'running',
      'sport', 'sports', 'academy', 'coach', 'training'
    ],
    body:
      'Thanks for reaching out about a trial lesson!\n' +
      'Please fill out the application form at the link below.\n\n' +
      '{{FORM_LINK}}\n\n' +
      'If you have any questions, feel free to ask anytime.\n' +
      'Advance Sports Academy'
  },
  th: {
    keywords: [
      // ทักทาย / สอบถาม
      'ภาษาไทย', 'ไทย', 'สวัสดี', 'สอบถาม', 'อยากทราบ', 'ขอถาม', 'คำถาม',
      // ทดลองเรียน / สมัคร
      'ทดลอง', 'ทดลองเรียน', 'สมัคร', 'สมัครเรียน', 'สนใจ', 'สนใจเรียน',
      'อยากเรียน', 'เรียน', 'คลาส', 'เข้าร่วม', 'จอง', 'ว่าง', 'ดูการเรียน',
      'สมาชิก', 'เริ่มเรียน',
      // ราคา
      'ราคา', 'ค่าเรียน', 'ค่าใช้จ่าย', 'เท่าไหร่', 'เท่าไร', 'รายเดือน', 'ฟรี',
      // เวลา / สถานที่
      'ตาราง', 'ตารางเรียน', 'เวลา', 'กี่โมง', 'วันไหน', 'ที่ไหน', 'สถานที่',
      'ที่อยู่', 'ที่จอดรถ',
      // ใคร / อะไร
      'กี่ขวบ', 'อายุ', 'ลูก', 'เด็ก',
      'ฟุตบอล', 'ฟุตซอล', 'ยิมนาสติก', 'กรีฑา', 'วิ่ง', 'กีฬา', 'โค้ช'
    ],
    body:
      'ขอบคุณที่สอบถามเกี่ยวกับคลาสทดลองเรียนค่ะ\n' +
      'กรุณากรอกแบบฟอร์มใบสมัครผ่านลิงก์ด้านล่างนี้ได้เลยค่ะ\n\n' +
      '{{FORM_LINK}}\n\n' +
      'หากมีข้อสงสัยใดๆ สามารถสอบถามได้ตลอดเวลานะคะ\n' +
      'Advance Sports Academy'
  }
};

/* ============================================================
 * フォーム入力完了の申告メッセージ
 * ============================================================ */

/**
 * 「フォームを出しました」の申告。
 *
 * 当たると持ち物案内（シーン2）を返す。出していない人に送ると話が噛み合わない
 * ので、英語は 'done' のような単独語を入れず、フォームを指す句の形にしてある。
 */
const FORM_COMPLETION_KEYWORDS = {
  ja: [
    '完了', '送信しました', '送りました', '提出しました', '入力しました',
    '記入しました', '書きました', '出しました', '送信済', '送信完了',
    '申し込みました', '申込みました', '登録しました', 'できました'
  ],
  en: [
    'completed', 'submitted', 'finished the form', 'done with the form',
    'filled out', 'filled in', 'sent the form', 'sent it', 'form is done',
    'all done', 'just applied', 'application sent'
  ],
  th: [
    'เสร็จ', 'ส่งแล้ว', 'กรอกแล้ว', 'กรอกฟอร์มแล้ว', 'ส่งฟอร์มแล้ว',
    'สมัครแล้ว', 'เรียบร้อย'
  ]
};

function isFormCompletionMessage_(text, lang) {
  const keywords = FORM_COMPLETION_KEYWORDS[lang] || [];
  return keywords.some(function (kw) { return containsKeyword_(text, kw); });
}

/* ============================================================
 * 人が対応すべき問い合わせ
 * ============================================================
 * 料金交渉・返金・退会・クレーム・怪我など、自動で答えると実害が出る話。
 * 自動返信せず、Queue の担当者欄に印を付けてスタッフに回す。
 */

/**
 * ここに語を足すと、その語を含む問い合わせには自動返信しなくなる。
 * 増やしすぎると、体験の申し込みまで人待ちになって申込率が落ちる。
 * 「答えを間違えると実害が出る話」に限ること。
 *
 * 意図的に外している語：
 *   '熱'   … 「情熱」「熱心」に当たる。発熱は '発熱' で拾う
 *   '謝'   … 「感謝しています」に当たる。'謝罪' の形で拾う
 *   'stop' … 「何時に stop しますか」に当たる
 *   'charge' … 「How much do you charge?」は料金の質問で、人手は要らない
 *   'แพ้'  … タイ語では「試合に負ける」の意味にもなる。'แพ้อาหาร' で拾う
 */
const ESCALATION_KEYWORDS = [
  // 日本語：お金
  '返金', '払い戻し', '返してほしい', '値引き', '割引', '請求', '二重請求',
  '引き落とし', '未払い', '料金が違', '高すぎ',
  // 日本語：やめる・休む
  '解約', '退会', 'やめたい', '辞めたい', 'キャンセル', '休会', '休みたい',
  '振替', '返品', '転校', '引っ越し',
  // 日本語：苦情
  '苦情', 'クレーム', 'ひどい', '最悪', '不満', '責任', '謝罪', '訴え', '弁償',
  'いじめ', '差別', '個人情報',
  // 日本語：安全・体調
  '怪我', 'けが', 'ケガ', '事故', '救急', '病院', '骨折', '捻挫', '出血',
  '発熱', '体調', '具合が悪', 'アレルギー', '喘息', '発作', '虐待',
  // English: money
  'refund', 'money back', 'reimburse', 'overcharged', 'double charged',
  'billing', 'invoice', 'discount', 'too expensive',
  // English: leaving / pausing
  'cancel', 'quit', 'withdraw', 'unsubscribe', 'terminate', 'pause',
  'freeze', 'suspend', 'moving away',
  // English: complaint
  'complaint', 'complain', 'unhappy', 'disappointed', 'terrible', 'awful',
  'worst', 'rude', 'bullying', 'bullied', 'lawyer', 'legal action', 'sue',
  // English: safety / health
  'injury', 'injured', 'accident', 'hospital', 'emergency', 'ambulance',
  'fracture', 'sprained', 'bleeding', 'fever', 'sick', 'allergy', 'allergic',
  'asthma', 'seizure',
  // ไทย: เงิน
  'คืนเงิน', 'เงินคืน', 'ส่วนลด', 'ค่าเสียหาย', 'เรียกเก็บเงินซ้ำ', 'แพงเกินไป',
  // ไทย: หยุด / ยกเลิก
  'ยกเลิก', 'ลาออก', 'หยุดเรียน', 'พักเรียน', 'เลื่อนเรียน', 'ย้ายบ้าน',
  // ไทย: ร้องเรียน
  'ร้องเรียน', 'ไม่พอใจ', 'แย่มาก', 'ทนาย', 'กลั่นแกล้ง',
  // ไทย: ความปลอดภัย / สุขภาพ
  'บาดเจ็บ', 'อุบัติเหตุ', 'โรงพยาบาล', 'ป่วย', 'ไข้', 'กระดูกหัก', 'เลือดออก',
  'แพ้อาหาร', 'หอบหืด'
];

/**
 * キーワード照合。
 *
 * 英数字のキーワードは単語境界で照合する。部分一致にすると
 * "quite good" が "quit"（退会）に、"application" が "apply" に
 * 誤って引っかかる。日本語とタイ語は語を空白で区切らないため部分一致で照合する。
 */
function containsKeyword_(text, keyword) {
  if (/^[\x20-\x7E]+$/.test(keyword)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^A-Za-z])' + escaped + '([^A-Za-z]|$)', 'i').test(text);
  }
  return text.indexOf(keyword) !== -1;
}

function needsHuman_(text) {
  return ESCALATION_KEYWORDS.some(function (kw) {
    return containsKeyword_(text, kw);
  });
}

const HUMAN_HANDOFF_REPLY = {
  ja: 'お問い合わせありがとうございます。\n' +
      '内容を確認のうえ、担当者より改めてご連絡いたします。\n' +
      '少々お待ちくださいませ。\n\nAdvance Sports Academy',
  en: 'Thank you for your message.\n' +
      'A member of our team will review it and get back to you shortly.\n\n' +
      'Advance Sports Academy',
  th: 'ขอบคุณสำหรับข้อความค่ะ\n' +
      'ทีมงานจะตรวจสอบและติดต่อกลับโดยเร็วที่สุดค่ะ\n\n' +
      'Advance Sports Academy'
};

/* ============================================================
 * シーン2：体験フォーム送信後（持ち物案内）
 * ============================================================ */

const SCENE2_AFTER_TRIAL_FORM = {
  ja:
    'フォームの入力ありがとうございます。\n\n' +
    '当日は走るメニューが多いため、最後までやりきれない場合がございますが\n' +
    'その際はスタッフの方でサポートしますのでご安心ください。\n\n' +
    '当日の持ち物こちらになります。\n\n' +
    '・運動着＆着替え\n・タオル\n・水分（多めに）\n' +
    '・シューズ（普段はいている物で可）*スパイク禁止\n' +
    '・体操クラスのお子様は裸足または靴下\n\n' +
    'よろしくお願いいたします。\nAdvance Sports Academy',
  en:
    'Thank you for filling out the form.\n\n' +
    "The trial lesson includes a lot of running activities, so if your child isn't able to " +
    "complete everything, please don't worry — our staff will be there to support them.\n\n" +
    "Here's what to bring on the day:\n\n" +
    '・Sportswear & a change of clothes\n・A towel\n・Water (plenty of it)\n' +
    '・Shoes (regular sneakers are fine) *Spikes are not allowed\n' +
    '・Children in the gymnastics class: bare feet or socks\n\n' +
    'Thank you,\nAdvance Sports Academy',
  th:
    'ขอบคุณสำหรับการกรอกแบบฟอร์มค่ะ\n\n' +
    'ในวันทดลองเรียนจะมีกิจกรรมที่ต้องวิ่งเยอะ หากบุตรหลานทำไม่ไหวจนจบ ' +
    'ทางสตาฟฟ์จะคอยช่วยเหลือ ไม่ต้องกังวลนะคะ\n\n' +
    'สิ่งที่ต้องเตรียมมาในวันนั้น มีดังนี้ค่ะ\n\n' +
    '・ชุดกีฬาและชุดเปลี่ยน\n・ผ้าขนหนู\n・น้ำดื่ม (เตรียมมาเยอะๆ)\n' +
    '・รองเท้า (รองเท้าที่ใส่ประจำก็ได้) *ห้ามใส่รองเท้าสตั๊ด\n' +
    '・เด็กที่เรียนคลาสยิมนาสติก: เท้าเปล่าหรือใส่ถุงเท้า\n\n' +
    'ขอบคุณค่ะ\nAdvance Sports Academy'
};

/* ============================================================
 * シーン3：体験終了後（スタッフが手動送信）
 * ============================================================ */

const ENROLL_FORMS_SHARED_EN_TH = {
  ticket: { url: 'https://forms.gle/f9LzcNzLpxhSNp398', entryId: 'entry.54950727' },
  monthly: { url: 'https://forms.gle/3PrDTtsBvZARfsc17', entryId: 'entry.1179713979' }
};

const ENROLL_FORMS = {
  ja: {
    ticket: { url: 'https://forms.gle/7zPVmuvZm4K6ECL96', entryId: 'entry.40411921' },
    monthly: { url: 'https://forms.gle/rVgkZ5EnKDjHKojA6', entryId: 'entry.1931375728' }
  },
  // 英語とタイ語は1つのフォームで2言語対応している（フォーム内のLanguage質問で言語を判定）
  en: ENROLL_FORMS_SHARED_EN_TH,
  th: ENROLL_FORMS_SHARED_EN_TH
};

const SCENE3_AFTER_TRIAL_LESSON = {
  ja:
    '体験レッスン、ありがとうございました！\n' +
    'お子さんは楽しんでいただけましたでしょうか？\n' +
    'ASAでは、お客様のご都合に合わせてチケット制と月額制の2種類の会員プランをご用意しています。\n' +
    '今後のご入会をご検討いただけましたら、下記よりお申し込みください。\n\n' +
    '・チケット制お申し込みフォーム: {{TICKET_LINK}}\n\n' +
    '・月額制お申し込みフォーム: {{MONTHLY_LINK}}\n\n' +
    'ご不明な点がございましたら、いつでもお気軽にご連絡くださいね。\n\n' +
    'よろしくお願いいたします。\nAdvance Sports Academy',
  en:
    'Thank you for coming to the trial lesson today! We hope your child had a great time.\n\n' +
    'At ASA, we offer two membership plans to fit your schedule: a ticket-based plan and a monthly plan.\n' +
    "If you're considering joining, please apply below.\n\n" +
    '・Ticket Plan Application: {{TICKET_LINK}}\n\n' +
    '・Monthly Plan Application: {{MONTHLY_LINK}}\n\n' +
    "Please don't hesitate to contact us if you have any questions.\n" +
    'Best,\nAdvance Sports Academy',
  // タイ語のみ、送信するスタッフの性別で語尾を切り替える。
  // シーン3は自動返信ではなくスタッフが手動で送るため、実在の話し手がいる。
  th: {
    female:
      'ขอบคุณสำหรับคลาสทดลองเรียนในวันนี้นะคะ! หวังว่าน้องๆ จะสนุกกันนะคะ\n\n' +
      'ที่ ASA เรามีแผนสมาชิก 2 แบบเพื่อให้เหมาะกับตารางเวลาของคุณลูกค้า คือแบบตั๋วและแบบรายเดือน\n' +
      'หากสนใจที่จะสมัครสมาชิก สามารถสมัครผ่านลิงก์ด้านล่างนี้ได้เลยค่ะ\n\n' +
      '・แบบฟอร์มสมัครสมาชิก (แบบตั๋ว): {{TICKET_LINK}}\n' +
      '・แบบฟอร์มสมัครสมาชิก (แบบรายเดือน): {{MONTHLY_LINK}}\n\n' +
      'หากมีข้อสงสัยใดๆ สามารถติดต่อสอบถามได้ตลอดเวลานะคะ ขอบคุณค่ะ\n' +
      'Advance Sports Academy',
    male:
      'ขอบคุณสำหรับคลาสทดลองเรียนในวันนี้นะครับ! หวังว่าน้องๆ จะสนุกกันนะครับ\n\n' +
      'ที่ ASA เรามีแผนสมาชิก 2 แบบเพื่อให้เหมาะกับตารางเวลาของคุณลูกค้า คือแบบตั๋วและแบบรายเดือน\n' +
      'หากสนใจที่จะสมัครสมาชิก สามารถสมัครผ่านลิงก์ด้านล่างนี้ได้เลยครับ\n\n' +
      '・แบบฟอร์มสมัครสมาชิก (แบบตั๋ว): {{TICKET_LINK}}\n' +
      '・แบบฟอร์มสมัครสมาชิก (แบบรายเดือน): {{MONTHLY_LINK}}\n\n' +
      'หากมีข้อสงสัยใดๆ สามารถติดต่อสอบถามได้ตลอดเวลานะครับ ขอบคุณครับ\n' +
      'Advance Sports Academy'
  }
};

/**
 * シーン3の本文を取り出す。
 * 日本語・英語は文字列、タイ語は性別ごとの2種類。
 */
function resolveScene3Body_(lang, gender) {
  const body = SCENE3_AFTER_TRIAL_LESSON[lang];
  if (!body) return null;
  if (typeof body === 'string') return body;
  return body[gender] || body.female;
}

/** その言語が送信者の性別を必要とするか。 */
function scene3NeedsGender_(lang) {
  return typeof SCENE3_AFTER_TRIAL_LESSON[lang] === 'object';
}

/* ============================================================
 * シーン4：入会後（Band招待）
 * ============================================================ */

const SCENE4_WELCOME = {
  ja:
    'ようこそASAへ！\n' +
    'この度はASAにご入会いただき、誠にありがとうございます。\n' +
    'ASAでは、会員様限定のBandグループを利用して、スケジュール管理や出欠確認、アカデミーからのお知らせなどを行っています。\n' +
    'お手数ですが、下記リンクよりご参加いただき、Bandプロフィールの設定をお願いいたします。\n\n' +
    'プロフィール設定のお願い\n' +
    '・プロフィールの名前と写真：お子様の情報に変更してください。\n' +
    '・サブの名前：保護者様のお名前をご記入ください。\n' +
    '・兄弟姉妹がいる場合：クラスに参加するお子様全員の名前と写真を添付してください。\n\n' +
    'ご参加いただくBandグループ\n' +
    '・Band Enjoy Class: https://band.us/n/aaab05z058D9Y\n' +
    '・Band Advance Class: https://band.us/n/a6a7A3n3g0Ddk\n\n' +
    '今後の連絡は全てBandにて行いますので、ご理解とご協力をお願いいたします。\n' +
    'ご不明な点がございましたら、お気軽にお問い合わせください。\n\n' +
    'よろしくお願いいたします。\nAdvance Sports Academy',
  en:
    'Welcome to ASA!\n' +
    'Thank you for joining us.\n' +
    'At ASA, we use an exclusive Band group for members to manage schedules, track attendance, ' +
    'and receive announcements from the academy. Please join via the link below and set up your Band profile.\n\n' +
    'Profile Setup Request\n' +
    "・Profile Name & Photo: Please change to your child's information.\n" +
    "・Nickname/Sub Name: Please enter the parent's/guardian's name.\n" +
    '・If you have siblings enrolled: Please include the names and photos of all children attending classes.\n\n' +
    'Band Groups to Join\n' +
    '・Band Enjoy Class: https://band.us/n/aaab05z058D9Y\n' +
    '・Band Advance Class: https://band.us/n/a6a7A3n3g0Ddk\n\n' +
    'All future communications will be through Band, so we appreciate your understanding and cooperation.\n' +
    'If you have any questions, please feel free to ask.',
  th:
    'ยินดีต้อนรับสู่ ASA ค่ะ! ขอบคุณที่สมัครสมาชิกกับ ASA ค่ะ\n\n' +
    'ที่ ASA เราใช้กลุ่ม Band สำหรับสมาชิกเท่านั้น เพื่อจัดการตารางเรียน เช็คชื่อ และรับข่าวสารจากทางอคาเดมี่\n' +
    'รบกวนเข้าร่วมผ่านลิงก์ด้านล่างและตั้งค่าโปรไฟล์ Band ด้วยค่ะ\n\n' +
    'คำขอในการตั้งค่าโปรไฟล์\n' +
    '・ชื่อและรูปโปรไฟล์: กรุณาเปลี่ยนเป็นข้อมูลของบุตรหลาน\n' +
    '・ชื่อรอง: กรุณากรอกชื่อผู้ปกครอง\n' +
    '・กรณีมีพี่น้อง: กรุณาแนบชื่อและรูปภาพของบุตรหลานทุกคนที่เข้าร่วมคลาส\n\n' +
    'กลุ่ม Band ที่ต้องเข้าร่วม\n' +
    '・Band Enjoy Class: https://band.us/n/aaab05z058D9Y\n' +
    '・Band Advance Class: https://band.us/n/a6a7A3n3g0Ddk\n\n' +
    'การติดต่อในอนาคตทั้งหมดจะดำเนินการผ่าน Band จึงขอขอบคุณสำหรับความเข้าใจและความร่วมมือค่ะ\n' +
    'หากมีข้อสงสัยใดๆ สามารถสอบถามได้ตลอดเวลาค่ะ'
};

/* ============================================================
 * Webhook
 * ============================================================ */

function doPost(e) {
  if (!e || !e.postData) {
    Logger.log('doPostが手動実行されました。動作確認はLINE Developersの「検証」ボタン、' +
               'または実際にLINEでメッセージを送って行ってください。');
    return jsonOutput_({ status: 'no postData' });
  }

  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    Logger.log('リクエストのJSON解析に失敗: ' + err.message);
    return jsonOutput_({ status: 'bad request' });
  }

  const events = body.events || [];

  events.forEach(function (event) {
    try {
      handleEvent_(event);
    } catch (err) {
      // 1件の失敗で残りのイベントを落とさない
      Logger.log('イベント処理でエラー: ' + err.message);
    }
  });

  return jsonOutput_({ status: 'ok' });
}

function handleEvent_(event) {
  // 友だち追加。ここを記録できた相手だけが自動送信の対象になる。
  if (event.type === 'follow') {
    recordFollower_(event.source.userId);
    Logger.log('友だち追加を記録: ' + event.source.userId);
    return;
  }

  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const text = event.message.text;

  const lang = detectLanguage_(text, userId);
  saveLang_(userId, lang);

  // 0. 人が応対したことのあるお客様には、何があっても自動送信しない。
  //    キーワードの判定より前に置く。ここを通り抜ける経路を作らないため。
  if (!mayAutoSend_(userId)) {
    logRow_(userId, 'skipped_known_customer', text, true, '要対応');
    Logger.log('既存のお客様のため自動送信せず記録のみ: ' + userId);
    return;
  }

  // 1. 人が対応すべき内容なら、自動で答えずスタッフに回す
  if (needsHuman_(text)) {
    replyMessage_(replyToken, HUMAN_HANDOFF_REPLY[lang]);
    logRow_(userId, 'human_handoff_' + lang, text, true, '要対応');
    Logger.log('要対応として記録: ' + userId);
    return;
  }

  // 2. フォーム入力完了の申告（シーン1より先に判定する）
  if (isFormCompletionMessage_(text, lang)) {
    if (alreadyHandled_(userId, 'scene2_after_trial_form_' + lang)) {
      Logger.log('持ち物案内は送信済みのためスキップ: ' + userId);
      return;
    }
    replyMessage_(replyToken, SCENE2_AFTER_TRIAL_FORM[lang]);
    logRow_(userId, 'scene2_after_trial_form_' + lang, SCENE2_AFTER_TRIAL_FORM[lang], true, '');
    return;
  }

  // 3. 体験の問い合わせ
  const config = SCENE1_TRIAL_INQUIRY[lang];
  const matched = config.keywords.some(function (kw) {
    return containsKeyword_(text, kw);
  });
  if (!matched) return;

  // 既存のお客様かどうかは、この関数の先頭 mayAutoSend_() で判定済み。
  // 判定箇所を1つにしておかないと、片方だけ通り抜ける経路ができる。

  const keyword = 'scene1_trial_inquiry_' + lang;
  if (alreadyHandled_(userId, keyword)) {
    Logger.log('同じ案内が登録済みのためスキップ: ' + userId + ' / ' + keyword);
    return;
  }

  const replyText = config.body.replace(
    '{{FORM_LINK}}',
    buildPrefilledFormLink_(TRIAL_FORM.baseUrl, TRIAL_FORM.entryId, userId)
  );

  if (REPLY_MODE === 'immediate') {
    const ok = replyMessages_(replyToken, scene1Messages_(lang, replyText));
    logRow_(userId, keyword, replyText, ok, '');
  } else {
    logRow_(userId, keyword, replyText, false, '');
  }
}

/**
 * シーン1で送るメッセージ一式。案内文のあとにスケジュール画像を1枚。
 * その言語の画像URLが未設定なら案内文だけを返す。
 */
function scene1Messages_(lang, replyText) {
  const messages = [textMessage_(replyText)];
  const url = SCENE1_SCHEDULE_IMAGE[lang];
  if (url) messages.push(imageMessage_(url));
  return messages;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function buildPrefilledFormLink_(baseUrl, entryId, userId) {
  const sep = baseUrl.indexOf('?') === -1 ? '?' : '&';
  return baseUrl + sep + entryId + '=' + encodeURIComponent(userId);
}

/* ============================================================
 * Queue（記録と重複防止）
 * ============================================================ */

/**
 * 同一ユーザー・同一キーワードが既に記録されていれば true。
 * 送信済み・未送信・保留中を問わず、二度目は送らない。
 */
function alreadyHandled_(userId, keyword) {
  const data = getQueueSheet_().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === userId && data[i][2] === keyword) return true;
  }
  return false;
}

function logRow_(userId, keyword, replyText, sent, assignee) {
  getQueueSheet_().appendRow([new Date(), userId, keyword, replyText, sent, assignee || '']);
}

/**
 * 定時実行：未送信の行を処理する。
 * REPLY_MODE が 'immediate' のときは送信漏れ（返信に失敗した行）の再送のみを担う。
 *
 *   E列(sent)がtrue      → スキップ
 *   F列(担当者)に記入あり → 保留（スタッフ対応中）
 *   それ以外              → プッシュ送信し、成功したらsentをtrueにする
 */
function processQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('別の処理が実行中のため、今回はスキップしました。');
    return;
  }

  try {
    const token = getChannelAccessToken_();
    const sheet = getQueueSheet_();
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const userId = data[i][1];
      const keyword = data[i][2];
      const replyText = data[i][3];
      const sent = data[i][4];
      const assignee = (data[i][5] || '').toString().trim();

      if (sent === true) continue;

      if (assignee !== '') {
        Logger.log('担当者対応中のため保留: ' + userId + ' / ' + keyword + ' / ' + assignee);
        continue;
      }

      const ok = pushMessage_(userId, replyText, token);
      sheet.getRange(i + 1, 5).setValue(ok);
      Logger.log('定時処理 ' + userId + ' / ' + keyword + ' → ' + ok);
    }
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
 * 送信
 * ============================================================ */

/**
 * replyToken を使った返信。無料枠を消費せず、即座に届く。
 * 受信したメッセージへの応答は必ずこちらを使う。
 */
function replyMessage_(replyToken, text) {
  return replyMessages_(replyToken, [textMessage_(text)]);
}

function textMessage_(text) {
  return { type: 'text', text: text };
}

/** 画像1枚。1MB以下のファイルを想定し、original と preview に同じURLを使う。 */
function imageMessage_(url) {
  return { type: 'image', originalContentUrl: url, previewImageUrl: url };
}

/**
 * 複数のメッセージをまとめて返信する（LINEの上限は1回5通）。
 *
 * 画像を含む送信が失敗したら、テキストだけで送り直す。
 * 画像のURLが切れているときに配列ごと拒否されると、お客様には
 * 「1通も届かない」ことになる。案内文だけでも必ず届くようにするための保険。
 */
function replyMessages_(replyToken, messages) {
  if (!replyToken) return false;

  const ok = postReply_(replyToken, messages);
  if (ok) return true;

  const textOnly = messages.filter(function (m) { return m.type === 'text'; });
  if (textOnly.length === messages.length) return false;

  Logger.log('画像付きの返信に失敗したため、テキストだけで送り直します。' +
             '画像URLを testScheduleImages() で確認してください。');
  return postReply_(replyToken, textOnly);
}

function postReply_(replyToken, messages) {
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getChannelAccessToken_() },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages }),
    muteHttpExceptions: true
  };
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', options);
  const code = res.getResponseCode();
  if (code !== 200) {
    Logger.log('返信に失敗 (HTTP ' + code + '): ' + res.getContentText());
  }
  return code === 200;
}

/**
 * こちらから送るプッシュ。送信数の上限を消費するため、
 * 受信への応答ではなくフォーム送信後の案内などに限って使う。
 */
function pushMessage_(userId, text, token) {
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + (token || getChannelAccessToken_()) },
    payload: JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text: text }]
    }),
    muteHttpExceptions: true
  };
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', options);
  const code = res.getResponseCode();
  if (code !== 200) {
    Logger.log('プッシュ送信に失敗 (HTTP ' + code + '): ' + res.getContentText());
  }
  return code === 200;
}

/* ============================================================
 * フォーム送信時の処理
 * ============================================================ */

/**
 * フォーム送信をきっかけにした自動送信も止めるか。
 *
 * true  … 「どんなトリガーでも自動送信しない」を厳密に守る（既定）
 * false … お客様自身がフォームを出したときだけは送る
 *
 * ★ true のままだと、既存のお客様が入会フォームを出しても
 *   Bandへの招待（シーン4）が自動で飛ばない。スタッフが手動で
 *   案内する運用になる。取りこぼすと入会後の連絡が届かないので、
 *   運用が回らないようなら false にすること。
 */
const BLOCK_ON_FORM_SUBMIT = true;

/** フォーム送信きっかけの自動送信をしてよいか。 */
function mayAutoSendOnFormSubmit_(userId) {
  if (!BLOCK_ON_FORM_SUBMIT) return true;
  if (isAutoReplyBlocked_(userId)) {
    Logger.log('既存のお客様のためフォーム後の自動送信を見送りました: ' + userId +
               '（手動で案内してください）');
    return false;
  }
  return true;
}

function onTrialFormSubmit(e) {
  const userId = extractUserId_(e);
  if (!userId) {
    Logger.log('userId取得失敗（シーン2）。フォームの「LINE ID」質問と、' +
               'LINEが送るリンクの事前入力設定を確認してください。');
    return;
  }
  if (!mayAutoSendOnFormSubmit_(userId)) {
    logRow_(userId, 'skipped_known_customer_trial_form', '', true, '要対応');
    return;
  }
  const lang = extractFormLanguage_(e);
  const keyword = 'scene2_after_trial_form_' + lang;
  if (alreadyHandled_(userId, keyword)) {
    Logger.log('持ち物案内は送信済みのためスキップ: ' + userId);
    return;
  }
  const ok = pushMessage_(userId, SCENE2_AFTER_TRIAL_FORM[lang]);
  logRow_(userId, keyword, SCENE2_AFTER_TRIAL_FORM[lang], ok, '');
}

function onEnrollFormSubmitJaTicket(e) { handleEnrollFormSubmit_(e, 'ja'); }
function onEnrollFormSubmitJaMonthly(e) { handleEnrollFormSubmit_(e, 'ja'); }
function onEnrollFormSubmitSharedTicket(e) { handleEnrollFormSubmit_(e, extractFormLanguage_(e)); }
function onEnrollFormSubmitSharedMonthly(e) { handleEnrollFormSubmit_(e, extractFormLanguage_(e)); }

function handleEnrollFormSubmit_(e, lang) {
  const userId = extractUserId_(e);
  if (!userId) {
    Logger.log('userId取得失敗（シーン4・' + lang + '）。フォームの「LINE ID」質問を確認してください。');
    return;
  }
  if (!mayAutoSendOnFormSubmit_(userId)) {
    logRow_(userId, 'skipped_known_customer_enroll_form', '', true, '要対応');
    return;
  }
  const keyword = 'scene4_welcome_' + lang;
  if (alreadyHandled_(userId, keyword)) {
    Logger.log('入会案内は送信済みのためスキップ: ' + userId);
    return;
  }
  const ok = pushMessage_(userId, SCENE4_WELCOME[lang]);
  logRow_(userId, keyword, SCENE4_WELCOME[lang], ok, '');
}

/**
 * フォーム回答からLINEユーザーIDを取り出す。
 * 質問タイトルの表記ゆれに耐えるよう、複数の呼び方を許容する。
 * 体験フォームの回答シートでは列名が「LINE ID」になっている。
 */
function extractUserId_(e) {
  const values = (e && e.namedValues) || {};
  const candidates = ['システム用ID', 'system id', 'systemid', 'line id', 'lineid', 'line_id'];
  const key = Object.keys(values).find(function (k) {
    const norm = k.toLowerCase().replace(/\s+/g, ' ').trim();
    return candidates.some(function (c) { return norm.indexOf(c) !== -1; });
  });
  if (!key) return null;
  const v = values[key][0];
  return v ? v.toString().trim() : null;
}

/**
 * フォーム内「Language」質問の回答から言語コードを判定する。
 * 選択肢: 日本語 / English / ภาษาไทย
 */
function extractFormLanguage_(e) {
  const values = (e && e.namedValues) || {};
  const key = Object.keys(values).find(function (k) {
    return k.trim().toLowerCase() === 'language';
  });
  const answer = key ? values[key][0] : '';

  if (answer.indexOf('日本語') !== -1) return 'ja';
  if (answer.indexOf('ไทย') !== -1) return 'th';
  return 'en';
}

/* ============================================================
 * スタッフ操作
 * ============================================================ */

/**
 * 入力されたLINEユーザーIDを整える。
 *
 * スプレッドシートのセルはIDを折り返して表示するため、コピーすると
 * 途中に改行や空白が紛れ込むことがある。前後だけでなく**内部の空白も**
 * 取り除かないと、LINEが `The property, 'to', in the request body is invalid`
 * を返して送信に失敗する。
 */
function normalizeUserId_(raw) {
  return (raw || '').toString().replace(/\s+/g, '');
}

/** LINEのユーザーIDは U に続く32桁の16進数。 */
function isValidUserId_(userId) {
  return /^U[0-9a-f]{32}$/i.test(userId);
}

/* ============================================================
 * 手動送信
 * ============================================================
 * 自動送信を止めているお客様には、ここから人が選んで送る。
 * 送る相手も文面も人が決めているので、禁止リストは見ない。
 */

/** ユーザーIDを尋ねて整える。取り消しや形式違いなら null。 */
function promptUserId_(ui) {
  const resp = ui.prompt('LINEユーザーIDを入力してください');
  if (resp.getSelectedButton() !== ui.Button.OK) return null;
  const userId = normalizeUserId_(resp.getResponseText());
  if (!userId) return null;
  if (!isValidUserId_(userId)) {
    ui.alert(
      'LINEユーザーIDの形式が正しくありません。\n\n' +
      '入力された値: ' + userId + '（' + userId.length + '文字）\n\n' +
      '正しくは U で始まる33文字（Uのあと16進数32桁）です。\n' +
      'Queueシートの userId 列からセルごとコピーしてください。'
    );
    return null;
  }
  return userId;
}

/** 言語を尋ねる。table に無い言語なら null。 */
function promptLang_(ui, table) {
  const resp = ui.prompt('言語を入力してください（ja / en / th）');
  if (resp.getSelectedButton() !== ui.Button.OK) return null;
  const lang = resp.getResponseText().trim();
  if (!table[lang]) {
    ui.alert('言語は ja / en / th のいずれかで入力してください。');
    return null;
  }
  return lang;
}

/**
 * 送って記録する。
 *
 * 同じ案内を送った記録があれば、送る前に確認する。二重送信は
 * 「話を聞いていない」という印象になるため、黙って通さない。
 * 送ったあとは、そのお客様を自動送信の禁止リストに入れる。
 * 人が応対を始めた相手なので、以後ボットが割り込まないようにする。
 */
function sendManualAndLog_(ui, userId, keyword, text, label) {
  if (alreadyHandled_(userId, keyword)) {
    const again = ui.alert(
      'この案内は送信済みの記録があります',
      label + ' は既にこのお客様へ送られています。\nもう一度送りますか？',
      ui.ButtonSet.YES_NO
    );
    if (again !== ui.Button.YES) return;
  }

  const ok = pushMessage_(userId, text);
  if (ok) {
    logRow_(userId, keyword, text, true, '');
    blockAutoReply_(userId, '手動で' + label + 'を送信');
  }
  ui.alert(ok
    ? label + 'を送信しました。\nこのお客様には今後ボットから自動送信されません。'
    : '送信に失敗しました。ログを確認してください。');
}

/** シーン2：体験フォーム送信後の持ち物案内。 */
function sendScene2Manual() {
  const ui = SpreadsheetApp.getUi();
  const userId = promptUserId_(ui);
  if (!userId) return;
  const lang = promptLang_(ui, SCENE2_AFTER_TRIAL_FORM);
  if (!lang) return;

  sendManualAndLog_(ui, userId, 'scene2_after_trial_form_' + lang,
    SCENE2_AFTER_TRIAL_FORM[lang], '持ち物案内');
}

/** シーン4：入会後のBand招待。 */
function sendScene4Manual() {
  const ui = SpreadsheetApp.getUi();
  const userId = promptUserId_(ui);
  if (!userId) return;
  const lang = promptLang_(ui, SCENE4_WELCOME);
  if (!lang) return;

  sendManualAndLog_(ui, userId, 'scene4_welcome_' + lang,
    SCENE4_WELCOME[lang], 'Band招待');
}

function sendScene3Manual() {
  const ui = SpreadsheetApp.getUi();

  const userId = promptUserId_(ui);
  if (!userId) return;

  const lang = promptLang_(ui, SCENE3_AFTER_TRIAL_LESSON);
  if (!lang) return;

  // タイ語は語尾が話し手の性別で変わるため、送信するスタッフの性別を尋ねる。
  let gender = '';
  if (scene3NeedsGender_(lang)) {
    const genderResp = ui.prompt(
      '送信するご自身の性別を入力してください\n' +
      '女性なら f（語尾は ค่ะ / นะคะ）、男性なら m（語尾は ครับ / นะครับ）'
    );
    if (genderResp.getSelectedButton() !== ui.Button.OK) return;
    const answer = genderResp.getResponseText().trim().toLowerCase();
    if (answer === 'f' || answer === 'female' || answer === '女' || answer === '女性') {
      gender = 'female';
    } else if (answer === 'm' || answer === 'male' || answer === '男' || answer === '男性') {
      gender = 'male';
    } else {
      ui.alert('性別は f（女性）または m（男性）で入力してください。');
      return;
    }
  }

  const forms = ENROLL_FORMS[lang];
  const text = resolveScene3Body_(lang, gender)
    .replace('{{TICKET_LINK}}', buildPrefilledFormLink_(forms.ticket.url, forms.ticket.entryId, userId))
    .replace('{{MONTHLY_LINK}}', buildPrefilledFormLink_(forms.monthly.url, forms.monthly.entryId, userId));

  const keyword = 'scene3_after_trial_lesson_' + lang + (gender ? '_' + gender : '');
  sendManualAndLog_(ui, userId, keyword, text, '体験後のお礼');
}

// 旧 addKnownContact() は stopAutoReplyForContact() に置き換えた。
// 登録先を2つにしておくと、片方にだけ入れて安心してしまう。
// 既存の KnownContacts シートの中身は isAutoReplyBlocked_() が今も見ている。

/** このお客様への自動送信を止める。人が応対した相手に使う。 */
function stopAutoReplyForContact() {
  const ui = SpreadsheetApp.getUi();

  const resp = ui.prompt('自動送信を止めるLINEユーザーIDを入力してください');
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const userId = normalizeUserId_(resp.getResponseText());
  if (!userId) return;
  if (!isValidUserId_(userId)) {
    ui.alert(
      'LINEユーザーIDの形式が正しくありません。\n\n' +
      '入力された値: ' + userId + '（' + userId.length + '文字）\n\n' +
      '正しくは U で始まる33文字です。Queueシートの userId 列からコピーしてください。'
    );
    return;
  }

  const memoResp = ui.prompt('理由やお名前（任意）');
  const memo = memoResp.getSelectedButton() === ui.Button.OK ? memoResp.getResponseText().trim() : '';

  blockAutoReply_(userId, memo || '手動で登録');
  ui.alert('登録しました。このお客様には今後どのトリガーでも自動送信されません。\n' + userId);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ASAツール')
    .addItem('① 持ち物案内を送信（体験フォーム記入後）', 'sendScene2Manual')
    .addItem('② 体験後のお礼を送信（入会案内つき）', 'sendScene3Manual')
    .addItem('③ Band招待を送信（入会フォーム記入後）', 'sendScene4Manual')
    .addSeparator()
    .addItem('このお客様への自動送信を止める', 'stopAutoReplyForContact')
    .addItem('過去にやり取りのある方の自動送信を止める（初回のみ）', 'markPastContactsAsExisting')
    .addItem('自動送信の状況を確認', 'countBlockedContacts')
    .addSeparator()
    .addItem('設定を確認', 'checkProperties')
    .addToUi();
}

/* ============================================================
 * セットアップ・診断
 * ============================================================ */

function setupHourlyTrigger() {
  const oldFunctions = [
    'process00', 'process02', 'process04', 'process06',
    'process08', 'process10', 'process12', 'process14',
    'process16', 'process18', 'process20', 'process22',
    'processQueue'
  ];

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (oldFunctions.indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('processQueue').timeBased().everyHours(1).create();
  Logger.log('1時間おきのトリガーを登録しました（旧トリガーは削除済み）。');
}

function setupFormTriggers() {
  const targets = [
    { formId: '1im84mMXHDZEfFxJFOUtpP3CzqA6zhefK6wSo5CfEr0E', fn: 'onTrialFormSubmit' },
    { formId: '1EBIzXLmgD_5zR_Z5hjv5Mp9C1nfAvgdaBb7X69J8Lkw', fn: 'onEnrollFormSubmitJaTicket' },
    { formId: '174nE6w8R2exFaul_tzw1gn4pguXjA_abNF5u7Q_t16M', fn: 'onEnrollFormSubmitJaMonthly' },
    { formId: '1ryQ8Fy_nRmfnqpDv-Q-JK11r3xN3THSmkNQASLzakCg', fn: 'onEnrollFormSubmitSharedTicket' },
    { formId: '14HrG7hB2DRMwVXnA6RPWULJXTP21Z9nxJPjR4gSIAuU', fn: 'onEnrollFormSubmitSharedMonthly' }
  ];

  targets.forEach(function (t) {
    ScriptApp.getProjectTriggers().forEach(function (tr) {
      if (tr.getHandlerFunction() === t.fn) ScriptApp.deleteTrigger(tr);
    });
    try {
      const form = FormApp.openById(t.formId);
      ScriptApp.newTrigger(t.fn).forForm(form).onFormSubmit().create();
      Logger.log('登録成功: ' + t.fn + '（' + form.getTitle() + '）');
    } catch (err) {
      Logger.log('登録失敗: ' + t.fn + '（' + t.formId + '）エラー: ' + err.message);
    }
  });

  Logger.log('setupFormTriggers 完了。「登録成功」が5件出ているか確認してください。');
}

/**
 * 設定の確認。トークンは先頭と末尾のみ表示する。
 */
function checkProperties() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const token = props[PROP_TOKEN];
  const sheetId = props[PROP_SHEET_ID];

  Logger.log(PROP_TOKEN + ': ' +
    (token ? token.slice(0, 4) + '...' + token.slice(-4) + '（' + token.length + '文字）' : '★未設定'));
  Logger.log(PROP_SHEET_ID + ': ' + (sheetId || '★未設定'));
}

/**
 * スケジュール画像のURLを確認する。画像を差し替えたら必ず実行すること。
 *
 * LINEに送る前にここで弾いておかないと、URLが切れていることに
 * 気づくのがお客様に届かなかったときになる。
 */
function testScheduleImages() {
  ['ja', 'en', 'th'].forEach(function (lang) {
    const url = SCENE1_SCHEDULE_IMAGE[lang];
    if (!url) {
      Logger.log(lang + ': 未設定（この言語では画像を送りません）');
      return;
    }
    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      const code = res.getResponseCode();
      const type = res.getHeaders()['Content-Type'] || res.getHeaders()['content-type'] || '不明';
      const kb = Math.round(res.getBlob().getBytes().length / 1024);
      const okType = type.indexOf('image/jpeg') !== -1 || type.indexOf('image/png') !== -1;

      if (code === 200 && okType && kb <= 1024) {
        Logger.log(lang + ': OK（' + type + ' / ' + kb + 'KB）');
      } else {
        Logger.log(lang + ': ★要確認 HTTP ' + code + ' / ' + type + ' / ' + kb + 'KB');
        if (!okType) Logger.log('   → JPEGかPNGである必要があります。');
        if (kb > 1024) Logger.log('   → プレビュー用の上限1MBを超えています。縮小してください。');
      }
    } catch (err) {
      Logger.log(lang + ': ★取得できません（' + err.message + '）');
    }
  });
  Logger.log('3言語とも OK なら、次の問い合わせから画像が添付されます。');
}

/**
 * 現在の友だち全員を「既存のお客様」として自動送信の禁止リストに入れる。
 *
 * ★ 貼り替えた直後に一度だけ実行すること。
 *
 * これを実行するまで、既存のお客様は「初めてメッセージをくれた人」と
 * 区別できない。実行しておけば、いま友だちである全員が保護される。
 * 以後に友だち追加した人だけが自動送信の対象になる。
 *
 * 友だち一覧の取得APIが使えないアカウントの場合は失敗する。その場合でも
 * mayAutoSend_() が「友だち追加の記録がない人には送らない」と判断するので、
 * 既存のお客様に初回案内が飛ぶことはない。
 */
function markAllCurrentFollowersAsExisting() {
  const token = getChannelAccessToken_();
  const sheet = getNoAutoReplySheet_();

  const existing = {};
  sheet.getDataRange().getValues().slice(1).forEach(function (row) {
    existing[row[0]] = true;
  });

  let url = 'https://api.line.me/v2/bot/followers/ids?limit=1000';
  let added = 0;
  let seen = 0;
  const now = new Date();
  const rows = [];

  for (let page = 0; page < 50; page++) {
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      Logger.log('★友だち一覧を取得できません (HTTP ' + code + '): ' + res.getContentText());
      Logger.log('このアカウントでは一覧APIが使えない可能性があります。');
      Logger.log('その場合でも、友だち追加を記録していない相手には自動送信しない' +
                 '仕組みが働くので、既存のお客様に初回案内が飛ぶことはありません。');
      break;
    }

    const body = JSON.parse(res.getContentText());
    const ids = body.userIds || [];
    ids.forEach(function (id) {
      seen++;
      if (!existing[id]) {
        existing[id] = true;
        rows.push([id, '一括登録：この設定より前からの友だち', now]);
        added++;
      }
    });

    if (!body.next) break;
    url = 'https://api.line.me/v2/bot/followers/ids?limit=1000&start=' + body.next;
  }

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
  }

  Logger.log('友だち ' + seen + '件を確認し、' + added + '件を禁止リストに追加しました。');
  Logger.log('この' + added + '名には、今後どのトリガーでも自動送信されません。');
}

/**
 * これまでに一度でもやり取りのあったお客様を、まとめて禁止リストに入れる。
 *
 * ★ markAllCurrentFollowersAsExisting() が 403 で使えないアカウント向け。
 *   貼り替えた直後に一度だけ実行すること。
 *
 * 友だち一覧APIは認証済みアカウントでないと使えない（403）。代わりに
 * 手元のシートを使う。Queue と UserLang に載っているユーザーIDは、
 * 過去にこのアカウントへ連絡をくれた実在のお客様なので、
 * 「初めての人」ではないと言い切れる。
 *
 * これで守れないのは「友だち追加だけして一度も連絡をくれていない人」。
 * その方が今後メッセージをくれたときは mayAutoSend_() が
 * 友だち追加の記録がないことに気づいて止めるので、そちらで拾える。
 */
function markPastContactsAsExisting() {
  const sheet = getNoAutoReplySheet_();

  const existing = {};
  sheet.getDataRange().getValues().slice(1).forEach(function (row) {
    existing[row[0]] = true;
  });

  const found = {};
  getQueueSheet_().getDataRange().getValues().slice(1).forEach(function (row) {
    const id = (row[1] || '').toString().trim();
    if (id) found[id] = true;
  });
  getUserLangSheet_().getDataRange().getValues().slice(1).forEach(function (row) {
    const id = (row[0] || '').toString().trim();
    if (id) found[id] = true;
  });

  const now = new Date();
  const rows = [];
  Object.keys(found).forEach(function (id) {
    if (!existing[id]) {
      rows.push([id, '一括登録：過去にやり取りのあったお客様', now]);
    }
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
  }

  Logger.log('過去のやり取り ' + Object.keys(found).length + '名を確認し、' +
             rows.length + '名を禁止リストに追加しました。');
  Logger.log('この方々には、今後どのトリガーでも自動送信されません。');
}

/** いま自動送信が止まっている人数を数える。 */
function countBlockedContacts() {
  const n = Math.max(0, getNoAutoReplySheet_().getLastRow() - 1);
  const f = Math.max(0, getFollowersSheet_().getLastRow() - 1);
  Logger.log('自動送信を止めているお客様: ' + n + '名');
  Logger.log('友だち追加を記録できているお客様: ' + f + '名（この方々だけが自動送信の対象）');
}

function testSheetAccess() {
  const data = getQueueSheet_().getDataRange().getValues();
  Logger.log('Queueシート アクセスOK。現在の行数: ' + data.length);
}

function debugListSheetNames() {
  const ss = getSpreadsheet_();
  Logger.log('スプレッドシート名: ' + ss.getName());
  ss.getSheets().forEach(function (s) {
    Logger.log('シート名: [' + s.getName() + ']（' + s.getName().length + '文字）');
  });
}
