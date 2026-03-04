import re

with open('api/index.py', 'r') as f:
    code = f.read()

# 1. Replace imports and supabase SDK with httpx
new_supabase_client = '''import httpx
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
'''

# Replace the old get_supabase definition
old_supabase = '''def get_supabase():
    try:
        from supabase import create_client, Client
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"Supabase SDK not available: {e}")
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(status_code=500, detail="Supabase not configured")
    return create_client(SUPABASE_URL, SUPABASE_KEY)'''

code = code.replace(old_supabase, new_supabase_client)

with open('api/index.py', 'w') as f:
    f.write(code)
    
print("Successfully mocked Supabase SDK with httpx")
