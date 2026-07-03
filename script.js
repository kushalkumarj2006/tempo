// ============================================================
// CONFIGURATION & AUTH
// ============================================================
const BACKEND_URL = 'https://tempo-agxk.onrender.com'; // Update to your Render URL
let API_SECRET = localStorage.getItem('askrepo_secret');

if (!API_SECRET) {
    API_SECRET = prompt("Enter Colab Orchestrator API Secret:");
    if (API_SECRET) localStorage.setItem('askrepo_secret', API_SECRET);
}

// ============================================================
// ORIGINAL PYTHON CELLS (Updated with Absolute Paths)
// ============================================================
const CELL1 = `import subprocess, time
print("🔧 Installing Ollama binary...")
subprocess.run("curl -fsSL https://ollama.com/install.sh | sh", shell=True)
subprocess.Popen("/usr/local/bin/ollama serve > /tmp/ollama.log 2>&1", shell=True)
time.sleep(10)
print("✅ Ollama server is active")`;

const CELL2 = `import subprocess
print("📥 Pulling model qwen2.5-coder:7b (this may take a minute)...")
process = subprocess.Popen(
    ["/usr/local/bin/ollama", "pull", "qwen2.5-coder:7b"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True
)
for line in process.stdout:
    print(line, end='')
print("✅ Model ready")`;

const CELL3 = (url) => `import subprocess, os
repo_path = "/content/repo"
if os.path.exists(repo_path):
    subprocess.run(f"rm -rf {repo_path}", shell=True)
print(f"📡 Cloning ${url}...")
subprocess.run(f"git clone ${url} {repo_path}", shell=True)
print("✅ Repo cloned to /content/repo")`;

const CELL4 = `import subprocess, json, re, os
from pathlib import Path

def ask_assistant(mode, question):
    # logic using absolute path for execution
    prompt = f"Repo: /content/repo. Mode: {mode}. Question: {question}"
    try:
        cmd = ["/usr/local/bin/ollama", "run", "qwen2.5-coder:7b", prompt]
        return subprocess.check_output(cmd, text=True, timeout=120)
    except Exception as e:
        return str(e)

print("✅ Assistant Logic Initialized")`;

// ============================================================
// DOM ELEMENTS
// ============================================================
const terminal = document.getElementById('terminal');
const startBtn = document.getElementById('start-setup-btn');
const endBtn = document.getElementById('end-session-btn');
const repoCard = document.getElementById('repo-card');
const repoUrlInput = document.getElementById('repo-url');
const confirmRepoBtn = document.getElementById('confirm-repo-btn');
const setupDashboard = document.getElementById('setup-dashboard');
const chatInterface = document.getElementById('chat-interface');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const statusBadge = document.getElementById('status-badge');

// Stepper
const stepSession = document.getElementById('step-session');
const stepOllama = document.getElementById('step-ollama');
const stepRepo = document.getElementById('step-repo');

// ============================================================
// CORE LOGIC
// ============================================================
let sessionId = null;

function logToTerminal(msg, isError = false) {
    const line = document.createElement('div');
    line.className = 'line';
    if (isError) line.style.color = 'var(--error)';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

async function api(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json', 'api-secret': API_SECRET }
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${BACKEND_URL}${endpoint}`, options);
    return await res.json();
}

async function executeCell(code, cellNo, onPartial = null) {
    const start = await api('/exec', 'POST', { sessionId, code, cellNo });
    if (start.error) throw new Error(start.error);
    
    const executionId = start.executionId;
    
    while (true) {
        await new Promise(r => setTimeout(r, 3000));
        const check = await api(`/exec-status?sessionId=${sessionId}&executionId=${executionId}`);
        
        if (check.partialOutput) {
            logToTerminal(check.partialOutput.split('\n').pop()); // Log last line of partial
            if (onPartial) onPartial(check.partialOutput);
        }

        if (check.status === 'completed') {
            logToTerminal(`Cell ${cellNo} completed.`);
            return check.output;
        } else if (check.status === 'failed') {
            throw new Error(check.error || "Execution failed");
        }
    }
}

// ============================================================
// WORKFLOW HANDLERS
// ============================================================

startBtn.onclick = async () => {
    try {
        startBtn.disabled = true;
        startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Initializing...';
        
        // STEP 1: Session
        stepSession.classList.add('active');
        logToTerminal("Requesting new Colab VM...");
        const sessionRes = await api('/new', 'POST', { gpu: 'T4' });
        if (!sessionRes.success) throw new Error(sessionRes.details || "Limit reached");
        
        sessionId = sessionRes.sessionId;
        statusBadge.className = 'badge connected';
        statusBadge.textContent = `CONNECTED: ${sessionId.substring(0,8)}`;
        endBtn.style.display = 'inline-flex';
        stepSession.classList.replace('active', 'completed');

        // STEP 2: Ollama
        stepOllama.classList.add('active');
        await executeCell(CELL1, 1);
        await executeCell(CELL2, 2);
        stepOllama.classList.replace('active', 'completed');

        // Transition to Repo Config
        repoCard.style.display = 'block';
        logToTerminal("Environment ready. Please provide GitHub repository.");

    } catch (err) {
        logToTerminal(err.message, true);
        startBtn.disabled = false;
        startBtn.textContent = "Retry Setup";
    }
};

confirmRepoBtn.onclick = async () => {
    const url = repoUrlInput.value.trim();
    if (!url) return;
    const fullUrl = url.startsWith('http') ? url : `https://github.com/${url}`;

    try {
        confirmRepoBtn.disabled = true;
        stepRepo.classList.add('active');
        
        await executeCell(CELL3(fullUrl), 3);
        await executeCell(CELL4, 4);
        
        stepRepo.classList.replace('active', 'completed');
        logToTerminal("Indexing complete. Launching chat...");

        // Switch UI
        setTimeout(() => {
            setupDashboard.style.display = 'none';
            chatInterface.style.display = 'flex';
            document.getElementById('current-repo-tag').textContent = `📦 ${url}`;
            addChatMessage("bot", `I've finished indexing **${url}**. Ask me anything!`);
        }, 1000);

    } catch (err) {
        logToTerminal(err.message, true);
        confirmRepoBtn.disabled = false;
    }
};

// ============================================================
// CHAT INTERFACE
// ============================================================

function addChatMessage(role, text) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.innerHTML = text.replace(/\n/g, '<br>');
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
}

async function handleQuery() {
    const q = chatInput.value.trim();
    if (!q) return;

    const mode = document.querySelector('input[name="mode"]:checked').value;
    addChatMessage("user", q);
    chatInput.value = '';

    const botDiv = addChatMessage("bot", '<i class="fas fa-robot"></i> Thinking...');

    try {
        // v3.9 Captures stdout, so we must print the function return
        const code = `print(ask_assistant("${mode}", """${q.replace(/"/g, '\\"')}"""))`;
        
        const answer = await executeCell(code, 99, (partial) => {
            if (partial.trim()) botDiv.innerHTML = partial.replace(/\n/g, '<br>') + '...';
        });
        
        botDiv.innerHTML = answer.trim();
    } catch (err) {
        botDiv.innerHTML = `<span style="color:var(--error)">Error: ${err.message}</span>`;
    }
}

sendBtn.onclick = handleQuery;
chatInput.onkeypress = (e) => { if (e.key === 'Enter') handleQuery(); };

// ============================================================
// TERMINATE
// ============================================================
endBtn.onclick = async () => {
    if (confirm("Terminate Colab session?")) {
        await api(`/session/${sessionId}`, 'DELETE');
        location.reload();
    }
};
