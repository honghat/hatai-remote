from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from db.psql.session import get_db
from crud.ssh_service import SSHService
from core.ssh_manager import SSHTerminal
from schemas.ssh import (
    SSHConnectionCreate, SSHConnectionUpdate, SSHConnectionResponse,
    SSHCommandCreate, SSHCommandResponse
)
from typing import List
import json

router = APIRouter()


# ── Connections ───────────────────────────────────────────────────────────
@router.get("/connections", response_model=List[SSHConnectionResponse])
def list_connections(db: Session = Depends(get_db)):
    svc = SSHService(db)
    return svc.get_connections(user_id=1)


@router.post("/connections", response_model=SSHConnectionResponse)
def create_connection(data: SSHConnectionCreate, db: Session = Depends(get_db)):
    svc = SSHService(db)
    save_data = data.dict()
    if 'password' in save_data:
        save_data['password_encrypted'] = save_data.pop('password')
    return svc.create_connection(user_id=1, data=save_data)


@router.put("/connections/{connection_id}", response_model=SSHConnectionResponse)
def update_connection(connection_id: int, data: SSHConnectionUpdate, db: Session = Depends(get_db)):
    svc = SSHService(db)
    conn = svc.get_connection(connection_id, user_id=1)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
        
    save_data = data.dict(exclude_unset=True)
    if 'password' in save_data:
        save_data['password_encrypted'] = save_data.pop('password')
    
    for k, v in save_data.items():
        setattr(conn, k, v)
    db.commit()
    db.refresh(conn)
    return conn


@router.delete("/connections/{connection_id}")
def delete_connection(connection_id: int, db: Session = Depends(get_db)):
    svc = SSHService(db)
    conn = svc.get_connection(connection_id, user_id=1)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    db.delete(conn)
    db.commit()
    return {"message": "Connection deleted"}


@router.post("/connections/{connection_id}/test")
def test_connection(connection_id: int, db: Session = Depends(get_db)):
    svc = SSHService(db)
    conn = svc.get_connection(connection_id, user_id=1)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    success, msg = SSHTerminal.test_connection(conn.__dict__)
    return {"status": "ok" if success else "error", "message": msg}


# ── WebSocket Terminal ───────────────────────────────────────────────────────
@router.websocket("/ws/{connection_id}")
async def ssh_websocket_endpoint(websocket: WebSocket, connection_id: int, token: str = None):
    await websocket.accept()
    
    db = next(get_db())
    svc = SSHService(db)
    conn = svc.get_connection(connection_id, user_id=1)
    
    if not conn:
        await websocket.send_json({"type": "error", "message": "Connection not found"})
        await websocket.close()
        return

    terminal = SSHTerminal(websocket, conn.__dict__)
    if not await terminal.connect():
        await websocket.close()
        return

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            
            if msg["type"] == "input":
                terminal.send_input(msg["data"])
            elif msg["type"] == "resize":
                terminal.resize(msg["cols"], msg["rows"])
                
    except WebSocketDisconnect:
        terminal.stop()
    except Exception as e:
        print(f"WS error: {e}")
        terminal.stop()


# ── Saved Commands ────────────────────────────────────────────────────────
@router.get("/commands", response_model=List[SSHCommandResponse])
def list_commands(db: Session = Depends(get_db)):
    svc = SSHService(db)
    return svc.get_saved_commands(user_id=1)


@router.post("/commands", response_model=SSHCommandResponse)
def create_command(data: SSHCommandCreate, db: Session = Depends(get_db)):
    svc = SSHService(db)
    return svc.create_command(user_id=1, data=data.dict())


@router.put("/commands/{command_id}", response_model=SSHCommandResponse)
def update_command(command_id: int, data: dict, db: Session = Depends(get_db)):
    svc = SSHService(db)
    updated = svc.update_command(command_id, user_id=1, data=data)
    if not updated:
        raise HTTPException(status_code=404, detail="Command not found")
    return updated


@router.delete("/commands/{command_id}")
def delete_command(command_id: int, db: Session = Depends(get_db)):
    svc = SSHService(db)
    if not svc.delete_command(command_id, user_id=1):
        raise HTTPException(status_code=404, detail="Command not found")
    return {"message": "Command deleted successfully"}
