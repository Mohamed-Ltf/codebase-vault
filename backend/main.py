import os
import json
from dotenv import load_dotenv

# 1. LOAD ENVIRONMENT VARIABLES FIRST
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from ingestor import ingest_repo, co, index

app = FastAPI()

# 2. CORS CONFIGURATION
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. DATA MODELS
class IngestRequest(BaseModel):
    url: str

class ChatRequest(BaseModel):
    message: str
    repo_url: str

class MapRequest(BaseModel):
    repo_url: str

# 4. ENDPOINTS

@app.post("/ingest")
async def handle_ingest(req: IngestRequest):
    try:
        count = ingest_repo(req.url)
        return {"status": "success", "chunks": count}
    except Exception as e:
        print(f"Ingestion Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat")
async def handle_chat(req: ChatRequest):
    try:
        query_emb = co.embed(
            texts=[req.message],
            model="embed-english-v3.0",
            input_type="search_query"
        ).embeddings[0]

        results = index.query(
            vector=query_emb, 
            top_k=5, 
            include_metadata=True,
            filter={"repo_url": {"$eq": req.repo_url}}
        )
        
        context = ""
        sources = []
        for res in results['matches']:
            meta = res['metadata']
            context += f"\nFile: {meta['path']} (Line {meta['line_start']})\nContent: {meta['text']}\n"
            sources.append({
                "path": meta['path'],
                "line": int(meta['line_start']),
                "text": meta['text']
            })

        prompt = f"""
        You are an expert software engineer assistant. Use the following code snippets (context) 
        to answer the user's question accurately. 
        
        Always cite the file path and line number in your answer when referencing specific code.
        Context:
        {context}
        
        Question: {req.message}
        """
        
        response = co.chat(
            model="command-a-03-2025",
            message=prompt
        )

        return {"answer": response.text, "sources": sources}
    except Exception as e:
        print(f"Chat Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/map")
async def handle_map(req: MapRequest):
    """
    Generates a JSON-based nodes & links structure for a force-directed graph.
    """
    try:
        results = index.query(
            vector=[0.0] * 1024, 
            top_k=50, 
            include_metadata=True,
            filter={"repo_url": {"$eq": req.repo_url}}
        )
        
        paths = list(set([res['metadata']['path'] for res in results['matches']]))
        context_paths = "\n".join(paths)

        prompt = f"""
        Analyze this codebase file list and generate a JSON representation of its architecture for a force-directed graph.
        
        RULES:
        1. Output ONLY valid JSON. No markdown, no backticks, no explanations.
        2. The JSON must have exactly two keys: "nodes" and "links".
        3. "nodes" is an array of objects: {{"id": "filename or concept", "group": "category_name"}}.
        4. "links" is an array of objects: {{"source": "parent_id", "target": "child_id"}}.
        5. Group files logically (e.g., "Backend", "Frontend", "Config", "Services"). Create parent concept nodes to connect related files together.
        6. Use only the base filename for leaf nodes, not the full path.

        Files:
        {context_paths}
        """
        
        response = co.chat(
            model="command-a-03-2025",
            message=prompt
        )
        
        raw_text = response.text.strip()
        if raw_text.startswith("```json"):
            raw_text = raw_text[7:-3].strip()
        elif raw_text.startswith("```"):
            raw_text = raw_text[3:-3].strip()

        graph_data = json.loads(raw_text)

        return {"map_data": graph_data}
    except Exception as e:
        print(f"Map Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# 5. STARTUP
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)