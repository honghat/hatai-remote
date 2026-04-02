// HatAI Browser Extension - Content Script
// Draws distinct visual IDs on actionable elements and creates an index mapping

window._hatai_visual_scan = function() {
    // 1. Remove previous tags
    document.querySelectorAll('.hatai-v-badge, .hatai-bbox').forEach(e => e.remove());
    
    const elements = document.querySelectorAll('a, button, input, textarea, select, [role="button"], [tabindex]');
    let result = "Interactive Elements:\\n";
    let idCount = 1;

    // We keep a small map for debugging
    window._hatai_map = {};

    for (let i = 0; i < elements.length; i++) {
        if (idCount >= 100) break;
        let el = elements[i];
        let rect = el.getBoundingClientRect();
        
        // Skip hidden or zero-size elements
        if (rect.width === 0 || rect.height === 0 || el.style.display === 'none' || el.style.visibility === 'hidden') {
            continue;
        }

        // Identify element semantics
        let tag = el.tagName.toLowerCase();
        let text = (el.innerText || el.value || el.placeholder || el.title || el.getAttribute('aria-label') || "").trim().substring(0, 45).replace(/\\n/g, ' ');
        if (tag === 'input' || tag === 'textarea') {
            text += ` (input type=${el.type||''} name=${el.name||''})`;
        }
        if (!text.trim()) text = tag;
        
        // Add robust data attribute! 
        el.setAttribute('data-hatai-id', idCount);
        window._hatai_map[idCount] = el;

        // Visual Highlight: Create a badge container
        let badge = document.createElement('div');
        badge.className = 'hatai-v-badge';
        badge.innerText = `[${idCount}]`;
        
        // Styling the Badge (Yellow background, high visibility for LLM)
        Object.assign(badge.style, {
            position: 'absolute',
            top: `${rect.top + window.scrollY}px`,
            left: `${rect.left + window.scrollX}px`,
            backgroundColor: '#FFEB3B', // Vibrant Yellow
            color: '#000',
            border: '1px solid #000',
            fontSize: '11px',
            fontWeight: '900',
            padding: '2px 4px',
            borderRadius: '4px',
            zIndex: '2147483647', // Maximum z-index
            pointerEvents: 'none', // Don't block clicks
            boxShadow: '0px 2px 4px rgba(0,0,0,0.5)',
            transform: 'translate(-50%, -50%)', // Center on top-left corner
        });

        // Draw a bounding box for extra clarity
        let box = document.createElement('div');
        box.className = 'hatai-bbox';
        Object.assign(box.style, {
            position: 'absolute',
            top: `${rect.top + window.scrollY}px`,
            left: `${rect.left + window.scrollX}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            border: '2px dashed #00BCD4', // Cyan boundary
            zIndex: '2147483646',
            pointerEvents: 'none',
            opacity: '0.4',
        });

        document.body.appendChild(badge);
        document.body.appendChild(box);

        result += `- [${idCount}] ${text}\\n`;
        idCount++;
    }
    return result;
};

// If AppleScript injects an event request
document.addEventListener('hatai-request-scan', function(e) {
    try {
        const textOut = window._hatai_visual_scan();
        document.dispatchEvent(new CustomEvent('hatai-scan-done', { detail: textOut }));
    } catch(err) {
        console.error("HatAI Error:", err);
    }
});

console.log("🚀 HatAI Extension Loaded. Listeners active.");

let hataiHudHost = null;
let hataiLogContainer = null;
let currentThinkSpanNode = null;
let isManualHidden = false;
let isMinimized = false;

function ensureFloatingPopup() {
    if (document.getElementById('hatai-hud-host')) {
        const hudWrapper = hataiHudHost.shadowRoot.getElementById('hatai-hud-wrapper');
        const fab = hataiHudHost.shadowRoot.getElementById('hatai-fab');
        if (!isManualHidden) {
            hudWrapper.classList.remove('hatai-hidden');
            fab.style.display = 'none';
        }
        return;
    }

    // Tạo Host Element
    hataiHudHost = document.createElement('div');
    hataiHudHost.id = 'hatai-hud-host';
    hataiHudHost.style.cssText = "position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;";
    
    const shadow = hataiHudHost.attachShadow({mode: 'open'});

    // Style System Siêu Mượt
    const style = document.createElement('style');
    style.textContent = `
        :host {
            --bg-glass: rgba(15, 23, 42, 0.9);
            --border-glass: rgba(255, 255, 255, 0.1);
            --text-main: #e2e8f0;
            --text-muted: #94a3b8;
            --accent-glow: #0ea5e9;
            --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }
        
        #hatai-hud-wrapper {
            width: 380px;
            max-height: 400px;
            background: var(--bg-glass);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid var(--border-glass);
            border-radius: 16px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-family: var(--font-mono);
            font-size: 13px;
            color: var(--text-main);
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            transform: translateY(0);
            opacity: 1;
            box-sizing: border-box;
            user-select: none;
        }

        #hatai-hud-wrapper.hatai-hidden {
            opacity: 0;
            transform: translateY(40px) scale(0.9);
            pointer-events: none;
        }

        #hatai-hud-wrapper.hatai-minimized {
            max-height: 44px;
            width: 240px;
        }

        #hatai-hud-wrapper.hatai-minimized #hatai-log-viewport {
            opacity: 0;
            pointer-events: none;
        }

        .hud-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            background: rgba(0, 0, 0, 0.3);
            border-bottom: 1px solid var(--border-glass);
            cursor: move;
        }

        .macos-dots {
            display: flex;
            gap: 8px;
        }
        
        .dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 8px;
            color: rgba(0,0,0,0);
        }
        .dot:hover { color: rgba(0,0,0,0.5); }
        .dot.red { background: #ff5f56; }
        .dot.yellow { background: #ffbd2e; }
        .dot.green { 
            background: #27c93f; 
            box-shadow: 0 0 8px #27c93f;
            animation: pulse-green 2s infinite;
        }

        @keyframes pulse-green {
            0% { box-shadow: 0 0 0 0 rgba(39, 201, 63, 0.4); }
            70% { box-shadow: 0 0 0 6px rgba(39, 201, 63, 0); }
            100% { box-shadow: 0 0 0 0 rgba(39, 201, 63, 0); }
        }

        .hud-title {
            font-size: 11px;
            font-weight: 800;
            color: #94a3b8;
            letter-spacing: 0.8px;
            text-transform: uppercase;
            pointer-events: none;
        }

        #hatai-log-viewport {
            flex: 1;
            padding: 12px 16px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 10px;
            transition: opacity 0.3s;
        }

        /* FAB for hidden state */
        #hatai-fab {
            width: 48px;
            height: 48px;
            background: var(--bg-glass);
            backdrop-filter: blur(10px);
            border: 1px solid var(--accent-glow);
            border-radius: 50%;
            display: none;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 15px var(--accent-glow);
            transition: all 0.3s;
            animation: fab-entry 0.5s cubic-bezier(0.18, 0.89, 0.32, 1.28);
        }
        #hatai-fab:hover { transform: scale(1.1) rotate(15deg); }
        @keyframes fab-entry {
            from { transform: scale(0) rotate(-45deg); opacity: 0; }
            to { transform: scale(1) rotate(0); opacity: 1; }
        }

        #hatai-fab svg { width: 24px; height: 24px; fill: var(--accent-glow); }

        #hatai-log-viewport::-webkit-scrollbar { width: 4px; }
        #hatai-log-viewport::-webkit-scrollbar-thumb {
            background: rgba(14, 165, 233, 0.3);
            border-radius: 10px;
        }

        .log-entry { line-height: 1.6; animation: slideIn 0.3s ease-out; word-break: break-word; }
        @keyframes slideIn {
            from { opacity: 0; transform: translateX(15px); }
            to { opacity: 1; transform: translateX(0); }
        }

        .log-think { 
            color: #fbbf24; 
            background: rgba(251, 191, 36, 0.08);
            border-left: 3px solid #fbbf24;
            padding: 10px;
            border-radius: 8px;
            font-size: 11px;
            font-style: italic;
            margin: 4px 0;
        }
        .log-think b { display: block; margin-bottom: 4px; font-size: 9px; text-transform: uppercase; opacity: 0.7; letter-spacing: 1px; }
        .log-tool { 
            color: #0ea5e9; 
            background: rgba(14, 165, 233, 0.15); 
            padding: 10px; 
            border-radius: 8px; 
            border-left: 3px solid #0ea5e9; 
        }
        .log-text { color: #f1f5f9; font-size: 13px; font-weight: 500; }
        .log-info { color: #64748b; font-style: italic; font-size: 11px; text-align: center; }
        .log-error { color: #f43f5e; font-weight: 700; background: rgba(244, 63, 94, 0.15); padding: 10px; border-radius: 8px; border: 1px solid rgba(244,63,94,0.3); }
        .log-done { 
            color: #10b981; 
            font-weight: 900; 
            letter-spacing: 2px; 
            text-align: center; 
            border-top: 1px solid var(--border-glass); 
            padding-top: 12px; 
            text-shadow: 0 0 10px rgba(16, 185, 129, 0.4);
        }
    `;

    // Wrapper
    const wrapper = document.createElement('div');
    wrapper.id = 'hatai-hud-wrapper';

    // Header
    const header = document.createElement('div');
    header.className = 'hud-header';
    header.innerHTML = `
        <div class="macos-dots">
            <div class="dot red" id="hatai-btn-close" title="Ẩn (Alt+H)">×</div>
            <div class="dot yellow" id="hatai-btn-min" title="Thu nhỏ">−</div>
            <div class="dot green" title="HatAI Active"></div>
        </div>
        <div class="hud-title">HatAI Vision Node</div>
        <div style="width: 48px;"></div>
    `;

    // Logs Container
    hataiLogContainer = document.createElement('div');
    hataiLogContainer.id = 'hatai-log-viewport';

    wrapper.appendChild(header);
    wrapper.appendChild(hataiLogContainer);

    // FAB
    const fab = document.createElement('div');
    fab.id = 'hatai-fab';
    fab.title = "Hiện HatAI HUD";
    fab.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5-9h10v2H7z"/></svg>`;
    
    shadow.appendChild(style);
    shadow.appendChild(wrapper);
    shadow.appendChild(fab);
    
    // Logic nút bấm
    shadow.getElementById('hatai-btn-close').onclick = (e) => {
        e.stopPropagation();
        isManualHidden = true;
        wrapper.classList.add('hatai-hidden');
        fab.style.display = 'flex';
    };

    shadow.getElementById('hatai-btn-min').onclick = (e) => {
        e.stopPropagation();
        isMinimized = !isMinimized;
        if (isMinimized) wrapper.classList.add('hatai-minimized');
        else wrapper.classList.remove('hatai-minimized');
    };

    fab.onclick = () => {
        isManualHidden = false;
        wrapper.classList.remove('hatai-hidden');
        fab.style.display = 'none';
    };

    // Drag and Drop (Simple)
    let isDragging = false;
    let offset = { x: 0, y: 0 };

    header.onmousedown = (e) => {
        isDragging = true;
        offset.x = e.clientX - hataiHudHost.offsetLeft;
        offset.y = e.clientY - hataiHudHost.offsetTop;
        header.style.cursor = 'grabbing';
    };

    window.onmousemove = (e) => {
        if (!isDragging) return;
        hataiHudHost.style.left = (e.clientX - offset.x) + 'px';
        hataiHudHost.style.top = (e.clientY - offset.y) + 'px';
        hataiHudHost.style.bottom = 'auto';
        hataiHudHost.style.right = 'auto';
    };

    window.onmouseup = () => {
        isDragging = false;
        header.style.cursor = 'move';
    };

    (document.documentElement || document.body).appendChild(hataiHudHost);
}

function appendLogEntry(html, typeClass) {
    ensureFloatingPopup();
    const div = document.createElement('div');
    div.className = `log-entry ${typeClass}`;
    div.innerHTML = html;
    
    hataiLogContainer.appendChild(div);
    hataiLogContainer.scrollTop = hataiLogContainer.scrollHeight;
    
    while(hataiLogContainer.children.length > 30) {
        hataiLogContainer.removeChild(hataiLogContainer.firstChild);
    }
    return div;
}

function handleAIPayload(payload) {
    try {
        const t = payload.type;
        ensureFloatingPopup();
        
        const wrapper = hataiHudHost.shadowRoot.getElementById('hatai-hud-wrapper');
        const fab = hataiHudHost.shadowRoot.getElementById('hatai-fab');
        
        // Chỉ hiện lại nếu không phải là manual hidden
        if (!isManualHidden) {
            wrapper.classList.remove('hatai-hidden');
            fab.style.display = 'none';
        }
        
        if (t === "thinking_token") {
            if (!currentThinkSpanNode) {
                const div = appendLogEntry("<b>🤔 Đang suy luận...</b><span></span>", "log-think");
                currentThinkSpanNode = div.querySelector('span');
            }
            currentThinkSpanNode.innerText += payload.content;
            hataiLogContainer.scrollTop = hataiLogContainer.scrollHeight;
        } else if (t === "tool_call") {
            currentThinkSpanNode = null;
            appendLogEntry(`<b>⚡ THỰC THI LỆNH: ${payload.tool}</b><br/><span style="color:var(--text-muted);font-size:11px;">Mọi thứ đang diễn ra tự động...</span>`, "log-tool");
        } else if (t === "text") {
            currentThinkSpanNode = null;
            appendLogEntry(`🤖 <b>AI:</b> ${payload.content}`, "log-text");
        } else if (t === "info") {
            currentThinkSpanNode = null;
            appendLogEntry(`<i>ℹ️ ${payload.message}</i>`, "log-info");
        } else if (t === "error") {
            currentThinkSpanNode = null;
            appendLogEntry(`❌ LỖI HỆ THỐNG: ${payload.content}`, "log-error");
        } else if (t === "done") {
            currentThinkSpanNode = null;
            appendLogEntry("🏁 TÁC VỤ HOÀN TẤT TRÊN LƯỢT NÀY", "log-done");
        }
    } catch (e) { console.error(e); }
}

chrome.runtime.onMessage.addListener((payload, sender, sendResponse) => {
    if (window.location.href.includes("localhost:5173/chat")) return;
    handleAIPayload(payload);
});

// Khởi động khi Document Body đã sẵn sàng
function initHatAIHUD() {
    if (window.location.href.includes("localhost:5173/chat")) return;

    if (!document.body) {
        setTimeout(initHatAIHUD, 100);
        return;
    }
    
    // Khởi tạo luôn
    ensureFloatingPopup();
    appendLogEntry("<i>[Trạm trung chuyển HatAI - Đang chờ kết nối...]</i>", "log-info");

    try {
        // Yêu cầu background trả về dữ liệu log
        chrome.runtime.sendMessage({type: "request_sync"}, (response) => {
            if (chrome.runtime.lastError) {
                return; // Ignore error if background is not ready
            }
            if (response && response.buffer && response.buffer.length > 0) {
                if(hataiLogContainer) hataiLogContainer.innerHTML = '';
                for (let payload of response.buffer) {
                    handleAIPayload(payload);
                }
            }
        });
    } catch(e) {}
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHatAIHUD);
} else {
    initHatAIHUD();
}
