# Hermes Development Guide

## Project Overview

**Hermes** は、バル（AIエージェント）を一元管理するための統合ダッシュボードです。タスク管理・エージェント監視・自動報告を通じて、AIエージェントの自律的な運用を支援します。

```
Hermes (Task Management)
  ├→ Discord (Notifications)
  ├→ agent-whisper (Trace Monitoring)
  └→ OpenClaw/Claude Code (Execution)
```

---

## Architecture

### Stack
- **Backend:** FastAPI (port 8010)
- **Frontend:** Vanilla JS + CSS (port 3005)
- **Database:** SQLite (`backend/data/hermes.db`)
- **Containerization:** Docker Compose
- **Notifications:** Discord Webhook

### Key Components

#### Database (SQLite)
- `agents` — エージェント登録・メタデータ
- `tasks` — タスク（pending/running/completed/failed）
- `task_logs` — ツール実行ログ・進捗・結果

#### Backend Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/agents` | エージェント一覧 |
| POST | `/agents` | エージェント作成 |
| GET | `/agents/{id}` | エージェント詳細（メタデータ） |
| GET | `/agents/{id}/health` | エージェント健全性（最終トレース時刻・エラー率） |
| GET | `/tasks` | タスク一覧（フィルタ対応） |
| POST | `/tasks` | タスク作成 → Discord通知送信 |
| PUT | `/tasks/{id}/status` | ステータス更新 → Discord完了通知 |
| GET | `/tasks/{id}/logs` | タスクログ取得 |
| POST | `/tasks/{id}/progress` | 進捗報告 |

#### Frontend Features
- エージェント一覧・詳細表示
- agent-whisper トレース統合表示
- タスク管理（作成・監視・実行状況確認）
- メトリクスダッシュボード
- リアルタイムステータス更新（WebSocket）

---

## Development Workflow

### Local Setup

```bash
# リポジトリクローン
git clone https://github.com/tak633b/hermes.git
cd hermes

# 環境設定
cp .env.example .env
# .env を編集（agent-whisper URL、Discord Webhook等）

# Docker起動
docker compose up -d --build

# アクセス
# UI: http://localhost:3005
# API: http://localhost:8010
# Docs: http://localhost:8010/docs (Swagger)
```

### Database Schema

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  status TEXT DEFAULT 'idle',
  created_at TEXT,
  updated_at TEXT,
  logs TEXT,       -- JSON: event logs
  memory TEXT,     -- JSON: agent context/notes
  parameters TEXT  -- JSON: tool configs
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',  -- pending/running/completed/failed
  progress INTEGER DEFAULT 0,      -- 0-100%
  result TEXT,                     -- JSON: execution result
  error TEXT,                      -- Error message
  priority INTEGER DEFAULT 0,      -- 0=normal, 1=medium, 2=high
  due_date TEXT,                   -- ISO8601
  max_retries INTEGER DEFAULT 3,
  retry_count INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  tool_calls TEXT  -- JSON: structured execution steps
);

CREATE TABLE task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  timestamp TEXT,
  level TEXT,      -- info/warn/error
  message TEXT,
  tool_name TEXT,
  tool_args TEXT,
  tool_result TEXT,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
```

---

## Improvement Roadmap

### Phase 1: Foundation (✅ Complete)
- [x] Hermes フルスタック実装
- [x] SQLite 永続化
- [x] Discord Webhook 通知（フルUUID + 完了 curl コマンド埋め込み）
- [x] agent-whisper トレース連携（`agent.name` ベース検索）
- [x] Hermes ヘルスビュー（`AW_BASE_URL` 経由で agent-whisper 接続）
- [x] WebSocket リアルタイム更新（エージェントバッジ・タスク状態）
- [x] ブラウザネイティブ通知（`task_created` イベント時）
- [x] hermes-task-poller Cron 登録（`*/15 * * * *`）

### Phase 1.5: UX Fixes (✅ Complete — 2026-04-06)
- [x] タスク作成後に Tasks タブへ自動切り替え（`fix: 5179676`）
- [x] タスク一覧にエージェント名を表示（UUID → 名前、`fix: fe7766b`）
- [x] alert() を Toast 通知に置き換え

### Phase 2: Autonomous Execution (🔄 In Progress)
- [ ] **Task Execution Engine** — `tool_calls` フィールドをパース → サブエージェント自動起動
- [ ] **Smart Task Retry** — 失敗時のリトライロジック強化（指数バックオフ）
- [ ] **Task Templates** — よく使うタスク（「レポート作成」「コード審査」）をテンプレート化
- [ ] **Task Status Quick Update** — 一覧画面でステータスを直接変更できるボタン

### Phase 3: Intelligence (📋 Future)
- [ ] **Priority Learning** — タスク優先度の自動推定（過去の完了時間から）
- [ ] **Anomaly Detection** — タスク実行時間が異常に長い場合は自動アラート
- [ ] **Multi-Agent Scheduling** — 複数エージェント間のタスク分配最適化

### Phase 4: Integration (🎯 Long-term)
- [ ] **Slack/Teams Integration** — Discord 以外のチャットプラットフォーム対応
- [ ] **Analytics Dashboard** — エージェント効率・成功率の可視化
- [ ] **API Rate Limiting & Quota** — 公開API化に向けた制御

---

## Adding a New Feature

### Example: Task Execution Engine

**Goal:** Hermes で `tool_calls` フィールドを定義 → バルが自動実行 → 結果報告

**Steps:**

1. **Database Migration** (`backend/main.py` コンテキストで）
   ```python
   # tasks テーブルに tool_calls カラムを追加（既存）
   # {
   #   "steps": [
   #     {"tool": "exec", "args": {"command": "..."}},
   #     {"tool": "sessions_spawn", "args": {"task": "...", "agentId": "..."}}
   #   ]
   # }
   ```

2. **Execution Logic** (`backend/executor.py` 新規作成)
   ```python
   async def execute_task_steps(task_id: str, tool_calls: list):
       """tool_calls を順番に実行し、結果を task_logs に記録"""
       for step in tool_calls:
           tool_name = step["tool"]
           args = step["args"]
           # 1. ツール実行（exec / sessions_spawn 等）
           # 2. 結果を task_logs に記録
           # 3. エラー時は例外スロー
   ```

3. **API Endpoint Update** (`backend/main.py`)
   ```python
   @app.post("/tasks/{id}/execute")
   async def execute_task(task_id: str):
       # DB から tool_calls を取得
       # execute_task_steps(task_id, tool_calls) を呼び出し
       # Discord に進捗通知（ステップごと）
   ```

4. **Frontend Update** (`frontend/index.html`)
   ```html
   <!-- タスク作成フォームに tool_calls エディタを追加 -->
   <div id="tool-calls-editor">...</div>
   ```

5. **Testing**
   ```bash
   # タスクを作成 → tool_calls に exec ステップを設定
   # API で実行開始 → ログを監視
   curl -X POST http://localhost:8010/tasks/xxx/execute
   ```

6. **Documentation**
   - README に使用例を追加
   - API ドキュメント（Swagger）を更新

---

## Design Principles

1. **Autonomous First**
   - ユーザー（たか）の介入を最小化
   - バルが自律的に判断・実行・報告できる設計

2. **Transparency**
   - すべてのアクションを Discord に通知
   - ログ・トレースは完全に記録可能

3. **Resilient**
   - エラー時は自動リトライ
   - 部分的な失敗では全体が止まらない

4. **Observable**
   - agent-whisper との統合で実行トレースを可視化
   - メトリクスダッシュボードで健全性を監視

---

## Code Style & Conventions

- **Python:** PEP 8（flake8 推奨）
- **JavaScript:** Vanilla JS（フレームワークなし）
- **Git:** Conventional Commits（`feat:`, `fix:`, `docs:` 等）
- **Database:** マイグレーション不要（開発中はスキーマを直接変更）

---

## Debugging Tips

### Backend Logs
```bash
docker compose logs -f hermes-backend
```

### Database Query
```bash
sqlite3 backend/data/hermes.db
> SELECT * FROM tasks WHERE status='pending';
```

### API Test
```bash
curl -X GET http://localhost:8010/docs  # Swagger UI
```

### Frontend Console
ブラウザの F12 → Console タブ（JavaScript エラー確認）

---

## Related Projects

- **agent-whisper** — AIエージェントのトレース収集・可視化
  - https://github.com/tak633b/agent-whisper
  - Hermesが参照：エージェント詳細画面にトレース表示

- **OpenClaw** — バルの実行基盤
  - Cron: `hermes-task-poller.py` を 15分ごと実行
  - Hook: Claude Code からツール実行をキャッチ → agent-whisper に記録

---

## Contributing

機能追加・改善提案は GitHub Issues/PRにて。

