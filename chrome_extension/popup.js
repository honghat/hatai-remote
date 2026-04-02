let ws;
const logContainer = document.getElementById('log-container');
const statusDot = document.getElementById('status');
let currentThinkSpan = null;

function appendLog(html, className = "log-text") {
    const div = document.createElement('div');
    div.className = `log-entry ${className}`;
    div.innerHTML = html;
    logContainer.appendChild(div);
    requestAnimationFrame(() => logContainer.scrollTop = logContainer.scrollHeight);
    return div;
}

function connect() {
    ws = new WebSocket("ws://localhost:8000/agent/ws");
    
    ws.onopen = () => {
        statusDot.classList.add('connected');
        appendLog("[Connected to HatAI Engine]", "log-system");
    };

    ws.onclose = () => {
        statusDot.classList.remove('connected');
        setTimeout(connect, 3000); // Tự gắn lại sau 3 giây
    };

    ws.onmessage = (event) => {
        try {
            const payload = JSON.parse(event.data);
            const t = payload.type;
            
            if (t === "thinking_token") {
                if (!currentThinkSpan) {
                    currentThinkSpan = document.createElement("span");
                    const div = appendLog("🧠: <span></span>", "log-think");
                    currentThinkSpan = div.querySelector('span');
                }
                currentThinkSpan.innerText += payload.content;
                logContainer.scrollTop = logContainer.scrollHeight;
            } else if (t === "tool_call") {
                currentThinkSpan = null; // reset think
                const argsStr = JSON.stringify(payload.args, null, 2);
                appendLog(`⚡ Gọi công cụ: <b>${payload.tool}</b><br/><code>${argsStr}</code>`, "log-tool");
            } else if (t === "tool_result") {
                currentThinkSpan = null;
                // Nếu result quá dài, nó không bay vào đây vì đã truncate bên Backend
                // Append log "Tool result received"
                appendLog("✅ Xong tác vụ", "log-system");
            } else if (t === "text") {
                currentThinkSpan = null;
                appendLog(`🤖: ${payload.content}`, "log-text");
            } else if (t === "info") {
                currentThinkSpan = null;
                appendLog(`ℹ️ ${payload.message}`, "log-system");
            } else if (t === "error") {
                currentThinkSpan = null;
                appendLog(`❌ Lỗi: ${payload.content}`, "log-error");
            } else if (t === "done") {
                currentThinkSpan = null;
                appendLog("🏁 [Đã hoàn thành lượt truy vấn]", "log-system");
            }
        } catch (e) {
            console.error(e);
        }
    };
}

// Khởi chạy
connect();
