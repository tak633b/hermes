#!/usr/bin/env python3
"""
Hermes Report — バルがHermesにタスク結果を報告するCLI

使い方:
  python3 scripts/hermes-report.py --task-id <id> --status completed --result "実行結果"
  python3 scripts/hermes-report.py --task-id <id> --status failed --result "エラー内容"
  python3 scripts/hermes-report.py --task-id <id> --log "処理中: ステップ1完了"
  python3 scripts/hermes-report.py --task-id <id> --progress 50
"""

import argparse
import json
import os
import sys
import urllib.request

HERMES_BASE_URL = os.environ.get("HERMES_BASE_URL", "http://localhost:8010")


def hermes_post(path: str, payload: dict) -> dict | None:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{HERMES_BASE_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"[ERROR] HTTP {e.code}: {body}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return None


def main():
    parser = argparse.ArgumentParser(description="Hermes Task Reporter")
    parser.add_argument("--task-id", required=True, help="タスクID")
    parser.add_argument("--status", choices=["pending", "running", "completed", "failed", "cancelled"],
                        help="タスクステータスを更新")
    parser.add_argument("--result", default=None, help="タスク実行結果（テキスト）")
    parser.add_argument("--progress", type=int, default=None, help="進捗（0-100）")
    parser.add_argument("--log", default=None, help="ログメッセージを追加")
    parser.add_argument("--log-level", default="info", choices=["debug", "info", "warn", "error"],
                        help="ログレベル（デフォルト: info）")
    args = parser.parse_args()

    task_id = args.task_id

    # ログ追加
    if args.log:
        payload = {"level": args.log_level, "message": args.log}
        result = hermes_post(f"/tasks/{task_id}/logs", payload)
        if result is not None:
            print(f"✅ ログ追加: {args.log}")
        else:
            print("❌ ログ追加失敗", file=sys.stderr)
            sys.exit(1)

    # 進捗・ステータス更新
    if args.status or args.progress is not None or args.result:
        payload: dict = {}
        if args.progress is not None:
            payload["progress"] = args.progress
        if args.status:
            payload["status"] = args.status
        if args.result:
            payload["result"] = args.result
        if not payload:
            print("[WARN] 何も更新するものがありません")
            return

        result = hermes_post(f"/tasks/{task_id}/progress", payload)
        if result is not None:
            status_str = args.status or "（ステータス変更なし）"
            progress_str = f"進捗 {args.progress}%" if args.progress is not None else ""
            print(f"✅ 報告完了: ステータス={status_str} {progress_str}")
        else:
            print("❌ 報告失敗", file=sys.stderr)
            sys.exit(1)

    if not args.log and args.status is None and args.progress is None and args.result is None:
        parser.print_help()


if __name__ == "__main__":
    main()
