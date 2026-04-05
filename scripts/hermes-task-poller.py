#!/usr/bin/env python3
"""
Hermes Task Poller — バルがHermesのpendingタスクをチェックして実行するスクリプト

使い方:
  python3 scripts/hermes-task-poller.py [--once] [--agent-id bal-main]

  --once: 1回だけ実行して終了（Cron用）
  --agent-id: 対象エージェントID（デフォルト: bal-main）
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

HERMES_BASE_URL = os.environ.get("HERMES_BASE_URL", "http://localhost:8010")
DEFAULT_AGENT_NAME = "bal-main"


def get_pending_tasks(agent_id: str | None = None) -> list:
    url = f"{HERMES_BASE_URL}/tasks?status=pending"
    if agent_id:
        url += f"&agent_id={agent_id}"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"[ERROR] Hermesへの接続失敗: {e}", file=sys.stderr)
        return []


def get_agent_id_by_name(name: str) -> str | None:
    try:
        with urllib.request.urlopen(f"{HERMES_BASE_URL}/agents", timeout=10) as resp:
            agents = json.loads(resp.read())
        for agent in agents:
            if agent.get("name") == name:
                return agent["id"]
    except Exception as e:
        print(f"[ERROR] エージェント一覧取得失敗: {e}", file=sys.stderr)
    return None


def add_log(task_id: str, message: str, level: str = "info") -> None:
    data = json.dumps({"level": level, "message": message}).encode()
    req = urllib.request.Request(
        f"{HERMES_BASE_URL}/tasks/{task_id}/logs",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass


def report_progress(task_id: str, progress: int, status: str, result: str | None = None) -> None:
    payload: dict = {"progress": progress, "status": status}
    if result:
        payload["result"] = result
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{HERMES_BASE_URL}/tasks/{task_id}/progress",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"[ERROR] 進捗報告失敗: {e}", file=sys.stderr)


def process_task(task: dict) -> None:
    task_id = task["id"]
    title = task.get("title", "（無題）")
    description = task.get("description", "")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"[{now}] タスク受信: {title} ({task_id[:8]}...)")

    # タスク受信を報告
    add_log(task_id, f"バルがタスクを受信しました: {title}")
    report_progress(task_id, progress=10, status="running")

    # タスク内容を標準出力（バルのOpenClawが処理できるよう）
    print(f"  タイトル: {title}")
    if description:
        print(f"  内容: {description}")
    print(f"  タスクID: {task_id}")
    print(f"  完了報告コマンド: python3 scripts/hermes-report.py --task-id {task_id} --status completed --result '実行結果'")


def main():
    parser = argparse.ArgumentParser(description="Hermes Task Poller")
    parser.add_argument("--once", action="store_true", help="1回だけ実行して終了")
    parser.add_argument("--agent-id", default=None, help="エージェントID（省略時は名前で検索）")
    parser.add_argument("--agent-name", default=DEFAULT_AGENT_NAME, help="エージェント名（デフォルト: bal-main）")
    parser.add_argument("--dry-run", action="store_true", help="実際には報告せず確認だけ")
    args = parser.parse_args()

    # エージェントIDを解決
    agent_id = args.agent_id
    if not agent_id:
        agent_id = get_agent_id_by_name(args.agent_name)
        if not agent_id:
            print(f"[WARN] エージェント '{args.agent_name}' が見つかりません。フィルタなしで全タスクを確認します。")

    tasks = get_pending_tasks(agent_id)
    if not tasks:
        print("pending タスクはありません。")
        return

    print(f"{len(tasks)} 件のpendingタスクがあります。")
    for task in tasks:
        if args.dry_run:
            print(f"  [DRY-RUN] {task.get('title')} ({task['id'][:8]}...)")
        else:
            process_task(task)


if __name__ == "__main__":
    main()
