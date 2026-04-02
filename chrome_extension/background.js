// Bộ đệm lưu giữ log để khi anh nhảy qua Tab mới nó rải lại ngay lập tức
self.historyBuffer = [];
self.hatai_ws = null;
self.reconnectTimer = null;

function connect() {
    if (self.hatai_ws && (self.hatai_ws.readyState === WebSocket.OPEN || self.hatai_ws.readyState === WebSocket.CONNECTING)) {
        return;
    }
    
    self.hatai_ws = new WebSocket("ws://localhost:8000/agent/ws");
    
    self.hatai_ws.onopen = () => {
        console.log("HatAI Background: WS Connected");
        self.historyBuffer = []; // Reset khi mở luồng mới
        const initMsg = {type: "info", message: "[Đã kết nối luồng AI]"};
        self.historyBuffer.push(initMsg);
        forwardToAllTabs(initMsg);
    };
    
    self.hatai_ws.onclose = () => {
        console.log("HatAI Background: WS Closed. Reconnecting...");
        clearTimeout(self.reconnectTimer);
        self.reconnectTimer = setTimeout(connect, 3000);
    };
    
    self.hatai_ws.onerror = (e) => {
        console.error("HatAI Background: WS Error", e);
    };
    
    self.hatai_ws.onmessage = (event) => {
        try {
            const payload = JSON.parse(event.data);
            
            self.historyBuffer.push(payload);
            if (self.historyBuffer.length > 50) self.historyBuffer.shift();

            forwardToAllTabs(payload);
        } catch(e) { console.error(e); }
    };
}

function forwardToAllTabs(payload) {
    chrome.tabs.query({}, (tabs) => {
        for (let tab of tabs) {
            chrome.tabs.sendMessage(tab.id, payload).catch(err => {});
        }
    });
}

// Khi một Tab mới mở / tải xong Content Script, nó gọi xin dữ liệu
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "request_sync") {
        sendResponse({ buffer: self.historyBuffer });
    }
});

connect();
