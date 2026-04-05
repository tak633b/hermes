const API_BASE_URL = 'http://localhost:8000';

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

    // Status
    static getStatus() {
        return this.request('/status');
    }

    static getHealth() {
        return this.request('/health');
    }
}
