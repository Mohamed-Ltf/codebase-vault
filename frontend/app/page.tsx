"use client";

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { 
  Send, 
  Database, 
  Code, 
  Folder, 
  ArrowLeft, 
  Layout, 
  MessageSquare, 
  GitFork 
} from 'lucide-react';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { 
  ssr: false,
  loading: () => <div className="p-8 text-zinc-400 animate-pulse font-medium">Loading physics engine...</div>
});

const CATEGORY_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', 
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
];

export default function Home() {
  // State Management
  const [repoUrl, setRepoUrl] = useState('');
  const [indexedRepos, setIndexedRepos] = useState<{url: string, name: string}[]>([]);
  const [activeRepo, setActiveRepo] = useState<{url: string, name: string} | null>(null);
  const [view, setView] = useState<'chat' | 'map'>('chat');
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState<{role: string, text: string, sources?: any[]}[]>([]);
  const [mapData, setMapData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Responsive Graph State
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphDim, setGraphDim] = useState({ width: 800, height: 600 });

  // 1. REFRESH DIMENSIONS: ResizeObserver ensures the canvas fits any screen size
  useEffect(() => {
    if (!containerRef.current || view !== 'map') return;

    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setGraphDim({ width, height });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [view]);

  // Persistence
  useEffect(() => {
    const saved = localStorage.getItem('cohere_codebot_repos');
    if (saved) {
      try { setIndexedRepos(JSON.parse(saved)); } catch (e) { console.error("Cache load failed"); }
    }
  }, []);

  // Helpers
  const uniqueGroups = mapData?.nodes 
    ? Array.from(new Set(mapData.nodes.map((n: any) => String(n.group)))) 
    : [];

  const getNodeColor = (group: string) => {
    const idx = uniqueGroups.indexOf(group);
    return CATEGORY_COLORS[idx % CATEGORY_COLORS.length] || '#9ca3af';
  };

  const handleIngest = async () => {
    if (!repoUrl) return;
    let cleanUrl = repoUrl.trim();
    if (cleanUrl.includes('https://') && cleanUrl.lastIndexOf('https://') > 0) {
      cleanUrl = cleanUrl.substring(0, cleanUrl.lastIndexOf('https://'));
    }

    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanUrl })
      });
      if (res.ok) {
        const repoName = cleanUrl.split('/').filter(Boolean).pop() || 'Repository';
        const newList = [...indexedRepos, { url: cleanUrl, name: repoName }];
        setIndexedRepos(newList);
        localStorage.setItem('cohere_codebot_repos', JSON.stringify(newList));
        setRepoUrl('');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChat = async () => {
    if (!message || !activeRepo) return;
    setLoading(true);
    const userMsg = { role: 'user', text: message };
    setChat(prev => [...prev, userMsg]);
    
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, repo_url: activeRepo.url })
      });
      const data = await res.json();
      setChat(prev => [...prev, { role: 'bot', text: data.answer, sources: data.sources }]);
    } finally {
      setMessage('');
      setLoading(false);
    }
  };

  const fetchMap = async () => {
    if (!activeRepo) return;
    if (mapData && view === 'map') return; 
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: activeRepo.url })
      });
      const data = await res.json();
      setMapData(data.map_data);
      setView('map');
    } finally {
      setLoading(false);
    }
  };

  if (!activeRepo) {
    return (
      <div className="min-h-screen bg-zinc-50 p-8 font-sans selection:bg-zinc-200">
        <div className="max-w-5xl mx-auto">
          <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-12 gap-6">
            <div>
              <h1 className="font-bold text-3xl flex items-center gap-3 text-zinc-900">
                <Code size={36} /> Codebase Vault
              </h1>
              <p className="text-zinc-500 mt-1">Select a technical context to begin analysis.</p>
            </div>
            <div className="flex gap-2 w-full md:w-auto">
              <input 
                className="flex-1 md:w-80 border border-zinc-200 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-zinc-200 bg-white shadow-sm"
                placeholder="GitHub Repo URL"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
              <button 
                onClick={handleIngest}
                disabled={loading}
                className="bg-zinc-900 text-white px-6 py-2 rounded-lg font-semibold hover:bg-zinc-800 disabled:opacity-50 flex items-center gap-2"
              >
                <Database size={18} /> {loading ? 'Indexing...' : 'Index'}
              </button>
            </div>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {indexedRepos.map((repo, i) => (
              <div 
                key={i}
                onClick={() => setActiveRepo(repo)}
                className="bg-white border border-zinc-200 rounded-2xl p-6 cursor-pointer hover:border-zinc-900 transition-all group shadow-sm"
              >
                <div className="bg-zinc-50 w-12 h-12 rounded-xl flex items-center justify-center mb-4 text-zinc-500 group-hover:bg-zinc-900 group-hover:text-white transition-all">
                  <Folder size={24} />
                </div>
                <h3 className="font-bold text-xl text-zinc-900 truncate">{repo.name}</h3>
                <p className="text-zinc-400 text-xs truncate font-mono mt-1">{repo.url}</p>
              </div>
            ))}
            {indexedRepos.length === 0 && (
              <div className="col-span-full py-20 border-2 border-dashed border-zinc-200 rounded-2xl text-center text-zinc-400 font-medium">
                No repositories indexed yet.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white text-zinc-900 font-sans selection:bg-zinc-100">
      <header className="border-b border-zinc-100 p-4 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => {setActiveRepo(null); setChat([]); setView('chat'); setMapData(null);}} 
            className="p-2 hover:bg-zinc-100 rounded-full"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="font-bold text-lg leading-none">{activeRepo.name}</h1>
            <p className="text-[10px] text-zinc-400 uppercase tracking-tighter mt-1 font-mono">{activeRepo.url}</p>
          </div>
        </div>
        
        <div className="bg-zinc-100 p-1 rounded-xl flex gap-1">
          <button onClick={() => setView('chat')} className={`px-4 py-1.5 text-xs rounded-lg font-bold flex items-center gap-2 ${view === 'chat' ? 'bg-white shadow-sm' : 'text-zinc-500'}`}>
            <MessageSquare size={14} /> Discussion
          </button>
          <button onClick={fetchMap} className={`px-4 py-1.5 text-xs rounded-lg font-bold flex items-center gap-2 ${view === 'map' ? 'bg-white shadow-sm' : 'text-zinc-500'}`}>
            <Layout size={14} /> Graph View
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden relative bg-zinc-50/30">
        {view === 'chat' ? (
          <div className="p-6 space-y-6 max-w-4xl mx-auto pb-32 h-full overflow-y-auto">
            {chat.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-4 rounded-2xl border ${m.role === 'user' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-100'}`}>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div ref={containerRef} className="absolute inset-0 flex flex-col items-center justify-center bg-white border border-zinc-200 rounded-xl m-6 overflow-hidden shadow-inner relative">
            {loading && !mapData ? (
              <div className="m-auto text-zinc-400 flex flex-col items-center gap-3 animate-pulse">
                <Database size={32} className="animate-spin" />
                <p className="font-medium">Synthesizing Architecture...</p>
              </div>
            ) : mapData ? (
              <>
                <ForceGraph2D
                  graphData={mapData}
                  width={graphDim.width}
                  height={graphDim.height}
                  nodeLabel=""
                  linkDirectionalParticles={2}
                  linkDirectionalParticleSpeed={0.005}
                  backgroundColor="#ffffff"
                  nodeCanvasObject={(node: any, ctx: any, globalScale: number) => {
                    const label = node.id;
                    const fontSize = 12 / globalScale;
                    ctx.font = `${fontSize}px Sans-Serif`;
                    const color = getNodeColor(String(node.group));

                    ctx.beginPath();
                    ctx.arc(node.x, node.y, 5, 0, 2 * Math.PI, false);
                    ctx.fillStyle = color;
                    ctx.fill();

                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillStyle = '#3f3f46';
                    ctx.fillText(label, node.x, node.y + 7);
                  }}
                />
                
                <div className="absolute top-4 right-4 bg-white/95 p-4 rounded-xl shadow-md border border-zinc-100 z-10 min-w-[150px]">
                  <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-3 border-b pb-2">Legend</h3>
                  <div className="space-y-2">
                    {uniqueGroups.map((group, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: getNodeColor(group as string) }}></span>
                        <span className="text-xs text-zinc-700 font-medium capitalize">{group as string}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>

      {view === 'chat' && (
        <footer className="p-6 bg-white border-t border-zinc-100">
          <div className="max-w-3xl mx-auto relative">
            <input 
              className="w-full border border-zinc-200 rounded-2xl px-6 py-4 pr-16 outline-none focus:ring-2 focus:ring-zinc-100 text-sm"
              placeholder={`Query ${activeRepo.name}...`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleChat()}
              disabled={loading}
            />
            <button 
              onClick={handleChat} 
              disabled={loading} 
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-zinc-900 text-white p-2.5 rounded-xl hover:bg-zinc-800 disabled:opacity-50"
            >
              <Send size={20} />
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}