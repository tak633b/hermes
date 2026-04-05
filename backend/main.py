from fastapi import Body, FastAPI, HTTPException, Query, BackgroundTasks, WebSocket, WebSocketDisconnect
import aiohttp
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional, Any, Set
import uuid
import sqlite3
from contextlib import contextmanager
from pathlib import Path
import json
import asyncio
import time
import os

DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL")

STATUS_COLORS = {
    "completed": 0x57F287,  # green
    "failed": 0xED4245,     # red
    "running": 0x5865F2,    # blurple
    "cancelled": 0x95A5A6,  # grey
    "pending": 0xFEE75C,    # yellow
}


async def send_discord_notification(title: str, description: str, color: int, fields: list[dict] | None = None) -> None:
    if not DISCORD_WEBHOOK_URL:
        return
    embed: dict = {"title": title, "description": description, "color": color,
                   "timestamp": datetime.utcnow().isoformat()}
    if fields:
        embed["fields"] = fields
    payload = {"embeds": [embed]}
    try:
        async with aiohttp.ClientSession() as session:
            await session.post(DISCORD_WEBHOOK_URL, json=payload)
    except Exception:
        pass  # never block the main flow on notification errors


app = FastAPI(title="Hermes Agent Orchestration")

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.add(ws)

    def disconnect(self, ws: WebSocket):
        self.active.discard(ws)

    async def broadcast(self, message: dict):
        data = json.dumps(message)
        dead = set()
        for ws in list(self.active):
            try:
                await ws.send_text(data)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.active.discard(ws)

ws_manager = ConnectionManager()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path("data/hermes.db")
DB_PATH.parent.mkdir(exist_ok=True)


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                status TEXT DEFAULT 'idle',
                parameters TEXT,
                tool_calls TEXT,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT DEFAULT 'pending',
                progress INTEGER DEFAULT 0,
                result TEXT,
                error TEXT,
                created_at TEXT,
                updated_at TEXT,
                FOREIGN KEY (agent_id) REFERENCES agents(id)
            );
            CREATE TABLE IF NOT EXISTS agent_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                level TEXT DEFAULT 'info',
                message TEXT,
                FOREIGN KEY (agent_id) REFERENCES agents(id)
            );
            CREATE TABLE IF NOT EXISTS agent_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT,
                UNIQUE(agent_id, key),
                FOREIGN KEY (agent_id) REFERENCES agents(id)
            );
            CREATE TABLE IF NOT EXISTS task_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                level TEXT DEFAULT 'info',
                message TEXT,
                tool_name TEXT,
                tool_args TEXT,
                tool_result TEXT,
                FOREIGN KEY (task_id) REFERENCES tasks(id)
            );
        """)
        # Migrate: add tool_calls column to agents if not exists
        try:
            conn.execute("ALTER TABLE agents ADD COLUMN tool_calls TEXT")
        except Exception:
            pass
        # Migrate: add priority, due_date, max_retries, retry_count to tasks
        for col, definition in [
            ("priority", "INTEGER DEFAULT 0"),
            ("due_date", "TEXT"),
            ("max_retries", "INTEGER DEFAULT 0"),
            ("retry_count", "INTEGER DEFAULT 0"),
        ]:
            try:
                conn.execute(f"ALTER TABLE tasks ADD COLUMN {col} {definition}")
            except Exception:
                pass


init_db()


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def row_to_agent(row) -> dict:
    d = dict(row)
    if d.get("parameters"):
        try:
            d["parameters"] = json.loads(d["parameters"])
        except Exception:
            d["parameters"] = None
    if d.get("tool_calls"):
        try:
            d["tool_calls"] = json.loads(d["tool_calls"])
        except Exception:
            d["tool_calls"] = None
    return d


def row_to_task(row) -> dict:
    d = dict(row)
    if d.get("result"):
        try:
            d["result"] = json.loads(d["result"])
        except Exception:
            d["result"] = None
    return d


# ---- Tool Definitions ----

def tool_web_search(query: str) -> dict:
    """Web検索（モック実装）"""
    time.sleep(0.5)
    return {
        "results": [
            {"title": f"Result 1 for '{query}'", "url": "https://example.com/1", "snippet": f"This is a mock result about {query}."},
            {"title": f"Result 2 for '{query}'", "url": "https://example.com/2", "snippet": f"Another mock result about {query}."},
        ],
        "query": query,
        "total": 2,
    }


def tool_file_read(path: str) -> dict:
    """ファイル読み込み"""
    try:
        p = Path(path)
        if not p.exists():
            return {"error": f"File not found: {path}", "content": None}
        if not p.is_file():
            return {"error": f"Not a file: {path}", "content": None}
        content = p.read_text(encoding="utf-8", errors="replace")
        return {"path": path, "content": content[:4000], "size": p.stat().st_size}
    except Exception as e:
        return {"error": str(e), "content": None}


def tool_llm_call(prompt: str) -> dict:
    """LLM呼び出し（モック実装）"""
    time.sleep(0.3)
    return {
        "response": f"[Mock LLM Response] Processed prompt: '{prompt[:100]}...' — This is a simulated response from the language model.",
        "model": "mock-llm",
        "usage": {"input_tokens": len(prompt.split()), "output_tokens": 20},
    }


TOOLS = {
    "web_search": tool_web_search,
    "file_read": tool_file_read,
    "llm_call": tool_llm_call,
}


def _add_task_log(conn, task_id: str, level: str, message: str,
                  tool_name: str = None, tool_args: str = None, tool_result: str = None):
    conn.execute(
        "INSERT INTO task_logs (task_id, timestamp, level, message, tool_name, tool_args, tool_result) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (task_id, datetime.utcnow().isoformat(), level, message, tool_name, tool_args, tool_result)
    )


def _add_agent_log(conn, agent_id: str, level: str, message: str):
    conn.execute(
        "INSERT INTO agent_logs (agent_id, timestamp, level, message) VALUES (?, ?, ?, ?)",
        (agent_id, datetime.utcnow().isoformat(), level, message)
    )


# ---- Execution Engine ----

def _run_task_with_tools(task_id: str):
    """tool_callsを順番に実行してタスクを処理する実行エンジン"""
    try:
        with get_db() as conn:
            task_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if not task_row:
                return
            task = dict(task_row)
            agent_row = conn.execute("SELECT * FROM agents WHERE id = ?", (task["agent_id"],)).fetchone()
            if not agent_row:
                return
            agent = dict(agent_row)

            # tool_calls取得
            tool_calls = []
            if agent.get("tool_calls"):
                try:
                    tool_calls = json.loads(agent["tool_calls"])
                except Exception:
                    tool_calls = []

            now = datetime.utcnow().isoformat()
            conn.execute(
                "UPDATE tasks SET status='running', progress=5, updated_at=? WHERE id=?",
                (now, task_id)
            )
            _add_task_log(conn, task_id, "info", f"タスク開始: {task['title']}")
            _add_agent_log(conn, agent["id"], "info", f"タスク開始: {task['title']}")

        total_steps = max(len(tool_calls), 1)
        results = []

        for i, tool_call in enumerate(tool_calls):
            tool_name = tool_call.get("name", "")
            tool_args = tool_call.get("args", {})
            progress = int(10 + (i / total_steps) * 80)

            with get_db() as conn:
                conn.execute(
                    "UPDATE tasks SET progress=?, updated_at=? WHERE id=?",
                    (progress, datetime.utcnow().isoformat(), task_id)
                )
                _add_task_log(
                    conn, task_id, "info",
                    f"[{i+1}/{total_steps}] ツール実行: {tool_name}",
                    tool_name=tool_name,
                    tool_args=json.dumps(tool_args, ensure_ascii=False),
                )

            # ツール実行
            tool_fn = TOOLS.get(tool_name)
            if tool_fn is None:
                result = {"error": f"Unknown tool: {tool_name}"}
                level = "error"
            else:
                try:
                    result = tool_fn(**tool_args)
                    level = "info"
                except Exception as e:
                    result = {"error": str(e)}
                    level = "error"

            results.append({"tool": tool_name, "args": tool_args, "result": result})

            with get_db() as conn:
                _add_task_log(
                    conn, task_id, level,
                    f"[{i+1}/{total_steps}] 完了: {tool_name} → {'成功' if 'error' not in result else 'エラー'}",
                    tool_name=tool_name,
                    tool_args=json.dumps(tool_args, ensure_ascii=False),
                    tool_result=json.dumps(result, ensure_ascii=False)[:2000],
                )

        # 完了
        finished_at = datetime.utcnow().isoformat()
        final_result = {"steps": results, "step_count": len(results)}
        with get_db() as conn:
            conn.execute(
                "UPDATE tasks SET status='completed', progress=100, result=?, updated_at=? WHERE id=?",
                (json.dumps(final_result, ensure_ascii=False), finished_at, task_id)
            )
            _add_task_log(conn, task_id, "info", f"タスク完了: {len(results)}ステップ実行済み")
            _add_agent_log(conn, agent["id"], "info", f"タスク完了: {task['title']} ({len(results)}ステップ)")

    except Exception as e:
        error_msg = str(e)
        err_at = datetime.utcnow().isoformat()
        try:
            with get_db() as conn:
                conn.execute(
                    "UPDATE tasks SET status='failed', error=?, updated_at=? WHERE id=?",
                    (error_msg, err_at, task_id)
                )
                _add_task_log(conn, task_id, "error", f"タスク失敗: {error_msg}")
        except Exception:
            pass


# Models
class ToolCall(BaseModel):
    name: str
    args: dict = {}


class Agent(BaseModel):
    id: Optional[str] = None
    name: str
    description: str
    status: str = "idle"
    parameters: Optional[dict] = None
    tool_calls: Optional[List[ToolCall]] = None
    created_at: Optional[str] = None


class AgentLog(BaseModel):
    timestamp: str
    level: str = "info"
    message: str


class AgentMemory(BaseModel):
    key: str
    value: str


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None


class Task(BaseModel):
    id: Optional[str] = None
    agent_id: str
    title: str
    description: str
    status: str = "pending"
    progress: int = 0
    result: Optional[dict] = None
    error: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    priority: int = 0
    due_date: Optional[str] = None
    max_retries: int = 0
    retry_count: int = 0


class SystemStatus(BaseModel):
    total_agents: int
    active_agents: int
    total_tasks: int
    pending_tasks: int
    running_tasks: int
    completed_tasks: int
    failed_tasks: int


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/tools")
async def list_tools():
    """利用可能なツール一覧"""
    return {
        "tools": [
            {"name": "web_search", "description": "Web検索（モック）", "args": {"query": "string"}},
            {"name": "file_read", "description": "ファイル読み込み", "args": {"path": "string"}},
            {"name": "llm_call", "description": "LLM呼び出し（モック）", "args": {"prompt": "string"}},
        ]
    }


@app.get("/agents", response_model=List[Agent])
async def list_agents():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM agents ORDER BY created_at DESC").fetchall()
    return [row_to_agent(r) for r in rows]


@app.post("/agents", response_model=Agent)
async def create_agent(agent: Agent):
    agent.id = str(uuid.uuid4())
    agent.created_at = datetime.utcnow().isoformat()
    tool_calls_json = json.dumps([tc.dict() for tc in agent.tool_calls]) if agent.tool_calls else None
    with get_db() as conn:
        conn.execute(
            "INSERT INTO agents (id, name, description, status, parameters, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (agent.id, agent.name, agent.description, agent.status,
             json.dumps(agent.parameters) if agent.parameters else None,
             tool_calls_json, agent.created_at)
        )
    return agent


@app.get("/agents/health")
async def get_agents_health():
    """エージェントごとのヘルスメトリクスを返す。タスク統計 + agent-whisper最終トレース時刻を含む。"""
    with get_db() as conn:
        agents = [dict(r) for r in conn.execute("SELECT id, name, status FROM agents").fetchall()]
        result = []
        for agent in agents:
            aid = agent["id"]
            aname = agent["name"]
            rows = conn.execute(
                "SELECT status, created_at, updated_at FROM tasks WHERE agent_id = ? ORDER BY created_at DESC",
                (aid,)
            ).fetchall()
            total = len(rows)
            completed = sum(1 for r in rows if r["status"] == "completed")
            failed = sum(1 for r in rows if r["status"] == "failed")
            error_rate = round(failed / (completed + failed) * 100, 1) if (completed + failed) > 0 else 0.0
            last_task_at = rows[0]["updated_at"] if rows else None

            aw_last_trace_at = None
            try:
                aw_url = os.environ.get("AW_BASE_URL", "http://agent-whisper:8000")
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        f"{aw_url}/traces",
                        params={"q": aname, "limit": 1},
                        timeout=aiohttp.ClientTimeout(total=3)
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            # Support paginated {items, total} and legacy plain list
                            traces = data.get("items", data) if isinstance(data, dict) else data
                            if traces and isinstance(traces, list) and traces[0].get("started_at"):
                                aw_last_trace_at = traces[0]["started_at"]
            except Exception:
                pass

            result.append({
                "agent_id": aid,
                "agent_name": aname,
                "status": agent["status"],
                "total_tasks": total,
                "completed_tasks": completed,
                "failed_tasks": failed,
                "error_rate": error_rate,
                "last_task_at": last_task_at,
                "aw_last_trace_at": aw_last_trace_at,
            })
    return result


@app.get("/agents/{agent_id}", response_model=Agent)
async def get_agent(agent_id: str):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM agents WHERE id = ?", (agent_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    return row_to_agent(row)


@app.put("/agents/{agent_id}")
async def update_agent(agent_id: str, update: AgentUpdate):
    with get_db() as conn:
        row = conn.execute("SELECT id FROM agents WHERE id = ?", (agent_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Agent not found")
        fields = []
        values = []
        if update.name is not None:
            fields.append("name = ?")
            values.append(update.name)
        if update.description is not None:
            fields.append("description = ?")
            values.append(update.description)
        if update.status is not None:
            fields.append("status = ?")
            values.append(update.status)
        if not fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        values.append(agent_id)
        conn.execute(f"UPDATE agents SET {', '.join(fields)} WHERE id = ?", values)
        updated = conn.execute("SELECT id, name, description, status, parameters, tool_calls, created_at FROM agents WHERE id = ?", (agent_id,)).fetchone()
    return {"id": updated[0], "name": updated[1], "description": updated[2], "status": updated[3], "parameters": json.loads(updated[4] or "{}"), "tool_calls": json.loads(updated[5] or "[]"), "created_at": updated[6]}


@app.put("/agents/{agent_id}/tool_calls")
async def update_agent_tool_calls(agent_id: str, tool_calls: List[ToolCall]):
    with get_db() as conn:
        result = conn.execute(
            "UPDATE agents SET tool_calls = ? WHERE id = ?",
            (json.dumps([tc.dict() for tc in tool_calls]), agent_id)
        )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"status": "updated", "tool_calls": [tc.dict() for tc in tool_calls]}


@app.put("/agents/{agent_id}/parameters")
async def update_agent_parameters(agent_id: str, parameters: dict):
    with get_db() as conn:
        result = conn.execute(
            "UPDATE agents SET parameters = ? WHERE id = ?",
            (json.dumps(parameters), agent_id)
        )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"status": "updated"}


@app.get("/agents/{agent_id}/logs")
async def get_agent_logs(agent_id: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT timestamp, level, message FROM agent_logs WHERE agent_id = ? ORDER BY id DESC LIMIT 200",
            (agent_id,)
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/agents/{agent_id}/logs")
async def add_agent_log(agent_id: str, log: AgentLog):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO agent_logs (agent_id, timestamp, level, message) VALUES (?, ?, ?, ?)",
            (agent_id, log.timestamp, log.level, log.message)
        )
    return log


@app.get("/agents/{agent_id}/memory")
async def get_agent_memory(agent_id: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT key, value FROM agent_memory WHERE agent_id = ?",
            (agent_id,)
        ).fetchall()
    return [dict(r) for r in rows]


@app.put("/agents/{agent_id}/status")
async def update_agent_status(agent_id: str, body: dict = Body(...)):
    """Update agent status. Body: {"status": "idle"|"running"|"completed"|"error"}"""
    new_status = body.get("status")
    if not new_status:
        raise HTTPException(status_code=400, detail="status is required")

    with get_db() as conn:
        row = conn.execute("SELECT name FROM agents WHERE id = ?", (agent_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Agent not found")
        agent_name = row[0]
        conn.execute("UPDATE agents SET status = ? WHERE id = ?", (new_status, agent_id))

    await ws_manager.broadcast({
        "event": "agent_status_changed",
        "agent_id": agent_id,
        "status": new_status,
    })

    status_emoji = {"running": "🤖", "completed": "✅", "error": "❌", "idle": "💤"}.get(new_status, "📌")
    await send_discord_notification(
        title=f"{status_emoji} Agent Status: {new_status.capitalize()}",
        description=f"**{agent_name}** is now **{new_status}**",
        color=STATUS_COLORS.get(new_status, 0x99AAB5),
        fields=[{"name": "Agent ID", "value": agent_id, "inline": True}],
    )
    return {"agent_id": agent_id, "status": new_status}


@app.get("/agents/{agent_id}/metrics")
async def get_agent_metrics(agent_id: str):
    with get_db() as conn:
        agent_row = conn.execute("SELECT id FROM agents WHERE id = ?", (agent_id,)).fetchone()
        if not agent_row:
            raise HTTPException(status_code=404, detail="Agent not found")
        rows = conn.execute(
            "SELECT status, created_at, updated_at FROM tasks WHERE agent_id = ?",
            (agent_id,)
        ).fetchall()

    tasks = [dict(r) for r in rows]
    total_tasks = len(tasks)
    completed_tasks = sum(1 for t in tasks if t["status"] == "completed")
    failed_tasks = sum(1 for t in tasks if t["status"] == "failed")
    completion_rate = round(completed_tasks / total_tasks * 100, 1) if total_tasks > 0 else 0.0
    error_rate = round(failed_tasks / total_tasks * 100, 1) if total_tasks > 0 else 0.0

    durations = []
    for t in tasks:
        if t["status"] == "completed" and t["created_at"] and t["updated_at"]:
            try:
                created = datetime.fromisoformat(t["created_at"])
                updated = datetime.fromisoformat(t["updated_at"])
                diff = (updated - created).total_seconds()
                if diff >= 0:
                    durations.append(diff)
            except Exception:
                pass
    avg_duration_seconds = round(sum(durations) / len(durations), 2) if durations else 0.0

    tasks_by_status: dict = {}
    for t in tasks:
        s = t["status"] or "unknown"
        tasks_by_status[s] = tasks_by_status.get(s, 0) + 1

    from datetime import timedelta
    today = datetime.utcnow().date()
    day_labels = [(today - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
    day_counts_map: dict = {label: 0 for label in day_labels}
    for t in tasks:
        if t["created_at"]:
            try:
                d = datetime.fromisoformat(t["created_at"]).date().isoformat()
                if d in day_counts_map:
                    day_counts_map[d] += 1
            except Exception:
                pass
    tasks_by_day = {
        "labels": day_labels,
        "values": [day_counts_map[d] for d in day_labels],
    }

    return {
        "total_tasks": total_tasks,
        "completed_tasks": completed_tasks,
        "failed_tasks": failed_tasks,
        "completion_rate": completion_rate,
        "error_rate": error_rate,
        "avg_duration_seconds": avg_duration_seconds,
        "tasks_by_status": tasks_by_status,
        "tasks_by_day": tasks_by_day,
    }


@app.put("/agents/{agent_id}/memory")
async def update_agent_memory(agent_id: str, memory: AgentMemory):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO agent_memory (agent_id, key, value) VALUES (?, ?, ?) ON CONFLICT(agent_id, key) DO UPDATE SET value = excluded.value",
            (agent_id, memory.key, memory.value)
        )
    return memory


@app.get("/agents/{agent_id}/tasks")
async def get_agent_tasks(agent_id: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM tasks WHERE agent_id = ? ORDER BY created_at DESC",
            (agent_id,)
        ).fetchall()
    return [row_to_task(r) for r in rows]


@app.get("/tasks", response_model=List[Task])
async def list_tasks(agent_id: Optional[str] = Query(None), status: Optional[str] = Query(None)):
    query = "SELECT * FROM tasks WHERE 1=1"
    params = []
    if agent_id:
        query += " AND agent_id = ?"
        params.append(agent_id)
    if status:
        query += " AND status = ?"
        params.append(status)
    query += " ORDER BY created_at DESC"
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return [row_to_task(r) for r in rows]


@app.post("/tasks", response_model=Task)
async def create_task(task: Task):
    task.id = str(uuid.uuid4())
    task.created_at = datetime.utcnow().isoformat()
    task.updated_at = task.created_at
    with get_db() as conn:
        conn.execute(
            "INSERT INTO tasks (id, agent_id, title, description, status, progress, result, error, created_at, updated_at, priority, due_date, max_retries, retry_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (task.id, task.agent_id, task.title, task.description, task.status,
             task.progress, json.dumps(task.result) if task.result else None,
             task.error, task.created_at, task.updated_at,
             task.priority, task.due_date, task.max_retries, task.retry_count)
        )
        # Get agent name for notification
        agent_row = conn.execute("SELECT name FROM agents WHERE id = ?", (task.agent_id,)).fetchone() if task.agent_id else None
        agent_name = agent_row[0] if agent_row else "Unknown"

    # Send Discord notification for new task assignment
    priority_val = task.priority or 0
    priority_label = "🔴 高" if priority_val >= 2 else "🟡 中" if priority_val == 1 else "🟢 通常"
    fields = [
        {"name": "エージェント", "value": agent_name, "inline": True},
        {"name": "優先度", "value": priority_label, "inline": True},
        {"name": "タスクID", "value": task.id, "inline": False},
    ]
    if task.description:
        fields.append({"name": "内容", "value": task.description[:500], "inline": False})
    if task.due_date:
        fields.append({"name": "期日", "value": task.due_date, "inline": True})
    fields.append({"name": "完了報告コマンド", "value": f'`curl -s -X PUT http://localhost:8010/tasks/{task.id}/status -H \'Content-Type: application/json\' -d \'{{\"status\":\"completed\",\"result\":\"実行結果をここに\"}}\''+'`', "inline": False})
    await send_discord_notification(
        title=f"📋 新しいタスク: {task.title}",
        description=f"**{agent_name}** に新しいタスクが割り当てられました。\n実行してください。",
        color=0x5865F2,  # Discord Blurple
        fields=fields,
    )
    # Broadcast task_created event to all WebSocket clients
    await ws_manager.broadcast({
        "event": "task_created",
        "task_id": task.id,
        "title": task.title,
        "agent_id": task.agent_id,
        "agent_name": agent_name,
        "priority": task.priority or 0,
        "created_at": task.created_at,
    })
    return task


@app.get("/tasks/{task_id}", response_model=Task)
async def get_task(task_id: str):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    return row_to_task(row)


@app.get("/tasks/{task_id}/logs")
async def get_task_logs(task_id: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT timestamp, level, message, tool_name, tool_args, tool_result FROM task_logs WHERE task_id = ? ORDER BY id ASC",
            (task_id,)
        ).fetchall()
    return [dict(r) for r in rows]


@app.put("/tasks/{task_id}", response_model=Task)
async def update_task(task_id: str, task: Task):
    task.updated_at = datetime.utcnow().isoformat()
    with get_db() as conn:
        result = conn.execute(
            "UPDATE tasks SET agent_id=?, title=?, description=?, status=?, progress=?, result=?, error=?, updated_at=? WHERE id=?",
            (task.agent_id, task.title, task.description, task.status,
             task.progress, json.dumps(task.result) if task.result else None,
             task.error, task.updated_at, task_id)
        )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.post("/tasks/{task_id}/execute")
async def execute_task(task_id: str, background_tasks: BackgroundTasks):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    task = dict(row)
    if task["status"] not in ("pending", "failed"):
        raise HTTPException(status_code=400, detail=f"Cannot execute task with status '{task['status']}'")

    background_tasks.add_task(_run_task_with_tools, task_id)
    return {"status": "started", "task_id": task_id}


@app.put("/tasks/{task_id}/retry")
async def retry_task(task_id: str, background_tasks: BackgroundTasks):
    updated_at = datetime.utcnow().isoformat()
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, max_retries, retry_count FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Task not found")
        max_retries = row[1] or 0
        retry_count = row[2] or 0
        if max_retries > 0 and retry_count >= max_retries:
            raise HTTPException(
                status_code=400,
                detail=f"Max retries reached ({retry_count}/{max_retries})"
            )
        new_retry_count = retry_count + 1
        conn.execute(
            "UPDATE tasks SET status='pending', progress=0, error=NULL, updated_at=?, retry_count=? WHERE id=?",
            (updated_at, new_retry_count, task_id)
        )
    background_tasks.add_task(_run_task_with_tools, task_id)
    return {"status": "retried", "task_id": task_id, "retry_count": new_retry_count}


VALID_TASK_STATUSES = {"pending", "running", "completed", "failed", "cancelled"}


@app.put("/tasks/{task_id}/status")
async def update_task_status(task_id: str, body: dict = Body(...)):
    """Update task status. Body: {"status": "running"|"completed"|"failed"|"cancelled", "result": "optional comment"}"""
    new_status = body.get("status")
    result_comment = body.get("result")
    if not new_status or new_status not in VALID_TASK_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(sorted(VALID_TASK_STATUSES))}"
        )

    updated_at = datetime.utcnow().isoformat()
    # Auto-set progress based on status
    progress_map = {"running": 50, "completed": 100, "failed": None, "cancelled": None, "pending": 0}
    progress_val = progress_map.get(new_status)

    task_title = task_id
    agent_name = None
    retried = False
    with get_db() as conn:
        row = conn.execute(
            "SELECT tasks.id, tasks.title, agents.name, tasks.max_retries, tasks.retry_count, tasks.agent_id "
            "FROM tasks LEFT JOIN agents ON tasks.agent_id = agents.id WHERE tasks.id = ?",
            (task_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Task not found")
        task_title = row[1] or task_id
        agent_name = row[2]
        max_retries = row[3] or 0
        retry_count = row[4] or 0
        agent_id_for_retry = row[5]

        if progress_val is not None and result_comment is not None:
            conn.execute(
                "UPDATE tasks SET status=?, progress=?, result=?, updated_at=? WHERE id=?",
                (new_status, progress_val, result_comment, updated_at, task_id)
            )
        elif progress_val is not None:
            conn.execute(
                "UPDATE tasks SET status=?, progress=?, updated_at=? WHERE id=?",
                (new_status, progress_val, updated_at, task_id)
            )
        elif result_comment is not None:
            conn.execute(
                "UPDATE tasks SET status=?, result=?, updated_at=? WHERE id=?",
                (new_status, result_comment, updated_at, task_id)
            )
        else:
            conn.execute(
                "UPDATE tasks SET status=?, updated_at=? WHERE id=?",
                (new_status, updated_at, task_id)
            )

        # Auto-retry logic: if failed and retries remaining, create new pending task
        if new_status == "failed" and retry_count < max_retries:
            new_retry_count = retry_count + 1
            conn.execute(
                "UPDATE tasks SET retry_count=? WHERE id=?",
                (new_retry_count, task_id)
            )
            retry_task_id = str(uuid.uuid4())
            retry_at = datetime.utcnow().isoformat()
            conn.execute(
                "INSERT INTO tasks (id, agent_id, title, description, status, progress, result, error, "
                "created_at, updated_at, priority, due_date, max_retries, retry_count) "
                "SELECT ?, agent_id, title || ' (retry ' || ? || ')', description, 'pending', 0, NULL, NULL, "
                "?, ?, priority, due_date, max_retries, ? FROM tasks WHERE id=?",
                (retry_task_id, new_retry_count, retry_at, retry_at, new_retry_count, task_id)
            )
            retried = True

    await ws_manager.broadcast({
        "event": "task_status_changed",
        "task_id": task_id,
        "status": new_status,
        "updated_at": updated_at,
    })

    if new_status in {"completed", "failed", "cancelled"}:
        status_emoji = {"completed": "✅", "failed": "❌", "cancelled": "⏹️"}.get(new_status, "")
        fields = [{"name": "Task", "value": task_title, "inline": True}]
        if agent_name:
            fields.append({"name": "Agent", "value": agent_name, "inline": True})
        if result_comment:
            fields.append({"name": "実行結果", "value": result_comment[:1000], "inline": False})
        if retried:
            fields.append({"name": "Auto-Retry", "value": f"再試行タスクを自動作成しました（{retry_count + 1}/{max_retries}）", "inline": False})
        await send_discord_notification(
            title=f"{status_emoji} Task {new_status.capitalize()}",
            description=f"Task status changed to **{new_status}**",
            color=STATUS_COLORS.get(new_status, 0x99AAB5),
            fields=fields,
        )

    return {"task_id": task_id, "status": new_status, "updated_at": updated_at, "retried": retried}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """WebSocket endpoint for real-time agent/task status updates."""
    await ws_manager.connect(ws)
    try:
        # Send initial state
        with get_db() as conn:
            agents = conn.execute("SELECT id, name, status FROM agents").fetchall()
        await ws.send_text(json.dumps({
            "event": "init",
            "agents": [{"id": r[0], "name": r[1], "status": r[2]} for r in agents],
        }))
        # Keep alive until client disconnects
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)


@app.get("/agent-whisper/traces")
async def get_agent_whisper_traces(agent_id: Optional[str] = Query(None)):
    """
    Proxy endpoint to fetch traces from agent-whisper.
    Forwards requests to agent-whisper backend.
    """
    import aiohttp
    import asyncio
    
    try:
        agent_whisper_url = "http://agent-whisper:8000"  # Docker internal name
        endpoint = "/api/traces"
        params = {}
        if agent_id:
            params["agent_id"] = agent_id
        
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{agent_whisper_url}{endpoint}", params=params, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return {"traces": data}
                else:
                    raise HTTPException(status_code=resp.status, detail="agent-whisper request failed")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching traces: {str(e)}")


@app.post("/tasks/{task_id}/progress")
async def report_task_progress(task_id: str, body: dict = Body(...)):
    """
    エージェントからタスク進捗レポートを受け取るエンドポイント。
    body: {
        "progress": 0-100 (int),
        "message": "進捗メッセージ" (str, optional),
        "status": "running|completed|failed" (str, optional)
    }
    """
    progress = body.get("progress")
    message = body.get("message", "")
    new_status = body.get("status")
    updated_at = datetime.utcnow().isoformat()

    if progress is not None and not (0 <= int(progress) <= 100):
        raise HTTPException(status_code=400, detail="progress must be 0-100")

    with get_db() as conn:
        row = conn.execute("SELECT id, status FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Task not found")

        if progress is not None and new_status:
            conn.execute(
                "UPDATE tasks SET progress=?, status=?, updated_at=? WHERE id=?",
                (int(progress), new_status, updated_at, task_id)
            )
        elif progress is not None:
            conn.execute(
                "UPDATE tasks SET progress=?, updated_at=? WHERE id=?",
                (int(progress), updated_at, task_id)
            )
        elif new_status:
            conn.execute(
                "UPDATE tasks SET status=?, updated_at=? WHERE id=?",
                (new_status, updated_at, task_id)
            )

        if message:
            _add_task_log(conn, task_id, "INFO", message)

    await ws_manager.broadcast({
        "event": "task_progress",
        "task_id": task_id,
        "progress": progress,
        "status": new_status,
        "message": message,
        "updated_at": updated_at,
    })

    return {"task_id": task_id, "progress": progress, "status": new_status, "updated_at": updated_at}


@app.post("/tasks/{task_id}/logs")
async def add_task_log(task_id: str, body: dict = Body(...)):
    """
    エージェントからタスクログを追加するエンドポイント。
    body: {
        "level": "INFO|WARN|ERROR" (str),
        "message": "ログメッセージ" (str),
        "tool_name": "ツール名" (str, optional),
        "tool_args": "ツール引数" (str, optional),
        "tool_result": "ツール結果" (str, optional)
    }
    """
    level = body.get("level", "INFO")
    message = body.get("message", "")
    tool_name = body.get("tool_name")
    tool_args = body.get("tool_args")
    tool_result = body.get("tool_result")

    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    with get_db() as conn:
        row = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Task not found")

        _add_task_log(conn, task_id, level, message, tool_name, tool_args, tool_result)

    await ws_manager.broadcast({
        "event": "task_log",
        "task_id": task_id,
        "level": level,
        "message": message,
        "tool_name": tool_name,
    })

    return {"task_id": task_id, "status": "logged"}


@app.get("/status", response_model=SystemStatus)
async def get_status():
    with get_db() as conn:
        total_agents = conn.execute("SELECT COUNT(*) FROM agents").fetchone()[0]
        active_agents = conn.execute("SELECT COUNT(*) FROM agents WHERE status='running'").fetchone()[0]
        total_tasks = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
        pending_tasks = conn.execute("SELECT COUNT(*) FROM tasks WHERE status='pending'").fetchone()[0]
        running_tasks = conn.execute("SELECT COUNT(*) FROM tasks WHERE status='running'").fetchone()[0]
        completed_tasks = conn.execute("SELECT COUNT(*) FROM tasks WHERE status='completed'").fetchone()[0]
        failed_tasks = conn.execute("SELECT COUNT(*) FROM tasks WHERE status='failed'").fetchone()[0]
    return SystemStatus(
        total_agents=total_agents,
        active_agents=active_agents,
        total_tasks=total_tasks,
        pending_tasks=pending_tasks,
        running_tasks=running_tasks,
        completed_tasks=completed_tasks,
        failed_tasks=failed_tasks
    )


@app.get("/timeline")
async def get_timeline(
    agent_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    """
    Unified timeline of Hermes tasks and agent-whisper traces, merged and sorted by timestamp.
    Each item has: type, timestamp, title, status, agent_id, and relevant details.
    """
    # Fetch Hermes tasks
    query = "SELECT id, agent_id, title, description, status, progress, created_at, updated_at FROM tasks WHERE 1=1"
    params: list = []
    if agent_id:
        query += " AND agent_id = ?"
        params.append(agent_id)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    with get_db() as conn:
        task_rows = conn.execute(query, params).fetchall()

    timeline: list[dict] = []
    for row in task_rows:
        d = dict(row)
        ts = d.get("created_at") or ""
        timeline.append({
            "type": "task",
            "timestamp": ts,
            "title": d.get("title", ""),
            "status": d.get("status", ""),
            "agent_id": d.get("agent_id", ""),
            "details": {
                "id": d.get("id"),
                "description": d.get("description", ""),
                "progress": d.get("progress", 0),
                "updated_at": d.get("updated_at", ""),
            },
        })

    # Fetch agent-whisper traces
    try:
        aw_url = "http://agent-whisper:8000"
        aw_params: dict = {"limit": limit}
        if agent_id:
            aw_params["agent_id"] = agent_id
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{aw_url}/traces",
                params=aw_params,
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status == 200:
                    traces = await resp.json()
                    for trace in traces:
                        ts = trace.get("started_at") or trace.get("created_at") or ""
                        timeline.append({
                            "type": "trace",
                            "timestamp": ts,
                            "title": trace.get("trace_id", ""),
                            "status": trace.get("status", ""),
                            "agent_id": str(trace.get("agent_id", "")),
                            "details": {
                                "trace_id": trace.get("trace_id"),
                                "tool_call_count": trace.get("tool_call_count", 0),
                                "session_id": trace.get("session_id", ""),
                                "ended_at": trace.get("ended_at", ""),
                            },
                        })
    except Exception:
        pass  # AW unavailable — return tasks only

    # Merge-sort by timestamp descending
    timeline.sort(key=lambda x: x["timestamp"] or "", reverse=True)
    return timeline[:limit]


@app.get("/agents/compare")
def get_agents_compare():
    """エージェントごとのタスク統計を返す比較ビュー用エンドポイント"""
    with get_db() as conn:
        agents = [dict(r) for r in conn.execute("SELECT id, name, status FROM agents").fetchall()]
        result = []
        for agent in agents:
            aid = agent["id"]
            rows = conn.execute(
                "SELECT status, progress FROM tasks WHERE agent_id = ?", (aid,)
            ).fetchall()
            total = len(rows)
            completed = sum(1 for r in rows if r["status"] == "completed")
            failed = sum(1 for r in rows if r["status"] == "failed")
            running = sum(1 for r in rows if r["status"] == "running")
            pending = sum(1 for r in rows if r["status"] == "pending")
            completed_progresses = [r["progress"] for r in rows if r["status"] == "completed" and r["progress"] is not None]
            avg_progress = (sum(completed_progresses) / len(completed_progresses)) if completed_progresses else 0.0
            result.append({
                "agent_id": aid,
                "agent_name": agent["name"],
                "status": agent["status"],
                "total_tasks": total,
                "completed_tasks": completed,
                "failed_tasks": failed,
                "running_tasks": running,
                "pending_tasks": pending,
                "avg_progress": round(avg_progress, 1),
            })
    return result


@app.post("/test/discord-notify")
async def test_discord_notify():
    """Test Discord webhook notification."""
    if not DISCORD_WEBHOOK_URL:
        return {"status": "skipped", "reason": "DISCORD_WEBHOOK_URL not configured"}
    await send_discord_notification(
        title="🧪 Hermes テスト通知",
        description="Discord Webhook が正常に動作しています！",
        color=5763719,
        fields=[{"name": "送信元", "value": "Hermes API /test/discord-notify", "inline": True}]
    )
    return {"status": "sent", "webhook_url": DISCORD_WEBHOOK_URL[:50] + "..."}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
