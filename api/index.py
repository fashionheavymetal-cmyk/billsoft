"""
BillSoft - Backend API
FastAPI application for billing software with Google Auth and Supabase.
Deployed as a Vercel Serverless Function.
"""

import os
import json
import requests as http_requests
from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from mangum import Mangum
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ============================================
# Configuration
# ============================================
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5500")

# ============================================
# Supabase Client
# ============================================
import httpx
from pydantic import BaseModel
from typing import Optional, List, Any, Dict

class SupabaseResponse:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count

class SupabaseQueryBuilder:
    def __init__(self, url, headers, table, action, method, data=None):
        self.url = f"{url}/{table}"
        self.headers = dict(headers)
        self.action = action
        self.method = method
        self.json_data = data
        self.params = {}
        
    def select(self, columns="*", count=None):
        self.params["select"] = columns
        if count == "exact":
            self.headers["Prefer"] = "count=exact"
        return self
        
    def insert(self, data):
        self.json_data = data
        self.headers["Prefer"] = "return=representation"
        return self
        
    def update(self, data):
        self.json_data = data
        self.headers["Prefer"] = "return=representation"
        return self
        
    def delete(self):
        self.headers["Prefer"] = "return=representation"
        return self
        
    def eq(self, column, value):
        self.params[column] = f"eq.{value}"
        return self
        
    def order(self, column, desc=False):
        dir_str = "desc" if desc else "asc"
        self.params["order"] = f"{column}.{dir_str}"
        return self
        
    def limit(self, count):
        self.params["limit"] = str(count)
        return self
        
    def execute(self):
        import asyncio
        # We need a synchronous execute for compatibility with existing code where supabase is used synchronously
        # Actually, all existing calls have 'await' if they were async, but the original code was synchronous!
        # Let's use httpx synchronous client
        with httpx.Client() as client:
            r = client.request(self.method, self.url, headers=self.headers, params=self.params, json=self.json_data)
            if r.status_code >= 400:
                print(f"Supabase Error: {r.text}")
                from fastapi import HTTPException
                raise HTTPException(status_code=500, detail="Database error")
                
            data = []
            try:
                data = r.json()
            except:
                pass
                
            count_val = None
            if self.headers.get("Prefer") == "count=exact":
                try:
                    rng = r.headers.get("content-range", "0-0/0")
                    count_val = int(rng.split("/")[-1])
                except:
                    count_val = 0
                    
            return SupabaseResponse(data, count_val)

class SupabaseTable:
    def __init__(self, url, headers, name):
        self.url = url
        self.headers = headers
        self.name = name
        
    def select(self, columns="*", count=None):
        return SupabaseQueryBuilder(self.url, self.headers, self.name, "select", "GET").select(columns, count)
        
    def insert(self, data):
        return SupabaseQueryBuilder(self.url, self.headers, self.name, "insert", "POST").insert(data)
        
    def update(self, data):
        return SupabaseQueryBuilder(self.url, self.headers, self.name, "update", "PATCH").update(data)
        
    def delete(self):
        return SupabaseQueryBuilder(self.url, self.headers, self.name, "delete", "DELETE").delete()

class SupabaseClient:
    def __init__(self, url, key):
        self.url = f"{url}/rest/v1"
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        }
        
    def table(self, name):
        return SupabaseTable(self.url, self.headers, name)

def get_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="Supabase not configured")
    return SupabaseClient(SUPABASE_URL, SUPABASE_KEY)


# ============================================
# FastAPI App
# ============================================
app = FastAPI(
    title="BillSoft API",
    description="Backend API for BillSoft Billing Software",
    version="1.0.0"
)

# CORS — use wildcard for Vercel serverless compatibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Explicit preflight handler — Vercel serverless may not forward OPTIONS to middleware
@app.options("/{path:path}")
async def preflight_handler(path: str):
    return JSONResponse(
        content="OK",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
    )

# ============================================
# Pydantic Models
# ============================================
class GoogleAuthRequest(BaseModel):
    token: str

class CustomerCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None

class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None

class ProductCreate(BaseModel):
    name: str
    description: Optional[str] = None
    price: float
    unit: Optional[str] = "piece"

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    unit: Optional[str] = None

class InvoiceItemCreate(BaseModel):
    product_id: Optional[str] = None
    description: str
    quantity: float = 1
    unit_price: float = 0

class InvoiceCreate(BaseModel):
    customer_id: Optional[str] = None
    invoice_number: str
    date: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = "draft"
    tax_rate: Optional[float] = 0
    discount: Optional[float] = 0
    notes: Optional[str] = None
    items: List[InvoiceItemCreate] = []

class InvoiceUpdate(BaseModel):
    customer_id: Optional[str] = None
    invoice_number: Optional[str] = None
    date: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None
    tax_rate: Optional[float] = None
    discount: Optional[float] = None
    notes: Optional[str] = None
    items: Optional[List[InvoiceItemCreate]] = None

# ============================================
# Auth Dependency
# ============================================
async def get_current_user(authorization: str = Header(None)):
    """Verify Google token and return user info.
    Supports both ID tokens (one-tap) and access tokens (OAuth popup).
    Also supports 'demo-token' for local development.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header missing")

    token = authorization.replace("Bearer ", "")

    # Demo mode bypass for local development
    if token == "demo-token":
        return {
            "google_id": "demo-user-id",
            "email": "demo@billsoft.app",
            "name": "Demo User",
            "avatar_url": ""
        }

    # Try 1: Verify as Google ID token (from one-tap / credential response)
    try:
        idinfo = id_token.verify_oauth2_token(
            token, google_requests.Request(), GOOGLE_CLIENT_ID
        )
        return {
            "google_id": idinfo["sub"],
            "email": idinfo["email"],
            "name": idinfo.get("name", ""),
            "avatar_url": idinfo.get("picture", "")
        }
    except Exception:
        pass  # Not an ID token, try as access token

    # Try 2: Use as OAuth access token (from popup flow)
    try:
        res = http_requests.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        if res.status_code == 200:
            userinfo = res.json()
            return {
                "google_id": userinfo["sub"],
                "email": userinfo["email"],
                "name": userinfo.get("name", ""),
                "avatar_url": userinfo.get("picture", "")
            }
    except Exception:
        pass

    raise HTTPException(status_code=401, detail="Invalid or expired token")


async def get_user_id(authorization: str = Header(None)):
    """Get user_id from database based on Google token."""
    user_info = await get_current_user(authorization)
    supabase = get_supabase()
    
    # Try to find user
    result = supabase.table("users").select("id").eq("google_id", user_info["google_id"]).execute()
    
    if result.data:
        return result.data[0]["id"]
    
    # Create user if not exists
    new_user = supabase.table("users").insert({
        "google_id": user_info["google_id"],
        "email": user_info["email"],
        "name": user_info["name"],
        "avatar_url": user_info["avatar_url"]
    }).execute()
    
    return new_user.data[0]["id"]


# ============================================
# API Routes - Health
# ============================================
@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "BillSoft API", "version": "1.0.0"}


# ============================================
# API Routes - Auth
# ============================================
@app.post("/api/auth/google")
async def google_auth(req: GoogleAuthRequest):
    """Authenticate with Google ID token, upsert user, return user data."""
    try:
        idinfo = id_token.verify_oauth2_token(
            req.token, google_requests.Request(), GOOGLE_CLIENT_ID
        )
        
        supabase = get_supabase()
        user_data = {
            "google_id": idinfo["sub"],
            "email": idinfo["email"],
            "name": idinfo.get("name", ""),
            "avatar_url": idinfo.get("picture", "")
        }
        
        # Check if user exists
        existing = supabase.table("users").select("*").eq("google_id", idinfo["sub"]).execute()
        
        if existing.data:
            # Update existing user
            user = supabase.table("users").update({
                "name": user_data["name"],
                "avatar_url": user_data["avatar_url"]
            }).eq("google_id", idinfo["sub"]).execute()
            user_record = user.data[0]
        else:
            # Insert new user
            user = supabase.table("users").insert(user_data).execute()
            user_record = user.data[0]
        
        return {
            "user": user_record,
            "token": req.token
        }
    except ValueError as e:
        raise HTTPException(status_code=401, detail=f"Invalid Google token: {str(e)}")


# ============================================
# API Routes - Customers
# ============================================
@app.get("/api/customers")
async def list_customers(user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    result = supabase.table("customers").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
    return {"data": result.data}


@app.post("/api/customers")
async def create_customer(customer: CustomerCreate, user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    data = customer.model_dump(exclude_none=True)
    data["user_id"] = user_id
    result = supabase.table("customers").insert(data).execute()
    return {"data": result.data[0]}


@app.get("/api/customers/{customer_id}")
async def get_customer(customer_id: str, user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    result = supabase.table("customers").select("*").eq("id", customer_id).eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {"data": result.data[0]}


@app.put("/api/customers/{customer_id}")
async def update_customer(customer_id: str, customer: CustomerUpdate, user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    data = customer.model_dump(exclude_none=True)
    result = supabase.table("customers").update(data).eq("id", customer_id).eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {"data": result.data[0]}


@app.delete("/api/customers/{customer_id}")
async def delete_customer(customer_id: str, user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    supabase.table("customers").delete().eq("id", customer_id).eq("user_id", user_id).execute()
    return {"message": "Customer deleted"}


# ============================================
# API Routes - Products
# ============================================
@app.get("/api/products")
async def list_products(user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    result = supabase.table("products").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
    return {"data": result.data}


@app.post("/api/products")
async def create_product(product: ProductCreate, user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    data = product.model_dump(exclude_none=True)
    data["user_id"] = user_id
    result = supabase.table("products").insert(data).execute()
    return {"data": result.data[0]}


@app.get("/api/products/{product_id}")
async def get_product(product_id: str, user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    result = supabase.table("products").select("*").eq("id", product_id).eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"data": result.data[0]}


@app.put("/api/products/{product_id}")
async def update_product(product_id: str, product: ProductUpdate, user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    data = product.model_dump(exclude_none=True)
    result = supabase.table("products").update(data).eq("id", product_id).eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"data": result.data[0]}


@app.delete("/api/products/{product_id}")
async def delete_product(product_id: str, user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    supabase.table("products").delete().eq("id", product_id).eq("user_id", user_id).execute()
    return {"message": "Product deleted"}


# ============================================
# API Routes - Invoices
# ============================================
@app.get("/api/invoices")
async def list_invoices(user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    result = supabase.table("invoices").select("*, customers(name, email)").eq("user_id", user_id).order("created_at", desc=True).execute()
    return {"data": result.data}


@app.post("/api/invoices")
async def create_invoice(invoice: InvoiceCreate, user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    
    # Calculate totals
    subtotal = sum(item.quantity * item.unit_price for item in invoice.items)
    tax_amount = subtotal * (invoice.tax_rate or 0) / 100
    discount = invoice.discount or 0
    total = subtotal + tax_amount - discount
    
    # Insert invoice
    invoice_data = {
        "user_id": user_id,
        "customer_id": invoice.customer_id,
        "invoice_number": invoice.invoice_number,
        "date": invoice.date or str(date.today()),
        "due_date": invoice.due_date,
        "status": invoice.status or "draft",
        "subtotal": float(subtotal),
        "tax_rate": float(invoice.tax_rate or 0),
        "tax_amount": float(tax_amount),
        "discount": float(discount),
        "total": float(total),
        "notes": invoice.notes
    }
    
    result = supabase.table("invoices").insert(invoice_data).execute()
    invoice_record = result.data[0]
    
    # Insert invoice items
    if invoice.items:
        items_data = []
        for item in invoice.items:
            items_data.append({
                "invoice_id": invoice_record["id"],
                "product_id": item.product_id,
                "description": item.description,
                "quantity": float(item.quantity),
                "unit_price": float(item.unit_price),
                "amount": float(item.quantity * item.unit_price)
            })
        supabase.table("invoice_items").insert(items_data).execute()
    
    return {"data": invoice_record}


@app.get("/api/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    result = supabase.table("invoices").select("*, customers(name, email, phone, address, city, state, zip_code)").eq("id", invoice_id).eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    # Get invoice items
    items = supabase.table("invoice_items").select("*, products(name)").eq("invoice_id", invoice_id).execute()
    
    invoice_data = result.data[0]
    invoice_data["items"] = items.data
    
    return {"data": invoice_data}


@app.put("/api/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, invoice: InvoiceUpdate, user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    
    update_data = invoice.model_dump(exclude_none=True, exclude={"items"})
    
    # If items are provided, recalculate totals
    if invoice.items is not None:
        subtotal = sum(item.quantity * item.unit_price for item in invoice.items)
        tax_rate = invoice.tax_rate if invoice.tax_rate is not None else 0
        
        # Get current tax_rate if not provided
        if invoice.tax_rate is None:
            current = supabase.table("invoices").select("tax_rate").eq("id", invoice_id).execute()
            if current.data:
                tax_rate = float(current.data[0]["tax_rate"])
        
        discount = invoice.discount if invoice.discount is not None else 0
        if invoice.discount is None:
            current = supabase.table("invoices").select("discount").eq("id", invoice_id).execute()
            if current.data:
                discount = float(current.data[0]["discount"])
        
        tax_amount = subtotal * tax_rate / 100
        total = subtotal + tax_amount - discount
        
        update_data["subtotal"] = float(subtotal)
        update_data["tax_amount"] = float(tax_amount)
        update_data["total"] = float(total)
        
        # Delete old items and insert new
        supabase.table("invoice_items").delete().eq("invoice_id", invoice_id).execute()
        items_data = []
        for item in invoice.items:
            items_data.append({
                "invoice_id": invoice_id,
                "product_id": item.product_id,
                "description": item.description,
                "quantity": float(item.quantity),
                "unit_price": float(item.unit_price),
                "amount": float(item.quantity * item.unit_price)
            })
        if items_data:
            supabase.table("invoice_items").insert(items_data).execute()
    
    if update_data:
        result = supabase.table("invoices").update(update_data).eq("id", invoice_id).eq("user_id", user_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Invoice not found")
        return {"data": result.data[0]}
    
    return {"message": "Invoice updated"}


@app.delete("/api/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    supabase.table("invoices").delete().eq("id", invoice_id).eq("user_id", user_id).execute()
    return {"message": "Invoice deleted"}


# ============================================
# API Routes - Dashboard
# ============================================
@app.get("/api/dashboard")
async def get_dashboard(user_id: str = Depends(get_user_id)):
    supabase = get_supabase()
    
    # Get all invoices
    invoices = supabase.table("invoices").select("total, status").eq("user_id", user_id).execute()
    
    total_revenue = sum(float(inv["total"]) for inv in invoices.data if inv["status"] == "paid")
    pending_amount = sum(float(inv["total"]) for inv in invoices.data if inv["status"] in ("sent", "draft"))
    overdue_amount = sum(float(inv["total"]) for inv in invoices.data if inv["status"] == "overdue")
    
    total_invoices = len(invoices.data)
    paid_count = sum(1 for inv in invoices.data if inv["status"] == "paid")
    pending_count = sum(1 for inv in invoices.data if inv["status"] in ("sent", "draft"))
    overdue_count = sum(1 for inv in invoices.data if inv["status"] == "overdue")
    
    # Get customer count
    customers = supabase.table("customers").select("id", count="exact").eq("user_id", user_id).execute()
    
    # Get product count
    products = supabase.table("products").select("id", count="exact").eq("user_id", user_id).execute()
    
    # Recent invoices
    recent = supabase.table("invoices").select("*, customers(name)").eq("user_id", user_id).order("created_at", desc=True).limit(5).execute()
    
    return {
        "data": {
            "total_revenue": total_revenue,
            "pending_amount": pending_amount,
            "overdue_amount": overdue_amount,
            "total_invoices": total_invoices,
            "paid_count": paid_count,
            "pending_count": pending_count,
            "overdue_count": overdue_count,
            "customer_count": customers.count if customers.count else 0,
            "product_count": products.count if products.count else 0,
            "recent_invoices": recent.data
        }
    }



