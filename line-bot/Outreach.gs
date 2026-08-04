/**
 * Advance Sports Academy — 学校向け営業メールの差し込み送信
 *
 * ============================================================
 * これは何か
 * ============================================================
 * スプレッドシートの `Outreach` タブに並べた学校リストを読み、
 * 学校名を差し込んだ営業メールを日本語・英語・タイ語で送る。
 *
 * ★ 既定は「送信しない」。DRY_RUN を false にするまで1通も出ない。
 *   対外的な一斉送信は、間違えたときの損害が大きい。まず空撃ちで
 *   宛先と本文を目で確かめてから本番に切り替えること。
 *
 * ============================================================
 * Outreach シートの列
 * ============================================================
 *   A: schoolName  … 差し込む学校名（本文の「◯◯校」に入る）
 *   B: email       … 送信先。空欄の行は自動でスキップ
 *   C: lang        … ja / en / th
 *   D: contact     … 担当部署や担当者名（任意。メモ用途）
 *   E: status      … 空欄=未送信 / sent / skipped / error
 *   F: sentAt      … 送信日時
 *   G: note        … エラー内容や備考
 *
 * ============================================================
 * 実行の順序
 * ============================================================
 *   1. setupOutreachSheet()   … シートを用意する（初回のみ）
 *   2. 学校名とアドレスを人が入力する
 *   3. previewOutreach()      … 1通目の本文を実物どおりに確認
 *   4. sendOutreachBatch()    … DRY_RUN=true のまま実行し、ログを確認
 *   5. DRY_RUN を false にして sendOutreachBatch() を実行（本番）
 */

/* ============================================================
 * 安全装置
 * ============================================================ */

/** true の間は1通も送らず、ログに出すだけ。本番前に必ず空撃ちすること。 */
const DRY_RUN = true;

/** 1回の実行で送る上限。Gmailの1日あたり上限に当てないための刻み。 */
const BATCH_SIZE = 40;

/** 送信元の表示名。受け取る側に誰からか一目で分かるようにする。 */
const SENDER_NAME = 'Advance Sports Academy — Seiya Kojima';

const SHEET_OUTREACH = 'Outreach';
const OUTREACH_HEADER =
  ['schoolName', 'email', 'lang', 'contact', 'status', 'sentAt', 'note'];

/* ============================================================
 * 文面（{{SCHOOL}} に学校名が入る）
 * ============================================================
 * 文面を直すときはこのブロックだけを触ればよい。
 */

const OUTREACH_SUBJECT = {
  ja: '【ご案内】U-12サッカー大会「KOJIMA JAPAN CUP」ご参加のお願い（9/20開催・優勝チームは日本遠征へご招待）',
  en: 'Invitation: KOJIMA JAPAN CUP — U-12 Football Tournament, 20 September (Champions Travel to Japan)',
  th: 'ขอเรียนเชิญเข้าร่วมการแข่งขันฟุตบอล U-12 "KOJIMA JAPAN CUP" (20 ก.ย. 2569 — ทีมชนะเลิศได้เดินทางไปญี่ปุ่น)'
};

const ENTRY_FORM_URL = 'https://forms.gle/bSqwo5V5fKJ23pAN7';

const OUTREACH_BODY = {
  ja: [
    '{{SCHOOL}} ご担当者様',
    '',
    '突然のご連絡失礼いたします。バンコクにて子ども向けスポーツアカデミーを運営しております Advance Sports Academy の小島聖矢と申します。元Jリーグ選手として、現在はタイの子どもたちの育成に取り組んでおります。',
    '',
    'このたび、タイのU-12世代を対象としたサッカー大会「KOJIMA JAPAN CUP」を開催する運びとなりました。貴校のチームにぜひご参加いただきたく、ご案内を差し上げます。',
    '',
    'この大会の最大の特徴は、優勝チームを日本へご招待することです。埼玉県で開催される「宇賀神カップ」（主催：宇賀神友弥氏／元浦和レッズ・現浦和レッズU21責任者）に出場し、日本各地の強豪30チームと本気の勝負を経験していただきます。滞在中はJ1リーグの試合観戦、プロが使用する施設でのトレーニング、東京・埼玉の観光も予定しております。',
    '',
    'この日本遠征にかかる費用は、渡航費・宿泊費・大会参加費を含め、すべて主催者が負担いたします。選手12名とコーチ2名の計14名をご招待します。',
    '',
    '■ 大会概要',
    '　日時　　　2026年9月20日（日）9:00開始（8:30受付）',
    '　会場　　　Versus Stadium（The Corner FC）',
    '　対象　　　U-12（2014年生まれ以降）',
    '　形式　　　7人制・全試合ノックアウト（同点時はPK戦）',
    '　登録　　　選手12名＋コーチ2名',
    '　定員　　　32チーム（先着順）',
    '　参加費　　3,000バーツ／1チーム',
    '　申込締切　2026年8月31日（月）',
    '',
    '■ 貴校にとってのメリット',
    '',
    '生徒が国際基準の真剣勝負を経験できること、そして勝ち上がれば日本でのトレーニングと試合という、通常では得がたい機会を無償で得られることです。海外遠征は保護者の負担が大きく実現しにくいものですが、本大会では優勝チームに限りその負担がありません。',
    '',
    'また、本大会はタイと日本のサッカー界をつなぐ架け橋となることを目的としており、貴校のご参加は生徒の成長のみならず、学校としての国際交流の実績にもつながるものと考えております。',
    '',
    '■ お申し込み',
    '',
    '定員は32チームのみです。下記フォームより、お早めにお申し込みください。',
    ENTRY_FORM_URL,
    '',
    '定員に達し次第、締切前でも受付を終了いたします。',
    '',
    'ご不明な点、日程のご相談、詳細資料のご希望などございましたら、お気軽にご返信ください。大会概要のパンフレット（日本語・英語・タイ語）もご用意しております。',
    '',
    '---',
    'Advance Sports Academy（ASA）',
    '代表　小島 聖矢',
    'Email: seiya@asa-th.com / Tel: 080-9691-0860 / Instagram: @asabangkok',
    '',
    '※ 今後のご案内が不要な場合は、その旨ご返信ください。以後お送りいたしません。'
  ].join('\n'),

  en: [
    'Dear {{SCHOOL}},',
    '',
    'My name is Seiya Kojima, Director of Advance Sports Academy (ASA), a youth sports academy here in Bangkok. As a former J.League professional, I now devote my time to developing young players in Thailand.',
    '',
    'I am writing to invite your school to take part in the KOJIMA JAPAN CUP, a U-12 football tournament we are hosting this September.',
    '',
    'What makes this tournament different is that the champions travel to Japan. The winning team will be invited to compete in the Ugajin Cup in Saitama, hosted by Tomoya Ugajin — former Urawa Reds player and current head of the Urawa Reds U21 squad — against 30 of the strongest teams from across Japan. The trip also includes watching a J1 League match at the stadium, training at professional facilities, and sightseeing in Tokyo and Saitama.',
    '',
    'Every cost of this trip — flights, accommodation and tournament fees — is covered in full by the organisers. We will host 12 players and 2 coaches.',
    '',
    'Tournament details',
    '  Date            Sunday 20 September 2026, 9:00 kick-off (registration from 8:30)',
    '  Venue           Versus Stadium (The Corner FC)',
    '  Category        U-12 (born 2014 or later)',
    '  Format          7-a-side, full knockout (penalties decide a draw)',
    '  Squad           12 players + 2 coaches',
    '  Capacity        32 teams (first come, first served)',
    '  Entry fee       3,000 THB per team',
    '  Entry deadline  Monday 31 August 2026',
    '',
    'Why this may interest your school',
    '',
    'Your students get to compete at a genuinely international standard, and if they win, they receive training and matches in Japan at no cost to their families. Overseas trips are usually out of reach for most parents; for the champion team here, that barrier does not exist.',
    '',
    'The tournament also exists to build a bridge between Thai and Japanese football. Your school\'s participation would contribute not only to your students\' development, but to your record of international exchange.',
    '',
    'How to enter',
    '',
    'Only 32 places are available. Please register early using the form below.',
    ENTRY_FORM_URL,
    '',
    'Entries close as soon as the tournament is full, even before the deadline.',
    '',
    'If you have any questions, would like to discuss scheduling, or would like the full tournament brochure (available in Japanese, English and Thai), please reply to this email — I would be glad to help.',
    '',
    '---',
    'Advance Sports Academy (ASA)',
    'Seiya Kojima, Director',
    'Email: seiya@asa-th.com / Tel: 080-9691-0860 / Instagram: @asabangkok',
    '',
    'If you would prefer not to receive further messages from us, simply reply and we will not write again.'
  ].join('\n'),

  th: [
    'เรียน {{SCHOOL}}',
    '',
    'ผมขออนุญาตแนะนำตัวครับ ผมชื่อ เซยะ โคจิมะ (Seiya Kojima) ผู้อำนวยการ Advance Sports Academy (ASA) อคาเดมีกีฬาสำหรับเด็กในกรุงเทพฯ ผมเคยเป็นนักฟุตบอลอาชีพในลีก J.League ของญี่ปุ่น และปัจจุบันทุ่มเทให้กับการพัฒนานักฟุตบอลเยาวชนในประเทศไทยครับ',
    '',
    'ในครั้งนี้ ทางเราจะจัดการแข่งขันฟุตบอลรุ่น U-12 ชื่อ "KOJIMA JAPAN CUP" ขึ้น จึงขอเรียนเชิญทีมของโรงเรียนท่านเข้าร่วมการแข่งขันครับ',
    '',
    'จุดเด่นที่สุดของรายการนี้คือ ทีมชนะเลิศจะได้เดินทางไปประเทศญี่ปุ่นครับ ทีมแชมป์จะได้รับเชิญไปแข่งขันในรายการ "อุกะจิน คัพ" (Ugajin Cup) ที่จังหวัดไซตามะ ซึ่งจัดโดยคุณโทโมยะ อุกะจิน อดีตนักเตะทีม Urawa Reds และปัจจุบันเป็นผู้ดูแลทีม Urawa Reds U21 โดยจะได้ลงแข่งกับทีมชั้นนำจากทั่วประเทศญี่ปุ่นกว่า 30 ทีม นอกจากนี้ยังมีการชมการแข่งขัน J1 League ที่สนามจริง การฝึกซ้อมในสนามระดับมืออาชีพ และการท่องเที่ยวในโตเกียวและไซตามะครับ',
    '',
    'ค่าใช้จ่ายในการเดินทางครั้งนี้ ทั้งค่าตั๋วเครื่องบิน ค่าที่พัก และค่าสมัครแข่งขัน ทางผู้จัดเป็นผู้รับผิดชอบทั้งหมดครับ โดยจะเชิญนักกีฬา 12 คน และโค้ช 2 คน รวม 14 ท่าน',
    '',
    'รายละเอียดการแข่งขัน',
    '  วันที่          วันอาทิตย์ที่ 20 กันยายน 2569 เริ่มแข่ง 09:00 น. (ลงทะเบียน 08:30 น.)',
    '  สถานที่        Versus Stadium (The Corner FC)',
    '  รุ่นอายุ         U-12 (เกิดปี พ.ศ. 2557 หรือหลังจากนั้น)',
    '  รูปแบบ         ฟุตบอล 7 คน แบบน็อกเอาต์ทุกนัด (เสมอตัดสินด้วยการยิงจุดโทษ)',
    '  จำนวนผู้เล่น   นักกีฬา 12 คน + โค้ช 2 คน',
    '  จำนวนทีม      32 ทีม (ตามลำดับการสมัคร)',
    '  ค่าสมัคร       3,000 บาท ต่อทีม',
    '  ปิดรับสมัคร    วันจันทร์ที่ 31 สิงหาคม 2569',
    '',
    'ประโยชน์ที่โรงเรียนของท่านจะได้รับ',
    '',
    'นักเรียนจะได้สัมผัสการแข่งขันจริงจังในระดับสากล และหากคว้าแชมป์ได้ ก็จะได้ฝึกซ้อมและลงแข่งขันที่ประเทศญี่ปุ่นโดยที่ผู้ปกครองไม่ต้องรับภาระค่าใช้จ่ายเลยครับ โดยปกติแล้วการเดินทางไปแข่งต่างประเทศเป็นภาระที่หนักสำหรับผู้ปกครอง แต่สำหรับทีมชนะเลิศของรายการนี้ ภาระดังกล่าวจะไม่เกิดขึ้นครับ',
    '',
    'อีกทั้งการแข่งขันนี้มีเป้าหมายเพื่อเป็นสะพานเชื่อมวงการฟุตบอลไทยและญี่ปุ่น การเข้าร่วมของโรงเรียนท่านจึงไม่เพียงส่งเสริมพัฒนาการของนักเรียน แต่ยังเป็นผลงานด้านการแลกเปลี่ยนระหว่างประเทศของโรงเรียนอีกด้วยครับ',
    '',
    'วิธีการสมัคร',
    '',
    'รับจำกัดเพียง 32 ทีมเท่านั้นครับ กรุณาสมัครผ่านลิงก์ด้านล่างแต่เนิ่นๆ',
    ENTRY_FORM_URL,
    '',
    'หากมีทีมสมัครครบตามจำนวนแล้ว ทางเราจะปิดรับสมัครทันที แม้ยังไม่ถึงกำหนดปิดรับก็ตามครับ',
    '',
    'หากท่านมีข้อสงสัย ต้องการปรึกษาเรื่องกำหนดการ หรือต้องการโบรชัวร์รายละเอียดการแข่งขัน (มีทั้งภาษาไทย อังกฤษ และญี่ปุ่น) สามารถตอบกลับอีเมลฉบับนี้ได้เลยครับ ยินดีให้ข้อมูลเพิ่มเติมครับ',
    '',
    '---',
    'Advance Sports Academy (ASA)',
    'เซยะ โคจิมะ (Seiya Kojima) — ผู้อำนวยการ',
    'Email: seiya@asa-th.com / Tel: 080-9691-0860 / Instagram: @asabangkok',
    '',
    'หากไม่ประสงค์จะรับข่าวสารจากเราอีก กรุณาตอบกลับแจ้งให้ทราบ ทางเราจะไม่ส่งอีกครับ'
  ].join('\n')
};

/* ============================================================
 * シートの用意
 * ============================================================ */

function getOutreachSheet_() {
  return getOrCreateSheet_(SHEET_OUTREACH, OUTREACH_HEADER);
}

function setupOutreachSheet() {
  const sheet = getOutreachSheet_();
  sheet.setFrozenRows(1);
  Logger.log('Outreach シートを用意しました。列は ' + OUTREACH_HEADER.join(' / '));
  Logger.log('学校名・メールアドレス・言語(ja/en/th) を入力してから previewOutreach() を実行してください。');
}

/* ============================================================
 * 差し込み
 * ============================================================ */

/** 学校名を差し込んだ件名と本文を組み立てる。 */
function buildOutreachMail_(schoolName, lang) {
  const body = OUTREACH_BODY[lang];
  const subject = OUTREACH_SUBJECT[lang];
  if (!body || !subject) return null;
  return {
    subject: subject,
    body: body.split('{{SCHOOL}}').join(schoolName)
  };
}

/**
 * 送信できる行かどうかを判定し、駄目な理由を返す。
 * 判定を1か所に集めておくと、空撃ちと本番で挙動がずれない。
 */
function outreachRowIssue_(row) {
  const schoolName = (row[0] || '').toString().trim();
  const email = (row[1] || '').toString().trim();
  const lang = (row[2] || '').toString().trim().toLowerCase();
  const status = (row[4] || '').toString().trim().toLowerCase();

  if (status === 'sent') return '送信済み';
  if (status === 'skipped') return '除外指定';
  if (!schoolName) return '学校名が空';
  if (!email) return 'メールアドレスが空';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'メールアドレスの形式が不正: ' + email;
  if (['ja', 'en', 'th'].indexOf(lang) === -1) return '言語は ja / en / th のいずれかにしてください: ' + lang;
  return null;
}

/** 1通目の本文をそのまま表示する。送信前に必ず目で確かめるため。 */
function previewOutreach() {
  const data = getOutreachSheet_().getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const issue = outreachRowIssue_(data[i]);
    if (issue) continue;

    const schoolName = data[i][0].toString().trim();
    const lang = data[i][2].toString().trim().toLowerCase();
    const mail = buildOutreachMail_(schoolName, lang);

    Logger.log('--- 送信対象の1通目（' + (i + 1) + '行目）---');
    Logger.log('宛先: ' + data[i][1]);
    Logger.log('言語: ' + lang);
    Logger.log('件名: ' + mail.subject);
    Logger.log('本文:\n' + mail.body);
    return;
  }
  Logger.log('送信できる行がありません。学校名・アドレス・言語が入っているか確認してください。');
}

/* ============================================================
 * 送信
 * ============================================================ */

/**
 * 未送信の行を上から順に処理する。
 *
 * DRY_RUN が true の間は1通も送らず、何を送るつもりだったかをログに出す。
 * 同じアドレスが複数行にあっても、この実行内では1回しか送らない。
 */
function sendOutreachBatch() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('別の処理が実行中のため中止しました。');
    return;
  }

  try {
    const sheet = getOutreachSheet_();
    const data = sheet.getDataRange().getValues();

    // 送信済みのアドレスを先に集める。行が重複していても二重送信しない。
    const alreadySent = {};
    for (let i = 1; i < data.length; i++) {
      if ((data[i][4] || '').toString().trim().toLowerCase() === 'sent') {
        alreadySent[(data[i][1] || '').toString().trim().toLowerCase()] = true;
      }
    }

    let sent = 0;
    let skipped = 0;
    const now = new Date();

    for (let i = 1; i < data.length && sent < BATCH_SIZE; i++) {
      const rowNumber = i + 1;
      const issue = outreachRowIssue_(data[i]);

      if (issue) {
        if (issue !== '送信済み' && issue !== '除外指定') {
          Logger.log(rowNumber + '行目 スキップ: ' + issue);
          skipped++;
        }
        continue;
      }

      const schoolName = data[i][0].toString().trim();
      const email = data[i][1].toString().trim();
      const lang = data[i][2].toString().trim().toLowerCase();

      if (alreadySent[email.toLowerCase()]) {
        Logger.log(rowNumber + '行目 スキップ: 同じアドレスへ送信済み ' + email);
        sheet.getRange(rowNumber, 5).setValue('skipped');
        sheet.getRange(rowNumber, 7).setValue('重複アドレス');
        skipped++;
        continue;
      }

      const mail = buildOutreachMail_(schoolName, lang);

      if (DRY_RUN) {
        Logger.log('[空撃ち] ' + email + ' / ' + lang + ' / ' + schoolName +
                   ' / 件名: ' + mail.subject.slice(0, 40) + '…');
        sent++;
        continue;
      }

      try {
        GmailApp.sendEmail(email, mail.subject, mail.body, { name: SENDER_NAME });
        sheet.getRange(rowNumber, 5).setValue('sent');
        sheet.getRange(rowNumber, 6).setValue(now);
        alreadySent[email.toLowerCase()] = true;
        sent++;
        Logger.log('送信 ' + email + ' / ' + schoolName);
        Utilities.sleep(1200); // 一気に叩かず間隔を空ける
      } catch (err) {
        sheet.getRange(rowNumber, 5).setValue('error');
        sheet.getRange(rowNumber, 7).setValue(err.message);
        Logger.log('★ 送信失敗 ' + email + ' : ' + err.message);
      }
    }

    Logger.log('--- 完了 ---');
    Logger.log((DRY_RUN ? '空撃ち（1通も送っていません）' : '本番送信') +
               ' 対象 ' + sent + '件 / スキップ ' + skipped + '件');

    if (DRY_RUN) {
      Logger.log('本番で送るには、コード先頭の DRY_RUN を false に変えてから再実行してください。');
    } else {
      Logger.log('残りの未送信分は、もう一度この関数を実行すると続きから送られます。');
      Logger.log('Gmailの1日あたり送信上限に注意してください（Workspace 2,000通 / 無料アカウント 500通）。');
    }
  } finally {
    lock.releaseLock();
  }
}

/** 送信状況の集計。どこまで進んだかを確認する。 */
function outreachStatus() {
  const data = getOutreachSheet_().getDataRange().getValues();
  const count = { sent: 0, error: 0, skipped: 0, pending: 0 };

  for (let i = 1; i < data.length; i++) {
    const schoolName = (data[i][0] || '').toString().trim();
    if (!schoolName) continue;
    const status = (data[i][4] || '').toString().trim().toLowerCase();
    if (status === 'sent') count.sent++;
    else if (status === 'error') count.error++;
    else if (status === 'skipped') count.skipped++;
    else count.pending++;
  }

  Logger.log('送信済み ' + count.sent + ' / 未送信 ' + count.pending +
             ' / 失敗 ' + count.error + ' / 除外 ' + count.skipped);
  if (count.error) Logger.log('★ 失敗した行は note 列に理由が入っています。');
}
