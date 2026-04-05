# Hermes 開発ガイド

## アーキテクチャ概要

```
hermes/
├── backend/          # FastAPI バックエンド (port 8010)
│   ├── main.py       # APIエンドポイント・DB・Discord通知
│   ├── data/         # SQLiteデータベース (hermes.db)
│   └── Dockerfile
├── frontend/         # Vanilla JS フロントエンド (port 3005 via nginx)
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── api.js    # APIクライアント
│       └── app.js    # UIロジック
├── docker-compose.yml
├── nginx.conf        # リバースプロキシ（/api/ → backend:8010、/ws → backend:8010）
└── .env              # 環境変数（gitignore対象）
```

**依存サービス:**
- `agent-whisper` (port 8000/9001) — トレース監視。`AW_BASE_URL=http://host.docker.internal:8000` でアクセス
- Discord Webhook — `DISCORD_WEBHOOK_URL` 環境変数で有効化

---

## ローカル開発フロー

```bash
# 起動
cd ~/hermes && docker compose up -d --build

# ログ確認
docker logs hermes-backend -f

# バックエンド単体テスト
cd ~/hermes && curl http://localhost:8010/health

# フロントエンド
open http://localhost:3005
```

**コード変更後は必ず:**
```bash
cd ~/hermes && docker compose up -d --build
```

---

## バックエンドに機能を追加する

### 新しい API エンドポイントの追加

`backend/main.py` の末尾（`if __name__ == "__main__"` の前）に追加：

```python
@app.get("/my-feature")
async def my_feature():
    with get_db() as conn:
        rows = conn.execute("SELECT ...").fetchall()
    return [dict(r) for r in rows]
```

**テーブルを追加する場合は `init_db()` 関数内に `CREATE TABLE IF NOT EXISTS` を追加する。**

### Discord 通知を送る

```python
await send_discord_notification(
    title="タイトル",
    description="メッセージ",
    color=0x5865F2,
    fields=[{"name": "フィールド名", "value": "値", "inline": True}]
)
```

### WebSocket でフロントに通知する

```python
await ws_manager.broadcast({"event": "my_event", "data": {...}})
```

---

## フロントエンドに機能を追加する

### API 呼び出しを追加する

`frontend/js/api.js` の `API` クラスに追加：

```javascript
static getMyFeature() {
    return this.request('/my-feature');
}
```

### 新しい UI を追加する

`frontend/js/app.js` に関数を追加してから `frontend/index.html` にボタン/タブを追加：

```javascript
async function myFeature() {
    const data = await API.getMyFeature();
    // DOM 更新
}
```

### agent-whisper と連携する

agent-whisper は CORS `*` を許可しているため、ブラウザから直接叩ける：

```javascript
const AW_BASE_URL = 'http://localhost:8000';  // api.js で定義済み

// トレース検索
const traces = await API.getAgentWhisperTraces(agentName, limit=20);

// 直接 fetch
const res = await fetch(`${AW_BASE_URL}/traces?agent_id=${agentName}`);
```

---

## バルとの連携設計方針

### タスクフロー

```
Hermes タスク作成（UI or API）
  → Discord #hermes-alerts に通知（フルUUID + curlコマンド付き）
  → バルがタスク内容を読んで実行
  → PUT /tasks/{id}/status {"status":"completed", "result":"..."}
  → Hermes が DB 更新 + Discord 完了通知
```

### 自律ポーリング

Cron で 15 分ごとに `hermes-task-poller.py` が実行され、pending タスクを自動検出する。

バルが実行したスクリプトで完了報告：
```bash
python3 ~/.openclaw/workspace/scripts/hermes-report.py \
  --task-id <UUID> \
  --status completed \
  --result "実行結果"
```

---

## 設計上の判断と理由

| 決定 | 理由 |
|------|------|
| SQLite (not PostgreSQL) | 単一マシン・シンプル・永続化で十分 |
| Vanilla JS (not React) | 依存を最小化、バンドル不要、Claude Code でも修正しやすい |
| Docker Compose | 環境再現性。`up -d --build` 一発で起動 |
| agent-whisper と別 Compose | 独立したライフサイクル。`host.docker.internal` でアクセス |
| ブラウザから AW 直接アクセス | プロキシ経由はネットワーク分離問題が複雑。AW は CORS `*` 許可済み |
| エージェント名で AW 紐付け | Hermes は UUID、AW は名前ベース。`agent.name` を統一キーにする |

---

## 今後の機能追加候補

優先度高：
- **タスク実行エンジン強化** — `tool_calls` フィールドに従ってサブエージェントを自律起動
- **agent-whisper アラート連携** — エラー率・タイムアウトを検出して Discord 通知

優先度中：
- **タスクフィルタ・検索UI** — ステータス・エージェント・期間でフィルタ
- **エージェント設定テンプレート** — よく使う設定をプリセット化

優先度低：
- **複数ユーザー対応** — 現状はたか専用のシングルテナント
- **外部 API 連携** — Notion・Todoist との双方向同期

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| ヘルスビューが空 | `AW_BASE_URL` が未設定 | `.env` に `AW_BASE_URL=http://host.docker.internal:8000` を追加 |
| Discord 通知が届かない | Webhook URL が無効 | `.env` の `DISCORD_WEBHOOK_URL` を再設定 |
| agent-whisper トレースが表示されない | エージェント名不一致 | Hermes の `agent.name` と AW の `agent_id` を一致させる |
| フロントが更新されない | キャッシュ | `docker compose up -d --build` して強制リロード |
