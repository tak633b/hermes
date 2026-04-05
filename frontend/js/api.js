const API_BASE_URL = 'http://localhost:8010';
const AW_BASE_URL = 'http://localhost:8000';

class API {
    static async request(endpoint, options = {}) {
        const url = `${API_BASE_URL}${endpoint}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || `HTTP ${response.status}`);
        }

        return response.json();
    }

    // Agents
    static getAgents() {
        return this.request('/agents');
    }

    static createAgent(name, description) {
        return this.request('/agents', {
            method: 'POST',
            body: JSON.stringify({
                name,
                description,
                status: 'idle'
            })
        });
    }

    static getAgent(id) {
        return this.request(`/agents/${id}`);
    }

    static getAgentLogs(id) {
        return this.request(`/agents/${id}/logs`);
    }

    static getAgentMemory(id) {
        return this.request(`/agents/${id}/memory`);
    }

    static updateAgentParameters(id, parameters) {
        return this.request(`/agents/${id}/parameters`, {
            method: 'PUT',
            body: JSON.stringify(parameters)
        });
    }

    static updateAgentToolCalls(id, toolCalls) {
        return this.request(`/agents/${id}/tool_calls`, {
            method: 'PUT',
            body: JSON.stringify(toolCalls)
        });
    }

    static getAvailableTools() {
        return this.request('/tools');
    }

    // Tasks
    static getTasks(agentId = null, status = null) {
        let endpoint = '/tasks';
        const params = [];
        if (agentId) params.push(`agent_id=${agentId}`);
        if (status) params.push(`status=${status}`);
        if (params.length > 0) {
            endpoint += '?' + params.join('&');
        }
        return this.request(endpoint);
    }

    static createTask(agentId, title, description) {
        return this.request('/tasks', {
            method: 'POST',
            body: JSON.stringify({
                agent_id: agentId,
                title,
                description,
                status: 'pending',
                progress: 0
            })
        });
    }

    static getTask(id) {
        return this.request(`/tasks/${id}`);
    }

    static updateTask(id, taskData) {
        return this.request(`/tasks/${id}`, {
            method: 'PUT',
            body: JSON.stringify(taskData)
        });
    }

    static retryTask(id) {
        return this.request(`/tasks/${id}/retry`, {
            method: 'PUT'
        });
    }

    static updateTaskStatus(id, status) {
        return this.request(`/tasks/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
    }

    static executeTask(id) {
        return this.request(`/tasks/${id}/execute`, {
            method: 'POST'
        });
    }

    static getTaskLogs(id) {
        return this.request(`/tasks/${id}/logs`);
    }

    // Status
    static updateAgent(agentId, data) {
        return this.request(`/agents/${agentId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
    }

    static getStatus() {
        return this.request('/status');
    }

    static getHealth() {
        return this.request('/health');
    }

    // Agent Whisper integration (direct call to agent-whisper backend)
    static async getAgentWhisperTraces(agentId, limit = 20) {
        try {
            const res = await fetch(`${AW_BASE_URL}/traces?agent_id=${encodeURIComponent(agentId)}&limit=${limit}`);
            if (!res.ok) return [];
            return await res.json();
        } catch (_e) {
            return [];
        }
    }

    static async searchAgentWhisperTraces(query, limit = 50) {
        try {
            const res = await fetch(`${AW_BASE_URL}/traces?q=${encodeURIComponent(query)}&limit=${limit}`);
            if (!res.ok) return [];
            return await res.json();
        } catch (_e) {
            return [];
        }
    }

    static async searchTraces(query, limit = 20, offset = 0) {
        const url = `${AW_BASE_URL}/traces?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('agent-whisper search failed');
        return await resp.json();
    }

    static async getAllTraces(limit = 50) {
        const url = `${AW_BASE_URL}/traces?limit=${limit}`;
        const response = await fetch(url);
        if (!response.ok) return [];
        return response.json();
    }

    // Unified Timeline
    static async getTimeline(agentId = null, limit = 50) {
        let endpoint = `/timeline?limit=${limit}`;
        if (agentId) endpoint += `&agent_id=${encodeURIComponent(agentId)}`;
        try {
            return await this.request(endpoint);
        } catch (_e) {
            return [];
        }
    }
}
