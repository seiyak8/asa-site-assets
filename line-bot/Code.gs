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
 * 言語判定
 * ============================================================ */

/**
 * 明示的な言語切替の合図。利用者がこれを送れば以後その言語で応対する。
 */
const LANG_SWITCH = [
  { lang: 'ja', words: ['日本語'] },
  { lang: 'en', words: ['English', 'english'] },
  { lang: 'th', words: ['ภาษาไทย', 'ไทย'] }
];

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
 * 言語を決める。強い手がかりから順に見る。
 *   1. 明示的な切替の合図（「日本語」「English」「ภาษาไทย」）
 *   2. 文字種（タイ文字 → th、かな → ja）
 *   3. 過去にこの利用者と使った言語
 *   4. 漢字のみ → ja
 *   5. どれでもなければ en
 *
 * 3 を 4 より先に見るのが要点。タイ在住の方が英語で書いてくることは多く、
 * 一度タイ語で会話した相手には以後もタイ語で応対したい。
 */
function detectLanguage_(text, userId) {
  for (const entry of LANG_SWITCH) {
    for (const w of entry.words) {
      if (text.indexOf(w) !== -1) return entry.lang;
    }
  }
  if (/[฀-๿]/.test(text)) return 'th';
  if (/[぀-ヿ]/.test(text)) return 'ja';

  const stored = userId ? getStoredLang_(userId) : null;
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

const SCENE1_TRIAL_INQUIRY = {
  ja: {
    keywords: [
      'はじめまして', '初めまして', 'こんにちは', '日本語',
      '体験', 'たいけん', 'トライアル', '申し込み', '申込', 'もうしこみ',
      '入会', 'レッスン', 'クラス', '見学', '習い事',
      'サッカー', '体操', '陸上', '教室'
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
      'English', 'hello', 'hi', 'trial', 'apply', 'application',
      'join', 'class', 'classes', 'lesson', 'lessons', 'enroll', 'register',
      'interested', 'football', 'soccer', 'gymnastics', 'athletics', 'academy',
      'price', 'fee', 'fees', 'cost', 'schedule'
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
      'ภาษาไทย', 'ไทย', 'สวัสดี', 'ทดลอง', 'สมัคร', 'สนใจ', 'เรียน',
      'คลาส', 'ราคา', 'ค่าเรียน', 'ตาราง', 'ฟุตบอล', 'ยิมนาสติก', 'กรีฑา'
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

const FORM_COMPLETION_KEYWORDS = {
  ja: ['完了', '送信しました', '送りました', '提出しました', '入力しました', '記入しました'],
  en: ['completed', 'submitted', 'finished the form', 'done with the form', 'filled out', 'filled in'],
  th: ['เสร็จ', 'ส่งแล้ว', 'กรอกแล้ว']
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

const ESCALATION_KEYWORDS = [
  // 日本語
  '返金', '解約', '退会', 'やめたい', '辞めたい', 'キャンセル', '苦情', 'クレーム',
  '怪我', 'けが', 'ケガ', '事故', '救急', '病院', '返してほしい', '値引き', '割引',
  // English
  'refund', 'cancel', 'quit', 'withdraw', 'complaint', 'injury', 'injured',
  'accident', 'hospital', 'discount', 'money back',
  // ไทย
  'คืนเงิน', 'ยกเลิก', 'ลาออก', 'ร้องเรียน', 'บาดเจ็บ', 'อุบัติเหตุ', 'ส่วนลด'
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
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const text = event.message.text;

  const lang = detectLanguage_(text, userId);
  saveLang_(userId, lang);

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

  if (isKnownContact_(userId)) {
    Logger.log('既存顧客のためシーン1をスキップ: ' + userId);
    return;
  }

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
    const ok = replyMessage_(replyToken, replyText);
    logRow_(userId, keyword, replyText, ok, '');
  } else {
    logRow_(userId, keyword, replyText, false, '');
  }
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
  if (!replyToken) return false;
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getChannelAccessToken_() },
    payload: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: 'text', text: text }]
    }),
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

function onTrialFormSubmit(e) {
  const userId = extractUserId_(e);
  if (!userId) {
    Logger.log('userId取得失敗（シーン2）。フォームの「LINE ID」質問と、' +
               'LINEが送るリンクの事前入力設定を確認してください。');
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

function sendScene3Manual() {
  const ui = SpreadsheetApp.getUi();

  const userIdResp = ui.prompt('LINEユーザーIDを入力してください');
  if (userIdResp.getSelectedButton() !== ui.Button.OK) return;
  const userId = userIdResp.getResponseText().trim();
  if (!userId) return;

  const langResp = ui.prompt('言語を入力してください（ja / en / th）');
  if (langResp.getSelectedButton() !== ui.Button.OK) return;
  const lang = langResp.getResponseText().trim();
  if (!SCENE3_AFTER_TRIAL_LESSON[lang]) {
    ui.alert('言語は ja / en / th のいずれかで入力してください。');
    return;
  }

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
  const ok = pushMessage_(userId, text);
  if (ok) logRow_(userId, keyword, text, true, '');
  ui.alert(ok ? '送信しました。' : '送信に失敗しました。ログを確認してください。');
}

function addKnownContact() {
  const ui = SpreadsheetApp.getUi();

  const userIdResp = ui.prompt('既存顧客として登録するLINEユーザーIDを入力してください');
  if (userIdResp.getSelectedButton() !== ui.Button.OK) return;
  const userId = userIdResp.getResponseText().trim();
  if (!userId) return;

  const memoResp = ui.prompt('メモ（任意・名前など。空欄でもOK）');
  const memo = memoResp.getSelectedButton() === ui.Button.OK ? memoResp.getResponseText().trim() : '';

  getKnownContactsSheet_().appendRow([userId, memo]);
  ui.alert('登録しました: ' + userId);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ASAツール')
    .addItem('シーン3を送信（体験レッスン後のお礼）', 'sendScene3Manual')
    .addItem('既存顧客として登録（シーン1の自動案内を止める）', 'addKnownContact')
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
