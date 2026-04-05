from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional
import uuid
import json
from pathlib import Path

app = FastAPI(title="Hermes Agent Orchestration")

# CORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# データ保存用（実運用はDBを使用）
DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)

# モデル定義
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

# ヘルスチェック
@app.get("/health")
async def health():
    return {"status": "ok"}

# Agent API
@app.get("/agents", response_model=List[Agent])
async def list_agents():
    agents_file = DATA_DIR / "agents.json"
    if not agents_file.exists():
        return []
    with open(agents_file) as f:
        return json.load(f)

@app.post("/agents", response_model=Agent)
async def create_agent(agent: Agent):
    agent.id = str(uuid.uuid4())
    agent.created_at = datetime.utcnow().isoformat()
    
    agents_file = DATA_DIR / "agents.json"
    agents = []
    if agents_file.exists():
        with open(agents_file) as f:
            agents = json.load(f)
    
    agents.append(agent.dict())
    with open(agents_file, "w") as f:
        json.dump(agents, f, indent=2)
    
    return agent

@app.get("/agents/{agent_id}", response_model=Agent)
async def get_agent(agent_id: str):
    agents_file = DATA_DIR / "agents.json"
    if not agents_file.exists():
        raise HTTPException(status_code=404, detail="Agent not found")
    
    with open(agents_file) as f:
        agents = json.load(f)
    
    agent = next((a for a in agents if a["id"] == agent_id), None)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    return agent

# Task API
@app.get("/tasks", response_model=List[Task])
async def list_tasks(agent_id: Optional[str] = Query(None), status: Optional[str] = Query(None)):
    tasks_file = DATA_DIR / "tasks.json"
    if not tasks_file.exists():
        return []
    
    with open(tasks_file) as f:
        tasks = json.load(f)
    
    if agent_id:
        tasks = [t for t in tasks if t["agent_id"] == agent_id]
    if status:
        tasks = [t for t in tasks if t["status"] == status]
    
    return tasks

@app.post("/tasks", response_model=Task)
async def create_task(task: Task):
    task.id = str(uuid.uuid4())
    task.created_at = datetime.utcnow().isoformat()
    task.updated_at = datetime.utcnow().isoformat()
    
    tasks_file = DATA_DIR / "tasks.json"
    tasks = []
    if tasks_file.exists():
        with open(tasks_file) as f:
            tasks = json.load(f)
    
    tasks.append(task.dict())
    with open(tasks_file, "w") as f:
        json.dump(tasks, f, indent=2)
    
    return task

@app.get("/tasks/{task_id}", response_model=Task)
async def get_task(task_id: str):
    tasks_file = DATA_DIR / "tasks.json"
    if not tasks_file.exists():
        raise HTTPException(status_code=404, detail="Task not found")
    
    with open(tasks_file) as f:
        tasks = json.load(f)
    
    task = next((t for t in tasks if t["id"] == task_id), None)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    return task

@app.put("/tasks/{task_id}", response_model=Task)
async def update_task(task_id: str, task: Task):
    tasks_file = DATA_DIR / "tasks.json"
    if not tasks_file.exists():
        raise HTTPException(status_code=404, detail="Task not found")
    
    with open(tasks_file) as f:
        tasks = json.load(f)
    
    task_index = next((i for i, t in enumerate(tasks) if t["id"] == task_id), None)
    if task_index is None:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task.updated_at = datetime.utcnow().isoformat()
    tasks[task_index] = task.dict()
    
    with open(tasks_file, "w") as f:
        json.dump(tasks, f, indent=2)
    
    return task

@app.get("/agents/{agent_id}/logs")
async def get_agent_logs(agent_id: str):
    logs_file = DATA_DIR / f"agent_{agent_id}_logs.json"
    if not logs_file.exists():
        return []
    with open(logs_file) as f:
        return json.load(f)

@app.post("/agents/{agent_id}/logs")
async def add_agent_log(agent_id: str, log: AgentLog):
    logs_file = DATA_DIR / f"agent_{agent_id}_logs.json"
    logs = []
    if logs_file.exists():
        with open(logs_file) as f:
            logs = json.load(f)
    logs.append(log.dict())
    with open(logs_file, "w") as f:
        json.dump(logs, f, indent=2)
    return log

@app.get("/agents/{agent_id}/memory")
async def get_agent_memory(agent_id: str):
    memory_file = DATA_DIR / f"agent_{agent_id}_memory.json"
    if not memory_file.exists():
        return []
    with open(memory_file) as f:
        return json.load(f)

@app.put("/agents/{agent_id}/memory")
async def update_agent_memory(agent_id: str, memory: AgentMemory):
    memory_file = DATA_DIR / f"agent_{agent_id}_memory.json"
    items = []
    if memory_file.exists():
        with open(memory_file) as f:
            items = json.load(f)
    existing = next((i for i, m in enumerate(items) if m["key"] == memory.key), None)
    if existing is not None:
        items[existing] = memory.dict()
    else:
        items.append(memory.dict())
    with open(memory_file, "w") as f:
        json.dump(items, f, indent=2)
    return memory

@app.put("/agents/{agent_id}/parameters")
async def update_agent_parameters(agent_id: str, parameters: dict):
    agents_file = DATA_DIR / "agents.json"
    if not agents_file.exists():
        raise HTTPException(status_code=404, detail="Agent not found")
    with open(agents_file) as f:
        agents = json.load(f)
    idx = next((i for i, a in enumerate(agents) if a["id"] == agent_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    agents[idx]["parameters"] = parameters
    with open(agents_file, "w") as f:
        json.dump(agents, f, indent=2)
    return {"status": "updated"}

@app.put("/tasks/{task_id}/retry")
async def retry_task(task_id: str):
    tasks_file = DATA_DIR / "tasks.json"
    if not tasks_file.exists():
        raise HTTPException(status_code=404, detail="Task not found")
    
    with open(tasks_file) as f:
        tasks = json.load(f)
    
    task_index = next((i for i, t in enumerate(tasks) if t["id"] == task_id), None)
    if task_index is None:
        raise HTTPException(status_code=404, detail="Task not found")
    
    tasks[task_index]["status"] = "pending"
    tasks[task_index]["progress"] = 0
    tasks[task_index]["error"] = None
    tasks[task_index]["updated_at"] = datetime.utcnow().isoformat()
    
    with open(tasks_file, "w") as f:
        json.dump(tasks, f, indent=2)
    
    return {"status": "retried"}

# Status API
@app.get("/status", response_model=SystemStatus)
async def get_status():
    agents_file = DATA_DIR / "agents.json"
    tasks_file = DATA_DIR / "tasks.json"
    
    agents = []
    tasks = []
    
    if agents_file.exists():
        with open(agents_file) as f:
            agents = json.load(f)
    
    if tasks_file.exists():
        with open(tasks_file) as f:
            tasks = json.load(f)
    
    active_agents = sum(1 for a in agents if a.get("status") == "running")
    pending_tasks = sum(1 for t in tasks if t.get("status") == "pending")
    running_tasks = sum(1 for t in tasks if t.get("status") == "running")
    completed_tasks = sum(1 for t in tasks if t.get("status") == "completed")
    failed_tasks = sum(1 for t in tasks if t.get("status") == "failed")
    
    return SystemStatus(
        total_agents=len(agents),
        active_agents=active_agents,
        total_tasks=len(tasks),
        pending_tasks=pending_tasks,
        running_tasks=running_tasks,
        completed_tasks=completed_tasks,
        failed_tasks=failed_tasks
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
