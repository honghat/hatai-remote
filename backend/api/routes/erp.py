"""
ERP Module Routes — Sales, Purchase, Inventory, Production, HR
"""
from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.security import get_current_user
from db.psql.session import get_db

router = APIRouter()

@router.get("/stats", tags=["ERP"])
async def get_erp_stats(
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get high-level ERP statistics."""
    # Placeholder for actual data retrieval
    return {
        "orders_month": 0,
        "revenue": 0,
        "products_count": 0,
        "growth": 0
    }

@router.get("/modules", tags=["ERP"])
async def list_modules(
    user_id: int = Depends(get_current_user)
):
    """List available ERP sub-modules and their status."""
    return [
        {"key": "sales", "label": "Bán hàng", "status": "coming"},
        {"key": "purchase", "label": "Mua hàng", "status": "coming"},
        {"key": "inventory", "label": "Kho", "status": "coming"},
        {"key": "production", "label": "Sản xuất", "status": "coming"},
        {"key": "hr", "label": "Nhân sự", "status": "coming"},
    ]
