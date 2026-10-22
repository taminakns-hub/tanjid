// Global State Management
let bots = [];
let selectedBotId = null;
let logSocket = null;
let logReconnectTimer = null;
let logOffsets = {};
let logReconnectAttempts = {};
let metricsInterval = null;
let botRefreshInterval = null;

let currentUser = { username: "", role: "user" };
let activeFilePath = null;
let aceEditor = null;

// Metrics Chart.js variables
let cpuChart = null;
let ramChart = null;
let metricsPollInterval = null;
let cpuDataHistory = [];
let ramDataHistory = [];
let chartLabels = [];

// Initialize Page
document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("dashboard-page")) {
        if (history.state === null) {
            history.replaceState({ view: "dashboard" }, "", "");
        }
        
        window.addEventListener("popstate", (event) => {
            const state = event.state;
            if (state && state.view === "workspace") {
                document.getElementById("dashboard-view").style.display = "none";
                document.getElementById("workspace-view").style.display = "block";
                selectBot(state.botId, true);
            } else {
                showDashboardViewInternal();
            }
        });

        initDashboard();
    }
});

async function initDashboard() {
    // 1. Fetch current user role & authenticate
    await fetchCurrentUser();
    
    // 2. Fetch list of bots
    await fetchBots(true);
    fetchMetrics();
    
    // Restore workspace view if history state was workspace
    if (history.state && history.state.view === "workspace") {
        const botId = history.state.botId;
        if (bots.some(b => b.id === botId)) {
            viewBotWorkspace(botId);
        } else {
            history.replaceState({ view: "dashboard" }, "", "");
        }
    }
    
    // 3. Setup global polling
    metricsInterval = setInterval(fetchMetrics, 5000);
    botRefreshInterval = setInterval(() => fetchBots(false), 3000);

    // 4. Initialize Ace Editor
    initAceEditor();
    setupConsoleInput();
    setupFileManagerEvents();

    // 5. Setup Event Listeners
    document.getElementById("btn-add-bot")?.addEventListener("click", openAddBotModal);
    document.getElementById("add-bot-form")?.addEventListener("submit", handleAddBot);
    document.getElementById("env-add-row")?.addEventListener("click", addEnvRow);
    document.getElementById("btn-save-env")?.addEventListener("click", saveEnvVariables);
    document.getElementById("form-install-package")?.addEventListener("submit", handleInstallPackage);
    document.getElementById("btn-install-reqs")?.addEventListener("click", handleInstallRequirements);
    document.getElementById("btn-save-reqs")?.addEventListener("click", () => saveRequirements(true));
    
    // Admin listeners
    document.getElementById("btn-save-settings")?.addEventListener("click", saveAdminSettings);
    document.getElementById("form-change-password")?.addEventListener("submit", handleAdminChangePassword);
    document.getElementById("btn-save-startup-file")?.addEventListener("click", saveStartupFile);

    // Setup 3D Scroll Reveal IntersectionObserver
    applyScrollReveal();
}

// Fetch Current User
async function fetchCurrentUser() {
    try {
        const res = await fetch("/api/me");
        if (res.status === 401) {
            window.location.href = "/login";
            return;
        }
        const data = await res.json();
        currentUser = data;
        
        document.getElementById("header-user-badge").textContent = `Operator: ${data.username} [${data.role.toUpperCase()}]`;
        updateBotLimitBadge();
        
        // If admin, show navigation tabs and load admin panel
        if (data.role === "admin") {
            document.getElementById("main-nav-tabs").style.display = "flex";
            const ownerGroup = document.getElementById("modal-owner-group");
            if (ownerGroup) ownerGroup.style.display = "block";
            fetchAdminData();
        }
    } catch (err) {
        console.error("Error fetching me details:", err);
    }
}

// Switch Main Dashboard Tabs (APPLICATIONS / ADMIN PANEL)
function switchMainTab(element, tabId) {
    document.querySelectorAll(".main-tab-content").forEach(el => {
        el.style.display = "none";
    });
    document.querySelectorAll("#main-nav-tabs .tab").forEach(tab => {
        tab.classList.remove("active");
    });

    document.getElementById(`tab-content-${tabId}`).style.display = "block";
    
    if (element) {
        element.classList.add("active");
    } else {
        const tabEl = document.querySelector(`#main-nav-tabs .tab[onclick*="${tabId}"]`);
        if (tabEl) tabEl.classList.add("active");
    }

    if (tabId === "admin-panel-tab") {
        fetchAdminData();
    } else {
        fetchBots(true);
    }
}

// Fetch Stats & System Metrics
async function fetchMetrics() {
    try {
        const res = await fetch("/api/metrics");
        if (res.ok) {
            const data = await res.json();
            document.getElementById("metric-total-bots").textContent = data.total_bots;
            document.getElementById("metric-running-bots").textContent = data.running_bots;
            document.getElementById("metric-cpu").textContent = `${data.cpu_usage.toFixed(1)}%`;
            document.getElementById("metric-ram").textContent = `${data.ram_usage.toFixed(1)}%`;
        }
    } catch (err) {
        console.error("Error fetching metrics:", err);
    }
}

// Fetch Bots List
async function fetchBots(initial = false) {
    try {
        const res = await fetch("/api/bots");
        if (res.status === 401) {
            window.location.href = "/login";
            return;
        }
        const data = await res.json();
        
        const botsChanged = JSON.stringify(bots) !== JSON.stringify(data);
        bots = data;
        updateBotLimitBadge();

        if (botsChanged || initial) {
            renderBotsGrid();
            renderSidebarList();
            
            if (selectedBotId) {
                const currentBot = bots.find(b => b.id === selectedBotId);
                if (currentBot) {
                    updateWorkspaceBotDetails(currentBot);
                }
            }
        }
    } catch (err) {
        console.error("Error fetching bots:", err);
    }
}

// Render Grid of Bots on Main Dashboard View
function renderBotsGrid() {
    const grid = document.getElementById("bots-grid");
    if (!grid) return;

    if (bots.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.886A2 2 0 0 1 8.18 10.18L2.293 12.09a2 2 0 0 0 0 3.82l5.886 1.912a2 2 0 0 1 1.912 1.912l1.912 5.886a2 2 0 0 0 3.82 0l1.912-5.886a2 2 0 0 1 1.912-1.912l5.886-1.912a2 2 0 0 0 0-3.82l-5.886-1.912a2 2 0 0 1-1.912-1.912L13.91 3a2 2 0 0 0-3.82 0Z"/></svg>
                <h3>No bots hosted yet</h3>
                <p>Create an empty workspace, then add or upload your bot files from its Files tab.</p>
                <button class="btn btn-primary" onclick="openAddBotModal()">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Host New Bot
                </button>
            </div>
        `;
        return;
    }

    grid.innerHTML = bots.map(bot => `
        <div class="bot-card scroll-reveal" onclick="viewBotWorkspace('${bot.id}')">
            <div class="bot-card-header">
                <div>
                    <h4 class="bot-title">${escapeHTML(bot.name)}</h4>
                    <div class="bot-source">
                        ${bot.source_type === 'workspace' ? `
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h18v13H3z"/><path d="M3 7l2-4h6l2 4"/></svg>
                            Workspace
                        ` : bot.source_type === 'git' ? `
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
                            Git Repository
                        ` : bot.source_type === 'zip' ? `
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                            ZIP Archive
                        ` : `
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            Pasted Script
                        `}
                        &bull; <span class="badge-owner" style="font-size: 0.65rem; border: none; padding: 0;">${escapeHTML(bot.owner)}</span>
                    </div>
                </div>
                <span class="bot-status-badge status-${bot.status}">${bot.status}</span>
            </div>
            
            <div class="bot-card-body">
                <div class="bot-meta-item">
                    Startup file: <span>${escapeHTML(bot.entrypoint || "Not selected")}</span>
                </div>
                <div class="bot-meta-item">
                    Auto Restart: <span>${bot.auto_restart ? 'YES' : 'NO'}</span>
                </div>
                <div class="bot-meta-item">
                    Environment Vars: <span>${Object.keys(bot.env_vars).length} vars</span>
                </div>
                ${bot.bot_telegram_name ? `
                    <div class="bot-meta-item" style="margin-top: 0.5rem; padding: 0.4rem; background: rgba(0, 255, 102, 0.05); border: 1px dashed rgba(0, 255, 102, 0.2); border-radius: 4px; display: flex; flex-direction: column; gap: 0.15rem;">
                        <div style="font-size: 0.72rem; color: var(--text-main); font-weight: bold; display: flex; align-items: center; gap: 0.25rem;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                            Telegram Details
                        </div>
                        <div style="font-size: 0.68rem; color: var(--text-muted);">Name: <span style="color: var(--accent);">${escapeHTML(bot.bot_telegram_name)}</span></div>
                        <div style="font-size: 0.68rem; color: var(--text-muted);">Username: <a href="https://t.me/${escapeHTML(bot.bot_username)}" target="_blank" style="color: var(--primary-light); text-decoration: underline;">@${escapeHTML(bot.bot_username)}</a></div>
                    </div>
                ` : ''}
            </div>

            <div class="bot-card-actions" onclick="event.stopPropagation()">
                ${bot.status === 'running' ? `
                    <button class="btn btn-secondary btn-icon" title="Stop Bot" onclick="controlBot('${bot.id}', 'stop')">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/></svg>
                    </button>
                ` : `
                    <button class="btn btn-primary btn-icon" title="${bot.entrypoint ? 'Start Bot' : 'Choose a startup file first'}" onclick="controlBot('${bot.id}', 'start')" ${bot.status === 'installing' || !bot.entrypoint ? 'disabled' : ''}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>
                `}
                <button class="btn btn-secondary btn-icon" title="Restart Bot" onclick="controlBot('${bot.id}', 'restart')" ${bot.status === 'installing' || !bot.entrypoint ? 'disabled' : ''}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                </button>
                <button class="btn btn-secondary" onclick="viewBotWorkspace('${bot.id}')">
                    Manage
                </button>
            </div>
        </div>
    `).join("");
    applyScrollReveal();
}

// Render Sidebar List inside Workspace View
function renderSidebarList() {
    const list = document.getElementById("sidebar-bots-list");
    if (!list) return;

    list.innerHTML = bots.map(bot => `
        <div class="sidebar-item ${bot.id === selectedBotId ? 'active' : ''}" onclick="selectBot('${bot.id}')">
            <div style="max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <strong style="font-size: 0.8125rem; font-family: 'Fira Code', monospace;">${escapeHTML(bot.name)}</strong>
            </div>
            <span class="bot-status-badge status-${bot.status}" style="font-size: 0.6rem; padding: 0.15rem 0.4rem;">${bot.status}</span>
        </div>
    `).join("");
}

function viewBotWorkspace(botId) {
    document.getElementById("dashboard-view").style.display = "none";
    document.getElementById("workspace-view").style.display = "block";
    selectBot(botId);
}

function showDashboardView() {
    if (history.state && history.state.view === "workspace") {
        history.back();
    } else {
        showDashboardViewInternal();
    }
}

function showDashboardViewInternal() {
    closeLogSocket();
    stopMetricsPolling();
    stopStatsPolling();
    selectedBotId = null;
    document.getElementById("workspace-view").style.display = "none";
    document.getElementById("dashboard-view").style.display = "block";
    fetchBots(true);
}

// Select Bot inside Workspace
function selectBot(botId, preventStateUpdate = false) {
    selectedBotId = botId;
    renderSidebarList();

    const bot = bots.find(b => b.id === botId);
    if (!bot) return;

    // Reset tabs
    switchTab('console');

    // Populate Details
    updateWorkspaceBotDetails(bot);

    // The authenticated WebSocket sends the recent log tail and then follows
    // new output continuously, so the console never needs a page reload.
    setupLogWebSocket(botId);

    // Live stat cards next to the console
    startStatsPolling();

    // Setup Env variables
    loadEnvVariables(bot.env_vars);
    loadStartupFileOptions(bot);

    // Load requirements.txt
    loadRequirements(botId);
    
    // Load Web IDE files
    loadFilesIDE(botId);

    // Setup performance metrics charts
    setupMetricsCharts(botId);

    // Handle history state updates
    if (!preventStateUpdate) {
        if (history.state && history.state.view === "workspace") {
            if (history.state.botId !== botId) {
                history.replaceState({ view: "workspace", botId: botId }, "", "");
            }
        } else {
            history.pushState({ view: "workspace", botId: botId }, "", "");
        }
    }
}

function updateWorkspaceBotDetails(bot) {
    document.getElementById("ws-bot-name").textContent = bot.name;
    document.getElementById("ws-bot-owner-badge").textContent = `Owner: ${bot.owner}`;
    
    const tgBadge = document.getElementById("ws-bot-telegram-badge");
    if (tgBadge) {
        if (bot.bot_telegram_name && bot.bot_username) {
            tgBadge.innerHTML = `🤖 ${escapeHTML(bot.bot_telegram_name)} (<a href="https://t.me/${escapeHTML(bot.bot_username)}" target="_blank" style="color: var(--accent); text-decoration: underline;">@${escapeHTML(bot.bot_username)}</a>)`;
            tgBadge.style.display = "inline-block";
        } else {
            tgBadge.style.display = "none";
        }
    }
    
    const badge = document.getElementById("ws-bot-status-badge");
    badge.className = `bot-status-badge status-${bot.status}`;
    badge.textContent = bot.status;

    const startBtn = document.getElementById("ws-btn-start");
    const stopBtn = document.getElementById("ws-btn-stop");
    const restartBtn = document.getElementById("ws-btn-restart");
    const startupInput = document.getElementById("startup-entrypoint-input");
    const startupSaveBtn = document.getElementById("btn-save-startup-file");

    const running = bot.status === "running";
    const installing = bot.status === "installing";
    startBtn.style.display = "inline-flex";
    stopBtn.style.display = "inline-flex";
    startBtn.disabled = running || installing || !bot.entrypoint;
    stopBtn.disabled = !running;
    restartBtn.disabled = installing || !bot.entrypoint;
    if (startupInput) startupInput.disabled = running;
    if (startupSaveBtn) startupSaveBtn.disabled = running;
}

async function loadStartupFileOptions(bot) {
    const input = document.getElementById("startup-entrypoint-input");
    const options = document.getElementById("startup-entrypoint-options");
    const status = document.getElementById("startup-entrypoint-status");
    if (!input || !options || !bot) return;

    input.value = bot.entrypoint || "";
    options.innerHTML = "";
    status.textContent = "Loading Python files from this bot...";

    try {
        const res = await fetch(`/api/bots/${encodeURIComponent(bot.id)}/files`);
        if (!res.ok) throw new Error((await res.json()).detail || "Could not load project files.");
        const files = await res.json();
        const scripts = files.filter(file => !file.is_dir && file.path.toLowerCase().endsWith(".py"));
        options.innerHTML = scripts.map(file => `<option value="${escapeHTML(file.path)}"></option>`).join("");
        status.textContent = scripts.length
            ? (bot.entrypoint
                ? `${scripts.length} Python file(s) available. Select one or type a relative path.`
                : `${scripts.length} Python file(s) available. Choose one and save it before starting.`)
            : "No Python files found yet. Upload/create one, then enter its relative path.";
    } catch (err) {
        status.textContent = err.message || "Could not load project files.";
    }
}

async function saveStartupFile() {
    if (!selectedBotId) return;
    const input = document.getElementById("startup-entrypoint-input");
    const status = document.getElementById("startup-entrypoint-status");
    const button = document.getElementById("btn-save-startup-file");
    const entrypoint = input.value.trim();
    if (!entrypoint) {
        status.textContent = "Enter or select a Python startup file first.";
        input.focus();
        return;
    }

    button.disabled = true;
    status.textContent = "Checking file and saving startup settings...";
    try {
        const res = await fetch(`/api/bots/${encodeURIComponent(selectedBotId)}/entrypoint`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entrypoint })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || "Could not save startup file.");

        input.value = data.entrypoint;
        const bot = bots.find(item => item.id === selectedBotId);
        if (bot) {
            bot.entrypoint = data.entrypoint;
            updateWorkspaceBotDetails(bot);
        }
        status.textContent = `Saved: ${data.entrypoint}. This file will run the next time the bot starts.`;
        fetchBots(false);
    } catch (err) {
        status.textContent = err.message || "Could not save startup file.";
    } finally {
        const bot = bots.find(item => item.id === selectedBotId);
        button.disabled = !!bot && bot.status === "running";
    }
}

// Switch workspace tabs
function switchTab(tabId) {
    document.querySelectorAll(".tab").forEach(tab => {
        tab.classList.remove("active");
    });
    document.querySelectorAll(".tab-content").forEach(content => {
        content.classList.remove("active");
    });

    document.querySelector(`.tab[onclick="switchTab('${tabId}')"]`).classList.add("active");
    document.getElementById(`tab-${tabId}`).classList.add("active");

    if (tabId === 'files' && aceEditor) {
        aceEditor.resize();
    }
    if (tabId === "env" && selectedBotId) {
        const bot = bots.find(item => item.id === selectedBotId);
        if (bot) loadStartupFileOptions(bot);
    }
}

// Add Bot Modal
function openAddBotModal() {
    document.getElementById("add-bot-modal").classList.add("open");
}

function closeAddBotModal() {
    document.getElementById("add-bot-modal").classList.remove("open");
    document.getElementById("add-bot-form").reset();
}

// Add Bot Form
async function handleAddBot(e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating...";

    const formData = new FormData(e.target);
    const overlay = document.getElementById("creation-loading-overlay");
    const terminalLogs = document.getElementById("creation-terminal-logs");
    if (overlay) overlay.style.display = "flex";
    if (terminalLogs) {
        terminalLogs.textContent = "Creating your empty bot workspace...";
    }

    try {
        const res = await fetch("/api/bots", {
            method: "POST",
            body: formData
        });

        if (res.ok) {
            const bot = await res.json();
            closeAddBotModal();
            if (overlay) overlay.style.display = "none";
            await fetchBots(true);
            if (bot && bot.id) {
                viewBotWorkspace(bot.id);
                switchTab("files");
            }
        } else {
            if (overlay) overlay.style.display = "none";
            const err = await res.json().catch(() => ({}));
            alert(`Error: ${err.detail || "Failed to add bot"}`);
        }
    } catch (err) {
        if (overlay) overlay.style.display = "none";
        console.error(err);
        alert(err.message || "Failed to connect to server.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Workspace";
    }
}

// Control Bot processes
async function controlBot(botId, action) {
    try {
        const res = await fetch(`/api/bots/${botId}/${action}`, {
            method: "POST"
        });
        if (res.ok) {
            fetchBots(false);
        } else {
            const err = await res.json();
            alert(`Failed: ${err.detail}`);
        }
    } catch (err) {
        console.error(err);
        alert("Failed to connect to server.");
    }
}

function handleWSControlBot(action) {
    if (!selectedBotId) return;
    controlBot(selectedBotId, action);
}

// Delete Bot
async function deleteSelectedBot() {
    if (!selectedBotId) return;
    const bot = bots.find(b => b.id === selectedBotId);
    if (!bot) return;

    if (!confirm(`Are you absolutely sure you want to delete '${bot.name}'? This will delete all code, packages, and logs.`)) {
        return;
    }

    try {
        const res = await fetch(`/api/bots/${selectedBotId}`, {
            method: "DELETE"
        });

        if (res.ok) {
            showDashboardView();
        } else {
            const err = await res.json();
            alert(`Error: ${err.detail || "Failed to delete bot"}`);
        }
    } catch (err) {
        console.error(err);
    }
}

// Load logs initially
async function loadLogs(botId) {
    const terminal = document.getElementById("terminal-console");
    if (!terminal) return;

    terminal.textContent = "Loading console logs...";
    try {
        const res = await fetch(`/api/bots/${botId}/logs`);
        if (res.ok) {
            const logs = await res.text();
            terminal.textContent = logs || "No logs yet.";
            terminal.scrollTop = terminal.scrollHeight;
        }
    } catch (err) {
        terminal.textContent = "Error reading logs from server.";
    }
}

// Set up WebSocket for live logs
function setupLogWebSocket(botId) {
    closeLogSocket();
    const terminal = document.getElementById("terminal-console");
    if (!terminal) return;
    if (!Object.prototype.hasOwnProperty.call(logOffsets, botId)) {
        logOffsets[botId] = 0;
        terminal.textContent = "Connecting to live bot console...";
    }

    const connect = () => {
        if (selectedBotId !== botId) return;
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/api/bots/${encodeURIComponent(botId)}/logs/ws?after=${encodeURIComponent(logOffsets[botId] || 0)}`;
        logSocket = new WebSocket(wsUrl);

        logSocket.onopen = () => {
            terminal.dataset.connection = "connected";
            logReconnectAttempts[botId] = 0;
            const notice = terminal.dataset.reconnectNotice;
            if (notice) {
                terminal.textContent = terminal.textContent.replace(notice, "");
                delete terminal.dataset.reconnectNotice;
            }
        };

        logSocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === "snapshot") {
                    terminal.textContent = message.text || "";
                } else if (message.type === "line") {
                    terminal.textContent += message.text || "";
                }
                if (Number.isFinite(message.offset)) logOffsets[botId] = message.offset;
                // Prevent long-running sessions from growing the browser buffer forever.
                if (terminal.textContent.length > 250000) {
                    terminal.textContent = terminal.textContent.slice(-200000);
                }
                terminal.scrollTop = terminal.scrollHeight;
            } catch (err) {
                console.error("Invalid live console message:", err);
            }
        };

        logSocket.onclose = (event) => {
            if (selectedBotId !== botId) return;
            if ([4401, 4403, 4404].includes(event.code)) {
                terminal.dataset.connection = "closed";
                terminal.textContent += "\n[Console access denied or bot no longer available.]\n";
                return;
            }
            terminal.dataset.connection = "reconnecting";
            const attempts = (logReconnectAttempts[botId] || 0) + 1;
            logReconnectAttempts[botId] = attempts;
            const delayMs = Math.min(1000 * (2 ** Math.min(attempts - 1, 4)), 15000);
            if (!terminal.dataset.reconnectNotice) {
                const notice = `\n[Console disconnected (code ${event.code}); reconnecting in ${Math.ceil(delayMs / 1000)}s...]\n`;
                terminal.textContent += notice;
                terminal.dataset.reconnectNotice = notice;
            }
            logReconnectTimer = setTimeout(connect, delayMs);
        };

        logSocket.onerror = () => {
            // Closing triggers onclose, which reconnects without reloading the page.
            if (logSocket && logSocket.readyState < WebSocket.CLOSING) logSocket.close();
        };
    };
    connect();
}

function closeLogSocket() {
    if (logReconnectTimer) {
        clearTimeout(logReconnectTimer);
        logReconnectTimer = null;
    }
    if (logSocket) {
        logSocket.onclose = null;
        logSocket.close();
        logSocket = null;
    }
}

function clearConsole() {
    const terminal = document.getElementById("terminal-console");
    if (terminal) terminal.textContent = "";
}

// Env Variables Manager
function loadEnvVariables(envVars) {
    const list = document.getElementById("env-variables-list");
    if (!list) return;

    list.innerHTML = "";
    Object.entries(envVars).forEach(([key, val]) => {
        addEnvRowWithValue(key, val);
    });

    if (Object.keys(envVars).length === 0) {
        addEnvRow();
    }
}

function addEnvRow() {
    addEnvRowWithValue("", "");
}

function addEnvRowWithValue(key, value) {
    const list = document.getElementById("env-variables-list");
    const row = document.createElement("div");
    row.className = "env-row";
    row.innerHTML = `
        <input type="text" class="form-control env-key text-green" placeholder="Variable Name" value="${escapeHTML(key)}" required style="font-family: 'Fira Code', monospace;">
        <input type="text" class="form-control env-value text-green" placeholder="Value" value="${escapeHTML(value)}" required style="font-family: 'Fira Code', monospace;">
        <button type="button" class="btn btn-danger btn-icon" onclick="this.parentElement.remove()" style="padding: 0.5rem;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    `;
    list.appendChild(row);
}

async function saveEnvVariables() {
    if (!selectedBotId) return;

    const rows = document.querySelectorAll("#env-variables-list .env-row");
    const env_vars = {};
    let valid = true;

    rows.forEach(row => {
        const key = row.querySelector(".env-key").value.trim();
        const val = row.querySelector(".env-value").value.trim();
        if (key) {
            env_vars[key] = val;
        } else {
            valid = false;
        }
    });

    if (!valid) {
        alert("Environment variable name cannot be empty.");
        return;
    }

    const saveBtn = document.getElementById("btn-save-env");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
        const res = await fetch(`/api/bots/${selectedBotId}/env`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(env_vars)
        });

        if (res.ok) {
            const bot = bots.find(b => b.id === selectedBotId);
            if (bot) bot.env_vars = env_vars;
            alert("Environment variables updated successfully!");
        } else {
            const err = await res.json();
            alert(`Error: ${err.detail}`);
        }
    } catch (err) {
        console.error(err);
        alert("Failed to save variables.");
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Variables";
    }
}

// Single Package Pip install
async function handleInstallPackage(e) {
    e.preventDefault();
    if (!selectedBotId) return;

    const input = document.getElementById("package_name");
    const name = input.value.trim();
    if (!name) return;

    const btn = e.target.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Installing...";

    try {
        const res = await fetch(`/api/bots/${selectedBotId}/install`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ package_name: name })
        });

        if (res.ok) {
            input.value = "";
            switchTab('console');
            alert(`Installing '${name}' in the background. Check console logs for progress!`);
            fetchBots(false);
        } else {
            const err = await res.json();
            alert(`Error: ${err.detail}`);
        }
    } catch (err) {
        console.error(err);
        alert("Failed to install package.");
    } finally {
        btn.disabled = false;
        btn.textContent = "Install Package";
    }
}

// requirements.txt saving and installing
async function handleInstallRequirements() {
    if (!selectedBotId) return;

    const btn = document.getElementById("btn-install-reqs");
    btn.disabled = true;

    // First save
    const saved = await saveRequirements(false);
    if (!saved) {
        btn.disabled = false;
        return;
    }

    try {
        const res = await fetch(`/api/bots/${selectedBotId}/install-requirements`, {
            method: "POST"
        });

        if (res.ok) {
            switchTab('console');
            alert("Installing requirements.txt in the background. Check console logs for progress!");
            fetchBots(false);
        } else {
            const err = await res.json();
            alert(`Error: ${err.detail}`);
        }
    } catch (err) {
        console.error(err);
        alert("Failed to start requirements installation.");
    } finally {
        btn.disabled = false;
    }
}

async function loadRequirements(botId) {
    const area = document.getElementById("requirements_content");
    if (!area) return;
    area.value = "Loading requirements.txt...";
    try {
        const res = await fetch(`/api/bots/${botId}/requirements`);
        if (res.ok) {
            const data = await res.json();
            area.value = data.requirements;
        } else {
            area.value = "Error loading requirements.txt";
        }
    } catch (err) {
        console.error(err);
        area.value = "Error loading requirements.txt";
    }
}

async function saveRequirements(showNotification = true) {
    if (!selectedBotId) return false;
    const content = document.getElementById("requirements_content").value;
    try {
        const res = await fetch(`/api/bots/${selectedBotId}/requirements`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requirements: content })
        });
        if (res.ok) {
            if (showNotification) alert("requirements.txt saved successfully!");
            return true;
        } else {
            alert("Failed to save requirements.txt");
            return false;
        }
    } catch (err) {
        console.error(err);
        alert("Error saving requirements.");
        return false;
    }
}

// --- Web IDE Code Editor (Ace Editor CDN Integration) ---

function initAceEditor() {
    const container = document.getElementById("ide-editor");
    if (!container) return;
    
    aceEditor = ace.edit("ide-editor");
    aceEditor.setTheme("ace/theme/tomorrow_night_eighties"); // Cyberpunk-like dark theme
    aceEditor.session.setMode("ace/mode/python");
    aceEditor.setReadOnly(true);
    
    // Bind Ctrl+S shortcut to save active file
    aceEditor.commands.addCommand({
        name: 'saveFile',
        bindKey: {win: 'Ctrl-S', mac: 'Command-S'},
        exec: function(editor) {
            saveActiveFileIDE();
        }
    });
}

// ================= Pterodactyl-style File Manager =================
let fmDir = "";            // current directory, relative to bot root
let fmItems = [];          // items in the current directory
let fmSelected = new Set();

function fmApi(path) { return `/api/bots/${selectedBotId}/fm/${path}`; }

async function fmPost(path, body) {
    const res = await fetch(fmApi(path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        let msg = "Request failed";
        try { msg = (await res.json()).detail || msg; } catch (e) {}
        throw new Error(msg);
    }
    return res.json();
}

function loadFilesIDE(botId) { fmDir = ""; fmSelected.clear(); return fmLoad(""); }

async function fmLoad(dir) {
    if (!selectedBotId) return;
    const table = document.getElementById("fm-table");
    try {
        const res = await fetch(`${fmApi("list")}?dir=${encodeURIComponent(dir)}`);
        if (!res.ok) throw new Error((await res.json()).detail || "Failed to list");
        const data = await res.json();
        fmDir = data.dir;
        fmItems = data.items;
        fmSelected.clear();
        fmRender();
    } catch (err) {
        table.innerHTML = `<div class="pt-fm-empty">${escapeHTML(err.message)}</div>`;
    }
}

function fmFormatSize(bytes) {
    if (bytes < 1024) return `${bytes} Bytes`;
    const units = ["KiB", "MiB", "GiB", "TiB"];
    let v = bytes / 1024, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(2)} ${units[i]}`;
}

function fmFormatDate(iso) {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "less than a minute ago";
    return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmJoin(...parts) { return parts.filter(Boolean).join("/"); }

function fmRenderBreadcrumb() {
    const bc = document.getElementById("fm-breadcrumb");
    const segs = fmDir ? fmDir.split("/") : [];
    let html = `<span class="pt-bc-sep">/</span><a onclick="fmLoad('')">home</a><span class="pt-bc-sep">/</span><a onclick="fmLoad('')">container</a><span class="pt-bc-sep">/</span>`;
    let acc = "";
    segs.forEach((s, i) => {
        acc = fmJoin(acc, s);
        const target = acc;
        html += i === segs.length - 1
            ? `<span class="pt-bc-current">${escapeHTML(s)}</span>`
            : `<a onclick="fmLoad('${target.replace(/'/g, "\\'")}')">${escapeHTML(s)}</a><span class="pt-bc-sep">/</span>`;
    });
    bc.innerHTML = html;
}

function fmRender() {
    fmRenderBreadcrumb();
    const table = document.getElementById("fm-table");
    const folderIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z"/></svg>`;
    const fileIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>`;

    let rows = "";
    if (fmDir) {
        const parent = fmDir.split("/").slice(0, -1).join("/");
        rows += `<div class="pt-fm-row pt-fm-up" onclick="fmLoad('${parent.replace(/'/g, "\\'")}')"><span class="pt-fm-check"></span><span class="pt-fm-icon">${folderIcon}</span><span class="pt-fm-name">..</span><span></span><span></span><span></span></div>`;
    }
    if (!fmItems.length && !fmDir) {
        rows += `<div class="pt-fm-empty">This directory seems to be empty.</div>`;
    }
    fmItems.forEach((it, idx) => {
        rows += `
        <div class="pt-fm-row" data-idx="${idx}" oncontextmenu="fmOpenMenu(event, ${idx})">
            <span class="pt-fm-check"><input type="checkbox" ${fmSelected.has(it.name) ? "checked" : ""} onclick="event.stopPropagation(); fmToggleSelect(${idx}, this.checked)"></span>
            <span class="pt-fm-icon">${it.is_dir ? folderIcon : fileIcon}</span>
            <span class="pt-fm-name" onclick="fmOpen(${idx})">${escapeHTML(it.name)}</span>
            <span class="pt-fm-size">${it.is_dir ? "" : fmFormatSize(it.size)}</span>
            <span class="pt-fm-date">${fmFormatDate(it.modified)}</span>
            <span class="pt-fm-dots" onclick="fmOpenMenu(event, ${idx})">&#8226;&#8226;&#8226;</span>
        </div>`;
    });
    table.innerHTML = rows;
    fmUpdateBulk();
}

function fmToggleSelect(idx, checked) {
    const name = fmItems[idx].name;
    checked ? fmSelected.add(name) : fmSelected.delete(name);
    fmUpdateBulk();
}

function fmUpdateBulk() {
    const show = fmSelected.size > 0 ? "inline-flex" : "none";
    document.getElementById("fm-bulk-delete").style.display = show;
    document.getElementById("fm-bulk-archive").style.display = show;
}

function fmOpen(idx) {
    const it = fmItems[idx];
    if (it.is_dir) fmLoad(fmJoin(fmDir, it.name));
    else openFileIDE(fmJoin(fmDir, it.name));
}

// ---- context menu (Rename / Move / Copy / Archive / Download / Delete) ----
function fmOpenMenu(event, idx) {
    event.preventDefault();
    event.stopPropagation();
    const it = fmItems[idx];
    const menu = document.getElementById("fm-context-menu");
    const isZip = it.name.toLowerCase().endsWith(".zip");
    const entries = [
        ["Rename", "fmRename"], ["Move", "fmMove"], ["Copy", "fmCopy"],
        ["Archive", "fmArchive"],
        ...(isZip ? [["Unarchive", "fmUnarchive"]] : []),
        ...(!it.is_dir ? [["Download", "fmDownload"]] : []),
        ["Delete", "fmDelete"]
    ];
    menu.innerHTML = entries.map(([label, fn]) =>
        `<div class="pt-menu-item ${label === "Delete" ? "danger" : ""}" onclick="${fn}(${idx})">${label}</div>`).join("");
    menu.style.display = "block";
    const rect = document.getElementById("tab-files").getBoundingClientRect();
    menu.style.left = Math.min(event.clientX - rect.left, rect.width - 170) + "px";
    menu.style.top = (event.clientY - rect.top) + "px";
}
document.addEventListener("click", () => {
    const m = document.getElementById("fm-context-menu");
    if (m) m.style.display = "none";
});

async function fmRename(idx) {
    const it = fmItems[idx];
    const name = prompt("New name:", it.name);
    if (!name || name === it.name) return;
    try { await fmPost("rename", { dir: fmDir, old_name: it.name, new_name: name }); fmLoad(fmDir); }
    catch (e) { alert(e.message); }
}
async function fmMove(idx) {
    const it = fmItems[idx];
    const dest = prompt("Move to directory (relative to root, empty = root):", fmDir);
    if (dest === null) return;
    try { await fmPost("move", { dir: fmDir, names: [it.name], destination: dest.replace(/^\/+|\/+$/g, "") }); fmLoad(fmDir); }
    catch (e) { alert(e.message); }
}
async function fmCopy(idx) {
    try { await fmPost("copy", { dir: fmDir, name: fmItems[idx].name }); fmLoad(fmDir); }
    catch (e) { alert(e.message); }
}
async function fmArchive(idx) {
    try { await fmPost("archive", { dir: fmDir, names: [fmItems[idx].name] }); fmLoad(fmDir); }
    catch (e) { alert(e.message); }
}
async function fmUnarchive(idx) {
    try { await fmPost("unarchive", { dir: fmDir, name: fmItems[idx].name }); fmLoad(fmDir); }
    catch (e) { alert(e.message); }
}
function fmDownload(idx) {
    window.location.href = `${fmApi("download")}?path=${encodeURIComponent(fmJoin(fmDir, fmItems[idx].name))}`;
}
async function fmDelete(idx) {
    const it = fmItems[idx];
    if (!confirm(`Delete '${it.name}'? This cannot be undone.`)) return;
    try { await fmPost("delete", { dir: fmDir, names: [it.name] }); fmLoad(fmDir); }
    catch (e) { alert(e.message); }
}
async function fmBulkDelete() {
    if (!confirm(`Delete ${fmSelected.size} selected item(s)?`)) return;
    try { await fmPost("delete", { dir: fmDir, names: [...fmSelected] }); fmLoad(fmDir); }
    catch (e) { alert(e.message); }
}
async function fmBulkArchive() {
    try { await fmPost("archive", { dir: fmDir, names: [...fmSelected] }); fmLoad(fmDir); }
    catch (e) { alert(e.message); }
}

async function fmCreateDirectory() {
    const name = prompt("Directory name:");
    if (!name) return;
    try {
        await fetch(`/api/bots/${selectedBotId}/files/create`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: fmJoin(fmDir, name), is_dir: true })
        }).then(async r => { if (!r.ok) throw new Error((await r.json()).detail); });
        fmLoad(fmDir);
    } catch (e) { alert(e.message); }
}

async function fmNewFile() {
    const name = prompt("File name:");
    if (!name) return;
    const path = fmJoin(fmDir, name);
    try {
        await fetch(`/api/bots/${selectedBotId}/files/create`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path, is_dir: false })
        }).then(async r => { if (!r.ok) throw new Error((await r.json()).detail); });
        openFileIDE(path);
    } catch (e) { alert(e.message); }
}

async function fmUploadFiles(fileList) {
    if (!fileList || !fileList.length || !selectedBotId) return;
    const fd = new FormData();
    fd.append("dir", fmDir);
    [...fileList].forEach(f => fd.append("files", f));
    try {
        const res = await fetch(fmApi("upload"), { method: "POST", body: fd });
        if (!res.ok) throw new Error((await res.json()).detail || "Upload failed");
        fmLoad(fmDir);
    } catch (e) { alert(e.message); }
}

function setupFileManagerEvents() {
    const input = document.getElementById("fm-upload-input");
    input?.addEventListener("change", () => { fmUploadFiles(input.files); input.value = ""; });

    const zone = document.getElementById("tab-files");
    const hint = document.getElementById("fm-dropzone");
    ["dragenter", "dragover"].forEach(ev => zone?.addEventListener(ev, e => {
        e.preventDefault(); hint.classList.add("active");
    }));
    ["dragleave", "drop"].forEach(ev => zone?.addEventListener(ev, e => {
        e.preventDefault(); hint.classList.remove("active");
    }));
    zone?.addEventListener("drop", e => fmUploadFiles(e.dataTransfer.files));
}

// ---- file editor (Ace) ----
async function openFileIDE(path) {
    if (!selectedBotId) return;
    try {
        const res = await fetch(`/api/bots/${selectedBotId}/files/read?path=${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error((await res.json()).detail || "Cannot open file");
        const data = await res.json();
        activeFilePath = path;
        document.getElementById("fm-list-view").style.display = "none";
        document.getElementById("fm-editor-view").style.display = "block";
        document.getElementById("fm-editor-path").innerHTML =
            `<span class="pt-bc-sep">/</span>home<span class="pt-bc-sep">/</span>container<span class="pt-bc-sep">/</span><span class="pt-bc-current">${escapeHTML(path)}</span>`;
        aceEditor.setValue(data.content, -1);
        aceEditor.setReadOnly(false);
        const ext = path.split(".").pop().toLowerCase();
        const modes = { py: "python", json: "json", js: "javascript", html: "html", css: "css", md: "markdown", yml: "yaml", yaml: "yaml", sh: "sh" };
        aceEditor.session.setMode("ace/mode/" + (modes[ext] || "text"));
        aceEditor.resize();
    } catch (e) { alert(e.message); }
}

function fmCloseEditor() {
    activeFilePath = null;
    document.getElementById("fm-editor-view").style.display = "none";
    document.getElementById("fm-list-view").style.display = "block";
    fmLoad(fmDir);
}

async function saveActiveFileIDE() {
    if (!selectedBotId || !activeFilePath) return;
    const btn = document.getElementById("ide-save-btn");
    btn.disabled = true;
    btn.textContent = "Saving...";
    try {
        const res = await fetch(`/api/bots/${selectedBotId}/files/write`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: activeFilePath, content: aceEditor.getValue() })
        });
        if (!res.ok) throw new Error((await res.json()).detail || "Failed to save");
        btn.textContent = "Saved ✓";
        setTimeout(() => { btn.textContent = "Save Content"; btn.disabled = false; }, 1200);
        return;
    } catch (e) { alert(e.message); }
    btn.textContent = "Save Content";
    btn.disabled = false;
}

// ================= Console: command input + live stat cards =================
let statsInterval = null;

function setupConsoleInput() {
    const input = document.getElementById("console-command-input");
    if (!input || input.dataset.bound) return;
    input.dataset.bound = "1";
    const history = [];
    let hIdx = 0;
    input.addEventListener("keydown", async (e) => {
        if (e.key === "ArrowUp" && history.length) {
            hIdx = Math.max(0, hIdx - 1); input.value = history[hIdx]; e.preventDefault();
        } else if (e.key === "ArrowDown") {
            hIdx = Math.min(history.length, hIdx + 1); input.value = history[hIdx] || ""; e.preventDefault();
        } else if (e.key === "Enter") {
            const cmd = input.value.trim();
            if (!cmd || !selectedBotId) return;
            history.push(cmd); hIdx = history.length;
            input.value = "";
            try {
                const res = await fetch(`/api/bots/${selectedBotId}/command`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ command: cmd })
                });
                if (!res.ok) {
                    const t = document.getElementById("terminal-console");
                    t.textContent += `\n[CONSOLE] ${(await res.json()).detail}\n`;
                    t.scrollTop = t.scrollHeight;
                }
            } catch (err) { console.error(err); }
        }
    });
}

function fmtBytes(n) {
    const u = ["B", "KiB", "MiB", "GiB", "TiB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i ? 2 : 0)} ${u[i]}`;
}

function fmtUptime(sec) {
    const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

async function pollStats() {
    if (!selectedBotId) return;
    try {
        const res = await fetch(`/api/bots/${selectedBotId}/stats`);
        if (!res.ok) return;
        const s = await res.json();
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set("stat-address", s.address);
        set("stat-uptime", s.running ? fmtUptime(s.uptime) : "Offline");
        set("stat-cpu", s.running ? `${s.cpu.toFixed(2)}%` : "Offline");
        set("stat-memory", s.running ? `${s.memory_mb.toFixed(2)} MiB` : "Offline");
        set("stat-disk", `${s.disk_mb.toFixed(2)} MiB`);
        set("stat-net-in", fmtBytes(s.net_in));
        set("stat-net-out", fmtBytes(s.net_out));
    } catch (e) { /* ignore transient errors */ }
}

function startStatsPolling() {
    stopStatsPolling();
    pollStats();
    statsInterval = setInterval(pollStats, 2000);
}
function stopStatsPolling() {
    if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
}

// --- Live Performance Metrics (Chart.js Integration) ---

function setupMetricsCharts(botId) {
    stopMetricsPolling();
    
    // Clear data history
    cpuDataHistory = Array(15).fill(0);
    ramDataHistory = Array(15).fill(0);
    chartLabels = Array(15).fill("");
    
    // Initialize Chart instances
    initMetricsCharts();
    
    // Start Polling loop
    pollBotMetrics(botId);
    metricsPollInterval = setInterval(() => pollBotMetrics(botId), 2000);
}

function initMetricsCharts() {
    const ctxCpu = document.getElementById("chart-cpu")?.getContext("2d");
    const ctxRam = document.getElementById("chart-ram")?.getContext("2d");
    
    if (!ctxCpu || !ctxRam) return;
    
    // Destroy existing chart if initialized
    if (cpuChart) cpuChart.destroy();
    if (ramChart) ramChart.destroy();
    
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: {
                beginAtZero: true,
                grid: { color: "rgba(26, 35, 61, 0.5)" },
                ticks: { color: "#9ca3af" }
            },
            x: {
                grid: { display: false },
                ticks: { display: false }
            }
        },
        plugins: {
            legend: { display: false }
        },
        animation: { duration: 0 } // No animation for real-time responsiveness
    };
    
    cpuChart = new Chart(ctxCpu, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [{
                data: cpuDataHistory,
                borderColor: '#00ff66',
                borderWidth: 2,
                tension: 0.2,
                fill: false
            }]
        },
        options: chartOptions
    });
    
    ramChart = new Chart(ctxRam, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [{
                data: ramDataHistory,
                borderColor: '#8b5cf6',
                borderWidth: 2,
                tension: 0.2,
                fill: false
            }]
        },
        options: chartOptions
    });
}

async function pollBotMetrics(botId) {
    try {
        const res = await fetch(`/api/bots/${botId}/metrics`);
        if (res.ok) {
            const metrics = await res.json();
            
            // Push values
            cpuDataHistory.push(metrics.cpu);
            cpuDataHistory.shift();
            
            ramDataHistory.push(metrics.ram);
            ramDataHistory.shift();
            
            chartLabels.push(new Date().toLocaleTimeString().split(" ")[0]);
            chartLabels.shift();
            
            // Update charts
            if (cpuChart) {
                cpuChart.data.datasets[0].data = cpuDataHistory;
                cpuChart.update();
            }
            if (ramChart) {
                ramChart.data.datasets[0].data = ramDataHistory;
                ramChart.update();
            }
        }
    } catch (err) {
        console.error("Error polling bot metrics:", err);
    }
}

function stopMetricsPolling() {
    if (metricsPollInterval) {
        clearInterval(metricsPollInterval);
        metricsPollInterval = null;
    }
}

// --- Admin Controls Panel ---

async function fetchAdminData() {
    if (currentUser.role !== "admin") return;
    
    try {
        // 1. Fetch Users
        const resUsers = await fetch("/api/admin/users");
        if (resUsers.ok) {
            const users = await resUsers.json();
            renderAdminUsers(users);
            populateOwnerDropdown(users);
        }
        
        // 2. Fetch Settings
        const resSettings = await fetch("/api/admin/settings");
        if (resSettings.ok) {
            const settings = await resSettings.json();
            document.getElementById("admin-auto-approve-toggle").checked = settings.auto_approve;
        }
    } catch (err) {
        console.error("Error fetching admin data:", err);
    }
}

function renderAdminUsers(users) {
    const tbody = document.getElementById("admin-users-table-body");
    if (!tbody) return;
    
    tbody.innerHTML = users.map(u => {
        let statusClass = "status-stopped"; // pending (grey)
        if (u.status === "approved") statusClass = "status-running"; // green
        if (u.status === "banned") statusClass = "status-error"; // red
        
        const isSelf = u.username === currentUser.username;
        const regDate = (u.registered_at && u.registered_at !== "unknown") ? new Date(u.registered_at).toLocaleString() : "Unknown";
        
        return `
            <tr>
                <td>
                    <a href="javascript:void(0)" onclick="openUserManageModal('${escapeHTML(u.username)}')" style="color: var(--primary-light); text-decoration: underline; font-weight: bold; display: inline-block; transition: color 0.2s;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--primary-light)'">
                        ${escapeHTML(u.username)}
                    </a> 
                    ${isSelf ? '<span style="font-size:0.65rem; color:var(--accent); font-family:\'Fira Code\', monospace;">[YOU]</span>' : ''}
                </td>
                <td><span class="badge-owner" style="font-size:0.65rem;">${u.role.toUpperCase()}</span></td>
                <td><span class="bot-status-badge ${statusClass}" style="font-size:0.65rem; padding: 0.15rem 0.4rem;">${u.status}</span></td>
                <td><span style="font-family: 'Fira Code', monospace; color: var(--accent);">${escapeHTML(u.ip_address)}</span></td>
                <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHTML(u.device_name)}">${escapeHTML(u.device_name)}</td>
                <td style="color: var(--text-muted);">${regDate}</td>
                <td style="cursor: pointer;" onclick="openUserManageModal('${escapeHTML(u.username)}')">
                    <span class="badge-owner" style="font-size:0.65rem; border-color: var(--accent); color: var(--accent); cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(0, 255, 102, 0.15)'" onmouseout="this.style.background='transparent'">
                        ${u.bots_count} / ${u.role === 'admin' ? 'Infinite' : u.bot_limit} bots
                    </span>
                </td>
                <td>
                    ${!isSelf ? `
                        <div style="display:flex; gap:0.25rem;">
                            ${u.status === 'pending' ? `
                                <button class="btn btn-accent" style="padding: 0.25rem 0.5rem; font-size: 0.65rem;" onclick="adminApproveUser('${u.username}')">Approve</button>
                            ` : ''}
                            ${u.status === 'approved' ? `
                                <button class="btn btn-danger" style="padding: 0.25rem 0.5rem; font-size: 0.65rem;" onclick="adminBanUser('${u.username}')">Ban</button>
                            ` : ''}
                            ${u.status === 'banned' ? `
                                <button class="btn btn-accent" style="padding: 0.25rem 0.5rem; font-size: 0.65rem;" onclick="adminUnbanUser('${u.username}')">Unban</button>
                            ` : ''}
                            <button class="btn btn-danger" style="padding: 0.25rem 0.5rem; font-size: 0.65rem; background: transparent; border-color: var(--danger);" onclick="adminDeleteUser('${u.username}')">Delete</button>
                        </div>
                    ` : '<span style="color: var(--text-dark);">No Actions</span>'}
                </td>
            </tr>
        `;
    }).join("");
}

async function adminApproveUser(username) {
    if (!confirm(`Approve user '${username}' access to host bots?`)) return;
    try {
        const res = await fetch(`/api/admin/users/${username}/approve`, { method: "POST" });
        if (res.ok) {
            fetchAdminData();
        } else {
            alert("Failed to approve user.");
        }
    } catch (err) {
        console.error(err);
    }
}

async function adminBanUser(username) {
    if (!confirm(`Are you sure you want to BAN user '${username}'? They will be locked out immediately.`)) return;
    try {
        const res = await fetch(`/api/admin/users/${username}/ban`, { method: "POST" });
        if (res.ok) {
            fetchAdminData();
        } else {
            alert("Failed to ban user.");
        }
    } catch (err) {
        console.error(err);
    }
}

async function adminUnbanUser(username) {
    if (!confirm(`Restore access for banned user '${username}'?`)) return;
    try {
        const res = await fetch(`/api/admin/users/${username}/unban`, { method: "POST" });
        if (res.ok) {
            fetchAdminData();
        } else {
            alert("Failed to unban user.");
        }
    } catch (err) {
        console.error(err);
    }
}

async function adminDeleteUser(username) {
    if (!confirm(`CRITICAL WARNING: Are you sure you want to DELETE user '${username}'? This will delete all of their hosted bot files permanently.`)) return;
    try {
        const res = await fetch(`/api/admin/users/${username}`, { method: "DELETE" });
        if (res.ok) {
            fetchAdminData();
        } else {
            alert("Failed to delete user.");
        }
    } catch (err) {
        console.error(err);
    }
}

async function saveAdminSettings() {
    const autoApprove = document.getElementById("admin-auto-approve-toggle").checked;
    const btn = document.getElementById("btn-save-settings");
    btn.disabled = true;
    
    try {
        const res = await fetch("/api/admin/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ auto_approve: autoApprove })
        });
        
        if (res.ok) {
            alert("Settings updated successfully!");
        } else {
            alert("Failed to save settings.");
        }
    } catch (err) {
        console.error(err);
    } finally {
        btn.disabled = false;
    }
}

async function handleAdminChangePassword(e) {
    e.preventDefault();
    const input = document.getElementById("admin_new_password");
    const val = input.value.trim();
    if (!val) return;
    
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    
    try {
        const res = await fetch("/api/admin/change-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ new_password: val })
        });
        
        if (res.ok) {
            alert("Password changed successfully!");
            input.value = "";
        } else {
            alert("Failed to change password.");
        }
    } catch (err) {
        console.error(err);
    } finally {
        btn.disabled = false;
    }
}

// Utility functions
function escapeHTML(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// --- 3D Scroll Reveal IntersectionObserver ---
function applyScrollReveal() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add("revealed");
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.05 });

    document.querySelectorAll(".scroll-reveal").forEach(el => observer.observe(el));
}

// --- Quota / Bot Limit Badges ---
function updateBotLimitBadge() {
    const botCount = bots.length;
    const limit = currentUser.bot_limit || 3;
    const isInfinite = currentUser.role === "admin";
    
    const limitText = isInfinite ? "Infinite" : limit;
    
    const badge = document.getElementById("bot-limit-badge");
    if (badge) {
        badge.textContent = `Bots: ${botCount} / ${limitText}`;
    }
    
    const modalBadge = document.getElementById("modal-bot-limit-badge");
    if (modalBadge) {
        modalBadge.textContent = isInfinite 
            ? `Quota: ${botCount} / Infinite bots used`
            : `Quota: ${botCount} / ${limit} bots used`;
    }
}

// --- Dynamic Owner Dropdown Populator ---
function populateOwnerDropdown(users) {
    const selectEl = document.getElementById("bot_owner");
    if (!selectEl) return;
    
    const approved = users.filter(u => u.status === "approved");
    selectEl.innerHTML = approved.map(u => `
        <option value="${escapeHTML(u.username)}" ${u.username === currentUser.username ? 'selected' : ''}>
            ${escapeHTML(u.username)} (${u.role.toUpperCase()})
        </option>
    `).join("");
}

// --- Manual Logs Refresh Handler ---
async function refreshConsoleLogs() {
    if (!selectedBotId) return;
    const terminal = document.getElementById("terminal-console");
    if (!terminal) return;
    
    const refreshBtn = document.querySelector(".btn-refresh-logs");
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = `
            <svg class="spin" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            Refreshing...
        `;
    }
    
    try {
        const res = await fetch(`/api/bots/${selectedBotId}/logs`);
        if (res.ok) {
            const logs = await res.text();
            terminal.textContent = logs || "Console output empty.";
            terminal.scrollTop = terminal.scrollHeight;
        } else {
            console.error("Failed to refresh logs");
        }
    } catch (err) {
        console.error("Error refreshing logs:", err);
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                Refresh
            `;
        }
    }
}

// --- User Management Modal Logic ---
let selectedManageUser = "";

async function openUserManageModal(username) {
    selectedManageUser = username;
    document.getElementById("manage-user-title").textContent = `Manage Operator: ${username}`;
    
    const limitInput = document.getElementById("manage-user-limit-input");
    
    try {
        const resUsers = await fetch("/api/admin/users");
        if (resUsers.ok) {
            const users = await resUsers.json();
            const u = users.find(x => x.username === username);
            if (u && limitInput) {
                limitInput.value = u.bot_limit;
            }
        }
    } catch (err) {
        console.error("Error fetching user for modal:", err);
    }
    
    await fetchAndRenderUserBots(username);
    
    document.getElementById("user-manage-modal").classList.add("open");
}

function closeUserManageModal() {
    document.getElementById("user-manage-modal").classList.remove("open");
}

async function saveUserLimit() {
    if (!selectedManageUser) return;
    const limitInput = document.getElementById("manage-user-limit-input");
    const limit = parseInt(limitInput.value);
    if (isNaN(limit) || limit < 0) {
        alert("Please enter a valid positive number.");
        return;
    }
    
    try {
        const res = await fetch(`/api/admin/users/${selectedManageUser}/limit`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bot_limit: limit })
        });
        if (res.ok) {
            alert(`Successfully updated bot limit for ${selectedManageUser} to ${limit}!`);
            fetchAdminData();
        } else {
            const err = await res.json();
            alert(`Error: ${err.detail || "Failed to update limit."}`);
        }
    } catch (err) {
        console.error("Error saving user limit:", err);
        alert("Network error.");
    }
}

async function fetchAndRenderUserBots(username) {
    const listContainer = document.getElementById("manage-user-bots-list");
    if (!listContainer) return;
    
    listContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 0.8125rem;">Loading bot instances...</div>`;
    
    try {
        const res = await fetch(`/api/admin/users/${username}/bots`);
        if (res.ok) {
            const userBots = await res.json();
            if (userBots.length === 0) {
                listContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 0.8125rem;">No bots hosted by this user.</div>`;
                return;
            }
            
            listContainer.innerHTML = userBots.map(bot => {
                const statusClass = bot.status === "running" ? "status-running" : "status-stopped";
                return `
                    <div class="manage-bot-item">
                        <div>
                            <strong style="color: var(--text-main); font-size: 0.875rem;">${escapeHTML(bot.name)}</strong>
                            <span class="bot-status-badge ${statusClass}" style="font-size: 0.65rem; margin-left: 0.5rem; padding: 0.1rem 0.3rem;">${bot.status}</span>
                            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">
                                ID: ${escapeHTML(bot.id)} &bull; Startup file: ${escapeHTML(bot.entrypoint || "Not selected")}
                            </div>
                        </div>
                        <div style="display: flex; gap: 0.5rem; align-items: center;">
                            ${bot.status === 'running' ? `
                                <button class="btn btn-danger" style="padding: 0.25rem 0.5rem; font-size: 0.65rem;" onclick="controlUserBot('${bot.id}', 'stop')">Stop</button>
                            ` : `
                                <button class="btn btn-accent" style="padding: 0.25rem 0.5rem; font-size: 0.65rem;" onclick="controlUserBot('${bot.id}', 'start')" ${bot.status === "installing" || !bot.entrypoint ? "disabled" : ""}>Start</button>
                            `}
                            <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.65rem;" onclick="controlUserBot('${bot.id}', 'restart')" ${bot.status === "installing" || !bot.entrypoint ? "disabled" : ""}>Restart</button>
                            <button class="btn btn-primary" style="padding: 0.25rem 0.5rem; font-size: 0.65rem;" onclick="manageUserBotWorkspace('${bot.id}')">Manage</button>
                        </div>
                    </div>
                `;
            }).join("");
        } else {
            listContainer.innerHTML = `<div style="color: var(--danger); font-size: 0.8125rem;">Failed to retrieve user bots.</div>`;
        }
    } catch (err) {
        console.error("Error fetching user bots:", err);
        listContainer.innerHTML = `<div style="color: var(--danger); font-size: 0.8125rem;">Network error.</div>`;
    }
}

async function controlUserBot(botId, action) {
    try {
        const res = await fetch(`/api/bots/${botId}/${action}`, { method: "POST" });
        if (res.ok) {
            if (selectedManageUser) {
                await fetchAndRenderUserBots(selectedManageUser);
            }
            fetchBots(false);
        } else {
            const err = await res.json();
            alert(`Error: ${err.detail || "Failed to control bot."}`);
        }
    } catch (err) {
        console.error("Error controlling user bot:", err);
    }
}

function manageUserBotWorkspace(botId) {
    closeUserManageModal();
    viewBotWorkspace(botId);
}
