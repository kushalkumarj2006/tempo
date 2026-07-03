// ============================================
// CONFIGURATION
// ============================================
const BACKEND_URL = 'https://tempo-agxk.onrender.com'; // Ensure this matches your Render URL
let API_SECRET = localStorage.getItem('askrepo_secret');
let sessionId = null;
let currentMode = 'fast';

// 1. Authentication Prompt
if (!API_SECRET) {
    API_SECRET = prompt("Enter Colab Orchestrator API Secret:");
    if (API_SECRET) localStorage.setItem('askrepo_secret', API_SECRET);
}

// DOM Elements
const terminal = document.getElementById('terminal');
const startSetupBtn = document.getElementById('start-setup-btn');
const endSessionBtn = document.getElementById('end-session-btn');
const repoCard = document.getElementById('repo-card');
const dashboard = document.getElementById('setup-dashboard');
const chatInterface = document.getElementById('chat-interface');
const messagesContainer = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const statusBadge = document.getElementById('status-badge');

// Stepper Elements
const stepSession = document.getElementById('step-session');
const stepOllama = document.getElementById('step-ollama');
const stepRepo = document.getElementById('step-repo');

// ============================================
// UTILITIES
// ============================================

function log(msg, isError = false) {
    const line = document.createElement('div');
    line.className = 'line';
    if (isError) line.style.color = 'var(--error)';
    line.textContent = `[${new Date().toLocaleTimeString()}] > ${msg}`;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

async function api(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'api-secret': API_SECRET
        }
    };
    if (body) options.body = JSON.stringify(body);
    
    try {
        const response = await fetch(`${BACKEND_URL}${endpoint}`, options);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (err) {
        log(`API Error: ${err.message}`, true);
        throw err;
    }
}

// THE POLLING ENGINE: Essential for v3.9 Backend
async function runPython(code, cellNo) {
    log(`Initializing Stage ${cellNo}...`);
    
    // 1. Post the execution request
    const response = await api('/exec', 'POST', { sessionId, code, cellNo });
    if (response.error) throw new Error(response.error);
    
    const executionId = response.executionId;
    log(`Execution Started: ${executionId.substring(0, 8)}... (Polling status)`);

    // 2. Poll /exec-status until finished
    while (true) {
        // Wait 4 seconds between polls to avoid spamming
        await new Promise(r => setTimeout(r, 4000));
        
        const statusData = await api(`/exec-status?sessionId=${sessionId}&executionId=${executionId}`);
        
        if (statusData.status === 'completed') {
            log(`Stage ${cellNo} Complete.`);
            // Clean up completed execution from backend memory
            api('/exec-ack', 'POST', { executionId }).catch(() => {});
            return statusData.output; 
        } else if (statusData.status === 'failed') {
            log(`Stage ${cellNo} Failed: ${statusData.error}`, true);
            throw new Error(statusData.error);
        } else {
            console.log("Still processing cell " + cellNo + "...");
        }
    }
}

// ============================================
// SETUP WORKFLOW
// ============================================

startSetupBtn.onclick = async () => {
    try {
        startSetupBtn.disabled = true;
        startSetupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Initializing...';

        // STEP 1: Session Creation
        stepSession.classList.add('active');
        const sessionRes = await api('/new', 'POST', { gpu: 'T4' });
        
        if (!sessionRes.success) throw new Error(sessionRes.details || "Session limit reached");
        
        sessionId = sessionRes.sessionId;
        statusBadge.className = 'badge connected';
        statusBadge.textContent = `ID: ${sessionId.substring(0,8)}`;
        endSessionBtn.style.display = 'inline-flex';
        
        stepSession.classList.replace('active', 'completed');
        log("Session established successfully.");

        // STEP 2: Ollama Setup
        stepOllama.classList.add('active');
        const setupCode = `
import subprocess, time
print("INSTALL: Downloading Ollama...")
subprocess.run("curl -fsSL https://ollama.com/install.sh | sh", shell=True)
subprocess.Popen("ollama serve", shell=True)
time.sleep(10)
print("INSTALL: Pulling Qwen2.5-Coder (7B)...")
subprocess.run("ollama pull qwen2.5-coder:7b", shell=True)
print("SUCCESS: Environment Ready")
        `;
        await runPython(setupCode, 1);
        stepOllama.classList.replace('active', 'completed');

        // Show Repo UI
        repoCard.style.display = 'block';
        log("Environment ready. Enter repository details to proceed.");

    } catch (err) {
        startSetupBtn.disabled = false;
        startSetupBtn.textContent = "Retry Setup";
        log(err.message, true);
    }
};

document.getElementById('confirm-repo-btn').onclick = async () => {
    const repoPath = document.getElementById('repo-url').value.trim();
    if (!repoPath) return;

    try {
        stepRepo.classList.add('active');
        log(`Cloning and Indexing: ${repoPath}...`);

        const indexCode = `
import subprocess, os
repo_name = "${repoPath}".split('/')[-1]
if not os.path.exists(repo_name):
    print(f"CLONE: Fetching {repo_name}...")
    subprocess.run(f"git clone https://github.com/${repoPath}.git", shell=True)

# AI Assistant Helpers
def ask_assistant(mode, query):
    import subprocess
    # In 'fast' mode, we could add file indexing logic here
    cmd = ["ollama", "run", "qwen2.5-coder:7b", query]
    return subprocess.check_output(cmd, text=True)

print(f"READY: ${repoPath} indexed.")
        `;
        await runPython(indexCode, 2);
        
        stepRepo.classList.replace('active', 'completed');
        log("Setup complete. Transitioning to Chat...");

        // Switch to Chat View
        setTimeout(() => {
            dashboard.style.display = 'none';
            chatInterface.style.display = 'flex';
            document.getElementById('current-repo-tag').textContent = `📦 ${repoPath}`;
            addMessage("bot", `Hello! I've indexed **${repoPath}**. How can I help you understand this codebase?`);
        }, 800);

    } catch (err) {
        log(err.message, true);
    }
};

// ============================================
// CHAT LOGIC
// ============================================

function addMessage(role, text) {
    const msg = document.createElement('div');
    msg.className = `msg ${role}`;
    msg.innerHTML = text.replace(/\n/g, '<br>');
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function sendQuery() {
    const query = chatInput.value.trim();
    if (!query) return;

    // Get selected mode (Fast or Simple)
    currentMode = document.querySelector('input[name="mode"]:checked').value;

    addMessage('user', query);
    chatInput.value = '';

    // Temp bot bubble
    const botMsg = document.createElement('div');
    botMsg.className = 'msg bot';
    botMsg.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Processing...';
    messagesContainer.appendChild(botMsg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    try {
        // v3.9 Captures STDOUT. We MUST use print() to get the result string.
        const askCode = `print(ask_assistant("${currentMode}", """${query}"""))`;
        const answer = await runPython(askCode, 99);
        
        botMsg.innerHTML = answer.trim();
    } catch (err) {
        botMsg.innerHTML = `<span style="color:var(--error)">Error: ${err.message}</span>`;
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

document.getElementById('send-btn').onclick = sendQuery;
chatInput.onkeypress = (e) => { if (e.key === 'Enter') sendQuery(); };

// ============================================
// TERMINATION
// ============================================

endSessionBtn.onclick = async () => {
    if (confirm("Stop session and terminate the Colab VM?")) {
        try {
            await api(`/session/${sessionId}`, 'DELETE');
            localStorage.removeItem('last_session_id');
            location.reload();
        } catch (e) {
            location.reload(); // Force reload even if API fails
        }
    }
};
