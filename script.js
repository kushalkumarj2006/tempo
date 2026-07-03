const BACKEND_URL = 'https://tempo-agxk.onrender.com'; // YOUR RENDER URL
let API_SECRET = localStorage.getItem('askrepo_secret');
let sessionId = null;
let currentMode = 'fast';

// 1. Force Auth on load
if (!API_SECRET) {
    API_SECRET = prompt("Enter Colab Orchestrator API Secret:");
    if (API_SECRET) localStorage.setItem('askrepo_secret', API_SECRET);
}

const term = document.getElementById('terminal');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

function log(msg, color = '#3fb950') {
    const line = document.createElement('div');
    line.style.color = color;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    term.appendChild(line);
    term.scrollTop = term.scrollHeight;
}

// 2. Optimized API Wrapper
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
    } catch (e) {
        log(`API Error: ${e.message}`, '#f85149');
        throw e;
    }
}

// 3. Fixed Polling Logic for v3.9
async function runPython(code, cellNo) {
    log(`Running Cell ${cellNo}...`);
    
    // Start execution
    const start = await api('/exec', 'POST', { sessionId, code, cellNo });
    if (start.error) throw new Error(start.error);
    
    const executionId = start.executionId;
    log(`Started: ${executionId.substring(0, 8)}... (Polling)`);

    // Poll until complete
    while (true) {
        await new Promise(r => setTimeout(r, 4000)); // Wait 4s
        const check = await api(`/exec-status?sessionId=${sessionId}&executionId=${executionId}`);
        
        if (check.status === 'completed') {
            log(`Cell ${cellNo} Success.`);
            return check.output;
        } else if (check.status === 'failed') {
            log(`Cell ${cellNo} Failed: ${check.error}`, '#f85149');
            throw new Error(check.error);
        } else {
            // Still running
            console.log("Still processing...");
        }
    }
}

// 4. Setup Workflow
document.getElementById('start-btn').onclick = async function() {
    this.disabled = true;
    try {
        log("Step 1: Creating Colab Session...");
        document.getElementById('step-1').classList.add('active');
        
        const session = await api('/new', 'POST', { gpu: 'T4' });
        sessionId = session.sessionId;
        
        statusDot.className = 'dot online';
        statusText.textContent = `Active: ${sessionId.substring(0,8)}`;
        document.getElementById('terminate-btn').style.display = 'block';
        document.getElementById('step-1').classList.replace('active', 'done');

        log("Step 2: Installing Ollama & Qwen Model...");
        document.getElementById('step-2').classList.add('active');
        
        const setupCode = `
import subprocess, time, os
print("System: Installing Dependencies...")
subprocess.run("curl -fsSL https://ollama.com/install.sh | sh", shell=True)
subprocess.Popen("ollama serve", shell=True)
time.sleep(8)
print("System: Pulling Qwen2.5-Coder...")
subprocess.run("ollama pull qwen2.5-coder:7b", shell=True)
print("OLLAMA_READY")
        `;
        await runPython(setupCode, 1);
        document.getElementById('step-2').classList.replace('active', 'done');

        document.getElementById('repo-config').style.display = 'block';
        log("Environment ready. Configure your repository below.");

    } catch (e) {
        this.disabled = false;
        log("Setup Failed. See console.", '#f85149');
    }
};

// 5. Indexing Logic
document.getElementById('index-btn').onclick = async function() {
    const repo = document.getElementById('repo-url').value;
    if (!repo) return;
    this.disabled = true;

    try {
        document.getElementById('step-3').classList.add('active');
        log(`Step 3: Indexing ${repo}...`);

        const indexCode = `
import os, subprocess
repo_name = "${repo}".split('/')[-1]
if not os.path.exists(repo_name):
    print(f"Cloning {repo_name}...")
    subprocess.run(f"git clone https://github.com/${repo}.git", shell=True)

# Helper functions for the chat
def ask_ai(mode, q):
    import subprocess
    prompt = f"Repo context active. Question: {q}" if mode == 'fast' else q
    cmd = ["ollama", "run", "qwen2.5-coder:7b", prompt]
    res = subprocess.check_output(cmd, text=True)
    return res

print(f"INDEX_COMPLETE: {repo_name}")
        `;
        await runPython(indexCode, 3);
        
        document.getElementById('step-3').classList.replace('active', 'done');
        log("Switching to Chat View...");
        
        document.getElementById('setup-view').style.display = 'none';
        document.getElementById('chat-view').style.display = 'flex';

    } catch (e) {
        this.disabled = false;
    }
};

// 6. Chat Logic
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');

async function addMessage(role, text) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

document.getElementById('send-btn').onclick = async function() {
    const q = chatInput.value.trim();
    if (!q) return;

    addMessage('user', q);
    chatInput.value = '';
    
    const botMsg = document.createElement('div');
    botMsg.className = 'msg bot';
    botMsg.textContent = '... AI is thinking ...';
    chatMessages.appendChild(botMsg);

    try {
        // v3.9 requires print() to capture the output string in the API
        const askCode = `print(ask_ai("${currentMode}", """${q}"""))`;
        const answer = await runPython(askCode, 99);
        botMsg.textContent = answer.trim();
    } catch (e) {
        botMsg.textContent = "Error: " + e.message;
    }
};

// Mode Switcher
document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.onclick = function() {
        document.querySelector('.mode-btn.active').classList.remove('active');
        this.classList.add('active');
        currentMode = this.dataset.mode;
    };
});

document.getElementById('terminate-btn').onclick = async () => {
    if (confirm("Terminate VM session?")) {
        await api(`/session/${sessionId}`, 'DELETE');
        location.reload();
    }
};
