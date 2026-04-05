// リアルタイムログポーリング用
let agentLogInterval = null;
let currentAgentId = null;

// WebSocket connection
let ws = null;
let wsReconnectTimer = null;

function connectWebSocket() {
    // Connect via nginx /ws proxy (same origin as frontend port)
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${location.host}/ws`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('[WS] Connected');
        if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
        showWsBadge('connected');
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleWsMessage(msg);
        } catch (_e) {}
    };

    ws.onclose = () => {
        console.log('[WS] Disconnected, reconnecting in 3s...');
        showWsBadge('disconnected');
        wsReconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => { ws.close(); };
}

// Request notification permission on page load
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}

function showBrowserNotification(title, body, icon) {
    if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(title, {
            body: body,
            icon: icon || '/favicon.ico',
            tag: 'hermes-' + Date.now(),
        });
        setTimeout(() => n.close(), 6000);
    }
}

function handleWsMessage(msg) {
    if (msg.event === 'task_created') {
        const priorityLabel = msg.priority >= 2 ? '🔴 高' : msg.priority === 1 ? '🟡 中' : '🟢 通常';
        showBrowserNotification(
            `📋 新タスク: ${msg.title}`,
            `担当: ${msg.agent_name || 'Unknown'} | 優先度: ${priorityLabel}`
        );
        showToast(`新タスク: ${msg.title}`);
        // Reload task list if on tasks tab
        const tasksTab = document.getElementById('tasks-section');
        if (tasksTab && tasksTab.classList.contains('active')) {
            loadTasks();
        }
    } else if (msg.event === 'task_status_changed') {
        // Update status badge in any visible task table
        const badge = document.getElementById('task-status-badge-' + msg.task_id);
        if (badge) {
            badge.className = 'card-status status-' + msg.status;
            badge.textContent = msg.status;
        }
        const progressCell = document.getElementById('task-progress-cell-' + msg.task_id);
        if (progressCell) {
            const progressMap = { running: 50, completed: 100 };
            if (progressMap[msg.status] !== undefined) progressCell.textContent = progressMap[msg.status] + '%';
        }
        const updatedCell = document.getElementById('task-updated-cell-' + msg.task_id);
        if (updatedCell && msg.updated_at) updatedCell.textContent = new Date(msg.updated_at).toLocaleString('ja-JP');

        // Show toast
        showToast(`タスク ${msg.task_id.slice(0, 8)}... → ${msg.status}`);
    } else if (msg.event === 'agent_status_changed') {
        // Update agent status badge in agent cards
        const agentBadge = document.getElementById('agent-status-badge-' + msg.agent_id);
        if (agentBadge) {
            agentBadge.className = 'card-status status-' + msg.status;
            agentBadge.textContent = msg.status;
        }
        // Reload agent list to reflect updated status
        loadAgents();
        showToast(`エージェント ${msg.agent_id.slice(0, 8)}... → ${msg.status}`);
    } else if (msg.event === 'init') {
        console.log('[WS] Received initial state:', msg.agents?.length, 'agents');
    }
}

function showWsBadge(state) {
    let badge = document.getElementById('ws-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.id = 'ws-badge';
        badge.style.cssText = 'position:fixed;bottom:16px;right:16px;padding:4px 10px;border-radius:12px;font-size:0.75rem;z-index:9999;';
        document.body.appendChild(badge);
    }
    if (state === 'connected') {
        badge.textContent = '● WS接続中';
        badge.style.background = '#c6f6d5';
        badge.style.color = '#276749';
    } else {
        badge.textContent = '○ WS切断';
        badge.style.background = '#fed7d7';
        badge.style.color = '#9b2c2c';
    }
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;bottom:48px;right:16px;background:#2d3748;color:#fff;padding:8px 14px;border-radius:8px;font-size:0.82rem;z-index:9999;opacity:0;transition:opacity 0.3s;';
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '1'; }, 50);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 3000);
}

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
    connectWebSocket();

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

    // Trace search
    document.getElementById('trace-search-btn').addEventListener('click', () => runTraceSearch());
    document.getElementById('trace-search-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runTraceSearch();
    });

    // Timeline tab
    document.getElementById('timeline-refresh-btn').addEventListener('click', () => loadTimeline());
    document.getElementById('compare-refresh-btn').addEventListener('click', () => loadCompare());
    document.getElementById('timeline-agent-filter').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loadTimeline();
    });
    document.getElementById('timeline-limit').addEventListener('change', () => loadTimeline());

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

    // Task agent filter
    document.addEventListener('change', (e) => {
        if (e.target.id === 'task-agent-filter') loadTasks();
    });

    // Modal close (task)
    document.getElementById('task-modal').addEventListener('click', (e) => {
        if (e.target.id === 'task-modal') closeModal('task-modal');
    });
    // Modal close (agent)
    document.getElementById('agent-modal').addEventListener('click', (e) => {
        if (e.target.id === 'agent-modal') closeModal('agent-modal');
    });

    // AW Traces tab: debounce search
    setupAwTracesTab();
}

async function initializeApp() {
    try {
        await API.getHealth();
        console.log('Backend is healthy');
    } catch (error) {
        alert('バックエンドに接続できません: ' + error.message);
    }
}

function setEmptyMessage(container, text) {
    container.textContent = '';
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = text;
    container.appendChild(p);
}

// Trace search pagination state
const traceSearchState = { query: '', offset: 0, limit: 20 };

async function runTraceSearch(offset = 0) {
    const query = document.getElementById('trace-search-input').value.trim();
    const container = document.getElementById('trace-search-results');
    if (!query) {
        setEmptyMessage(container, 'キーワードを入力してください');
        return;
    }
    traceSearchState.query = query;
    traceSearchState.offset = offset;

    setEmptyMessage(container, '検索中...');
    let result;
    try {
        result = await API.searchTraces(query, traceSearchState.limit, offset);
    } catch (_e) {
        setEmptyMessage(container, '検索に失敗しました。agent-whisper に接続できません。');
        return;
    }

    // Support both paginated {items, total} and legacy plain array
    const traces = Array.isArray(result) ? result : (result.items || []);
    const total = result.total != null ? result.total : traces.length;

    container.textContent = '';

    if (traces.length === 0 && offset === 0) {
        setEmptyMessage(container, `「${query}」に一致するトレースが見つかりません`);
        return;
    }

    const summary = document.createElement('p');
    summary.style.cssText = 'font-size:0.82rem;color:#718096;margin-bottom:0.5rem;';
    const pageNum = Math.floor(offset / traceSearchState.limit) + 1;
    summary.textContent = `${traces.length} 件表示中（ページ ${pageNum} / 合計 ${total} 件、検索: "${query}"）`;
    container.appendChild(summary);

    if (traces.length > 0) {
        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.85rem;margin-top:0.5rem;';
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.style.cssText = 'background:#edf2f7;text-align:left;';
        ['Trace ID', 'Agent ID', '開始時刻', 'ツール数'].forEach(label => {
            const th = document.createElement('th');
            th.style.padding = '6px 8px';
            th.textContent = label;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        traces.forEach((trace, i) => {
            const tr = document.createElement('tr');
            tr.style.background = i % 2 === 0 ? '#fff' : '#f7fafc';
            const startedAt = trace.started_at ? new Date(trace.started_at).toLocaleString('ja-JP') : '-';
            [
                { text: trace.trace_id ? trace.trace_id.substring(0, 12) + '…' : '-', style: 'padding:5px 8px;font-family:monospace;' },
                { text: String(trace.agent_id || '-'), style: 'padding:5px 8px;' },
                { text: startedAt, style: 'padding:5px 8px;' },
                { text: String(trace.tool_call_count || 0), style: 'padding:5px 8px;text-align:center;' },
            ].forEach(cell => {
                const td = document.createElement('td');
                td.style.cssText = cell.style;
                td.textContent = cell.text;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        container.appendChild(table);
    } else {
        const emptyMsg = document.createElement('p');
        emptyMsg.className = 'empty';
        emptyMsg.textContent = 'これ以上の結果はありません';
        container.appendChild(emptyMsg);
    }

    // Pagination controls
    const pagination = document.createElement('div');
    pagination.style.cssText = 'display:flex;gap:0.5rem;margin-top:0.75rem;align-items:center;';
    if (offset > 0) {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'btn btn-secondary';
        prevBtn.textContent = '← 前へ';
        prevBtn.addEventListener('click', () => runTraceSearch(offset - traceSearchState.limit));
        pagination.appendChild(prevBtn);
    }
    if (offset + traces.length < total) {
        const nextBtn = document.createElement('button');
        nextBtn.className = 'btn btn-secondary';
        nextBtn.textContent = '次へ →';
        nextBtn.addEventListener('click', () => runTraceSearch(offset + traceSearchState.limit));
        pagination.appendChild(nextBtn);
    }
    if (pagination.children.length > 0) {
        container.appendChild(pagination);
    }
}

function switchTab(tabName) {
    // Hide all tabs (both class-based and id-based)
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
        if (tab.id === 'tab-traces') tab.style.display = 'none';
    });

    // Remove active from all nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected tab
    if (tabName === 'traces') {
        const tracesTab = document.getElementById('tab-traces');
        tracesTab.style.display = 'block';
    } else {
        document.getElementById(tabName).classList.add('active');
    }

    // Add active to clicked button
    event.target.classList.add('active');

    // Load data for the tab
    if (tabName === 'agents') {
        loadAgents();
    } else if (tabName === 'tasks') {
        loadTasks();
    } else if (tabName === 'timeline') {
        loadTimeline();
    } else if (tabName === 'traces') {
        loadAwTraces();
    } else if (tabName === 'compare') {
        loadCompare();
    } else if (tabName === 'health') {
        loadHealth();
    }
}

// AW Traces tab state
let awTraceDebounceTimer = null;

async function loadAwTraces(query = '') {
    const container = document.getElementById('trace-list');
    setEmptyMessage(container, '読み込み中...');
    let traces;
    try {
        traces = await API.getAllTraces(50);
        if (query) {
            const q = query.toLowerCase();
            traces = traces.filter(t =>
                (t.agent_id && String(t.agent_id).toLowerCase().includes(q)) ||
                (t.trace_id && String(t.trace_id).toLowerCase().includes(q)) ||
                (t.session_id && String(t.session_id).toLowerCase().includes(q))
            );
        }
    } catch (_e) {
        setEmptyMessage(container, 'agent-whisper に接続できません');
        return;
    }

    container.textContent = '';

    if (!traces || traces.length === 0) {
        setEmptyMessage(container, query ? '「' + query + '」に一致するトレースが見つかりません' : 'トレースがありません');
        return;
    }

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.85rem;margin-top:0.5rem;';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.style.cssText = 'background:#edf2f7;text-align:left;';
    ['Trace ID', 'Agent ID', '開始時刻', 'ツール数'].forEach(label => {
        const th = document.createElement('th');
        th.style.padding = '6px 8px';
        th.textContent = label;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    traces.forEach((trace, i) => {
        const tr = document.createElement('tr');
        tr.style.background = i % 2 === 0 ? '#fff' : '#f7fafc';
        const startedAt = trace.started_at ? new Date(trace.started_at).toLocaleString('ja-JP') : '-';
        [
            { text: trace.trace_id ? trace.trace_id.substring(0, 12) + '...' : '-', style: 'padding:5px 8px;font-family:monospace;' },
            { text: String(trace.agent_id || '-'), style: 'padding:5px 8px;' },
            { text: startedAt, style: 'padding:5px 8px;' },
            { text: String(trace.tool_call_count || 0), style: 'padding:5px 8px;text-align:center;' },
        ].forEach(cell => {
            const td = document.createElement('td');
            td.style.cssText = cell.style;
            td.textContent = cell.text;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
}

function setupAwTracesTab() {
    const searchInput = document.getElementById('trace-search');
    if (!searchInput) return;
    searchInput.addEventListener('input', () => {
        clearTimeout(awTraceDebounceTimer);
        awTraceDebounceTimer = setTimeout(() => {
            loadAwTraces(searchInput.value.trim());
        }, 300);
    });
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

        const statusBadge = document.createElement('span');
        statusBadge.id = 'agent-status-badge-' + agent.id;
        statusBadge.className = `card-status status-${agent.status}`;
        statusBadge.textContent = agent.status;

        header.appendChild(title);
        header.appendChild(statusBadge);

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

        // Last activity row (populated async from agent-whisper)
        const activityRow = document.createElement('div');
        activityRow.style.cssText = 'font-size:0.78rem;color:#718096;margin-top:4px;';
        activityRow.textContent = '最終アクティビティ: 読み込み中...';

        card.appendChild(header);
        card.appendChild(desc);
        card.appendChild(meta);
        card.appendChild(activityRow);
        card.addEventListener('click', () => showAgentDetail(agent.id));
        container.appendChild(card);

        // Fetch last activity from agent-whisper asynchronously
        API.getAgentWhisperTraces(agent.name, 1).then(traces => {
            if (traces && traces.length > 0) {
                const t = traces[0];
                const ts = t.ended_at || t.started_at;
                if (ts) {
                    activityRow.textContent = '最終アクティビティ: ' + new Date(ts).toLocaleString('ja-JP');
                } else {
                    activityRow.textContent = '最終アクティビティ: 不明';
                }
            } else {
                activityRow.textContent = '最終アクティビティ: なし';
            }
        }).catch(() => {
            activityRow.textContent = '最終アクティビティ: 取得失敗';
        });
    });
}

async function loadAgentSelect() {
    try {
        const agents = await API.getAgents();
        const select = document.getElementById('task-agent');
        const options = agents.map(agent => `<option value="${agent.id}">${escapeHtml(agent.name)}</option>`).join('');
        select.innerHTML = '<option value="">選択してください</option>' + options;

        // Also populate the agent filter dropdown in task list
        const filterSelect = document.getElementById('task-agent-filter');
        if (filterSelect) {
            filterSelect.innerHTML = '<option value="">すべて</option>' + options;
        }
    } catch (error) {
        console.error('Load agent select error:', error);
    }
}

async function loadTasks() {
    try {
        const status = document.getElementById('task-status-filter').value;
        const agentId = document.getElementById('task-agent-filter')?.value || null;
        const tasks = await API.getTasks(agentId || null, status || null);
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
                        <button class="btn btn-success btn-small" onclick="executeTask('${task.id}')">▶ 実行エンジン</button>
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
        const agent = await API.getAgent(agentId);
        const [logs, memory, agentTasks, awTraces] = await Promise.all([
            API.getAgentLogs(agentId),
            API.getAgentMemory(agentId),
            API.getTasks(agentId),
            API.getAgentWhisperTraces(agent.name)
        ]);

        const modal = document.getElementById('agent-modal');
        const content = document.getElementById('agent-detail-content');
        content.innerHTML = '';

        const h2 = document.createElement('h2');
        h2.textContent = agent.name;
        content.appendChild(h2);

        // Edit button
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-warning btn-small';
        editBtn.textContent = '✏️ 編集';
        editBtn.style.marginTop = '0.5rem';
        content.appendChild(editBtn);

        // Edit form (hidden by default)
        const editForm = document.createElement('div');
        editForm.style.cssText = 'display:none;margin-top:1rem;background:#f7fafc;padding:1rem;border-radius:6px;';
        editForm.innerHTML = '';

        const nameLabel = document.createElement('label');
        nameLabel.textContent = 'エージェント名';
        nameLabel.style.cssText = 'display:block;font-weight:bold;margin-bottom:0.25rem;';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = agent.name;
        nameInput.style.cssText = 'width:100%;margin-bottom:0.75rem;padding:0.4rem;border:1px solid #cbd5e0;border-radius:4px;box-sizing:border-box;';

        const descLabel = document.createElement('label');
        descLabel.textContent = '説明';
        descLabel.style.cssText = 'display:block;font-weight:bold;margin-bottom:0.25rem;';
        const descInput = document.createElement('textarea');
        descInput.value = agent.description || '';
        descInput.rows = 3;
        descInput.style.cssText = 'width:100%;margin-bottom:0.75rem;padding:0.4rem;border:1px solid #cbd5e0;border-radius:4px;box-sizing:border-box;';

        const saveBtnEdit = document.createElement('button');
        saveBtnEdit.className = 'btn btn-primary btn-small';
        saveBtnEdit.textContent = '保存';
        const cancelBtnEdit = document.createElement('button');
        cancelBtnEdit.className = 'btn btn-secondary btn-small';
        cancelBtnEdit.textContent = 'キャンセル';
        cancelBtnEdit.style.marginLeft = '0.5rem';

        editForm.appendChild(nameLabel);
        editForm.appendChild(nameInput);
        editForm.appendChild(descLabel);
        editForm.appendChild(descInput);
        editForm.appendChild(saveBtnEdit);
        editForm.appendChild(cancelBtnEdit);
        content.appendChild(editForm);

        editBtn.addEventListener('click', () => { editForm.style.display = 'block'; editBtn.style.display = 'none'; });
        cancelBtnEdit.addEventListener('click', () => { editForm.style.display = 'none'; editBtn.style.display = ''; });
        saveBtnEdit.addEventListener('click', async () => {
            try {
                await API.updateAgent(agentId, { name: nameInput.value.trim(), description: descInput.value.trim() });
                h2.textContent = nameInput.value.trim();
                editForm.style.display = 'none';
                editBtn.style.display = '';
                await loadAgents();
            } catch (err) {
                alert('保存に失敗しました: ' + err.message);
            }
        });

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

        // Tool Calls section
        const toolCallSection = document.createElement('div');
        toolCallSection.style.marginTop = '1.5rem';
        const toolCallTitle = document.createElement('h4');
        toolCallTitle.textContent = 'ツール設定（実行エンジン）';
        toolCallSection.appendChild(toolCallTitle);

        // Current tool_calls display
        const currentToolCalls = agent.tool_calls || [];
        const toolCallPre = document.createElement('pre');
        toolCallPre.id = 'tool-calls-pre-' + agentId;
        toolCallPre.style.cssText = 'background:#f7fafc;padding:0.75rem;border-radius:4px;font-size:0.82rem;overflow-x:auto;';
        toolCallPre.textContent = JSON.stringify(currentToolCalls, null, 2) || '（未設定）';
        toolCallSection.appendChild(toolCallPre);

        // Edit tool_calls button
        const editToolCallBtn = document.createElement('button');
        editToolCallBtn.className = 'btn btn-warning btn-small';
        editToolCallBtn.textContent = 'ツール編集';
        editToolCallBtn.style.marginTop = '0.5rem';
        editToolCallBtn.addEventListener('click', () => showToolCallEditor(agentId, currentToolCalls, toolCallPre));
        toolCallSection.appendChild(editToolCallBtn);

        // Quick add buttons
        const quickAddDiv = document.createElement('div');
        quickAddDiv.style.marginTop = '0.5rem';
        const quickLabel = document.createElement('span');
        quickLabel.style.cssText = 'font-size:0.8rem;color:#718096;margin-right:0.5rem;';
        quickLabel.textContent = '素早く追加:';
        quickAddDiv.appendChild(quickLabel);
        [
            {name: 'web_search', args: {query: 'example search'}},
            {name: 'file_read', args: {path: '/tmp/example.txt'}},
            {name: 'llm_call', args: {prompt: 'Summarize this task'}},
        ].forEach(tc => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-small';
            btn.style.cssText = 'margin-right:4px;font-size:0.75rem;background:#e2e8f0;border:none;';
            btn.textContent = '+ ' + tc.name;
            btn.addEventListener('click', async () => {
                const newToolCalls = [...(agent.tool_calls || []), tc];
                try {
                    await API.updateAgentToolCalls(agentId, newToolCalls);
                    agent.tool_calls = newToolCalls;
                    toolCallPre.textContent = JSON.stringify(newToolCalls, null, 2);
                    btn.style.background = '#c6f6d5';
                    setTimeout(() => { btn.style.background = '#e2e8f0'; }, 1000);
                } catch (err) {
                    alert('保存に失敗: ' + err.message);
                }
            });
            quickAddDiv.appendChild(btn);
        });
        toolCallSection.appendChild(quickAddDiv);
        content.appendChild(toolCallSection);

        // Timeline section: unified view of tasks + traces (placed before task list)
        const tlSection = document.createElement('div');
        tlSection.style.marginTop = '1.5rem';
        const tlTitle = document.createElement('h4');
        tlTitle.textContent = '📅 タイムライン（タスク + トレース）';
        tlSection.appendChild(tlTitle);

        const traceListForTL = Array.isArray(awTraces) ? awTraces : (awTraces && awTraces.traces ? awTraces.traces : []);
        const taskListForTL = Array.isArray(agentTasks) ? agentTasks : [];

        // Format timestamp to YYYY-MM-DD HH:MM (JST)
        function formatJSTTimestamp(isoStr) {
            if (!isoStr) return '-';
            const d = new Date(isoStr);
            if (isNaN(d.getTime())) return '-';
            const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
            const y = jst.getUTCFullYear();
            const mo = String(jst.getUTCMonth() + 1).padStart(2, '0');
            const da = String(jst.getUTCDate()).padStart(2, '0');
            const h = String(jst.getUTCHours()).padStart(2, '0');
            const mi = String(jst.getUTCMinutes()).padStart(2, '0');
            return y + '-' + mo + '-' + da + ' ' + h + ':' + mi;
        }

        // Build unified event list
        const tlEvents = [];
        taskListForTL.forEach(t => {
            tlEvents.push({
                type: 'task',
                icon: '📋',
                time: new Date(t.created_at || 0).getTime(),
                title: t.title || 'タスク',
                sub: null,
                status: t.status || 'pending',
                ts: formatJSTTimestamp(t.created_at),
            });
        });
        traceListForTL.slice(0, 20).forEach(tr => {
            const sessionId = (tr.trace_id || tr.id || '').substring(0, 12);
            const toolCount = tr.tool_call_count || 0;
            tlEvents.push({
                type: 'trace',
                icon: '🔍',
                time: new Date(tr.started_at || 0).getTime(),
                title: sessionId ? 'session: ' + sessionId : 'トレース',
                sub: 'ツール数: ' + toolCount + '件',
                status: tr.status || null,
                ts: formatJSTTimestamp(tr.started_at),
            });
        });
        tlEvents.sort((a, b) => b.time - a.time);

        if (tlEvents.length === 0) {
            const emptyP = document.createElement('p');
            emptyP.className = 'empty';
            emptyP.textContent = 'タイムラインデータがありません';
            tlSection.appendChild(emptyP);
        } else {
            const tlList = document.createElement('div');
            tlList.className = 'timeline-list';
            tlEvents.forEach(ev => {
                const item = document.createElement('div');
                item.className = 'timeline-item timeline-item-' + ev.type;

                const iconSpan = document.createElement('span');
                iconSpan.className = 'timeline-icon';
                iconSpan.textContent = ev.icon;

                const bodyDiv = document.createElement('div');
                bodyDiv.className = 'timeline-body';

                const topRow = document.createElement('div');
                topRow.className = 'timeline-top-row';

                const tsSpan = document.createElement('span');
                tsSpan.className = 'timeline-ts';
                tsSpan.textContent = ev.ts;

                const titleSpan = document.createElement('span');
                titleSpan.className = 'timeline-title';
                titleSpan.textContent = ev.title;

                topRow.appendChild(tsSpan);
                topRow.appendChild(titleSpan);

                if (ev.status) {
                    const badge = document.createElement('span');
                    badge.className = 'card-status status-' + ev.status;
                    badge.textContent = ev.status;
                    topRow.appendChild(badge);
                }

                bodyDiv.appendChild(topRow);

                if (ev.sub) {
                    const subDiv = document.createElement('div');
                    subDiv.className = 'timeline-sub';
                    subDiv.textContent = ev.sub;
                    bodyDiv.appendChild(subDiv);
                }

                item.appendChild(iconSpan);
                item.appendChild(bodyDiv);
                tlList.appendChild(item);
            });
            tlSection.appendChild(tlList);
            const tlNote = document.createElement('p');
            tlNote.className = 'timeline-note';
            tlNote.textContent = '📋 青: Hermesタスク　🔍 緑: agent-whisperトレース（最新20件）';
            tlSection.appendChild(tlNote);
        }
        content.appendChild(tlSection);

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
            ['タイトル', 'ステータス', '進捗', '更新日時', '操作'].forEach(label => {
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
                tr.id = 'task-row-' + t.id;
                tr.style.cssText = (i % 2 === 0 ? 'background:#fff;' : 'background:#f7fafc;');

                const tdTitle = document.createElement('td');
                tdTitle.style.cssText = 'padding:5px 8px;cursor:pointer;';
                tdTitle.textContent = t.title;
                tdTitle.addEventListener('click', () => { closeModal('agent-modal'); showTaskDetail(t.id); });
                tr.appendChild(tdTitle);

                const tdStatus = document.createElement('td');
                tdStatus.style.padding = '5px 8px';
                tdStatus.id = 'task-status-cell-' + t.id;
                const span = document.createElement('span');
                span.id = 'task-status-badge-' + t.id;
                span.className = 'card-status status-' + t.status;
                span.textContent = t.status;
                tdStatus.appendChild(span);
                tr.appendChild(tdStatus);

                const tdProgress = document.createElement('td');
                tdProgress.style.padding = '5px 8px';
                tdProgress.id = 'task-progress-cell-' + t.id;
                tdProgress.textContent = t.progress + '%';
                tr.appendChild(tdProgress);

                const tdUpdated = document.createElement('td');
                tdUpdated.style.cssText = 'padding:5px 8px;font-size:0.8rem;';
                tdUpdated.id = 'task-updated-cell-' + t.id;
                tdUpdated.textContent = t.updated_at ? new Date(t.updated_at).toLocaleString('ja-JP') : '-';
                tr.appendChild(tdUpdated);

                // Status change buttons
                const tdActions = document.createElement('td');
                tdActions.style.cssText = 'padding:3px 8px;white-space:nowrap;';
                const statusButtons = [
                    { label: '▶', status: 'running', color: '#3182ce', title: 'running に変更' },
                    { label: '✓', status: 'completed', color: '#38a169', title: 'completed に変更' },
                    { label: '✗', status: 'failed', color: '#e53e3e', title: 'failed に変更' },
                ];
                statusButtons.forEach(({ label, status, color, title }) => {
                    const btn = document.createElement('button');
                    btn.textContent = label;
                    btn.title = title;
                    btn.style.cssText = `margin:2px;padding:2px 7px;font-size:0.8rem;border:1px solid ${color};color:${color};background:white;border-radius:4px;cursor:pointer;`;
                    btn.addEventListener('mouseover', () => { btn.style.background = color; btn.style.color = 'white'; });
                    btn.addEventListener('mouseout', () => { btn.style.background = 'white'; btn.style.color = color; });
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        btn.disabled = true;
                        try {
                            const result = await API.updateTaskStatus(t.id, status);
                            // Update badge and progress in-place
                            const badge = document.getElementById('task-status-badge-' + t.id);
                            if (badge) {
                                badge.className = 'card-status status-' + status;
                                badge.textContent = status;
                            }
                            const progressCell = document.getElementById('task-progress-cell-' + t.id);
                            if (progressCell) {
                                const progressMap = { running: 50, completed: 100 };
                                if (progressMap[status] !== undefined) progressCell.textContent = progressMap[status] + '%';
                            }
                            const updatedCell = document.getElementById('task-updated-cell-' + t.id);
                            if (updatedCell) updatedCell.textContent = new Date(result.updated_at).toLocaleString('ja-JP');
                        } catch (err) {
                            alert('ステータス更新に失敗しました: ' + err.message);
                        } finally {
                            btn.disabled = false;
                        }
                    });
                    tdActions.appendChild(btn);
                });
                tr.appendChild(tdActions);

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

        // Render agent-whisper traces using pre-fetched data
        awSection.removeChild(awLoading);
        const traceList = Array.isArray(awTraces) ? awTraces : (awTraces && awTraces.traces ? awTraces.traces : []);
        if (traceList.length === 0) {
            const p = document.createElement('p');
            p.className = 'empty';
            p.textContent = 'トレースがありません（agent-whisper agent_id: ' + agentId + '）';
            awSection.appendChild(p);
        } else {
            const traceNote = document.createElement('p');
            traceNote.style.cssText = 'font-size:0.8rem;color:#718096;margin-bottom:0.5rem;';
            traceNote.textContent = '直近 ' + traceList.length + ' 件（agent-whisper連携）';
            awSection.appendChild(traceNote);
            const table = document.createElement('table');
            table.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.82rem;';
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            headerRow.style.cssText = 'background:#ebf8ff;text-align:left;';
            ['Trace ID', 'Agent ID', '開始時刻', 'ツール数'].forEach(function(label) {
                const th = document.createElement('th');
                th.style.padding = '6px 8px';
                th.textContent = label;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);
            table.appendChild(thead);
            const tbody = document.createElement('tbody');
            traceList.slice(0, 10).forEach(function(trace, i) {
                const tr = document.createElement('tr');
                tr.style.background = i % 2 === 0 ? '#fff' : '#ebf8ff';
                const startedAt = trace.started_at
                    ? new Date(trace.started_at).toLocaleString('ja-JP')
                    : '-';
                [
                    { text: (trace.trace_id || trace.id || '').substring(0, 8) + '…', style: 'padding:5px 8px;font-family:monospace;' },
                    { text: String(trace.agent_id || '-'), style: 'padding:5px 8px;' },
                    { text: startedAt, style: 'padding:5px 8px;' },
                    { text: String(trace.tool_call_count || 0), style: 'padding:5px 8px;text-align:center;' },
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
            if (traceList.length > 10) {
                const more = document.createElement('p');
                more.style.cssText = 'font-size:0.8rem;color:#718096;margin-top:0.5rem;';
                more.textContent = '…他 ' + (traceList.length - 10) + ' 件（agent-whisper で確認: http://localhost:9001）';
                awSection.appendChild(more);
            }
        }

        // Metrics section
        const metricsSection = document.createElement('div');
        metricsSection.style.marginTop = '1.5rem';
        const metricsTitle = document.createElement('h4');
        metricsTitle.textContent = '📊 メトリクス';
        metricsSection.appendChild(metricsTitle);
        content.appendChild(metricsSection);

        API.getAgentMetrics(agentId).then(function(metrics) {
            // Text stats
            const statsDiv = document.createElement('div');
            statsDiv.style.cssText = 'display:flex;gap:1.5rem;flex-wrap:wrap;margin-bottom:1rem;margin-top:0.5rem;';
            [
                ['完了率', metrics.completion_rate + '%'],
                ['エラー率', metrics.error_rate + '%'],
                ['平均処理時間', metrics.avg_duration_seconds + '秒'],
                ['総タスク数', metrics.total_tasks],
            ].forEach(function(item) {
                const card = document.createElement('div');
                card.style.cssText = 'background:#f7fafc;border-radius:6px;padding:0.6rem 1rem;min-width:120px;';
                const label = document.createElement('div');
                label.style.cssText = 'font-size:0.75rem;color:#718096;';
                label.textContent = item[0];
                const value = document.createElement('div');
                value.style.cssText = 'font-size:1.2rem;font-weight:700;color:#2d3748;margin-top:2px;';
                value.textContent = item[1];
                card.appendChild(label);
                card.appendChild(value);
                statsDiv.appendChild(card);
            });
            metricsSection.appendChild(statsDiv);

            // Charts row
            const chartsRow = document.createElement('div');
            chartsRow.style.cssText = 'display:flex;gap:1.5rem;flex-wrap:wrap;align-items:flex-start;';

            // Doughnut chart (status breakdown)
            const doughnutWrap = document.createElement('div');
            doughnutWrap.style.cssText = 'background:#f7fafc;border-radius:8px;padding:1rem;flex:1;min-width:200px;max-width:260px;';
            const doughnutLabel = document.createElement('div');
            doughnutLabel.style.cssText = 'font-size:0.82rem;font-weight:600;color:#4a5568;margin-bottom:0.5rem;';
            doughnutLabel.textContent = 'ステータス別内訳';
            doughnutWrap.appendChild(doughnutLabel);
            const doughnutCanvas = document.createElement('canvas');
            doughnutCanvas.id = 'metrics-status-chart-' + agentId;
            doughnutCanvas.style.cssText = 'max-height:200px;';
            doughnutWrap.appendChild(doughnutCanvas);
            chartsRow.appendChild(doughnutWrap);

            // Bar chart (tasks by day)
            const barWrap = document.createElement('div');
            barWrap.style.cssText = 'background:#f7fafc;border-radius:8px;padding:1rem;flex:2;min-width:260px;';
            const barLabel = document.createElement('div');
            barLabel.style.cssText = 'font-size:0.82rem;font-weight:600;color:#4a5568;margin-bottom:0.5rem;';
            barLabel.textContent = '直近7日間 タスク作成数';
            barWrap.appendChild(barLabel);
            const barCanvas = document.createElement('canvas');
            barCanvas.id = 'metrics-day-chart-' + agentId;
            barCanvas.style.cssText = 'max-height:200px;';
            barWrap.appendChild(barCanvas);
            chartsRow.appendChild(barWrap);

            metricsSection.appendChild(chartsRow);

            // Render charts after DOM insertion
            setTimeout(function() {
                const statusData = metrics.tasks_by_status || {};
                const statusLabels = Object.keys(statusData);
                const statusValues = statusLabels.map(function(k) { return statusData[k]; });
                const statusColors = {
                    completed: '#48bb78',
                    failed: '#fc8181',
                    running: '#63b3ed',
                    pending: '#f6e05e',
                };
                const doughnutColors = statusLabels.map(function(k) { return statusColors[k] || '#cbd5e0'; });

                if (statusLabels.length > 0) {
                    new Chart(doughnutCanvas, {
                        type: 'doughnut',
                        data: {
                            labels: statusLabels,
                            datasets: [{
                                data: statusValues,
                                backgroundColor: doughnutColors,
                                borderWidth: 1,
                            }]
                        },
                        options: {
                            responsive: true,
                            plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
                        }
                    });
                } else {
                    doughnutCanvas.style.display = 'none';
                    const noData = document.createElement('p');
                    noData.className = 'empty';
                    noData.textContent = 'データなし';
                    doughnutWrap.appendChild(noData);
                }

                const dayData = metrics.tasks_by_day || { labels: [], values: [] };
                new Chart(barCanvas, {
                    type: 'bar',
                    data: {
                        labels: dayData.labels,
                        datasets: [{
                            label: 'タスク数',
                            data: dayData.values,
                            backgroundColor: '#63b3ed',
                            borderRadius: 4,
                        }]
                    },
                    options: {
                        responsive: true,
                        scales: {
                            y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } } },
                            x: { ticks: { font: { size: 10 } } },
                        },
                        plugins: { legend: { display: false } },
                    }
                });
            }, 50);
        }).catch(function() {
            const errP = document.createElement('p');
            errP.style.cssText = 'color:#718096;font-size:0.85rem;';
            errP.textContent = 'メトリクスを取得できませんでした';
            metricsSection.appendChild(errP);
        });

        modal.classList.add('active');
    } catch (error) {
        alert('エージェント情報の取得に失敗しました: ' + error.message);
    }
}

// Task log polling
let taskLogInterval = null;

async function refreshTaskLogs(taskId, logPre) {
    try {
        const logs = await API.getTaskLogs(taskId);
        if (logs.length === 0) {
            logPre.textContent = '（ログがありません）';
        } else {
            logPre.textContent = logs.map(l => {
                let line = '[' + l.timestamp + '] [' + l.level.toUpperCase() + '] ' + l.message;
                if (l.tool_name) {
                    line += ' | ツール: ' + l.tool_name;
                    if (l.tool_args) {
                        try { line += ' args=' + JSON.stringify(JSON.parse(l.tool_args)); } catch (_) {}
                    }
                }
                if (l.tool_result) {
                    try {
                        const preview = JSON.stringify(JSON.parse(l.tool_result)).substring(0, 120);
                        line += '\n  → ' + preview + (preview.length >= 120 ? '…' : '');
                    } catch (_) {}
                }
                return line;
            }).join('\n');
            logPre.scrollTop = logPre.scrollHeight;
        }
    } catch (_e) {}
}

async function showTaskDetail(taskId) {
    if (taskLogInterval) { clearInterval(taskLogInterval); taskLogInterval = null; }

    try {
        const [task, taskLogs] = await Promise.all([API.getTask(taskId), API.getTaskLogs(taskId)]);
        const modal = document.getElementById('task-modal');
        const content = document.getElementById('task-detail-content');
        content.innerHTML = '';

        const h2 = document.createElement('h2');
        h2.textContent = task.title;
        content.appendChild(h2);

        const infoDiv = document.createElement('div');
        infoDiv.style.marginTop = '1rem';
        [['説明', task.description], ['ステータス', task.status], ['進捗', task.progress + '%'],
         ['作成日時', new Date(task.created_at).toLocaleString('ja-JP')],
         ['更新日時', new Date(task.updated_at).toLocaleString('ja-JP')]
        ].forEach(([label, value]) => {
            const p = document.createElement('p');
            const strong = document.createElement('strong');
            strong.textContent = label + ': ';
            p.appendChild(strong);
            if (label === 'ステータス') {
                const span = document.createElement('span');
                span.className = 'card-status status-' + value;
                span.textContent = value;
                p.appendChild(span);
            } else {
                p.appendChild(document.createTextNode(value));
            }
            infoDiv.appendChild(p);
        });
        content.appendChild(infoDiv);

        if (task.status === 'pending') {
            const execDiv = document.createElement('div');
            execDiv.style.marginTop = '1rem';
            const execBtn = document.createElement('button');
            execBtn.className = 'btn btn-success';
            execBtn.textContent = '▶ 実行エンジン起動';
            execBtn.addEventListener('click', () => { closeModal('task-modal'); executeTask(task.id); });
            execDiv.appendChild(execBtn);
            content.appendChild(execDiv);
        }

        if (task.result) {
            const steps = task.result.steps || [];
            const resultDiv = document.createElement('div');
            resultDiv.style.cssText = 'margin-top:1.5rem;padding:1rem;background:#f7fafc;border-radius:4px;';
            const rTitle = document.createElement('h4');
            rTitle.textContent = '実行結果（' + steps.length + 'ステップ）';
            resultDiv.appendChild(rTitle);
            steps.forEach((s, i) => {
                const stepDiv = document.createElement('div');
                stepDiv.style.cssText = 'margin-top:0.75rem;padding:0.75rem;background:white;border-radius:4px;border-left:3px solid #4299e1;';
                const strong = document.createElement('strong');
                strong.textContent = (i + 1) + '. ' + s.tool;
                stepDiv.appendChild(strong);
                const pre = document.createElement('pre');
                pre.style.cssText = 'margin:0.5rem 0 0;font-size:0.8rem;overflow-x:auto;';
                pre.textContent = JSON.stringify(s.result, null, 2).substring(0, 500);
                stepDiv.appendChild(pre);
                resultDiv.appendChild(stepDiv);
            });
            content.appendChild(resultDiv);
        }

        if (task.error) {
            const errorDiv = document.createElement('div');
            errorDiv.style.cssText = 'margin-top:1.5rem;padding:1rem;background:#fed7d7;border-radius:4px;border-left:4px solid #f56565;';
            const eTitle = document.createElement('h4');
            eTitle.textContent = 'エラー';
            errorDiv.appendChild(eTitle);
            const eP = document.createElement('p');
            eP.textContent = task.error;
            errorDiv.appendChild(eP);
            content.appendChild(errorDiv);
        }

        if (task.status === 'failed') {
            const retryDiv = document.createElement('div');
            retryDiv.style.marginTop = '1.5rem';
            const retryBtn = document.createElement('button');
            retryBtn.className = 'btn btn-primary';
            retryBtn.textContent = '再試行';
            retryBtn.addEventListener('click', () => retryTask(task.id));
            retryDiv.appendChild(retryBtn);
            content.appendChild(retryDiv);
        }

        const logSection = document.createElement('div');
        logSection.style.marginTop = '1.5rem';
        const logHeader = document.createElement('div');
        logHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
        const logTitle = document.createElement('h4');
        logTitle.textContent = '実行ログ（リアルタイム）';
        logTitle.style.margin = '0';
        logHeader.appendChild(logTitle);
        const liveSpan = document.createElement('span');
        liveSpan.style.cssText = 'font-size:0.75rem;color:#48bb78;';
        liveSpan.textContent = '● LIVE';
        logHeader.appendChild(liveSpan);
        logSection.appendChild(logHeader);
        const logPre = document.createElement('pre');
        logPre.style.cssText = 'background:#1a202c;color:#e2e8f0;padding:1rem;border-radius:4px;overflow-x:auto;font-size:0.78rem;max-height:350px;overflow-y:auto;margin-top:0.5rem;';
        logPre.textContent = taskLogs.length === 0 ? '（ログがありません）' : '';
        logSection.appendChild(logPre);
        content.appendChild(logSection);

        if (taskLogs.length > 0) refreshTaskLogs(taskId, logPre);
        if (task.status === 'running' || task.status === 'pending') {
            taskLogInterval = setInterval(() => refreshTaskLogs(taskId, logPre), 2000);
        }

        modal.classList.add('active');
    } catch (error) {
        alert('タスク情報の取得に失敗しました: ' + error.message);
    }
}

function showToolCallEditor(agentId, currentToolCalls, preElement) {
    const json = JSON.stringify(currentToolCalls, null, 2);
    const newJson = prompt('ツール設定をJSON形式で編集してください:\n例: [{"name":"web_search","args":{"query":"AI news"}}]', json);
    if (newJson === null) return;
    try {
        const parsed = JSON.parse(newJson);
        API.updateAgentToolCalls(agentId, parsed).then(() => {
            preElement.textContent = JSON.stringify(parsed, null, 2);
        }).catch(err => alert('保存に失敗: ' + err.message));
    } catch (_) {
        alert('JSONが不正です');
    }
}

async function executeTask(taskId) {
    try {
        await API.executeTask(taskId);
        alert('実行エンジンを起動しました。ステータスが更新されます。');
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
    if (agentLogInterval) { clearInterval(agentLogInterval); agentLogInterval = null; }
    if (taskLogInterval) { clearInterval(taskLogInterval); taskLogInterval = null; }
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

// ---- Timeline Tab ----

async function loadTimeline() {
    const container = document.getElementById('timeline-list');
    const agentFilter = document.getElementById('timeline-agent-filter').value.trim();
    const limit = parseInt(document.getElementById('timeline-limit').value, 10) || 50;

    setEmptyMessage(container, '読み込み中...');

    // Fetch from Hermes backend /timeline (merges tasks + AW traces server-side)
    let hermesItems = [];
    try {
        let url = `${API_BASE_URL}/timeline?limit=${limit}`;
        if (agentFilter) url += `&agent_id=${encodeURIComponent(agentFilter)}`;
        const res = await fetch(url);
        if (res.ok) hermesItems = await res.json();
    } catch (_e) {}

    // Also fetch AW traces directly (client-side merge for freshness)
    let awItems = [];
    try {
        let awUrl = `${AW_BASE_URL}/traces?limit=${limit}`;
        if (agentFilter) awUrl += `&agent_id=${encodeURIComponent(agentFilter)}`;
        const res = await fetch(awUrl);
        if (res.ok) {
            const data = await res.json();
            const traces = Array.isArray(data) ? data : (data.items || []);
            awItems = traces.map(tr => ({
                type: 'trace',
                timestamp: tr.started_at || tr.created_at || '',
                title: tr.trace_id || '',
                status: tr.status || '',
                agent_id: String(tr.agent_id || ''),
                details: {
                    trace_id: tr.trace_id,
                    tool_call_count: tr.tool_call_count || 0,
                    session_id: tr.session_id || '',
                    ended_at: tr.ended_at || '',
                },
            }));
        }
    } catch (_e) {}

    // Merge: de-duplicate traces already returned by backend by trace_id
    const backendTraceIds = new Set(
        hermesItems.filter(i => i.type === 'trace').map(i => i.details && i.details.trace_id)
    );
    const extraAW = awItems.filter(i => !backendTraceIds.has(i.details && i.details.trace_id));
    const merged = [...hermesItems, ...extraAW];
    merged.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    const final = merged.slice(0, limit);

    renderTimeline(container, final);
}

function renderTimeline(container, items) {
    container.textContent = '';

    if (items.length === 0) {
        setEmptyMessage(container, 'タイムラインデータがありません');
        return;
    }

    const note = document.createElement('p');
    note.style.cssText = 'font-size:0.78rem;color:#a0aec0;margin-bottom:0.75rem;padding:0 0.5rem;';
    note.textContent = items.length + ' 件表示　青: Hermesタスク　緑: AWトレース';
    container.appendChild(note);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:0 0.25rem;';

    items.forEach(item => {
        const isTask = item.type === 'task';
        const borderColor = isTask ? '#4299e1' : '#48bb78';
        const bgColor = isTask ? '#ebf8ff' : '#f0fff4';
        const badgeBg = isTask ? '#4299e1' : '#48bb78';

        const card = document.createElement('div');
        card.style.cssText = 'display:flex;align-items:flex-start;gap:12px;padding:10px 14px;border-radius:8px;border-left:4px solid ' + borderColor + ';background:' + bgColor + ';';

        // Timestamp column
        const tsDiv = document.createElement('div');
        tsDiv.style.cssText = 'min-width:140px;font-size:0.75rem;color:#718096;padding-top:2px;white-space:nowrap;';
        tsDiv.textContent = item.timestamp ? new Date(item.timestamp).toLocaleString('ja-JP') : '-';
        card.appendChild(tsDiv);

        // Main content column
        const body = document.createElement('div');
        body.style.cssText = 'flex:1;min-width:0;';

        // Top row: type badge + title + status
        const topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

        const badge = document.createElement('span');
        badge.style.cssText = 'display:inline-block;font-size:0.68rem;font-weight:700;color:#fff;background:' + badgeBg + ';padding:2px 7px;border-radius:10px;text-transform:uppercase;letter-spacing:0.04em;';
        badge.textContent = isTask ? 'TASK' : 'TRACE';
        topRow.appendChild(badge);

        const title = document.createElement('span');
        title.style.cssText = 'font-size:0.87rem;font-weight:600;color:#2d3748;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px;';
        const titleText = item.title || '-';
        title.title = titleText;
        title.textContent = titleText.length > 48 ? titleText.substring(0, 48) + '\u2026' : titleText;
        topRow.appendChild(title);

        if (item.status) {
            const statusBadge = document.createElement('span');
            statusBadge.className = 'card-status status-' + item.status;
            statusBadge.textContent = item.status;
            topRow.appendChild(statusBadge);
        }
        body.appendChild(topRow);

        // Sub row: agent_id + details
        const subRow = document.createElement('div');
        subRow.style.cssText = 'font-size:0.77rem;color:#718096;margin-top:4px;display:flex;gap:12px;flex-wrap:wrap;';

        if (item.agent_id) {
            const agentSpan = document.createElement('span');
            agentSpan.textContent = 'Agent: ' + item.agent_id;
            subRow.appendChild(agentSpan);
        }

        if (isTask && item.details) {
            const progressSpan = document.createElement('span');
            progressSpan.textContent = '\u9032\u6357: ' + (item.details.progress || 0) + '%';
            subRow.appendChild(progressSpan);
            if (item.details.updated_at) {
                const updSpan = document.createElement('span');
                updSpan.textContent = '\u66f4\u65b0: ' + new Date(item.details.updated_at).toLocaleString('ja-JP');
                subRow.appendChild(updSpan);
            }
        } else if (!isTask && item.details) {
            const toolSpan = document.createElement('span');
            toolSpan.textContent = '\u30c4\u30fc\u30eb: ' + (item.details.tool_call_count || 0) + '\u4ef6';
            subRow.appendChild(toolSpan);
            if (item.details.trace_id) {
                const trSpan = document.createElement('span');
                trSpan.style.fontFamily = 'monospace';
                trSpan.textContent = 'ID: ' + item.details.trace_id.substring(0, 16) + '\u2026';
                subRow.appendChild(trSpan);
            }
        }
        body.appendChild(subRow);
        card.appendChild(body);
        list.appendChild(card);
    });

    container.appendChild(list);
}


async function loadHealth() {
    const container = document.getElementById('health-content');
    container.innerHTML = '<p class="empty">読み込み中...</p>';
    const healthData = await API.getAgentsHealth();
    if (!healthData || healthData.length === 0) {
        container.innerHTML = '<p class="empty">エージェントなし</p>';
        return;
    }
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;';
    healthData.forEach(agent => {
        const card = document.createElement('div');
        card.style.cssText = 'background:#1e1e2e;border:1px solid #333;border-radius:8px;padding:1rem;';
        const statusColor = agent.status === 'running' ? '#50fa7b' : agent.status === 'error' ? '#ff5555' : '#6272a4';
        const errorColor = agent.error_rate > 20 ? '#ff5555' : agent.error_rate > 5 ? '#ffb86c' : '#50fa7b';
        const lastAct = agent.aw_last_trace_at || agent.last_task_at;
        const lastActStr = lastAct ? new Date(lastAct).toLocaleString('ja-JP') : 'なし';
        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
                <strong style="font-size:1rem;">${agent.agent_name}</strong>
                <span style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor};border-radius:4px;padding:2px 8px;font-size:0.75rem;">${agent.status}</span>
            </div>
            <table style="width:100%;font-size:0.82rem;border-collapse:collapse;">
                <tr><td style="color:#6272a4;padding:2px 0;">エラー率</td><td style="color:${errorColor};text-align:right;font-weight:bold;">${agent.error_rate}%</td></tr>
                <tr><td style="color:#6272a4;padding:2px 0;">総タスク</td><td style="text-align:right;">${agent.total_tasks}</td></tr>
                <tr><td style="color:#6272a4;padding:2px 0;">完了</td><td style="color:#50fa7b;text-align:right;">${agent.completed_tasks}</td></tr>
                <tr><td style="color:#6272a4;padding:2px 0;">失敗</td><td style="color:#ff5555;text-align:right;">${agent.failed_tasks}</td></tr>
                <tr><td style="color:#6272a4;padding:2px 0;">最終活動</td><td style="text-align:right;font-size:0.75rem;">${lastActStr}</td></tr>
            </table>
        `;
        grid.appendChild(card);
    });
    container.appendChild(grid);
}

document.getElementById('health-refresh-btn')?.addEventListener('click', loadHealth);
