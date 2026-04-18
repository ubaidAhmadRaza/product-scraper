// popup.js - Full popup logic

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function addLog(msg) {
    const log = $('log');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${msg}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
    while (log.children.length > 100) log.removeChild(log.firstChild);
}

function updateStatus(data) {
    if (!data) return;

    // Status text
    if (data.running) {
        $('extractorStatus').textContent = data.paused ? '⏸ Paused' : '🟢 Running';
    } else if (data.processedPages && data.processedPages.length > 0) {
        $('extractorStatus').textContent = '📦 Batch Paused — Click Resume';
    } else {
        $('extractorStatus').textContent = '⏹ Idle';
    }

    $('currentPage').textContent    = data.currentPage  || '—';
    $('totalPages').textContent     = data.totalPages   || '—';
    $('productCount').textContent   = data.totalProducts || 0;
    $('whatsappCount').textContent  = data.whatsappCount || 0;
    $('pagesProcessed').textContent = (data.processedPages || []).length;

    // Progress bar
    const total = data.totalPages || 0;
    const done  = (data.processedPages || []).length;
    const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
    $('progressFill').style.width = pct + '%';
    $('progressFill').textContent = pct + '%';

    // Button states
    const isRunning     = data.running && !data.paused;
    const isPaused      = data.paused;
    const isBatchPaused = !data.running && (data.processedPages || []).length > 0;

    $('startBtn').disabled  = isRunning;
    $('pauseBtn').disabled  = !isRunning;
    $('resumeBtn').disabled = !(isPaused || isBatchPaused);  // ← KEY FIX
    $('stopBtn').disabled   = !(isRunning || isPaused);
}

function getConfig() {
    return {
        startPage:          parseInt($('startPage').value)   || 1,
        endPage:            parseInt($('endPage').value)     || null,
        batchSize:          parseInt($('batchSize').value)   || 5,
        delay:              (parseFloat($('delay').value)    || 2) * 1000,
        dedupMode:          $('dedupMode').value,
        dedupPriority:      $('dedupPriority').value,
        excludeOwnProducts: $('excludeOwnProducts').checked
    };
}

// ── Send message to active tab content script ─────────────────────────────────
async function sendToContent(action, extra = {}) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { addLog('❌ No active tab found'); return; }
    try {
        const resp = await chrome.tabs.sendMessage(tab.id, { action, ...extra });
        return resp;
    } catch (e) {
        addLog('❌ Could not reach content script. Are you on the product page?');
    }
}

// ── Button handlers ───────────────────────────────────────────────────────────
$('startBtn').addEventListener('click', async () => {
    const config = getConfig();
    addLog(`▶ Starting — pages ${config.startPage}→${config.endPage || 'all'}, batch ${config.batchSize}, delay ${config.delay/1000}s`);
    addLog(`🔄 Dedup: ${config.dedupMode} | Priority: ${config.dedupPriority}`);
    await sendToContent('start', { config });
});

$('pauseBtn').addEventListener('click', async () => {
    addLog('⏸ Pausing...');
    await sendToContent('pause');
});

$('resumeBtn').addEventListener('click', async () => {
    addLog('▶ Resuming next batch...');
    await sendToContent('resume');
});

$('stopBtn').addEventListener('click', async () => {
    addLog('⏹ Stopping...');
    await sendToContent('stop');
});

$('exportBtn').addEventListener('click', async () => {
    addLog('📥 Exporting CSV...');
    await sendToContent('export');
});

$('clearBtn').addEventListener('click', async () => {
    if (!confirm('Clear ALL collected data? This cannot be undone.')) return;
    addLog('🗑 Clearing data...');
    await sendToContent('clear');
});

$('dedupBtn').addEventListener('click', async () => {
    addLog('🔄 Running deduplication on existing data...');
    await sendToContent('deduplicate');
});

$('refreshBtn').addEventListener('click', async () => {
    const resp = await sendToContent('getStatus');
    if (resp?.status) updateStatus(resp.status);
    addLog('↻ Status refreshed');
});

$('clearLogBtn').addEventListener('click', () => {
    $('log').innerHTML = '<div class="log-entry">Log cleared.</div>';
});

// ── Listen for messages from content script ───────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'log') {
        addLog(message.message);
    }
    if (message.action === 'statusUpdate') {
        updateStatus(message.data);
    }
});

// ── Init: restore config + get live status ────────────────────────────────────
async function init() {
    const { extractorConfig: c } = await chrome.storage.local.get('extractorConfig');
    if (c) {
        if (c.startPage)          $('startPage').value            = c.startPage;
        if (c.endPage)            $('endPage').value              = c.endPage;
        if (c.batchSize)          $('batchSize').value            = c.batchSize;
        if (c.delay)              $('delay').value                = c.delay / 1000;
        if (c.dedupMode)          $('dedupMode').value            = c.dedupMode;
        if (c.dedupPriority)      $('dedupPriority').value        = c.dedupPriority;
        if (c.excludeOwnProducts) $('excludeOwnProducts').checked = c.excludeOwnProducts;
    }

    const resp = await sendToContent('getStatus');
    if (resp?.status) {
        updateStatus(resp.status);
        addLog(`📦 Resumed: ${resp.status.totalProducts} products already collected`);
    }
}

init();