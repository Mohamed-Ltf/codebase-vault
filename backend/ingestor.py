import os
import shutil
import git
import uuid
import stat
import time
from cohere import Client
from pinecone import Pinecone

co = Client(os.getenv("COHERE_API_KEY"))
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
index = pc.Index(os.getenv("PINECONE_INDEX_NAME"))

def remove_readonly(func, path, excinfo):
    os.chmod(path, stat.S_IWRITE)
    func(path)

def ingest_repo(repo_url: str):
    temp_dir = f"./temp_{uuid.uuid4().hex}"
    repo = None  # Initialize to avoid UnboundLocalError if clone fails
    
    try:
        repo = git.Repo.clone_from(repo_url, temp_dir)
        
        extensions = ('.py', '.js', '.ts', '.md', '.java', '.html', '.css', '.json', '.cpp')
        documents = []

        for root, _, files in os.walk(temp_dir):
            for file in files:
                if file.endswith(extensions):
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, temp_dir)
                    
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        lines = f.readlines()
                        
                        # CHUNKING LOGIC: 
                        # We use a 50-line window with a 40-line stride.
                        # This creates a consistent 10-line overlap between chunks 
                        # to ensure context isn't lost at the boundaries.
                        for i in range(0, len(lines), 40):
                            chunk_lines = lines[i : i + 50]
                            content = "".join(chunk_lines)
                            
                            if content.strip():
                                documents.append({
                                    "id": str(uuid.uuid4()),
                                    "text": content,
                                    "metadata": {
                                        "path": rel_path,
                                        "line_start": i + 1,
                                        "repo_url": repo_url
                                    }
                                })

        if not documents:
            return 0

        # Batch Embedding with Cohere
        texts = [doc["text"] for doc in documents]
        embeddings = co.embed(
            texts=texts,
            model="embed-english-v3.0",
            input_type="search_document"
        ).embeddings

        # Prepare vectors
        to_upsert = []
        for doc, emb in zip(documents, embeddings):
            to_upsert.append({
                "id": doc["id"],
                "values": emb,
                "metadata": {**doc["metadata"], "text": doc["text"]}
            })
        
        # ACTUAL BATCHED UPSERT:
        # Pinecone handles payloads better in chunks of 100 to avoid gRPC size limits.
        for i in range(0, len(to_upsert), 100):
            batch = to_upsert[i : i + 100]
            index.upsert(vectors=batch)

    finally:
        # 1. Always release the git handle first if it was successfully created
        if repo:
            try:
                repo.close()
            except Exception as e:
                print(f"Warning: Could not close repo handle: {e}")
                
        # 2. Proceed with aggressive cleanup
        if os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir, onerror=remove_readonly)
            except Exception as e:
                print(f"Cleanup failed for {temp_dir}. Manual deletion required. Error: {e}")
    
    return len(documents)