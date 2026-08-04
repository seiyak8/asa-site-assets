# ASA 週次レポート — 自動実行用の指示文

このファイルは、毎週月曜朝に自動起動する Routine へ渡す指示文の原本。
文面を直したいときはここを編集し、Routine の prompt を更新する。

Routine の設定：
- cron `0 1 * * 1`（UTC）＝ バンコク時間 月曜 08:00
- `create_new_session_on_fire: true`（毎回まっさらなセッションで実行）
- 必要なコネクタ：Google Drive、Windsor.ai

---

## 指示文（ここから下をそのまま Routine の prompt にする）

あなたは Advance Sports Academy（バンコクの子ども向けスポーツアカデミー）の
週次レポートを作成します。社長（seiya@asa-th.com）が月曜の朝に読むものです。

### 対象期間

先週の月曜から日曜まで。前週と比較すること。

### データ源（Google Drive コネクタで読む）

| 用途 | ファイル | ID |
|---|---|---|
| 顧客KPI・全登録明細 | ASA顧客管理（自動集計） | `1EjSSMQoStX5QysxL5E2WI4aBERO1dil_V1qNaMcnbOU` |
| 体験申込の生データ | Trial Application Form （回答） | `1_IJg0FWIa74SVA9UVqAsnH94aLQX1k2Q4l1F-9-4hY4` |
| LINE 自動返信ログ | （LINE返信ログ） | `1WGIH9RSUQYiohj9wT2yuk9Py8qOHUpMrYYxlnec8tFk` |
| 返信テンプレート | Academy LINE Response Manual | `1gU_n66iHwM3mu5azPNHhvhBBZEijgEty5iKc9infUVw` |
| 月額申込 | ASA月額プランお申込み書（回答） | `1lX1qmguNx1txMKYz9X6YMdTsFHyxzYcWfdUpp4fW6AY` |
| チケット | Ticket Enjoy | `12GJyXQ0siWPMKAWN7CWzD0G0QTEXZcwc5biYYI6F_0k` |

顧客管理シートは大きいので `read_file_content` の出力がトークン上限を超える。
その場合は保存先ファイルを Python か jq で解析すること（Read の行オフセットでは分割できない）。

明細表のヘッダー行は `登録日 / 種別 / クラス / 子供名 / 年齢 / 生年月日 / スポーツ歴 /
保護者名 / メールアドレス / 電話番号 / チケット・コース / 契約開始日 / 契約期間 /
支払方法 / 知ったきっかけ / 元フォーム` の16列。
複数の表が連結されているため、`種別` が空・`:-:`・`種別` の行は除外する。
`登録日` は `Thu Sep 19 2024 21:57:13 GMT+0700 (Indochina Time)` 形式。

広告データは Windsor.ai の `get_data` で取得する（コネクタ `facebook` / `instagram`）。
**応答の campaign 欄に `Uh-oh! You've connected more accounts than your Free plan allows`
が入っていたら、それは実データではなくプラン上限のエラー。** その場合は広告セクションを
省略し、「Windsor.ai の接続上限のため未収録」と明記すること。ゼロとして報告してはいけない。

### 必ず確認すること：データ配管の健全性

各フォームが顧客管理シートへ最後に記録された日を出し、止まっているものがあれば
**レポートの冒頭で警告する**。過去に以下の停止が起きている：

- Trial Application Form … 2026-01-30 以降 記録なし
- ASA Application Form … 2026-01-15 以降 記録なし
- ASA月額プランお申込み書 … 2026-05-14 以降 記録なし

数字が0でも「実績が0」とは限らず「記録が止まっている」可能性がある。
両者を区別して書くこと。区別できないときは「実数不明」と正直に書く。

### レポートの内容

1. 先週の新規体験・チケット入会・月額入会・LINE問い合わせ件数（前週比）
2. データ配管の状態（上記）
3. 累計KPI：入会率、月額継続率、直近アクティブ率、会員内訳
4. LINE：問い合わせ件数、言語別内訳、重複送信の有無、エスカレーション件数
5. 所見と今週やること（3〜5項目、効果が大きく手間が小さい順）

数字の羅列にせず、「何が起きたか」「来週どこを見るべきか」を書く。
特に**直近アクティブ率**は毎週追う（入会率は健全だが継続に課題があるため）。

### 厳守：個人情報

顧客管理シートにはお子様の氏名・生年月日、保護者の氏名・メール・電話番号が入っている。
レポートは Web ページとして公開されるため、**集計値のみを載せ、個人を特定できる情報は
一切含めないこと**。件数・比率・傾向だけを書く。

### 出力

1. HTML アーティファクトとして公開する。ASA のブランドカラー（teal `#1BAFC9`、
   ink `#0B0F14`、accent orange `#FF6B35`）を使い、スマホで読めてダーク/ライト両対応にする。
   favicon は `⚽` で固定。
2. 同じ内容を Google ドライブにも保存し、履歴を残す。
3. 完了したら社長の携帯へプッシュ通知する（要点1行）。
