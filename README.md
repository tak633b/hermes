# Hermes - Agent Orchestration & Task Management

AI エージェント の管理と タスク オーケストレーション をサポートするフルスタック プラットフォーム。

## 特徴

- 🤖 **エージェント管理** - 複数エージェントの登録・管理
- 📋 **タスク管理** - タスク作成・追跡・進捗監視
- 📊 **ダッシュボード** - リアルタイムステータス表示
- 🔄 **リトライ機能** - 失敗したタスクの自動再実行
- 🎯 **フィルタリング** - ステータス別タスク絞り込み

## アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│          Frontend (Vanilla JS + Nginx)          │
├─────────────────────────────────────────────────┤
│  Dashboard | Agent Manager | Task Manager | UI  │
└──────────────────┬──────────────────────────────┘
                   │ HTTP/JSON
                   ▼
┌─────────────────────────────────────────────────┐
│          Backend (FastAPI + Python)             │
├─────────────────────────────────────────────────┤
│  REST API | Agent Router | Task Router | Utils  │
└──────────────────┬──────────────────────────────┘
                   │ JSON File Storage
                   ▼
              ./data/
         ├── agents.json
         └── tasks.json
```

## クイックスタート

### 前提条件

- Docker & Docker Compose
- Python 3.11+ (ローカル実行時)
- Node.js (オプション)

### Docker での実行

```bash
# リポジトリをクローン
git clone https://github.com/tak633b/hermes.git
cd hermes

# コンテナをビルド・起動
docker compose up -d --build

# ブラウザで http://localhost:3000 にアクセス
```

### ローカル実行

```bash
# バックエンド
cd backend
pip install -r requirements.txt
python main.py

# フロントエンド（別ターミナル）
cd frontend
python -m http.server 8080
# http://localhost:8080 にアクセス
```

## API エンドポイント

### エージェント

- `GET /agents` - エージェント一覧
- `POST /agents` - エージェント作成
- `GET /agents/{id}` - エージェント詳細

### タスク

- `GET /tasks` - タスク一覧
- `GET /tasks?agent_id=xxx&status=pending` - フィルタ付き取得
- `POST /tasks` - タスク作成
- `GET /tasks/{id}` - タスク詳細
- `PUT /tasks/{id}` - タスク更新
- `PUT /tasks/{id}/retry` - タスク再実行

### ステータス

- `GET /status` - システムステータス
- `GET /health` - ヘルスチェック

## 使い方

### 1. エージェント登録

1. **エージェント** タブを開く
2. **新規エージェント** ボタンをクリック
3. エージェント名・説明を入力
4. 登録ボタンをクリック

### 2. タスク作成

1. **タスク** タブを開く
2. **新規タスク** ボタンをクリック
3. エージェント・タイトル・説明を入力
4. 作成ボタンをクリック

### 3. タスク監視

1. **ダッシュボード** で全体ステータス確認
2. **タスク** タブで詳細確認
3. **詳細** ボタンでタスク情報・結果を表示

### 4. 失敗タスクの再実行

1. 失敗したタスクの **詳細** を開く
2. **再試行** ボタンをクリック
3. タスクが `pending` 状態にリセット

## 設定

### バックエンド設定

`backend/main.py` の環境変数：

```python
# ポート
8000  # デフォルト

# データ保存先
./data/  # 相対パス
```

### フロントエンド設定

`frontend/js/api.js`:

```javascript
const API_BASE_URL = 'http://localhost:8000';
```

## 開発

### プロジェクト構成

```
hermes/
├── backend/
│   ├── main.py           # FastAPI アプリケーション
│   ├── Dockerfile        # Docker イメージ
│   ├── requirements.txt   # Python 依存
│   └── data/             # JSON ファイル保存
├── frontend/
│   ├── index.html        # メインページ
│   ├── js/
│   │   ├── api.js       # API クライアント
│   │   └── app.js       # アプリケーション
│   └── css/
│       └── style.css    # スタイルシート
├── docker-compose.yml    # Compose 設定
└── README.md
```

### 実装メモ

- バックエンド: FastAPI（軽量・高速）
- フロントエンド: Vanilla JS（依存なし・シンプル）
- データ保存: JSON ファイル（本番環境では DB に置き換え推奨）
- UI: Responsive CSS Grid

## トラブルシューティング

### バックエンドが起動しない

```bash
# ポート確認
lsof -i :8000

# ログ確認
docker logs hermes-backend

# 再ビルド
docker compose down
docker compose up -d --build
```

### フロントエンドが API に接続できない

```bash
# CORS 確認
# browser console でネットワークエラーを確認
# nginx.conf の /api プロキシ設定を確認
```

## ライセンス

MIT License

## 作成者

tak633b (BALTECH team)
