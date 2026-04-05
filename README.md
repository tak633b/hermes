# Hermes - Agent Orchestration & Task Management

AI エージェントの管理とタスクオーケストレーションをサポートするフルスタックプラットフォーム。
agent-whisper と連携してエージェントのトレース情報をリアルタイムで可視化できます。

## 特徴

- 🤖 **エージェント管理** - 複数エージェントの登録・管理・ステータス監視
- 📋 **タスク管理** - タスク作成・追跡・進捗監視・優先度設定・期日管理
- 📊 **ダッシュボード** - リアルタイムステータス表示（WebSocket）
- 🔄 **自動リトライ** - 失敗タスクの自動再実行（max_retries 設定）
- 🔗 **agent-whisper 連携** - エージェント詳細にトレース情報を統合表示
- 🔔 **Discord 通知** - エージェントステータス変化・タスク完了時に Webhook 通知
- 💾 **SQLite 永続化** - コンテナ再起動後もデータを保持
- 📝 **タスクログ** - リアルタイムの実行ログ閲覧

## アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│          Frontend (Vanilla JS + Nginx)           │
│  :3005                                           │
├─────────────────────────────────────────────────┤
│  Dashboard | Agent Manager | Task Manager        │
└──────────────────┬───────────────────────────────┘
                   │ HTTP/JSON + WebSocket
                   ▼
┌─────────────────────────────────────────────────┐
│          Backend (FastAPI + Python)              │
│  :8010                                           │
├─────────────────────────────────────────────────┤
│  REST API | WebSocket | Discord Webhook          │
└──────────────────┬───────────────────────────────┘
                   │ SQLite
                   ▼
              ./data/hermes.db

   (フロントエンドは agent-whisper API :8000 に直接アクセス)
```

## クイックスタート

### 前提条件

- Docker & Docker Compose
- agent-whisper（連携機能を使う場合）

### Docker での実行

```bash
# リポジトリをクローン
git clone https://github.com/tak633b/hermes.git
cd hermes

# 環境変数設定（任意）
cp .env.example .env  # または .env を直接編集

# コンテナをビルド・起動
docker compose up -d --build

# ブラウザで http://localhost:3005 にアクセス
```

### ポート

| サービス | ポート |
|---------|--------|
| フロントエンド | 3005 |
| バックエンド API | 8010 |

## 環境変数（`.env`）

```env
# Discord Webhook（エージェント/タスクの状態変化を通知）
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxx/yyy

# Anthropic API Key（将来のAI機能用）
ANTHROPIC_API_KEY=
```

## API エンドポイント

### エージェント

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/agents` | エージェント一覧 |
| `POST` | `/agents` | エージェント作成 |
| `GET` | `/agents/{id}` | エージェント詳細 |
| `PUT` | `/agents/{id}/status` | ステータス変更 |
| `GET` | `/agents/{id}/tasks` | エージェントのタスク一覧 |
| `GET` | `/agents/{id}/logs` | ログ一覧 |
| `GET` | `/agents/{id}/memory` | メモリ一覧 |
| `PUT` | `/agents/{id}/parameters` | パラメータ更新 |
| `PUT` | `/agents/{id}/tool_calls` | ツール設定更新 |

### タスク

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/tasks` | タスク一覧（`?agent_id=xxx&status=pending`）|
| `POST` | `/tasks` | タスク作成 |
| `GET` | `/tasks/{id}` | タスク詳細 |
| `PUT` | `/tasks/{id}` | タスク更新 |
| `PUT` | `/tasks/{id}/status` | ステータス変更 |
| `PUT` | `/tasks/{id}/retry` | 再実行 |
| `GET` | `/tasks/{id}/logs` | 実行ログ |

### agent-whisper プロキシ

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/agent-whisper/traces` | トレース一覧（`?agent_id=xxx`）|

### システム

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/status` | システムステータス |
| `GET` | `/health` | ヘルスチェック |
| `WS` | `/ws` | リアルタイム更新 |

## タスクモデル

```json
{
  "agent_id": "uuid",
  "title": "タスク名",
  "description": "詳細",
  "status": "pending|running|completed|failed|cancelled",
  "progress": 0,
  "priority": 0,
  "due_date": "2026-04-10T00:00:00",
  "max_retries": 3,
  "retry_count": 0
}
```

## agent-whisper との連携

Hermes と [agent-whisper](https://github.com/tak633b/agent-whisper) を連携するには、Hermes のエージェント名を agent-whisper の `agent_id` と一致させてください。

```
# 例: agent-whisper が "bal-main" で記録している場合
# Hermes のエージェント名も "bal-main" にする
```

エージェント詳細モーダルを開くと「agent-whisper トレース」セクションに自動でトレースが表示されます。

## プロジェクト構成

```
hermes/
├── backend/
│   ├── main.py           # FastAPI アプリケーション
│   ├── Dockerfile
│   ├── requirements.txt
│   └── data/
│       └── hermes.db     # SQLite DB（.gitignore）
├── frontend/
│   ├── index.html
│   ├── js/
│   │   ├── api.js        # API クライアント
│   │   └── app.js        # アプリケーションロジック
│   └── css/
│       └── style.css
├── nginx.conf
├── docker-compose.yml
├── .env                  # 環境変数（.gitignore）
└── README.md
```

## トラブルシューティング

### バックエンドが起動しない

```bash
docker logs hermes-backend
docker compose down && docker compose up -d --build
```

### agent-whisper トレースが表示されない

- agent-whisper が起動中か確認（`http://localhost:8000/health`）
- Hermes のエージェント名が agent-whisper の `agent_id` と一致しているか確認

### Discord 通知が届かない

```bash
# .env を確認
cat .env
# 再ビルド
docker compose up -d --build
```

## 作成者

tak633b (BALTECH team) — 2026-04-06
