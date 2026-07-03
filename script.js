// ============================================================
// BACKEND CONFIG
// ============================================================
const BACKEND_URL = 'https://tempo-agxk.onrender.com';
let API_SECRET = '';

// ============================================================
// DOM REFS
// ============================================================
const $ = id => document.getElementById(id);
const toggleSetup = $('toggleSetup');
const setupPanel = $('setupPanel');
const startBtn = $('startBtn');
const stopBtn = $('stopBtn');
const endBtn = $('endBtn');
const confirmRepoBtn = $('confirmRepoBtn');
const repoInput = $('repoInput');
const repoDisplay = $('repoDisplay');
const repoStatus = $('repoStatus');
const logArea = $('logArea');
const sessionStatus = $('sessionStatus');
const sessionBadge = $('sessionBadge');
const indexStatus = $('indexStatus');
const fileStats = $('fileStats');
const s1 = $('s1');
const s2 = $('s2');
const s3 = $('s3');
const messages = $('messages');
const questionInput = $('questionInput');
const askFastBtn = $('askFastBtn');
const askSimpleBtn = $('askSimpleBtn');
const chatFooter = $('chatFooter');

// ============================================================
// STATE
// ============================================================
let sessionId = null;
let colabSessionName = null;
let isRunning = false;
let shouldStop = false;
let repoConfirmed = false;
let repoUrl = '';
let chatReady = false;
let currentExecId = null;
let pollTimer = null;
let cellsDone = { c1: false, c2: false, c3: false, c4: false };

// ============================================================
// API KEY PROMPT (first visit)
// ============================================================
function getApiKey() {
  const stored = localStorage.getItem('askrepo_api_key');
  if (stored) {
    API_SECRET = stored;
    return true;
  }
  const key = prompt(
    '🔑 Enter your ColabBridge API secret key:\n\n' +
    '(This is required to connect to the backend.\n' +
    'It will be stored locally for future visits.)'
  );
  if (key && key.trim()) {
    API_SECRET = key.trim();
    localStorage.setItem('askrepo_api_key', API_SECRET);
    return true;
  }
  return false;
}

// ============================================================
// HELPERS
// ============================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function log(msg, type = 'info') {
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️' };
  console.log(`[AskRepo] ${icons[type] || ''} ${msg}`);
  logArea.textContent = msg;
}

function updateStep(el, state) {
  el.className = 'step-num';
  if (state === 'done') el.classList.add('done');
  else if (state === 'active') el.classList.add('active');
}

function parseRepoUrl(input) {
  let s = input.trim().replace(/\/$/, '');
  if (s.includes('github.com')) {
    const m = s.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (m) return { owner: m[1], repo: m[2] };
  }
  const parts = s.split('/');
  if (parts.length === 2) return { owner: parts[0], repo: parts[1] };
  return null;
}

// ============================================================
// API CLIENT (using new v3.9 endpoints)
// ============================================================
async function apiCall(endpoint, body = null, method = 'POST') {
  const headers = {
    'Content-Type': 'application/json',
    'api-secret': API_SECRET,
  };
  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const resp = await fetch(`${BACKEND_URL}${endpoint}`, opts);
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!resp.ok) {
    throw new Error(data.error || data.message || `HTTP ${resp.status}: ${text.substring(0, 100)}`);
  }
  return data;
}

// ============================================================
// SESSION MANAGEMENT (new /new endpoint)
// ============================================================
async function startSession() {
  const data = await apiCall('/new', {});
  if (!data.success) throw new Error(data.error || 'Session creation failed');
  sessionId = data.sessionId;
  colabSessionName = data.colabSession;
  log(`Session created: ${sessionId.substring(0, 12)}...`, 'success');
  return data;
}

async function stopSession() {
  if (!sessionId) return;
  try {
    const data = await apiCall(`/session/${sessionId}`, null, 'DELETE');
    log('Session stopped', 'success');
    return data;
  } catch (e) {
    log(`Stop error: ${e.message}`, 'warn');
    throw e;
  }
}

async function keepAlive() {
  if (!sessionId) return;
  try {
    await apiCall('/keepalive', { sessionId });
  } catch (e) {
    log(`Keepalive failed: ${e.message}`, 'warn');
  }
}

// ============================================================
// CODE EXECUTION (new /exec endpoint)
// ============================================================
async function executeCode(code, cellNo) {
  const data = await apiCall('/exec', {
    sessionId,
    code,
    cellNo
  });
  if (data.status === 'processing') {
    currentExecId = data.executionId;
    return data;
  }
  throw new Error(data.error || 'Execution failed');
}

async function pollExecution(execId, onProgress) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 300;

    pollTimer = setInterval(async () => {
      attempts++;
      try {
        const status = await apiCall(
          `/exec-status?sessionId=${sessionId}&executionId=${execId}`,
          null,
          'GET'
        );

        if (onProgress && status.output) {
          onProgress(status.output);
        }

        if (status.status === 'completed') {
          clearInterval(pollTimer);
          pollTimer = null;
          resolve(status);
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

        if (shouldStop) {
          clearInterval(pollTimer);
          pollTimer = null;
          reject(new Error('Stopped by user'));
        }
      } catch (err) {
        clearInterval(pollTimer);
        pollTimer = null;
        reject(err);
      }
    }, 3000);
  });
}

// ============================================================
// CELL DEFINITIONS (updated for new backend)
// ============================================================
const CELL1 = `import subprocess, time, os, sys, json
print("🔧 Installing Ollama...")
subprocess.run("apt-get update -qq && apt-get install -y zstd", shell=True, check=False)
subprocess.run("curl -fsSL https://ollama.com/install.sh | sh", shell=True, check=False)
subprocess.Popen("ollama serve > /tmp/ollama.log 2>&1", shell=True)
time.sleep(5)
print("✅ Ollama installed and running")`;

const CELL2 = `import subprocess, sys, json, time
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
print("✅ Model ready")`;

const CELL3 = `import subprocess, os, sys, json
repo_url = """${REPO_URL}"""
repo_name = repo_url.split("/")[-1]
target = f"/content/{repo_name}"
if os.path.exists(target):
    subprocess.run(f"rm -rf {target}", shell=True)
subprocess.run(f"git clone {repo_url} {target}", shell=True, check=False)
print(f"✅ Repo cloned to {target}")`;

const CELL4 = `import subprocess, json, re, hashlib, os, sys
from pathlib import Path

print("📁 Indexing files...")
repo_path = Path("/content/" + """${REPO_NAME}""")
file_contents = {}
extensions = ['*.py', '*.js', '*.json', '*.yaml', '*.yml', '*.md', '*.txt', '*.sh', '*.html', '*.css']
for ext in extensions:
    for f in repo_path.rglob(ext):
        try:
            content = f.read_text(encoding='utf-8', errors='ignore')
            rel = str(f.relative_to(repo_path))
            file_contents[rel] = content.split('\\n')
        except:
            pass
print(f"✅ Indexed {len(file_contents)} files")

cache = {}

def expand_keywords(q):
    m = {
        'login': ['login','sign in','auth','authenticate','credentials'],
        'auth': ['auth','authentication','authorization','jwt','session'],
        'api': ['api','endpoint','route','express'],
        'database': ['database','db','mongodb','mongoose','schema'],
        'user': ['user','users','profile','account'],
        'server': ['server','app','express','node','backend'],
    }
    words = q.lower().split()
    expanded = set(words)
    for w in words:
        for key, vals in m.items():
            if w in vals or w == key:
                expanded.update(vals)
                expanded.add(key)
    return list(expanded)

def score_files_fast(q, keywords):
    scored = []
    for fpath, lines in file_contents.items():
        score = 0
        pl = fpath.lower()
        for kw in keywords[:12]:
            if kw in pl:
                score += 3
        for line in lines[:40]:
            ll = line.lower()
            for kw in keywords[:12]:
                if kw in ll:
                    score += 1
        if score > 0:
            scored.append((score, fpath))
    scored.sort(reverse=True, key=lambda x: x[0])
    return scored[:4]

def clean_ansi(text):
    patterns = [
        r'\\x1b\\[[0-9;]*[a-zA-Z]',
        r'\\[?[0-9]+[a-zA-Z]',
        r'\\x1b\\[[0-9;]*m',
    ]
    for p in patterns:
        text = re.sub(p, '', text)
    return '\\n'.join(line.strip() for line in text.split('\\n') if line.strip())

def ask_fast(q):
    print(f"\\n🤔 {q}")
    kw = expand_keywords(q)
    scored = score_files_fast(q, kw)
    if not scored:
        print("❌ No relevant files found.")
        return
    context = ""
    for score, fpath in scored[:3]:
        lines = file_contents[fpath]
        context += f"\\n📁 {fpath}\\n"
        matches = []
        for i, line in enumerate(lines):
            ll = line.lower()
            for k in kw[:8]:
                if k in ll:
                    start = max(0, i-4)
                    end = min(len(lines), i+5)
                    matches.append((i, lines[start:end]))
                    break
            if len(matches) >= 8:
                break
        if matches:
            for i, block in matches[:6]:
                context += f"  L{i+1}: {''.join(block)}\\n"
        else:
            context += '\\n'.join(lines[:15]) + "\\n"
    if len(context) > 3500:
        context = context[:3500] + "\\n... (truncated)"
    prompt = f"""Codebase context:
{context}
Question: {q}
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
    print("✅ Done")

def ask_simple(q):
    print(f"\\n🤔 {q}\\n")
    proc = subprocess.Popen(
        ["ollama", "run", "qwen2.5-coder:7b"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True
    )
    stdout, _ = proc.communicate(input=q, timeout=60)
    clean = clean_ansi(stdout)
    print(clean)
    print("✅ Done")

print("\\n✅ Ready!")
print("\\n📝 Usage: ask_fast('your question') or ask_simple('your question')")`;

// ============================================================
// EXECUTE CELL WITH POLLING
// ============================================================
async function runCell(cellId, code, cellNo, progressCb) {
  log(`▶️ Running cell ${cellNo}...`, 'info');
  sessionStatus.textContent = `running cell ${cellNo}...`;

  const result = await executeCode(code, cellNo);
  if (result.status === 'processing') {
    const output = await pollExecution(result.executionId, progressCb);
    log(`✅ Cell ${cellNo} completed`, 'success');
    return output;
  }
  throw new Error('Unexpected response from /exec');
}

// ============================================================
// MAIN SETUP FLOW
// ============================================================
async function startSetup() {
  if (!API_SECRET) {
    if (!getApiKey()) {
      sessionStatus.textContent = '❌ API key required';
      return;
    }
  }

  if (isRunning) return;
  isRunning = true;
  shouldStop = false;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  endBtn.style.display = 'none';

  try {
    // 1. Start session
    sessionStatus.textContent = '⏳ Creating session...';
    updateStep(s1, 'active');
    await startSession();
    sessionBadge.textContent = `session: ${sessionId.substring(0, 12)}...`;
    sessionBadge.style.display = 'inline';
    endBtn.style.display = 'inline';
    sessionStatus.textContent = '✅ Session ready';

    // 2. Cell 1: Install Ollama
    updateStep(s1, 'active');
    await runCell('c1', CELL1, 1, (out) => {
      logArea.textContent = out.substring(0, 200);
    });
    cellsDone.c1 = true;
    updateStep(s1, 'done');

    // 3. Cell 2: Pull model
    logArea.textContent = '⏳ Pulling model...';
    await runCell('c2', CELL2, 2, (out) => {
      logArea.textContent = out.substring(0, 300);
    });
    cellsDone.c2 = true;

    // 4. Wait for repo
    sessionStatus.textContent = '⏳ Waiting for repository...';
    log('Waiting for repo confirmation...', 'warn');
    await waitForRepo();

    // 5. Cell 3: Clone repo
    updateStep(s2, 'active');
    const parsed = parseRepoUrl(repoUrl);
    const cloneCode = CELL3.replace('${REPO_URL}', repoUrl);
    await runCell('c3', cloneCode, 3);
    cellsDone.c3 = true;
    updateStep(s2, 'done');

    // 6. Cell 4: Index
    updateStep(s3, 'active');
    sessionStatus.textContent = '⏳ Indexing...';
    const repoName = parsed ? parsed.repo : 'repo';
    const indexCode = CELL4.replace('${REPO_NAME}', repoName);
    await runCell('c4', indexCode, 4, (out) => {
      const match = out.match(/Indexed (\d+) files/);
      if (match) fileStats.textContent = `📄 ${match[1]} files`;
      logArea.textContent = out.substring(0, 300);
    });
    cellsDone.c4 = true;
    updateStep(s3, 'done');

    // 7. Done
    setupPanel.classList.add('collapsed');
    sessionStatus.textContent = '✅ All cells completed!';
    indexStatus.textContent = '✅ Ready';
    fileStats.textContent = '📄 Indexed';
    chatReady = true;
    questionInput.disabled = false;
    askFastBtn.disabled = false;
    askSimpleBtn.disabled = false;
    chatFooter.innerHTML = '✅ <span class="ok">Ready to answer questions</span>';
    log('🎉 Setup complete! Chat enabled.', 'success');

  } catch (err) {
    sessionStatus.textContent = `❌ ${err.message}`;
    log(`Error: ${err.message}`, 'error');
  } finally {
    isRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
}

function waitForRepo() {
  return new Promise((resolve) => {
    if (repoConfirmed) return resolve();
    const check = setInterval(() => {
      if (repoConfirmed || shouldStop) {
        clearInterval(check);
        resolve();
      }
    }, 300);
  });
}

// ============================================================
// REPO CONFIRM
// ============================================================
confirmRepoBtn.addEventListener('click', () => {
  const raw = repoInput.value.trim();
  if (!raw) {
    repoStatus.textContent = '⚠️ Enter a repository';
    return;
  }
  const parsed = parseRepoUrl(raw);
  if (!parsed) {
    repoStatus.textContent = '❌ Invalid format. Use user/repo or URL';
    return;
  }
  repoUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
  repoDisplay.textContent = `📁 ${parsed.owner}/${parsed.repo}`;
  repoConfirmed = true;
  repoStatus.textContent = '✅ Repository set';
  log(`Repository set: ${repoUrl}`, 'success');
});

// ============================================================
// STOP / END
// ============================================================
stopBtn.addEventListener('click', () => {
  shouldStop = true;
  log('Stopping...', 'warn');
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  stopBtn.disabled = true;
});

endBtn.addEventListener('click', async () => {
  if (!sessionId) return;
  if (!confirm('End this session? All progress will be lost.')) return;

  endBtn.disabled = true;
  endBtn.textContent = '⏳ Ending...';
  chatFooter.innerHTML = '⏳ <span class="wait">Ending session...</span>';

  try {
    await stopSession();
    sessionId = null;
    sessionBadge.style.display = 'none';
    endBtn.style.display = 'none';
    setupPanel.classList.remove('collapsed');
    sessionStatus.textContent = '✅ Session ended';
    chatReady = false;
    questionInput.disabled = true;
    askFastBtn.disabled = true;
    askSimpleBtn.disabled = true;
    chatFooter.innerHTML = '⏳ <span class="wait">Session ended. Start again.</span>';
    log('Session ended by user', 'warn');
  } catch (error) {
    log(`Session stop issues: ${error.message}`, 'warn');
    // Clean up local state anyway
    sessionId = null;
    sessionBadge.style.display = 'none';
    endBtn.style.display = 'none';
    setupPanel.classList.remove('collapsed');
    sessionStatus.textContent = '⚠️ Session ended (with errors)';
    chatReady = false;
    questionInput.disabled = true;
    askFastBtn.disabled = true;
    askSimpleBtn.disabled = true;
    chatFooter.innerHTML = '⚠️ <span class="err">Session ended with errors</span>';
  } finally {
    endBtn.disabled = false;
    endBtn.textContent = '✕ End';
  }
});

// ============================================================
// TOGGLE SETUP
// ============================================================
toggleSetup.addEventListener('click', () => {
  setupPanel.classList.toggle('collapsed');
});

// ============================================================
// START BUTTON
// ============================================================
startBtn.addEventListener('click', startSetup);

// ============================================================
// CHAT
// ============================================================
async function askQuestion(mode) {
  if (!chatReady) {
    chatFooter.innerHTML = '⏳ <span class="wait">Setup not complete</span>';
    return;
  }

  const q = questionInput.value.trim();
  if (!q) {
    chatFooter.innerHTML = '⚠️ <span class="err">Enter a question</span>';
    return;
  }

  // Remove empty state
  const empty = messages.querySelector('.empty-state');
  if (empty) empty.remove();

  // User message
  const userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.innerHTML = `<div class="label">You</div><div class="content">${escapeHtml(q)}</div>`;
  messages.appendChild(userMsg);
  messages.scrollTop = messages.scrollHeight;

  // Bot placeholder
  const botMsg = document.createElement('div');
  botMsg.className = `msg bot ${mode === 'simple' ? 'simple' : ''}`;
  botMsg.innerHTML = `<div class="label">${mode === 'fast' ? '⚡ Fast' : '💬 Simple'}</div><div class="content"><span class="partial">🧠 Thinking...</span></div>`;
  messages.appendChild(botMsg);
  messages.scrollTop = messages
