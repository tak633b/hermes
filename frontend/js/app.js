// ページ読み込み時
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    loadDashboard();
    setupEventListeners();
    
    // 5秒ごとにステータスを更新
    setInterval(updateDashboard, 5000);
});

function setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabName = e.target.dataset.tab;
            switchTab(tabName);
        });
    });

    // Agent form
    document.getElementById('create-agent-btn').addEventListener('click', () => {
        document.getElementById('create-agent-form').style.display = 'block';
        document.getElementById('agent-name').focus();
    });

    document.getElementById('cancel-agent-btn').addEventListener('click', () => {
        document.getElementById('create-agent-form').style.display = 'none';
        document.getElementById('agent-form').reset();
    });

    document.getElementById('agent-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('agent-name').value;
        const description = document.getElementById('agent-description').value;
        
        try {
            await API.createAgent(name, description);
            alert('エージェントを作成しました');
            document.getElementById('agent-form').reset();
            document.getElementById('create-agent-form').style.display = 'none';
            loadAgents();
        } catch (error) {
            alert('エラー: ' + error.message);
        }
    });

    // Task form
    document.getElementById('create-task-btn').addEventListener('click', () => {
        document.getElementById('create-task-form').style.display = 'block';
        loadAgentSelect();
        document.getElementById('task-title').focus();
    });

    document.getElementById('cancel-task-btn').addEventListener('click', () => {
        document.getElementById('create-task-form').style.display = 'none';
        document.getElementById('task-form').reset();
    });

    document.getElementById('task-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const agentId = document.getElementById('task-agent').value;
        const title = document.getElementById('task-title').value;
        const description = document.getElementById('task-description').value;
        
        if (!agentId) {
            alert('エージェントを選択してください');
            return;
        }

        try {
            await API.createTask(agentId, title, description);
            alert('タスクを作成しました');
            document.getElementById('task-form').reset();
            document.getElementById('create-task-form').style.display = 'none';
            loadTasks();
        } catch (error) {
            alert('エラー: ' + error.message);
        }
    });

    // Task status filter
    document.getElementById('task-status-filter').addEventListener('change', loadTasks);

    // Modal close (task)
    document.getElementById('task-modal').addEventListener('click', (e) => {
        if (e.target.id === 'task-modal') closeModal('task-modal');
    });
    // Modal close (agent)
    document.getElementById('agent-modal').addEventListener('click', (e) => {
        if (e.target.id === 'agent-modal') closeModal('agent-modal');
    });
}

async function initializeApp() {
    try {
        await API.getHealth();
        console.log('Backend is healthy');
    } catch (error) {
        alert('バックエンドに接続できません: ' + error.message);
    }
}

function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Remove active from all nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab
    document.getElementById(tabName).classList.add('active');
    
    // Add active to clicked button
    event.target.classList.add('active');
    
    // Load data for the tab
    if (tabName === 'agents') {
        loadAgents();
    } else if (tabName === 'tasks') {
        loadTasks();
    }
}

async function loadDashboard() {
    try {
        const status = await API.getStatus();
        updateDashboardUI(status);
        
        const tasks = await API.getTasks();
        displayRecentTasks(tasks.slice(0, 5));
    } catch (error) {
        console.error('Dashboard load error:', error);
    }
}

async function updateDashboard() {
    try {
        const status = await API.getStatus();
        updateDashboardUI(status);
    } catch (error) {
        console.error('Dashboard update error:', error);
    }
}

function updateDashboardUI(status) {
    document.getElementById('total-agents').textContent = status.total_agents;
    document.getElementById('active-agents').textContent = status.active_agents;
    document.getElementById('total-tasks').textContent = status.total_tasks;
    document.getElementById('pending-tasks').textContent = status.pending_tasks;
    document.getElementById('running-tasks').textContent = status.running_tasks;
    document.getElementById('completed-tasks').textContent = status.completed_tasks;
    document.getElementById('failed-tasks').textContent = status.failed_tasks;
}

function displayRecentTasks(tasks) {
    const container = document.getElementById('recent-tasks');
    
    if (tasks.length === 0) {
        container.innerHTML = '<p class="empty">タスクがありません</p>';
        return;
    }
    
    container.innerHTML = tasks.map(task => {
        const statusClass = `status-${task.status}`;
        return `
            <div class="recent-task">
                <div class="recent-task-info">
                    <h4>${escapeHtml(task.title)}</h4>
                    <p class="recent-task-agent">Agent: ${escapeHtml(task.agent_id)}</p>
                </div>
                <span class="card-status ${statusClass}">${task.status}</span>
            </div>
        `;
    }).join('');
}

async function loadAgents() {
    try {
        const agents = await API.getAgents();
        displayAgents(agents);
    } catch (error) {
        console.error('Load agents error:', error);
        document.getElementById('agents-list').innerHTML = `<p class="empty">エラー: ${error.message}</p>`;
    }
}

function displayAgents(agents) {
    const container = document.getElementById('agents-list');
    
    if (agents.length === 0) {
        container.innerHTML = '<p class="empty">エージェントがありません</p>';
        return;
    }
    
    container.innerHTML = '';
    agents.forEach(agent => {
        const card = document.createElement('div');
        card.className = 'agent-card';
        card.style.cursor = 'pointer';
        card.dataset.agentId = agent.id;

        const header = document.createElement('div');
        header.className = 'card-header';

        const title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = agent.name;

        const status = document.createElement('span');
        status.className = `card-status status-${agent.status}`;
        status.textContent = agent.status;

        header.appendChild(title);
        header.appendChild(status);

        const desc = document.createElement('p');
        desc.className = 'card-description';
        desc.textContent = agent.description;

        const meta = document.createElement('div');
        meta.className = 'card-meta';
        meta.textContent = `ID: ${agent.id.substring(0, 8)}...`;

        const hint = document.createElement('span');
        hint.style.cssText = 'float:right;font-size:0.8rem;color:#718096;';
        hint.textContent = 'クリックで詳細';
        meta.appendChild(hint);

        card.appendChild(header);
        card.appendChild(desc);
        card.appendChild(meta);
        card.addEventListener('click', () => showAgentDetail(agent.id));
        container.appendChild(card);
    });
}

async function loadAgentSelect() {
    try {
        const agents = await API.getAgents();
        const select = document.getElementById('task-agent');
        select.innerHTML = '<option value="">選択してください</option>' + 
            agents.map(agent => `<option value="${agent.id}">${escapeHtml(agent.name)}</option>`).join('');
    } catch (error) {
        console.error('Load agent select error:', error);
    }
}

async function loadTasks() {
    try {
        const status = document.getElementById('task-status-filter').value;
        const tasks = await API.getTasks(null, status || null);
        displayTasks(tasks);
    } catch (error) {
        console.error('Load tasks error:', error);
        document.getElementById('tasks-list').innerHTML = `<p class="empty">エラー: ${error.message}</p>`;
    }
}

function displayTasks(tasks) {
    const container = document.getElementById('tasks-list');
    
    if (tasks.length === 0) {
        container.innerHTML = '<p class="empty">タスクがありません</p>';
        return;
    }
    
    container.innerHTML = tasks.map(task => {
        const statusClass = `status-${task.status}`;
        return `
            <div class="task-card">
                <div class="card-header">
                    <div>
                        <div class="card-title">${escapeHtml(task.title)}</div>
                        <div class="card-meta">Agent: ${escapeHtml(task.agent_id.substring(0, 8))}</div>
                    </div>
                    <span class="card-status ${statusClass}">${task.status}</span>
                </div>
                <p class="card-description">${escapeHtml(task.description)}</p>
                ${task.progress !== undefined ? `
                    <div class="card-progress">
                        <p style="font-size: 0.85rem; margin-bottom: 0.5rem;">進捗: ${task.progress}%</p>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${task.progress}%"></div>
                        </div>
                    </div>
                ` : ''}
                <div class="card-actions">
                    <button class="btn btn-primary btn-small" onclick="showTaskDetail('${task.id}')">詳細</button>
                    ${task.status === 'failed' ? `
                        <button class="btn btn-warning btn-small" onclick="retryTask('${task.id}')">再試行</button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

async function showAgentDetail(agentId) {
    try {
        const [agent, logs, memory] = await Promise.all([
            API.getAgent(agentId),
            API.getAgentLogs(agentId),
            API.getAgentMemory(agentId)
        ]);

        const modal = document.getElementById('agent-modal');
        const content = document.getElementById('agent-detail-content');
        content.innerHTML = '';

        const h2 = document.createElement('h2');
        h2.textContent = agent.name;
        content.appendChild(h2);

        // Basic info
        const info = document.createElement('div');
        info.style.marginTop = '1rem';
        [
            ['説明', agent.description],
            ['ステータス', agent.status],
            ['ID', agent.id],
            ['作成日時', agent.created_at ? new Date(agent.created_at).toLocaleString('ja-JP') : '-'],
        ].forEach(([label, value]) => {
            const p = document.createElement('p');
            const strong = document.createElement('strong');
            strong.textContent = label + ': ';
            p.appendChild(strong);
            p.appendChild(document.createTextNode(value));
            info.appendChild(p);
        });
        content.appendChild(info);

        // Parameters
        const paramSection = document.createElement('div');
        paramSection.style.marginTop = '1.5rem';
        const paramTitle = document.createElement('h4');
        paramTitle.textContent = 'パラメータ';
        paramSection.appendChild(paramTitle);
        const paramPre = document.createElement('pre');
        paramPre.style.cssText = 'background:#f7fafc;padding:1rem;border-radius:4px;overflow-x:auto;font-size:0.85rem;';
        paramPre.textContent = JSON.stringify(agent.parameters || {}, null, 2);
        paramSection.appendChild(paramPre);
        content.appendChild(paramSection);

        // Memory
        const memSection = document.createElement('div');
        memSection.style.marginTop = '1.5rem';
        const memTitle = document.createElement('h4');
        memTitle.textContent = 'メモリ';
        memSection.appendChild(memTitle);
        if (memory.length === 0) {
            const p = document.createElement('p');
            p.className = 'empty';
            p.textContent = 'メモリがありません';
            memSection.appendChild(p);
        } else {
            memory.forEach(m => {
                const row = document.createElement('div');
                row.style.cssText = 'padding:0.5rem;background:#f7fafc;border-radius:4px;margin-bottom:0.5rem;';
                const key = document.createElement('strong');
                key.textContent = m.key + ': ';
                row.appendChild(key);
                row.appendChild(document.createTextNode(m.value));
                memSection.appendChild(row);
            });
        }
        content.appendChild(memSection);

        // Logs
        const logSection = document.createElement('div');
        logSection.style.marginTop = '1.5rem';
        const logTitle = document.createElement('h4');
        logTitle.textContent = 'ログ';
        logSection.appendChild(logTitle);
        if (logs.length === 0) {
            const p = document.createElement('p');
            p.className = 'empty';
            p.textContent = 'ログがありません';
            logSection.appendChild(p);
        } else {
            const logPre = document.createElement('pre');
            logPre.style.cssText = 'background:#1a202c;color:#e2e8f0;padding:1rem;border-radius:4px;overflow-x:auto;font-size:0.8rem;max-height:300px;overflow-y:auto;';
            logPre.textContent = logs.map(l => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`).join('\n');
            logSection.appendChild(logPre);
        }
        content.appendChild(logSection);

        modal.classList.add('active');
    } catch (error) {
        alert('エージェント情報の取得に失敗しました: ' + error.message);
    }
}

async function showTaskDetail(taskId) {
    try {
        const task = await API.getTask(taskId);
        const modal = document.getElementById('task-modal');
        const content = document.getElementById('task-detail-content');
        
        let resultHTML = '';
        if (task.result) {
            resultHTML = `
                <div style="margin-top: 1.5rem; padding: 1rem; background-color: #f7fafc; border-radius: 4px;">
                    <h4>実行結果</h4>
                    <pre style="background: white; padding: 1rem; border-radius: 4px; overflow-x: auto;">${JSON.stringify(task.result, null, 2)}</pre>
                </div>
            `;
        }
        
        let errorHTML = '';
        if (task.error) {
            errorHTML = `
                <div style="margin-top: 1.5rem; padding: 1rem; background-color: #fed7d7; border-radius: 4px; border-left: 4px solid #f56565;">
                    <h4>エラー</h4>
                    <p>${escapeHtml(task.error)}</p>
                </div>
            `;
        }
        
        content.innerHTML = `
            <h2>${escapeHtml(task.title)}</h2>
            <div style="margin-top: 1rem;">
                <p><strong>説明:</strong> ${escapeHtml(task.description)}</p>
                <p><strong>ステータス:</strong> <span class="card-status status-${task.status}">${task.status}</span></p>
                <p><strong>進捗:</strong> ${task.progress}%</p>
                <p><strong>作成日時:</strong> ${new Date(task.created_at).toLocaleString('ja-JP')}</p>
                <p><strong>更新日時:</strong> ${new Date(task.updated_at).toLocaleString('ja-JP')}</p>
            </div>
            ${resultHTML}
            ${errorHTML}
            ${task.status === 'failed' ? `
                <div style="margin-top: 1.5rem;">
                    <button class="btn btn-primary" onclick="retryTask('${task.id}')">再試行</button>
                </div>
            ` : ''}
        `;
        
        modal.classList.add('active');
    } catch (error) {
        alert('タスク情報の取得に失敗しました: ' + error.message);
    }
}

async function retryTask(taskId) {
    try {
        await API.retryTask(taskId);
        alert('タスクを再実行しました');
        closeModal('task-modal');
        loadTasks();
    } catch (error) {
        alert('再実行に失敗しました: ' + error.message);
    }
}

function closeModal(modalId) {
    const id = modalId || 'task-modal';
    document.getElementById(id).classList.remove('active');
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}
