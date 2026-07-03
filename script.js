// ============================================================
// CONFIGURATION & AUTH
// ============================================================
const BACKEND_URL = 'https://tempo-agxk.onrender.com';
let SECRET_KEY = localStorage.getItem('askrepo_key') || '';

if (!SECRET_KEY) {
    SECRET_KEY = prompt("Please enter your API Secret Key:");
    if (SECRET_KEY) localStorage.setItem('askrepo_key', SECRET_KEY);
}

function wakeUp(attempt = 1) {
  fetch(`${BACKEND_URL}/health`)
    .then(res => res.json())
    .then(data => console.log('Backend:', data.status))
    .catch(() => {
      if (attempt < 3) setTimeout(() => wakeUp(attempt + 1), 2000);
    });
}
wakeUp();

// ============================================================
// PYTHON CELLS (Complete implementations)
// ============================================================
const CELL1 = `import subprocess, time, os
print("🔧 Installing Ollama...")
subprocess.run("apt-get update -qq && apt-get install -y zstd", shell=True, check=False)
subprocess.run("curl -fsSL https://ollama.com/install.sh | sh", shell=True, check=False)

# Ensure ollama is in PATH
os.environ["PATH"] = os.environ.get("PATH", "") + ":/usr/local/bin"
subprocess.Popen("ollama serve > /tmp/ollama.log 2>&1", shell=True)
time.sleep(8)
print("✅ Ollama installed and running")`;

const CELL2 = `import subprocess, sys, time
print("📥 Pulling qwen2.5-coder:7b...")
proc = subprocess.Popen(
    "ollama pull qwen2.5-coder:7b",
    shell=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1
)
for line in proc.stdout:
    print(line, end='')
    sys.stdout.flush()
proc.wait()
print("\\n✅ Model ready")`;

const CELL3 = (url) => `import subprocess, os
target = "/content/repo"
if os.path.exists(target):
    subprocess.run(f"rm -rf {target}", shell=True)
subprocess.run(f"git clone ${url} ${target}", shell=True, check=False)
print("✅ Repo cloned to", target)`;

const CELL4 = `import subprocess, json, re, hashlib
from pathlib import Path

print("📁 Indexing files...")
repo_path = Path("/content/repo")
file_contents = {}
extensions = ['*.py', '*.js', '*.json', '*.yaml', '*.yml', '*.md', '*.txt', '*.sh', '*.html', '*.css']
for ext in extensions:
    for file_path in repo_path.rglob(ext):
        try:
            content = file_path.read_text(encoding='utf-8', errors='ignore')
            rel_path = str(file_path.relative_to(repo_path))
            file_contents[rel_path] = content.split('\\\\n')
        except:
            pass
print(f"✅ Indexed {len(file_contents)} files")

# ============================================
# Caching
# ============================================
cache = {}
def get_cached_answer(question, context_hash):
    key = f"{question[:50]}_{context_hash[:20]}"
    return cache.get(key)

def set_cached_answer(question, context_hash, answer):
    key = f"{question[:50]}_{context_hash[:20]}"
    cache[key] = answer

# ============================================
# Keyword expansion
# ============================================
def expand_keywords(question):
    mappings = {
        'login': ['login','sign in','auth','authenticate','credentials'],
        'auth': ['auth','authentication','authorization','jwt','session'],
        'api': ['api','endpoint','route','express','rest'],
        'database': ['database','db','mongodb','mongoose','schema','sql'],
        'user': ['user','users','profile','account'],
        'server': ['server','app','express','node','backend'],
        'config': ['config','configuration','settings','env'],
        'test': ['test','tests','testing','jest','pytest']
    }
    words = question.lower().split()
    expanded = set(words)
    for w in words:
        for key, vals in mappings.items():
            if w in vals or w == key:
                expanded.update(vals)
                expanded.add(key)
    return list(expanded)

# ============================================
# Relevance scoring
# ============================================
def score_files_fast(question, keywords):
    scored = []
    for fpath, lines in file_contents.items():
        score = 0
        pl = fpath.lower()
        for kw in keywords[:15]:
            if kw in pl:
                score += 3
        for line in lines[:50]:
            ll = line.lower()
            for kw in keywords[:15]:
                if kw in ll:
                    score += 1
        if score > 0:
            scored.append((score, fpath))
    scored.sort(reverse=True, key=lambda x: x[0])
    return scored[:4]

# ============================================
# ANSI cleaner
# ============================================
def clean_ansi(text):
    ansi_escape = re.compile(r'\\\\x1b\\\\[[0-9;]*[a-zA-Z]')
    text = ansi_escape.sub('', text)
    text = re.sub(r'\\\\[?[0-9]+[a-zA-Z]', '', text)
    text = re.sub(r'\\\\x1b\\\\[[0-9;]*m', '', text)
    return '\\\\n'.join(line.strip() for line in text.split('\\\\n') if line.strip())

# ============================================
# Fast mode (with context)
# ============================================
def ask_fast(question):
    print(f"\\\\n🤔 {question}")
    keywords = expand_keywords(question)
    scored = score_files_fast(question, keywords)
    if not scored:
        print("❌ No relevant files found. Try a different question.")
        return "No relevant files found."
    
    context = ""
    for score, fpath in scored[:3]:
        lines = file_contents[fpath]
        context += f"\\\\n📁 {fpath}\\\\n"
        matches = []
        for i, line in enumerate(lines):
            ll = line.lower()
            for kw in keywords[:10]:
                if kw in ll:
                    start = max(0, i-5)
                    end = min(len(lines), i+6)
                    matches.append((i, lines[start:end]))
                    break
            if len(matches) >= 10:
                break
        if matches:
            for i, block in matches[:8]:
                context += f"  L{i+1}: {''.join(block)}\\\\n"
        else:
            context += '\\\\n'.join(lines[:20]) + "\\\\n"
    
    if len(context) > 4000:
        context = context[:4000] + "\\\\n... (truncated)"
    
    prompt = f"""Codebase context:
{context}

Question: {question}

Answer briefly and clearly, referencing file names if relevant."""
    print("🧠 Thinking...")
    proc = subprocess.Popen(
        ["ollama", "run", "qwen2.5-coder:7b"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True
    )
    stdout, _ = proc.communicate(input=prompt, timeout=120)
    clean = clean_ansi(stdout)
    print(clean)
    return clean

# ============================================
# Simple mode (no context)
# ============================================
def ask_simple(question):
    print(f"\\\\n🤔 {question}")
    proc = subprocess.Popen(
        ["ollama", "run", "qwen2.5-coder:7b"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True
    )
    stdout, _ = proc.communicate(input=question, timeout=60)
    clean = clean_ansi(stdout)
    print(clean)
    return clean

print("\\\\n✅ Ready!")
print("📝 Ask questions using ask_fast('question') or ask_simple('question')")`;

// ============================================================
// DOM REFS
// ============================================================
const startBtn = document.getElementById('start-setup-btn');
const endSessionBtn = document.getElementById('end-session-btn');
const confirmRepoBtn = document.getElementById('confirm-repo-btn');
const repoInput = document.getElementById('repo-url');
const terminal = document.getElementById('terminal');
const statusBadge = document.getElementById('status-badge');
const chatMessages = document.getElementById('chat-messages');
const questionInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const setupDashboard = document.getElementById('setup-dashboard');
const chatInterface = document.getElementById('chat-interface');
const currentRepoTag = document.getElementById('current-repo-tag');
const stepSession = document.getElementById('step-session');
const stepOllama = document.getElementById('step-ollama');
const stepRepo = document.getElementById('step-repo');

// ============================================================
// STATE
// ============================================================
let sessionId = null;
let cellRunning = false;
let repoConfirmed = false;
let repoUrl = '';
let pollTimer = null;
let currentExecId = null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function logToTerminal(msg, type = 'info') {
  const line = document.createElement('div');
  line.className = 'line';
  if (type === 'error') line.style.color = 'var(--accent-red)';
  if (type === 'success') line.style.color = 'var(--accent-green)';
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

function clearTerminal() {
  terminal.innerHTML = '';
}

// ============================================================
// BACKEND API (v3.9 Compatible)
// ============================================================
async function apiCall(endpoint, body = null, method = 'POST') {
  const headers = {
    'Content-Type': 'application/json',
    'api-secret': SECRET_KEY
  };
  const options = { method, headers };
  if (body && method !== 'GET' && method !== 'DELETE') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BACKEND_URL}${endpoint}`, options);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!response.ok) {
    throw new Error(data.error || data.message || `HTTP ${response.status}`);
  }
  return data;
}

async function checkStatus(executionId) {
  return await apiCall(
    `/exec-status?sessionId=${sessionId}&executionId=${executionId}`,
    null,
    'GET'
  );
}

// ============================================================
// EXECUTE CELL (Fixed for v3.9)
// ============================================================
async function executeCell(cellNo, code) {
  logToTerminal(`▶️ Starting cell ${cellNo}...`);
  
  const result = await apiCall('/exec', { sessionId, code, cellNo });
  
  if (result.status === 'processing') {
    currentExecId = result.executionId;
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 300;

      pollTimer = setInterval(async () => {
        attempts++;
        try {
          const status = await checkStatus(currentExecId);
          
          // Update terminal with partial output
          if (status.partialOutput) {
            const progressLines = status.partialOutput.split('\n').filter(l => l.trim());
            for (const line of progressLines.slice(-3)) {
              const pLine = document.createElement('div');
              pLine.className = 'line';
              pLine.textContent = line;
              terminal.appendChild(pLine);
            }
            terminal.scrollTop = terminal.scrollHeight;
          }

          if (status.status === 'completed') {
            clearInterval(pollTimer);
            pollTimer = null;
            const output = status.output || '(No output)';
            logToTerminal(`✅ Cell ${cellNo} completed`, 'success');
            resolve(output);
          } else if (status.status === 'failed') {
            clearInterval(pollTimer);
            pollTimer = null;
            reject(new Error(status.error || 'Execution failed'));
          }

          if (attempts >= maxAttempts) {
            clearInterval(pollTimer);
            pollTimer = null;
            reject(new Error('Polling timeout'));
          }
        } catch (err) {
          clearInterval(pollTimer);
          pollTimer = null;
          reject(err);
        }
      }, 5000);
    });
  }
  return result.output;
}

// ============================================================
// MAIN SETUP WORKFLOW
// ============================================================
async function startSetup() {
  if (cellRunning) return;
  if (!SECRET_KEY) {
    logToTerminal('❌ API key required. Refresh and enter key.', 'error');
    return;
  }

  cellRunning = true;
  startBtn.disabled = true;
  clearTerminal();

  try {
    // Step 1: Session
    stepSession.classList.add('active');
    logToTerminal("⏳ Creating Colab session...");
    
    const sessionData = await apiCall('/new', { gpu: 'T4' });
    sessionId = sessionData.sessionId;
    
    statusBadge.className = 'badge connected';
    statusBadge.textContent = `CONNECTED: ${sessionId.slice(0, 8)}`;
    endSessionBtn.style.display = 'inline-flex';
    stepSession.classList.replace('active', 'completed');
    logToTerminal(`✅ Session created: ${sessionId.slice(0, 12)}...`, 'success');

    // Step 2: Install Ollama
    stepOllama.classList.add('active');
    await executeCell(1, CELL1);
    
    // Step 3: Pull Model
    await executeCell(2, CELL2);
    stepOllama.classList.replace('active', 'completed');

    // Step 4: Wait for Repo
    document.getElementById('repo-card').style.display = 'block';
    logToTerminal("⏳ Waiting for repository URL...");
    while (!repoConfirmed) {
      await sleep(500);
      if (!cellRunning) break;
    }
    if (!repoConfirmed) {
      throw new Error('Repository not confirmed');
    }

    // Update repo tag
    const repoDisplay = repoUrl.replace('https://github.com/', '');
    currentRepoTag.textContent = `📦 ${repoDisplay}`;

    // Step 5: Clone Repo
    stepRepo.classList.add('active');
    logToTerminal(`📦 Cloning ${repoUrl}...`);
    await executeCell(3, CELL3(repoUrl));

    // Step 6: Index
    logToTerminal("📁 Indexing repository...");
    await executeCell(4, CELL4);
    stepRepo.classList.replace('active', 'completed');

    // Done
    logToTerminal("🎉 All setup complete! Launching chat...", 'success');
    statusBadge.className = 'badge ready';
    statusBadge.textContent = '🟢 READY';
    
    setTimeout(() => {
      setupDashboard.style.display = 'none';
      chatInterface.style.display = 'flex';
    }, 1500);

  } catch (err) {
    logToTerminal(`❌ ${err.message}`, 'error');
    console.error(err);
    startBtn.disabled = false;
  } finally {
    cellRunning = false;
  }
}

// ============================================================
// CHAT LOGIC
// ============================================================
async function askQuestion() {
  const q = questionInput.value.trim();
  if (!q || !sessionId) return;
  
  const modeRadio = document.querySelector('input[name="mode"]:checked');
  const mode = modeRadio ? modeRadio.value : 'fast';
  
  // Add user message
  const userDiv = document.createElement('div');
  userDiv.className = 'msg user';
  userDiv.textContent = q;
  chatMessages.appendChild(userDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  questionInput.value = '';

  // Add bot placeholder
  const botDiv = document.createElement('div');
  botDiv.className = 'msg bot';
  botDiv.textContent = '🧠 Thinking...';
  chatMessages.appendChild(botDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    const askCode = `
import json, sys
result = ask_${mode}("""${q.replace(/"/g, '\\"').replace(/\n/g, ' ')}""")
if result is None:
    result = "No response"
print(json.dumps({"answer": result}))
`;
    const output = await executeCell(99, askCode);
    
    try {
      const parsed = JSON.parse(output);
      botDiv.textContent = parsed.answer || output;
    } catch {
      botDiv.textContent = output.trim() || "No response.";
    }
  } catch (err) {
    botDiv.textContent = `❌ Error: ${err.message}`;
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============================================================
// EVENT LISTENERS
// ============================================================
confirmRepoBtn.onclick = () => {
  const raw = repoInput.value.trim();
  if (!raw) {
    logToTerminal('⚠️ Please enter a repository URL', 'error');
    return;
  }
  repoUrl = raw.startsWith('http') ? raw : `https://github.com/${raw}`;
  repoConfirmed = true;
  confirmRepoBtn.disabled = true;
  logToTerminal(`✅ Repository set: ${repoUrl}`, 'success');
};

startBtn.onclick = startSetup;
sendBtn.onclick = askQuestion;
questionInput.onkeydown = (e) => { if(e.key === 'Enter') askQuestion(); };

endSessionBtn.onclick = async () => {
  if (!sessionId) return;
  if (!confirm("Terminate this session? All progress will be lost.")) return;
  
  endSessionBtn.disabled = true;
  endSessionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  
  try {
    await apiCall(`/session/${sessionId}`, null, 'DELETE');
    logToTerminal('✅ Session terminated', 'success');
    setTimeout(() => location.reload(), 1000);
  } catch (err) {
    logToTerminal(`❌ ${err.message}`, 'error');
    endSessionBtn.disabled = false;
    endSessionBtn.innerHTML = '<i class="fas fa-power-off"></i> Terminate';
  }
};

// ============================================================
// MODE TOGGLE STYLING
// ============================================================
document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    document.querySelectorAll('.mode-toggle label').forEach(el => {
      el.classList.toggle('active', el.querySelector('input').checked);
    });
  });
});

// Initialize mode toggle
document.querySelectorAll('.mode-toggle label').forEach(el => {
  const radio = el.querySelector('input');
  if (radio && radio.checked) {
    el.classList.add('active');
  }
});

// ============================================================
// INIT
// ============================================================
console.log('🚀 AskRepo v3.9 loaded');
console.log(`📡 Backend: ${BACKEND_URL}`);
if (SECRET_KEY) console.log('🔑 API key loaded');

// Check if we have a stored session
if (localStorage.getItem('askrepo_session')) {
  console.log('📌 Previous session found:', localStorage.getItem('askrepo_session'));
}
