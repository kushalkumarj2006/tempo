const BACKEND_URL = 'https://tempo-agxk.onrender.com';
let API_SECRET = localStorage.getItem('askrepo_secret');
let sessionId = null;
let currentRepo = "";

// Initial Auth Prompt
if (!API_SECRET) {
    API_SECRET = prompt("Enter Backend API Secret:");
    if (API_SECRET) localStorage.setItem('askrepo_secret', API_SECRET);
}

// DOM Elements
const terminal = document.getElementById('terminal');
const startBtn = document.getElementById('start-setup-btn');
const endBtn = document.getElementById('end-session-btn');
const repoCard = document.getElementById('repo-card');
const chatView = document.getElementById('chat-interface');
const dashboard = document.getElementById('setup-dashboard');
const messagesContainer = document.getElementById('chat-messages');

// Setup Stepper Elements
const stepSession = document.getElementById('step-session');
const stepOllama = document.getElementById('step-ollama');
const stepRepo = document.getElementById('step-repo');

// --- Helper Functions ---

function log(msg, isError = false) {
    const line = document.createElement('div');
    line.className = 'line';
    line.style.color = isError ? 'var(--error)' : '#10b981';
    line.textContent = `> ${msg}`;
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
        return await response.json();
    } catch (err) {
        log(`API Error: ${err.message}`, true);
        throw err;
    }
}

// Polling function for v3.9 /exec-status
async function waitForExecution(executionId) {
    return new Promise((resolve, reject) => {
        const poll = setInterval(async () => {
            const data = await api(`/exec-status?sessionId=${sessionId}&executionId=${executionId}`);
            
            if (data.status === 'completed') {
                clearInterval(poll);
                resolve(data.output);
            } else if (data.status === 'failed') {
                clearInterval(poll);
                reject(data.error);
            }
        }, 5000); // Poll every 5 seconds
    });
}

async function runCode(code, cellNo) {
    log(`Executing Stage ${cellNo}...`);
    const res = await api('/exec', 'POST', { sessionId, code, cellNo });
    if (res.status === 'processing') {
        return await waitForExecution(res.executionId);
    }
    return res.output;
}

// --- Setup Orchestration ---

startBtn.onclick = async () => {
    try {
        startBtn.disabled = true;
        startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Initializing...';
        
        // 1. Create Session
        stepSession.classList.add('active');
        const sessionRes = await api('/new', 'POST', { gpu: 'T4' });
        if (!sessionRes.success) throw new Error(sessionRes.details || "Failed to create session");
        
        sessionId = sessionRes.sessionId;
        localStorage.setItem('last_session_id', sessionId);
        
        stepSession.classList.remove('active');
        stepSession.classList.add('completed');
        document.getElementById('status-badge').className = 'badge connected';
        document.getElementById('status-badge').textContent = `ID: ${sessionId.substring(0,8)}`;
        endBtn.style.display = 'inline-flex';

        // 2. Setup Ollama (Cell 1 & 2 combined)
        stepOllama.classList.add('active');
        const ollamaCode = `
import subprocess, time
print("🔧 Setting up Ollama...")
subprocess.run("curl -fsSL https://ollama.com/install.sh | sh", shell=True)
subprocess.Popen("ollama serve", shell=True)
time.sleep(10)
print("📥 Pulling Qwen2.5-Coder...")
subprocess.run("ollama pull qwen2.5-coder:7b", shell=True)
print("✅ Environment Ready")
        `;
        await runCode(ollamaCode, 1);
        stepOllama.classList.remove('active');
        stepOllama.classList.add('completed');

        // 3. Show Repo Config
        repoCard.style.display = 'block';
        log("Environment ready. Please confirm repository to index.");
        
    } catch (err) {
        log(err.message, true);
        startBtn.disabled = false;
        startBtn.textContent = "Retry Initialization";
    }
};

document.getElementById('confirm-repo-btn').onclick = async () => {
    const repo = document.getElementById('repo-url').value;
    if (!repo) return;
    
    try {
        stepRepo.classList.add('active');
        log(`Cloning and Indexing: ${repo}...`);
        
        const indexingCode = `
import subprocess, os
from pathlib import Path
repo_url = "https://github.com/${repo}"
if not os.path.exists('repo'):
    subprocess.run(f"git clone {repo_url} repo", shell=True)

# Simple Indexing Logic
files_count = 0
for path in Path('repo').rglob('*'):
    if path.is_file() and path.suffix in ['.py', '.js', '.ts', '.html', '.css', '.md']:
        files_count += 1
print(f"✅ Indexed {files_count} files in ${repo}")
        `;
        
        await runCode(indexingCode, 2);
        
        // Also inject the AskRepo Python helper functions into the VM session
        const helperCode = `
def ask_fast(q):
    import subprocess
    prompt = f"Using context from repo, answer: {q}"
    res = subprocess.check_output(f'ollama run qwen2.5-coder:7b "{prompt}"', shell=True, text=True)
    return res

def ask_simple(q):
    import subprocess
    res = subprocess.check_output(f'ollama run qwen2.5-coder:7b "{q}"', shell=True, text=True)
    return res
        `;
        await runCode(helperCode, 3);

        stepRepo.classList.remove('active');
        stepRepo.classList.add('completed');
        currentRepo = repo;
        
        // Transition to Chat
        dashboard.style.opacity = '0';
        setTimeout(() => {
            dashboard.style.display = 'none';
            chatView.style.display = 'flex';
            document.getElementById('current-repo-tag').textContent = `📦 ${repo}`;
            addMessage("bot", `Hello! I've indexed **${repo}**. What would you like to know about the code?`);
        }, 500);

    } catch (err) {
        log(err.message, true);
    }
};

// --- Chat Logic ---

async function addMessage(role, text) {
    const msg = document.createElement('div');
    msg.className = `msg ${role}`;
    msg.innerHTML = text.replace(/\n/g, '<br>');
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function sendQuery() {
    const input = document.getElementById('chat-input');
    const query = input.value.trim();
    const mode = document.querySelector('input[name="mode"]:checked').value;
    
    if (!query) return;
    
    addMessage('user', query);
    input.value = '';
    
    const botMsg = document.createElement('div');
    botMsg.className = 'msg bot';
    botMsg.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Thinking...';
    messagesContainer.appendChild(botMsg);

    try {
        const askCode = `print(ask_${mode}("""${query}"""))`;
        const answer = await runCode(askCode, 99);
        botMsg.innerHTML = answer;
    } catch (err) {
        botMsg.innerHTML = `<span style="color:var(--error)">Error: ${err.message}</span>`;
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

document.getElementById('send-btn').onclick = sendQuery;
document.getElementById('chat-input').onkeypress = (e) => { if(e.key === 'Enter') sendQuery(); };

// --- Termination ---

endBtn.onclick = async () => {
    if (confirm("Terminate session and wipe VM?")) {
        await api(`/session/${sessionId}`, 'DELETE');
        location.reload();
    }
};
