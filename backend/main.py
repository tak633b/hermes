from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional
import uuid
import sqlite3
from contextlib import contextmanager
from pathlib import Path
import llm_client

app = FastAPI(title="Hermes Agent Orchestration")

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
        """)


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


import json


def row_to_agent(row) -> dict:
    d = dict(row)
    if d.get("parameters"):
        try:
            d["parameters"] = json.loads(d["parameters"])
        except Exception:
            d["parameters"] = None
    return d


def row_to_task(row) -> dict:
    d = dict(row)
    if d.get("result"):
        try:
            d["result"] = json.loads(d["result"])
        except Exception:
            d["result"] = None
    return d


# Models
class Agent(BaseModel):
    id: Optional[str] = None
    name: str
    description: str
    status: str = "idle"
    parameters: Optional[dict] = None
    created_at: Optional[str] = None


class AgentLog(BaseModel):
    timestamp: str
    level: str = "info"
    message: str


class AgentMemory(BaseModel):
    key: str
    value: str


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


@app.get("/agents", response_model=List[Agent])
async def list_agents():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM agents ORDER BY created_at DESC").fetchall()
    return [row_to_agent(r) for r in rows]


@app.post("/agents", response_model=Agent)
async def create_agent(agent: Agent):
    agent.id = str(uuid.uuid4())
    agent.created_at = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO agents (id, name, description, status, parameters, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (agent.id, agent.name, agent.description, agent.status,
             json.dumps(agent.parameters) if agent.parameters else None,
             agent.created_at)
        )
    return agent


@app.get("/agents/{agent_id}", response_model=Agent)
async def get_agent(agent_id: str):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM agents WHERE id = ?", (agent_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    return row_to_agent(row)


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


@app.put("/agents/{agent_id}/memory")
async def update_agent_memory(agent_id: str, memory: AgentMemory):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO agent_memory (agent_id, key, value) VALUES (?, ?, ?) ON CONFLICT(agent_id, key) DO UPDATE SET value = excluded.value",
            (agent_id, memory.key, memory.value)
        )
    return memory


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
            "INSERT INTO tasks (id, agent_id, title, description, status, progress, result, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (task.id, task.agent_id, task.title, task.description, task.status,
             task.progress, json.dumps(task.result) if task.result else None,
             task.error, task.created_at, task.updated_at)
        )
    return task


@app.get("/tasks/{task_id}", response_model=Task)
async def get_task(task_id: str):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    return row_to_task(row)


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


def _run_task_with_llm(task_id: str):
    """バックグラウンドでLLMタスクを実行し、結果をDBに保存する"""
    import json as _json
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

            # ステータスを running に
            now = datetime.utcnow().isoformat()
            conn.execute(
                "UPDATE tasks SET status='running', progress=10, updated_at=? WHERE id=?",
                (now, task_id)
            )
            # ログ記録
            conn.execute(
                "INSERT INTO agent_logs (agent_id, timestamp, level, message) VALUES (?, ?, ?, ?)",
                (agent["id"], now, "info", f"タスク開始: {task['title']}")
            )

        result = llm_client.execute_task(
            agent_name=agent["name"],
            agent_description=agent["description"],
            task_title=task["title"],
            task_description=task["description"]
        )

        finished_at = datetime.utcnow().isoformat()
        with get_db() as conn:
            conn.execute(
                "UPDATE tasks SET status='completed', progress=100, result=?, updated_at=? WHERE id=?",
                (_json.dumps(result, ensure_ascii=False), finished_at, task_id)
            )
            conn.execute(
                "INSERT INTO agent_logs (agent_id, timestamp, level, message) VALUES (?, ?, ?, ?)",
                (agent["id"], finished_at, "info",
                 f"タスク完了: {task['title']} | 入力{result['usage']['input_tokens']}トークン / 出力{result['usage']['output_tokens']}トークン")
            )
    except Exception as e:
        error_msg = str(e)
        err_at = datetime.utcnow().isoformat()
        try:
            with get_db() as conn:
                conn.execute(
                    "UPDATE tasks SET status='failed', error=?, updated_at=? WHERE id=?",
                    (error_msg, err_at, task_id)
                )
                conn.execute(
                    "INSERT INTO agent_logs (agent_id, timestamp, level, message) VALUES (?, ?, ?, ?)",
                    (task.get("agent_id", ""), err_at, "error", f"タスク失敗: {error_msg}")
                )
        except Exception:
            pass


@app.post("/tasks/{task_id}/execute")
async def execute_task(task_id: str, background_tasks: BackgroundTasks):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    task = dict(row)
    if task["status"] not in ("pending", "failed"):
        raise HTTPException(status_code=400, detail=f"Cannot execute task with status '{task['status']}'")

    background_tasks.add_task(_run_task_with_llm, task_id)
    return {"status": "started", "task_id": task_id}


@app.put("/tasks/{task_id}/retry")
async def retry_task(task_id: str):
    updated_at = datetime.utcnow().isoformat()
    with get_db() as conn:
        result = conn.execute(
            "UPDATE tasks SET status='pending', progress=0, error=NULL, updated_at=? WHERE id=?",
            (updated_at, task_id)
        )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": "retried"}


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
