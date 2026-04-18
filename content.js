// content.js - Runs on the page

let extractorState = {
    running: false,
    paused: false,
    allProducts: [],
    processedPages: [],
    currentPage: 1,
    totalPages: 1,
    config: {
        batchSize: 5,
        startPage: 1,
        endPage: null,
        delay: 2000
    }
};

// ── Load saved state ──────────────────────────────────────────────────────────
async function loadState() {
    const saved = await chrome.storage.local.get(['extractorState', 'extractorConfig']);
    if (saved.extractorState) {
        extractorState.allProducts    = saved.extractorState.allProducts    || [];
        extractorState.processedPages = saved.extractorState.processedPages || [];
        extractorState.currentPage    = saved.extractorState.currentPage    || 1;
        extractorState.totalPages     = saved.extractorState.totalPages     || 1;
        extractorState.running        = saved.extractorState.running        || false;
        console.log('📀 Loaded state:', extractorState.allProducts.length, 'products');
    }
    if (saved.extractorConfig) {
        extractorState.config = { ...extractorState.config, ...saved.extractorConfig };
    }
    sendStatusUpdate();
}

// ── Save state ────────────────────────────────────────────────────────────────
async function saveState() {
    await chrome.storage.local.set({
        extractorState: {
            allProducts:    extractorState.allProducts,
            processedPages: extractorState.processedPages,
            currentPage:    extractorState.currentPage,
            totalPages:     extractorState.totalPages,
            running:        extractorState.running
        },
        extractorConfig: extractorState.config
    });
}

// ── Extract WhatsApp number ───────────────────────────────────────────────────
function extractWhatsApp(html) {
    if (!html) return '';
    const match = html.match(/href="(?:https?:)?\/\/(?:wa\.me|api\.whatsapp\.com)\/(\d+)/i);
    return match ? match[1] : '';
}

// ── Extract products from current page ───────────────────────────────────────
function extractProducts() {
    const products = [];
    const rows = document.querySelectorAll('table tbody tr');

    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length === 0) return;

        let productId = null;

        // Method 1: hidden input
        const hiddenInput = row.querySelector('input[name="product_id"]');
        if (hiddenInput && hiddenInput.value) productId = hiddenInput.value;

        // Method 2: cell[7]
        if (!productId && cells[7]) {
            const text = cells[7].textContent.trim();
            if (/^\d{6,7}$/.test(text)) productId = text;
        }

        // Method 3: scan all cells
        if (!productId) {
            for (let i = 0; i < cells.length; i++) {
                const text = cells[i].textContent.trim();
                if (/^\d{6,7}$/.test(text)) { productId = text; break; }
            }
        }

        if (!productId) return;

        // Skip already collected
        if (extractorState.allProducts.some(p => p.product_id === productId)) return;

        const sellerHtml = cells[0] ? cells[0].innerHTML : '';
        const sellerText = cells[0] ? cells[0].textContent.trim() : '';
        const whatsapp   = extractWhatsApp(sellerHtml);
        let sellerName   = sellerText;
        if (whatsapp) sellerName = sellerText.replace(whatsapp, '').replace(/\s+/g, ' ').trim();

        products.push({
            product_id:      productId,
            seller_name:     sellerName,
            whatsapp:        whatsapp,
            market:          cells[1] ? cells[1].textContent.trim() : '',
            sale_limit:      cells[2] ? cells[2].textContent.trim() : '',
            today_remaining: cells[3] ? cells[3].textContent.trim() : '',
            total_remaining: cells[4] ? cells[4].textContent.trim() : '',
            commission:      cells[5] ? cells[5].textContent.trim() : '',
            keyword:         cells[6] ? cells[6].textContent.trim() : '',
            page:            extractorState.currentPage,
            extracted_at:    new Date().toISOString()
        });
    });

    return products;
}

// ── Page helpers ──────────────────────────────────────────────────────────────
function getCurrentPage() {
    const active = document.querySelector('.pagination .page-link.active');
    if (active) return parseInt(active.textContent.trim()) || 1;
    const urlMatch = window.location.href.match(/[?&]page=(\d+)/);
    return urlMatch ? parseInt(urlMatch[1]) : 1;
}

function getTotalPages() {
    const pagination = document.querySelector('.pagination');
    if (!pagination) return 1;
    let max = 1;
    pagination.querySelectorAll('.page-link').forEach(link => {
        const num = parseInt(link.textContent.trim());
        if (!isNaN(num) && num > max) max = num;
    });
    return max;
}

function goToNextPage() {
    // Try › or » button
    const pagination = document.querySelector('.pagination');
    if (pagination) {
        const nextLink = Array.from(pagination.querySelectorAll('.page-link')).find(link =>
            link.textContent.trim() === '›' ||
            link.textContent.trim() === '»' ||
            /next/i.test(link.textContent.trim())
        );
        if (nextLink && nextLink.href && !nextLink.closest('li')?.classList.contains('disabled')) {
            saveState();
            window.location.href = nextLink.href;
            return true;
        }
    }

    // Fallback: build URL manually
    const url = new URL(window.location.href);
    const cur = parseInt(url.searchParams.get('page') || '1');
    url.searchParams.set('page', cur + 1);
    saveState();
    window.location.href = url.toString();
    return true;
}

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportToCSV() {
    if (extractorState.allProducts.length === 0) {
        sendLog('⚠️ No products to export');
        return;
    }

    const headers = [
        'product_id', 'seller_name', 'whatsapp', 'market',
        'sale_limit', 'today_remaining', 'total_remaining',
        'commission', 'keyword', 'page', 'extracted_at'
    ];
    const rows = [headers.join(',')];

    extractorState.allProducts.forEach(p => {
        const row = headers.map(h => {
            let v = String(p[h] || '').replace(/"/g, '""');
            if (v.includes(',') || v.includes('"') || v.includes('\n')) v = `"${v}"`;
            return v;
        });
        rows.push(row.join(','));
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `products_${extractorState.allProducts.length}_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    sendLog(`📁 Exported ${extractorState.allProducts.length} products to CSV`);
}

// ── Core extraction loop ──────────────────────────────────────────────────────
async function processCurrentPage() {
    if (!extractorState.running || extractorState.paused) return;

    const currentPage = getCurrentPage();
    const totalPages  = getTotalPages();
    const endPage     = extractorState.config.endPage || totalPages;

    extractorState.currentPage = currentPage;
    extractorState.totalPages  = totalPages;
    sendStatusUpdate();

    // Already processed this page?
    if (extractorState.processedPages.includes(currentPage)) {
        sendLog(`⏭️ Page ${currentPage} already processed, skipping...`);
        if (currentPage < endPage) {
            setTimeout(() => goToNextPage(), 1000);
        } else {
            finishExtraction();
        }
        return;
    }

    sendLog(`📄 Processing page ${currentPage} of ${totalPages}`);

    const products = extractProducts();

    if (products.length > 0) {
        extractorState.allProducts.push(...products);
        extractorState.processedPages.push(currentPage);
        await saveState();

        const withWA = products.filter(p => p.whatsapp).length;
        sendLog(`✅ Extracted ${products.length} products (${withWA} with WhatsApp)`);
        products.slice(0, 2).forEach(p => {
            sendLog(`   ID: ${p.product_id} | WA: ${p.whatsapp || 'No'}`);
        });
    } else {
        sendLog(`⚠️ No new products on page ${currentPage}`);
        extractorState.processedPages.push(currentPage);
        await saveState();
    }

    sendStatusUpdate();

    // Done?
    if (currentPage >= endPage || currentPage >= totalPages) {
        finishExtraction();
        return;
    }

    // Batch pause?
    const batchSize = extractorState.config.batchSize || 0;
    if (batchSize > 0 && extractorState.processedPages.length % batchSize === 0) {
        extractorState.running = false;
        await saveState();
        sendLog(`📦 Batch of ${batchSize} pages done. Click Resume to continue.`);
        sendStatusUpdate();
        return;
    }

    // Next page
    sendLog(`➡️ Moving to page ${currentPage + 1} in ${extractorState.config.delay / 1000}s...`);
    setTimeout(() => goToNextPage(), extractorState.config.delay);
}

function finishExtraction() {
    extractorState.running = false;
    saveState();
    sendLog('🎉 Extraction complete!');
    sendLog(`📦 Total: ${extractorState.allProducts.length} products from ${extractorState.processedPages.length} pages`);
    const withWA = extractorState.allProducts.filter(p => p.whatsapp).length;
    sendLog(`📱 With WhatsApp: ${withWA}`);
    sendStatusUpdate();
    exportToCSV();
}

// ── Messaging ─────────────────────────────────────────────────────────────────
function sendStatusUpdate() {
    const withWA = extractorState.allProducts.filter(p => p.whatsapp).length;
    chrome.runtime.sendMessage({
        action: 'statusUpdate',
        data: {
            running:        extractorState.running,
            paused:         extractorState.paused,
            currentPage:    extractorState.currentPage,
            totalPages:     extractorState.totalPages,
            totalProducts:  extractorState.allProducts.length,
            whatsappCount:  withWA,
            processedPages: extractorState.processedPages
        }
    }).catch(() => {});
}

function sendLog(message) {
    console.log(`[Extractor] ${message}`);
    chrome.runtime.sendMessage({ action: 'log', message }).catch(() => {});
}

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {

        case 'start':
            // Guard against double-start
            if (extractorState.running) {
                sendLog('⚠️ Already running, ignoring duplicate start');
                sendResponse({ success: true });
                break;
            }
            extractorState.running = true;
            extractorState.paused  = false;
            if (request.config) {
                extractorState.config = { ...extractorState.config, ...request.config };
            }
            saveState();
            sendLog('🚀 Starting extraction with config: ' + JSON.stringify(extractorState.config));

            // Navigate to startPage if not already there
            {
                const cur = getCurrentPage();
                if (cur !== extractorState.config.startPage) {
                    sendLog(`🔗 Navigating to start page ${extractorState.config.startPage}...`);
                    const url = new URL(window.location.href);
                    url.searchParams.set('page', extractorState.config.startPage);
                    saveState();
                    window.location.href = url.toString();
                    sendResponse({ success: true });
                    return true;
                }
            }
            processCurrentPage();
            sendResponse({ success: true });
            break;

        case 'pause':
            extractorState.paused = true;
            saveState();
            sendLog('⏸ Paused');
            sendStatusUpdate();
            sendResponse({ success: true });
            break;

        case 'resume':
            extractorState.running = true;
            extractorState.paused  = false;
            saveState();
            sendLog('▶ Resumed');
            processCurrentPage();
            sendResponse({ success: true });
            break;

        case 'stop':
            extractorState.running = false;
            extractorState.paused  = false;
            saveState();
            sendLog('⏹ Stopped');
            sendStatusUpdate();
            sendResponse({ success: true });
            break;

        case 'export':
            exportToCSV();
            sendResponse({ success: true });
            break;

        case 'clear':
            extractorState.allProducts    = [];
            extractorState.processedPages = [];
            extractorState.running        = false;
            extractorState.paused         = false;
            saveState();
            sendLog('🗑 All data cleared');
            sendStatusUpdate();
            sendResponse({ success: true });
            break;

        case 'getStatus':
            sendResponse({
                status: {
                    running:        extractorState.running,
                    paused:         extractorState.paused,
                    currentPage:    extractorState.currentPage,
                    totalPages:     extractorState.totalPages,
                    totalProducts:  extractorState.allProducts.length,
                    whatsappCount:  extractorState.allProducts.filter(p => p.whatsapp).length,
                    processedPages: extractorState.processedPages,
                    config:         extractorState.config
                }
            });
            break;

        default:
            sendResponse({ success: false, error: 'Unknown action' });
    }
    return true;
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    sendLog('✨ Product Extractor loaded');
    sendLog(`📍 URL: ${window.location.href}`);

    await loadState();

    extractorState.currentPage = getCurrentPage();
    extractorState.totalPages  = getTotalPages();

    sendLog(`📊 Page ${extractorState.currentPage} of ${extractorState.totalPages}`);
    sendLog(`📦 Already collected: ${extractorState.allProducts.length} products`);

    sendStatusUpdate();

    // Auto-resume if was running before page reload (navigation between pages)
    if (extractorState.running && extractorState.processedPages.length > 0) {
        sendLog('🔄 Auto-resuming after page navigation...');
        await new Promise(r => setTimeout(r, 1500)); // wait for DOM to settle
        processCurrentPage();
    } else {
        extractorState.running = false; // clear stale flag on fresh load
        await saveState();
        sendLog('💡 Click Start Extraction in the popup to begin.');
    }
}

init();