// リアルタイムログポーリング用
let agentLogInterval = null;
let currentAgentId = null;

async function refreshAgentLogs(agentId, logPre) {
    try {
        const logs = await API.getAgentLogs(agentId);
        if (logs.length === 0) {
            logPre.textContent = '（ログがありません）';
        } else {
            logPre.textContent = logs.map(l => '[' + l.timestamp + '] [' + l.level.toUpperCase() + '] ' + l.message).join('\n');
            logPre.scrollTop = logPre.scrollHeight;
        }
    } catch (_e) {}
}

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
                    ${task.status === 'pending' || task.status === 'failed' ? `
                        <button class="btn btn-success btn-small" onclick="executeTask('${task.id}')">▶ LLM実行</button>
                    ` : ''}
                    ${task.status === 'failed' ? `
                        <button class="btn btn-warning btn-small" onclick="retryTask('${task.id}')">再試行</button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

async function refreshAgentLogs(agentId, logPre) {
    try {
        const logs = await API.getAgentLogs(agentId);
        if (logs.length === 0) {
            logPre.textContent = '（ログがありません）';
        } else {
            const text = logs.map(l => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`).join('\n');
            logPre.textContent = text;
            logPre.scrollTop = logPre.scrollHeight;
        }
    } catch (_e) {}
}

async function showAgentDetail(agentId) {
    // 前のポーリングを停止
    if (agentLogInterval) {
        clearInterval(agentLogInterval);
        agentLogInterval = null;
    }
    currentAgentId = agentId;

    try {
        const [agent, logs, memory, agentTasks] = await Promise.all([
            API.getAgent(agentId),
            API.getAgentLogs(agentId),
            API.getAgentMemory(agentId),
            API.getTasks(agentId)
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

        // Tasks section
        const taskSection = document.createElement('div');
        taskSection.style.marginTop = '1.5rem';
        const taskSectionTitle = document.createElement('h4');
        taskSectionTitle.textContent = 'タスク一覧 (' + agentTasks.length + '件)';
        taskSection.appendChild(taskSectionTitle);
        if (agentTasks.length === 0) {
            const pEmpty = document.createElement('p');
            pEmpty.className = 'empty';
            pEmpty.textContent = 'タスクがありません';
            taskSection.appendChild(pEmpty);
        } else {
            const taskTable = document.createElement('table');
            taskTable.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.85rem;margin-top:0.5rem;';
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            headerRow.style.cssText = 'background:#edf2f7;text-align:left;';
            ['タイトル', 'ステータス', '進捗', '更新日時'].forEach(label => {
                const th = document.createElement('th');
                th.style.padding = '6px 8px';
                th.textContent = label;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);
            taskTable.appendChild(thead);
            const tbody = document.createElement('tbody');
            agentTasks.forEach((t, i) => {
                const tr = document.createElement('tr');
                tr.style.cssText = (i % 2 === 0 ? 'background:#fff;' : 'background:#f7fafc;') + 'cursor:pointer;';
                tr.addEventListener('click', () => { closeModal('agent-modal'); showTaskDetail(t.id); });

                const tdTitle = document.createElement('td');
                tdTitle.style.padding = '5px 8px';
                tdTitle.textContent = t.title;
                tr.appendChild(tdTitle);

                const tdStatus = document.createElement('td');
                tdStatus.style.padding = '5px 8px';
                const span = document.createElement('span');
                span.className = 'card-status status-' + t.status;
                span.textContent = t.status;
                tdStatus.appendChild(span);
                tr.appendChild(tdStatus);

                const tdProgress = document.createElement('td');
                tdProgress.style.padding = '5px 8px';
                tdProgress.textContent = t.progress + '%';
                tr.appendChild(tdProgress);

                const tdUpdated = document.createElement('td');
                tdUpdated.style.cssText = 'padding:5px 8px;font-size:0.8rem;';
                tdUpdated.textContent = t.updated_at ? new Date(t.updated_at).toLocaleString('ja-JP') : '-';
                tr.appendChild(tdUpdated);

                tbody.appendChild(tr);
            });
            taskTable.appendChild(tbody);
            taskSection.appendChild(taskTable);
        }
        content.appendChild(taskSection);

        // Logs with real-time polling
        const logSection = document.createElement('div');
        logSection.style.marginTop = '1.5rem';
        const logTitleRow = document.createElement('div');
        logTitleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
        const logTitle = document.createElement('h4');
        logTitle.textContent = 'ログ（リアルタイム更新）';
        logTitle.style.margin = '0';
        logTitleRow.appendChild(logTitle);
        const liveIndicator = document.createElement('span');
        liveIndicator.style.cssText = 'font-size:0.75rem;color:#48bb78;';
        liveIndicator.textContent = '● LIVE';
        logTitleRow.appendChild(liveIndicator);
        logSection.appendChild(logTitleRow);
        const logPre = document.createElement('pre');
        logPre.style.cssText = 'background:#1a202c;color:#e2e8f0;padding:1rem;border-radius:4px;overflow-x:auto;font-size:0.8rem;max-height:300px;overflow-y:auto;margin-top:0.5rem;';
        if (logs.length === 0) {
            logPre.textContent = '（ログがありません）';
        } else {
            logPre.textContent = logs.map(l => '[' + l.timestamp + '] [' + l.level.toUpperCase() + '] ' + l.message).join('\n');
            setTimeout(() => { logPre.scrollTop = logPre.scrollHeight; }, 50);
        }
        logSection.appendChild(logPre);
        content.appendChild(logSection);

        agentLogInterval = setInterval(() => {
            if (currentAgentId === agentId) {
                refreshAgentLogs(agentId, logPre);
            } else {
                clearInterval(agentLogInterval);
            }
        }, 3000);

        // agent-whisper traces section
        const awSection = document.createElement('div');
        awSection.style.marginTop = '1.5rem';
        const awTitle = document.createElement('h4');
        awTitle.textContent = 'agent-whisper トレース';
        awSection.appendChild(awTitle);
        const awLoading = document.createElement('p');
        awLoading.className = 'empty';
        awLoading.textContent = '読み込み中...';
        awSection.appendChild(awLoading);
        content.appendChild(awSection);

        modal.classList.add('active');

        // Fetch agent-whisper traces asynchronously after modal is shown
        try {
            const awResp = await fetch('http://localhost:9001/api/traces?q=' + encodeURIComponent(agent.name));
            if (awResp.ok) {
                const awTraces = await awResp.json();
                awSection.removeChild(awLoading);
                if (awTraces.length === 0) {
                    const p = document.createElement('p');
                    p.className = 'empty';
                    p.textContent = 'トレースがありません（検索キー: ' + agent.name + '）';
                    awSection.appendChild(p);
                } else {
                    const table = document.createElement('table');
                    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.82rem;';
                    const thead = document.createElement('thead');
                    const headerRow = document.createElement('tr');
                    headerRow.style.cssText = 'background:#edf2f7;text-align:left;';
                    ['Trace ID', 'Agent ID', '開始時刻', 'ツール数'].forEach(function(label) {
                        const th = document.createElement('th');
                        th.style.padding = '6px 8px';
                        th.textContent = label;
                        headerRow.appendChild(th);
                    });
                    thead.appendChild(headerRow);
                    table.appendChild(thead);
                    const tbody = document.createElement('tbody');
                    awTraces.slice(0, 10).forEach(function(trace, i) {
                        const tr = document.createElement('tr');
                        tr.style.background = i % 2 === 0 ? '#fff' : '#f7fafc';
                        const startedAt = trace.started_at
                            ? new Date(trace.started_at).toLocaleString('ja-JP')
                            : '-';
                        [
                            { text: trace.trace_id.substring(0, 8) + '…', style: 'padding:5px 8px;font-family:monospace;' },
                            { text: String(trace.agent_id), style: 'padding:5px 8px;' },
                            { text: startedAt, style: 'padding:5px 8px;' },
                            { text: String(trace.tool_call_count), style: 'padding:5px 8px;text-align:center;' },
                        ].forEach(function(cell) {
                            const td = document.createElement('td');
                            td.style.cssText = cell.style;
                            td.textContent = cell.text;
                            tr.appendChild(td);
                        });
                        tbody.appendChild(tr);
                    });
                    table.appendChild(tbody);
                    awSection.appendChild(table);
                    if (awTraces.length > 10) {
                        const more = document.createElement('p');
                        more.style.cssText = 'font-size:0.8rem;color:#718096;margin-top:0.5rem;';
                        more.textContent = '…他 ' + (awTraces.length - 10) + ' 件（agent-whisper で確認）';
                        awSection.appendChild(more);
                    }
                }
            } else {
                awLoading.textContent = 'agent-whisper に接続できません';
            }
        } catch (_err) {
            awLoading.textContent = 'agent-whisper に接続できません（http://localhost:9001 が起動しているか確認）';
        }
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

async function executeTask(taskId) {
    try {
        await API.executeTask(taskId);
        alert('LLM実行を開始しました。ステータスが更新されます。');
        loadTasks();
    } catch (error) {
        alert('実行開始に失敗しました: ' + error.message);
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
    // モーダルを閉じたらポーリング停止
    if (agentLogInterval) {
        clearInterval(agentLogInterval);
        agentLogInterval = null;
    }
    currentAgentId = null;
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
