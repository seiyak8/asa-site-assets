/**
 * Advance Sports Academy — Meta広告 / Instagram の実績を毎日取り込む
 *
 * ============================================================
 * これは何か
 * ============================================================
 * Meta Graph API から広告と Instagram の数字を取得し、Queue と同じ
 * スプレッドシートの `MetaAds` / `InstagramDaily` タブに日次で蓄積する。
 * 週次レポートは Google ドライブ経由でこのシートを読む。
 *
 * Windsor.ai の置き換え。無料プランではデータが返らないことが確認された
 * ため、Meta の API を直接叩く形にした。費用はかからない。
 *
 * 蓄積型にしている理由：都度問い合わせるだけだと履歴が残らない。
 * シートに貯めておけば、過去との比較や欠測の検出ができる。
 *
 * ============================================================
 * 設定：スクリプトプロパティに以下の「キー」で保存する
 * ============================================================
 *   META_ACCESS_TOKEN   … システムユーザーの長期トークン
 *   META_AD_ACCOUNT_ID  … 広告アカウントID（先頭の act_ は付けない）
 *   META_IG_USER_ID     … Instagram ビジネスアカウントのID
 *
 * ★ トークンをこのコードに直接書かないこと。
 *
 * ============================================================
 * 最初の手順
 * ============================================================
 *   1. testMetaConnection()  … トークンと権限の疎通確認。まずこれ
 *   2. backfillMeta(90)      … 過去90日を投入して履歴を作る
 *   3. setupMetaTriggers()   … 毎日の自動取得を登録
 */

const PROP_META_TOKEN = 'META_ACCESS_TOKEN';
const PROP_META_AD_ACCOUNT = 'META_AD_ACCOUNT_ID';
const PROP_META_IG_USER = 'META_IG_USER_ID';

/** APIバージョンは明示的に固定する。既定に任せると予告なく上がる。 */
const META_API_VERSION = 'v21.0';

const SHEET_META_ADS = 'MetaAds';
const SHEET_IG_DAILY = 'InstagramDaily';

const META_ADS_HEADER =
  ['date', 'campaign', 'spend', 'impressions', 'reach', 'clicks', 'cpc', 'ctr', 'fetchedAt'];
const IG_DAILY_HEADER =
  ['date', 'reach', 'profileViews', 'followers', 'fetchedAt'];

/* ============================================================
 * 設定の取得
 * ============================================================ */

function getMetaProp_(key, hint) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error(
      'スクリプトプロパティ ' + key + ' が未設定です。' + (hint || '') +
      ' GASエディタ → プロジェクトの設定 → スクリプト プロパティ で設定してください。'
    );
  }
  return value;
}

function getMetaToken_() {
  return getMetaProp_(PROP_META_TOKEN,
    'Meta ビジネス設定で発行したシステムユーザートークンを入れます。');
}

/** 広告アカウントIDは act_ 付きで使う。プロパティ側に act_ が入っていても許容する。 */
function getAdAccountId_() {
  const raw = getMetaProp_(PROP_META_AD_ACCOUNT, '広告アカウントIDです。')
    .toString().replace(/\s+/g, '');
  return raw.indexOf('act_') === 0 ? raw : 'act_' + raw;
}

function getIgUserId_() {
  return getMetaProp_(PROP_META_IG_USER, 'Instagram ビジネスアカウントのIDです。')
    .toString().replace(/\s+/g, '');
}

/* ============================================================
 * Graph API 呼び出し
 * ============================================================ */

/**
 * Graph API を叩いて JSON を返す。
 *
 * エラーは握りつぶさず例外にする。トークン切れや権限不足を
 * 「実績ゼロ」として記録してしまうと、レポートを読む側が
 * 「広告費を使わなかった」と誤読する。それは経営判断を誤らせる。
 */
function metaFetch_(path, params) {
  const query = Object.keys(params || {})
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
    .join('&');

  const url = 'https://graph.facebook.com/' + META_API_VERSION + '/' + path +
              (query ? '?' + query : '');

  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + getMetaToken_() },
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const text = res.getContentText();

  if (code !== 200) {
    throw new Error('Meta API エラー (HTTP ' + code + ') ' + path + ' : ' + text);
  }

  const json = JSON.parse(text);
  if (json.error) {
    throw new Error('Meta API エラー ' + path + ' : ' + JSON.stringify(json.error));
  }
  return json;
}

/** ページングを辿って data 配列を全部集める。 */
function metaFetchAll_(path, params) {
  let json = metaFetch_(path, params);
  let rows = (json.data || []).slice();

  let guard = 0;
  while (json.paging && json.paging.next && guard < 20) {
    const res = UrlFetchApp.fetch(json.paging.next, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) break;
    json = JSON.parse(res.getContentText());
    if (json.error) break;
    rows = rows.concat(json.data || []);
    guard++;
  }
  return rows;
}

/* ============================================================
 * 日付
 * ============================================================ */

function tz_() {
  // アカデミーはバンコク。広告の日次集計も現地時間で揃える。
  return 'Asia/Bangkok';
}

function ymd_(date) {
  return Utilities.formatDate(date, tz_(), 'yyyy-MM-dd');
}

function daysAgo_(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/* ============================================================
 * シートへの書き込み（同じ日付を二重に書かない）
 * ============================================================ */

/**
 * 行を upsert する。
 *
 * 日次実行と backfill が重なったり、手動で再実行したりするため、
 * 追記だけだと同じ日付の行が増えていく。キー列が一致する行は
 * 上書きし、無ければ末尾に足す。
 *
 * keyCols は突き合わせに使う列インデックス（0始まり）の配列。
 */
function upsertRows_(sheetName, header, rows, keyCols) {
  if (!rows.length) return { updated: 0, added: 0 };

  const sheet = getOrCreateSheet_(sheetName, header);
  const existing = sheet.getDataRange().getValues();

  // 区切りには NUL を使う。キャンペーン名には何でも入りうるため、
  // 通常の記号を区切りにすると別々の組が同じキーに潰れる恐れがある。
  const separator = String.fromCharCode(0);
  const keyOf = function (row) {
    return keyCols.map(function (i) { return String(row[i]); }).join(separator);
  };

  const indexByKey = {};
  for (let i = 1; i < existing.length; i++) {
    indexByKey[keyOf(existing[i])] = i + 1; // シートの行番号（1始まり）
  }

  const toAppend = [];
  let updated = 0;

  rows.forEach(function (row) {
    const at = indexByKey[keyOf(row)];
    if (at) {
      sheet.getRange(at, 1, 1, row.length).setValues([row]);
      updated++;
    } else {
      toAppend.push(row);
    }
  });

  if (toAppend.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, header.length)
         .setValues(toAppend);
  }

  return { updated: updated, added: toAppend.length };
}

/* ============================================================
 * Meta広告
 * ============================================================ */

/**
 * 指定期間の広告実績をキャンペーン別・日別に取得する。
 */
function fetchMetaAdsRange_(since, until) {
  const rows = metaFetchAll_(getAdAccountId_() + '/insights', {
    level: 'campaign',
    fields: 'campaign_name,spend,impressions,reach,clicks,cpc,ctr',
    time_range: JSON.stringify({ since: since, until: until }),
    time_increment: 1,   // 1日ごとに分ける
    limit: 200
  });

  const now = new Date();
  const num = function (v) { return v === undefined || v === '' ? 0 : Number(v); };

  return rows.map(function (r) {
    return [
      r.date_start || '',
      r.campaign_name || '(不明)',
      num(r.spend),
      num(r.impressions),
      num(r.reach),
      num(r.clicks),
      num(r.cpc),
      num(r.ctr),
      now
    ];
  });
}

/** 前日分を取り込む。毎日のトリガーから呼ばれる。 */
function fetchMetaAdsDaily() {
  const day = ymd_(daysAgo_(1));
  const rows = fetchMetaAdsRange_(day, day);
  const result = upsertRows_(SHEET_META_ADS, META_ADS_HEADER, rows, [0, 1]);
  Logger.log('Meta広告 ' + day + ' : ' + rows.length + '件取得（更新 ' +
             result.updated + ' / 追加 ' + result.added + '）');
  return result;
}

/* ============================================================
 * Instagram
 * ============================================================ */

/**
 * Instagram の日次インサイトを取得する。
 *
 * この API は指標名の変更が多い（impressions は2025年に廃止され views に
 * なった）。取れなかった指標は0で埋めず、欠測として空欄のままにする。
 */
function fetchInstagramRange_(since, until) {
  const igUser = getIgUserId_();
  const byDate = {};

  const collect = function (metric, column) {
    let data;
    try {
      data = metaFetch_(igUser + '/insights', {
        metric: metric,
        period: 'day',
        since: since,
        until: until
      });
    } catch (err) {
      // 廃止された指標や権限不足はここに来る。欠測として扱い、処理は続ける。
      Logger.log('Instagram 指標「' + metric + '」は取得できませんでした: ' + err.message);
      return;
    }
    (data.data || []).forEach(function (series) {
      (series.values || []).forEach(function (v) {
        const d = (v.end_time || '').slice(0, 10);
        if (!d) return;
        if (!byDate[d]) byDate[d] = {};
        byDate[d][column] = v.value;
      });
    });
  };

  collect('reach', 'reach');
  collect('profile_views', 'profileViews');

  // フォロワー数は時系列で遡れないため、実行時点の値を当日分に記録する。
  let followers = '';
  try {
    followers = metaFetch_(igUser, { fields: 'followers_count' }).followers_count;
  } catch (err) {
    Logger.log('フォロワー数を取得できませんでした: ' + err.message);
  }

  const today = ymd_(new Date());
  const now = new Date();

  return Object.keys(byDate).sort().map(function (d) {
    return [
      d,
      byDate[d].reach === undefined ? '' : byDate[d].reach,
      byDate[d].profileViews === undefined ? '' : byDate[d].profileViews,
      d === today ? followers : '',
      now
    ];
  });
}

/** 前日分を取り込む。毎日のトリガーから呼ばれる。 */
function fetchInstagramDaily() {
  const since = ymd_(daysAgo_(2));
  const until = ymd_(new Date());
  const rows = fetchInstagramRange_(since, until);
  const result = upsertRows_(SHEET_IG_DAILY, IG_DAILY_HEADER, rows, [0]);
  Logger.log('Instagram ' + since + '〜' + until + ' : ' + rows.length +
             '件（更新 ' + result.updated + ' / 追加 ' + result.added + '）');
  return result;
}

/* ============================================================
 * 過去分の投入
 * ============================================================ */

/**
 * 過去N日をまとめて取り込む。初回に1度だけ実行して履歴を作る。
 * Instagram のインサイトは概ね過去2年まで遡れるが、広告と違って
 * 期間が長いとエラーになることがあるため30日ずつに区切って取る。
 */
function backfillMeta(days) {
  const span = days || 90;

  const adsRows = fetchMetaAdsRange_(ymd_(daysAgo_(span)), ymd_(new Date()));
  const ads = upsertRows_(SHEET_META_ADS, META_ADS_HEADER, adsRows, [0, 1]);
  Logger.log('広告 backfill: ' + adsRows.length + '件（更新 ' + ads.updated +
             ' / 追加 ' + ads.added + '）');

  let igTotal = 0;
  for (let offset = span; offset > 0; offset -= 30) {
    const since = ymd_(daysAgo_(offset));
    const until = ymd_(daysAgo_(Math.max(offset - 30, 0)));
    const rows = fetchInstagramRange_(since, until);
    upsertRows_(SHEET_IG_DAILY, IG_DAILY_HEADER, rows, [0]);
    igTotal += rows.length;
    Utilities.sleep(500); // APIに連続で叩き込まない
  }
  Logger.log('Instagram backfill: ' + igTotal + '件');

  Logger.log('backfillMeta 完了。シートの日付に抜けがないか確認してください。');
}

/* ============================================================
 * トリガー
 * ============================================================ */

/**
 * 毎日の自動取得を登録する。1回だけ実行すればよい。
 * 前日分を確定させたいので、バンコク時間の朝5〜6時に走らせる。
 */
function setupMetaTriggers() {
  const handlers = ['fetchMetaAdsDaily', 'fetchInstagramDaily'];

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('fetchMetaAdsDaily').timeBased().atHour(5).everyDays(1).create();
  ScriptApp.newTrigger('fetchInstagramDaily').timeBased().atHour(6).everyDays(1).create();

  Logger.log('Meta の日次トリガーを登録しました（広告 5時台 / Instagram 6時台）。');
}

/* ============================================================
 * 疎通確認
 * ============================================================
 * 実装を進める前に、まずこれを実行して何が返るかを確かめる。
 * 特に Instagram は指標名の変更が多いので、憶測で列を決めない。
 */

function testMetaConnection() {
  Logger.log('--- 設定 ---');
  try {
    const token = getMetaToken_();
    Logger.log('META_ACCESS_TOKEN: ' + token.slice(0, 6) + '...（' + token.length + '文字）');
  } catch (err) {
    Logger.log('★ ' + err.message);
    return;
  }

  Logger.log('--- 広告アカウント ---');
  try {
    const acct = metaFetch_(getAdAccountId_(), {
      fields: 'name,account_status,currency,timezone_name'
    });
    Logger.log('名前: ' + acct.name + ' / 通貨: ' + acct.currency +
               ' / TZ: ' + acct.timezone_name + ' / 状態: ' + acct.account_status);

    const yesterday = ymd_(daysAgo_(1));
    const sample = fetchMetaAdsRange_(yesterday, yesterday);
    Logger.log('前日（' + yesterday + '）のキャンペーン数: ' + sample.length);
    sample.slice(0, 5).forEach(function (r) {
      Logger.log('  ' + r[1] + ' … 消化 ' + r[2] + ' / 表示 ' + r[3] + ' / クリック ' + r[5]);
    });
  } catch (err) {
    Logger.log('★ 広告アカウント: ' + err.message);
  }

  Logger.log('--- Instagram ---');
  try {
    const ig = metaFetch_(getIgUserId_(), { fields: 'username,followers_count,media_count' });
    Logger.log('ユーザー: @' + ig.username + ' / フォロワー: ' + ig.followers_count +
               ' / 投稿数: ' + ig.media_count);

    const rows = fetchInstagramRange_(ymd_(daysAgo_(7)), ymd_(new Date()));
    Logger.log('直近7日で取得できた日数: ' + rows.length);
    rows.slice(-3).forEach(function (r) {
      Logger.log('  ' + r[0] + ' … リーチ ' + r[1] + ' / プロフィール表示 ' + r[2]);
    });
  } catch (err) {
    Logger.log('★ Instagram: ' + err.message);
  }

  Logger.log('--- 確認事項 ---');
  Logger.log('★ が付いた行があれば、その権限かIDを見直してください。');
  Logger.log('広告の消化額は Meta広告マネージャの画面と必ず突き合わせてください。');
}
