import asyncio
import paramiko
import json
import logging
import threading
from typing import Dict, Any, Optional
from fastapi import WebSocket

logger = logging.getLogger("SSHManager")

class SSHTerminal:
    """Manages a single SSH shell session over a WebSocket."""
    def __init__(self, websocket: WebSocket, connection_data: Dict[str, Any]):
        self.websocket = websocket
        self.host = connection_data.get("host")
        self.port = connection_data.get("port", 22)
        self.username = connection_data.get("username")
        self.password = connection_data.get("password_encrypted") # For simplicity in this mock, use as-is
        self.private_key_str = connection_data.get("private_key")
        self.auth_method = connection_data.get("auth_method", "password")
        self.default_dir = connection_data.get("default_directory")
        self.loop = asyncio.get_event_loop()
        
        self.client: Optional[paramiko.SSHClient] = None
        self.channel: Optional[paramiko.Channel] = None
        self._stop_event = threading.Event()
        self._read_thread: Optional[threading.Thread] = None

    async def connect(self):
        """Establish SSH connection and start interactive shell."""
        try:
            self.client = paramiko.SSHClient()
            self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            # Auth logic
            if self.auth_method == "key" and self.private_key_str:
                from io import StringIO
                key_file = StringIO(self.private_key_str)
                # Try multiple key types
                pkey = None
                try: pkey = paramiko.RSAKey.from_private_key(key_file)
                except:
                    key_file.seek(0)
                    try: pkey = paramiko.Ed25519Key.from_private_key(key_file)
                    except: 
                        key_file.seek(0)
                        pkey = paramiko.ECDSAKey.from_private_key(key_file)
                
                self.client.connect(self.host, port=self.port, username=self.username, pkey=pkey, timeout=10)
            else:
                self.client.connect(self.host, port=self.port, username=self.username, password=self.password, timeout=10)
            
            # Start interactive session
            self.channel = self.client.invoke_shell(term='xterm', width=80, height=24)
            self.channel.setblocking(0)
            
            if self.default_dir:
                self.channel.send(f"cd \"{self.default_dir}\"\n")

            # Notification
            await self.websocket.send_json({"type": "connected", "host": f"{self.host}:{self.port}"})
            
            # Start reader loop
            self._read_thread = threading.Thread(target=self._read_loop, daemon=True)
            self._read_thread.start()
            
            return True
            
        except Exception as e:
            logger.error(f"SSH Connection failed: {e}")
            await self.websocket.send_json({"type": "error", "message": f"Connection failed: {str(e)}"})
            return False

    def _read_loop(self):
        """Bridge SSH output to WebSocket (runs in background thread)."""
        try:
            while not self._stop_event.is_set():
                if self.channel and self.channel.recv_ready():
                    data = self.channel.recv(4096).decode('utf-8', 'ignore')
                    # Send to WS safely using captured main loop
                    asyncio.run_coroutine_threadsafe(
                        self.websocket.send_json({"type": "output", "data": data}),
                        self.loop
                    )
                else:
                    import time
                    time.sleep(0.01)
                    if self.channel and self.channel.exit_status_ready():
                        break
        except Exception as e:
            logger.error(f"SSH Reader loop error: {e}")
        finally:
            self.stop()

    def send_input(self, data: str):
        """Send input from WebSocket to SSH channel."""
        if self.channel:
            self.channel.send(data)

    def resize(self, cols: int, rows: int):
        """Resize pseudo-terminal."""
        if self.channel:
            self.channel.resize_pty(width=cols, height=rows)

    def stop(self):
        """Gracefully release resources."""
        self._stop_event.set()
        if self.channel:
            self.channel.close()
        if self.client:
            self.client.close()
        logger.info(f"SSH Session to {self.host} closed")

    @staticmethod
    def test_connection(connection_data: Dict[str, Any]) -> tuple[bool, str]:
        """One-off test to verify credentials."""
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            host = connection_data.get("host")
            port = connection_data.get("port", 22)
            user = connection_data.get("username")
            pw = connection_data.get("password_encrypted")
            
            client.connect(host, port=port, username=user, password=pw, timeout=5)
            client.close()
            return True, "Kết nối thành công!"
        except Exception as e:
            return False, str(e)
