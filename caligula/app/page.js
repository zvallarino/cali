"use client";

import { useEffect, useState, useRef } from "react";
import { apiFetch, postJSON, setAuth, clearAuth, getUser } from "../lib/api";
import { FaVolumeHigh, FaCheck } from "react-icons/fa6"; // Added FaCheck

const USERS = ["zack", "mary"];

export default function Home() {
  const [user, setUser] = useState(null);
  const [words, setWords] = useState([]);
  const [error, setError] = useState("");
  
  // Practice Queue
  const [queue, setQueue] = useState([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("idle"); 
  const [isLoading, setIsLoading] = useState(false);
  const [isAddingWords, setIsAddingWords] = useState(false); // Loading state for "Add Words"

  // Modals
  const [newWordsModal, setNewWordsModal] = useState(null); // Array of strings or null

  // Debug State
  const [debugLog, setDebugLog] = useState(null);
  
  // Filters
  const [tenses, setTenses] = useState({ 
    presente: true, 
    passato_prossimo: false,
    imperfetto: false,
    futuro: false
  });
  
  const inputRef = useRef(null);
  const practiceItem = queue.length > 0 ? queue[0] : null;

  useEffect(() => {
    setUser(getUser());
  }, []);

  useEffect(() => {
    if (user) loadWords();
  }, [user]);

  useEffect(() => {
    if (practiceItem && status === "idle") {
        inputRef.current?.focus();
    }
  }, [practiceItem, status]);

  // --- Actions ---

  async function loginAs(name) {
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000/api";
      const data = await fetch(`${API_BASE}/auth/dev-login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name })
      }).then(r => r.json());

      if (data.access) {
        setAuth({ access: data.access, user: data.user });
        setUser(data.user);
      }
    } catch (e) { setError(e.message); }
  }

  async function loadWords() {
    try {
      const data = await apiFetch("/words/");
      setWords(data);
    } catch (e) { setError(e.message); }
  }

  async function fetchNextBatch() {
    const activeTenses = Object.keys(tenses).filter(k => tenses[k]);
    if (activeTenses.length === 0) {
      setError("Please select at least one tense.");
      return;
    }

    setIsLoading(true);
    setError("");
    setDebugLog(null);
    
    try {
      const tensesParam = activeTenses.join(",");
      const specs = await apiFetch(`/practice/batch-specs/?tenses=${tensesParam}`);
      const data = await postJSON("/llm/generate/", { specs });
      
      setDebugLog({
        requestedTenses: tensesParam,
        specsReceived: specs,
        llmResponse: data
      });
      
      if (data.json && data.json.sentences) {
        const newItems = data.json.sentences.map(sent => {
            const originalSpec = specs.find(s => s.id === sent.id); 
            return { spec: originalSpec, it: sent.it, en: sent.en };
        });
        setQueue(newItems);
      }
    } catch (e) { setError(e.message); } 
    finally { setIsLoading(false); }
  }

  async function checkAnswer() {
    if (!practiceItem || status !== "idle") return;

    const cleanInput = input.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g,"").trim().toLowerCase();
    const cleanTarget = practiceItem.it.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g,"").trim().toLowerCase();
    const isCorrect = cleanInput === cleanTarget;
    
    setStatus(isCorrect ? "correct" : "incorrect");

    await apiFetch(`/words/${practiceItem.spec.id}/score/`, { 
      method: "POST",
      body: JSON.stringify({ 
        tense: practiceItem.spec.tense, 
        correct: isCorrect 
      })
    });
    loadWords(); 
  }

  function handleNext() {
    setQueue(prev => prev.slice(1));
    setStatus("idle");
    setInput("");
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      status === "idle" ? checkAnswer() : handleNext();
    }
  }

  // --- Helpers ---

  async function addWords() {
    setIsAddingWords(true);
    try {
        const res = await postJSON("/words/add-new/");
        if (res.new_words && res.new_words.length > 0) {
            setNewWordsModal(res.new_words);
            loadWords();
        } else {
            // Just in case AI returns duplicates or nothing
            setError("AI couldn't find unique words this time. Try again!");
        }
    } catch(e) {
        setError(e.message);
    } finally {
        setIsAddingWords(false);
    }
  }

  async function resetStats() {
    if(!confirm("Reset all scores?")) return;
    await postJSON("/words/reset-stats/");
    loadWords();
  }

  function getStatBadge(stats, tense) {
    const s = stats?.[tense] || { hits: 0, misses: 0 };
    if (s.hits === 0 && s.misses === 0) return null;
    const labels = {
      presente: "Pres",
      passato_prossimo: "Past",
      imperfetto: "Imp",
      futuro: "Fut"
    };
    return (
      <span className="text-[10px] bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-slate-500 ml-2">
        {labels[tense] || tense}: <span className="text-emerald-600">{s.hits}</span>/<span className="text-red-500">{s.misses}</span>
      </span>
    );
  }

  function TenseCheckbox({ label, id, checked, onChange }) {
    return (
      <label className={`flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-lg border transition-colors ${checked ? 'bg-blue-50 border-blue-200' : 'border-slate-200 hover:border-blue-300'}`}>
        <input type="checkbox" checked={checked} onChange={onChange} className="w-4 h-4 accent-blue-600" />
        <span className={`text-sm font-medium ${checked ? 'text-blue-800' : 'text-slate-600'}`}>{label}</span>
      </label>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-3xl font-bold mb-8 text-slate-800">Caligula</h1>
          <div className="flex gap-3 justify-center">
             {USERS.map(u => (
                <button key={u} onClick={() => loginAs(u)} className="px-6 py-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium transition-all">
                  Login as {u}
                </button>
             ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8 font-sans relative">
      
      {/* --- MODAL: New Words Added --- */}
      {newWordsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full m-4 transform transition-all scale-100">
             <div className="text-center mb-6">
                <div className="mx-auto bg-emerald-100 w-12 h-12 rounded-full flex items-center justify-center text-emerald-600 mb-3">
                    <FaCheck size={20} />
                </div>
                <h3 className="text-xl font-bold text-slate-800">Vocabulary Expanded!</h3>
                <p className="text-sm text-slate-500">Added {newWordsModal.length} new verbs to your list.</p>
             </div>
             
             <ul className="space-y-2 mb-6">
               {newWordsModal.map(word => (
                 <li key={word} className="flex items-center justify-between px-4 py-3 bg-slate-50 rounded-xl border border-slate-100">
                   <span className="font-medium text-slate-700 capitalize text-lg">{word}</span>
                   <FaCheck className="text-emerald-500" />
                 </li>
               ))}
             </ul>
             
             <button 
               onClick={() => setNewWordsModal(null)}
               className="w-full py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-all shadow-lg"
             >
               Continue Learning
             </button>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto grid md:grid-cols-[1fr_320px] gap-8">
        
        {/* LEFT COLUMN: Practice */}
        <section className="flex flex-col gap-6">
           <header className="flex items-center justify-between">
              <h1 className="text-2xl font-bold tracking-tight text-slate-800">Practice Arena</h1>
              <button onClick={() => { clearAuth(); setUser(null); }} className="text-sm text-slate-400 hover:text-slate-600">Logout</button>
           </header>

           {error && <div className="p-4 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">{error}</div>}

           <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 min-h-[400px] flex flex-col justify-center relative overflow-hidden">
              {!practiceItem ? (
                <div className="text-center z-10">
                  <h2 className="text-xl font-semibold text-slate-700 mb-6">Configure Session</h2>
                  
                  <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto mb-8 text-left">
                    <TenseCheckbox label="Presente" checked={tenses.presente} onChange={e => setTenses({...tenses, presente: e.target.checked})} />
                    <TenseCheckbox label="Passato Prossimo" checked={tenses.passato_prossimo} onChange={e => setTenses({...tenses, passato_prossimo: e.target.checked})} />
                    <TenseCheckbox label="Imperfetto" checked={tenses.imperfetto} onChange={e => setTenses({...tenses, imperfetto: e.target.checked})} />
                    <TenseCheckbox label="Futuro Semplice" checked={tenses.futuro} onChange={e => setTenses({...tenses, futuro: e.target.checked})} />
                  </div>

                  <button 
                    onClick={fetchNextBatch}
                    disabled={isLoading}
                    className="px-8 py-3 rounded-full bg-slate-900 text-white text-lg font-medium hover:bg-slate-800 transition-all shadow-lg disabled:opacity-70"
                  >
                    {isLoading ? "Generating 20 Sentences..." : "Start Batch (20)"}
                  </button>
                </div>
              ) : (
                <div className="max-w-xl mx-auto w-full z-10">
                  <div className="mb-8">
                    <div className="flex justify-between items-end mb-2">
                        <span className="text-xs font-bold text-blue-600 uppercase tracking-wider bg-blue-50 px-2 py-1 rounded">Translate to Italian</span>
                        <span className="text-xs text-slate-300 font-mono">{queue.length} left</span>
                    </div>
                    <div className="text-3xl md:text-4xl font-medium text-slate-800 leading-tight">
                      {practiceItem.en}
                    </div>
                    <div className="mt-4 flex gap-2 text-sm text-slate-500">
                       <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-700 border border-slate-200">{practiceItem.spec.lemma}</span>
                       <span>→</span>
                       <span className="italic">{practiceItem.spec.person}, {practiceItem.spec.tense.replace("_", " ")}</span>
                    </div>
                  </div>

                  <div className="relative">
                    <input
                      ref={inputRef}
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      readOnly={status !== "idle"}
                      autoFocus
                      className={`w-full text-xl px-5 py-4 rounded-xl border-2 outline-none transition-all shadow-sm
                        ${status === 'idle' ? 'border-slate-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10' : ''}
                        ${status === 'correct' ? 'border-emerald-500 bg-emerald-50 text-emerald-900' : ''}
                        ${status === 'incorrect' ? 'border-red-500 bg-red-50 text-red-900' : ''}
                        ${status !== 'idle' ? 'cursor-not-allowed opacity-90' : ''}
                      `}
                    />
                    
                    <div className="mt-4 min-h-[48px] flex items-center justify-between">
                         <div className="flex items-center gap-3">
                           {status !== "idle" && (
                             <>
                               <button className="p-3 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                                 <FaVolumeHigh size={20} />
                               </button>
                               <span className={`text-lg font-bold ${status === 'correct' ? 'text-emerald-600' : 'text-red-600'}`}>
                                 {practiceItem.it}
                               </span>
                             </>
                           )}
                         </div>
                         
                         <div>
                          {status === "idle" ? (
                            <button onClick={checkAnswer} className="px-6 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 font-medium transition-colors">
                              Check
                            </button>
                          ) : (
                            <button onClick={handleNext} className="px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm font-medium transition-colors">
                              Next
                            </button>
                          )}
                        </div>
                    </div>
                  </div>
                </div>
              )}
           </div>

           {/* Debug Panel */}
           {/* {debugLog && (
             <div className="bg-slate-100 p-4 rounded-xl text-xs font-mono text-slate-600 overflow-x-auto border border-slate-300">
               <div className="font-bold mb-2 text-slate-800 border-b border-slate-300 pb-1">DEBUG LOG</div>
               <div className="mb-4">
                 <span className="font-semibold text-blue-600">1. Filter Sent:</span> {debugLog.requestedTenses}
               </div>
               <div className="mb-4">
                 <span className="font-semibold text-blue-600">2. Specs Received (First 3):</span>
                 <pre className="mt-1 bg-white p-2 rounded border border-slate-200">
                   {JSON.stringify(debugLog.specsReceived.slice(0, 3), null, 2)}
                   {debugLog.specsReceived.length > 3 && "\n... (more)"}
                 </pre>
               </div>
               <div>
                 <span className="font-semibold text-blue-600">3. Prompt Sent:</span>
                 <pre className="mt-1 bg-white p-2 rounded border border-slate-200">
                   {JSON.stringify(debugLog.llmResponse.sent, null, 2)}
                 </pre>
               </div>
             </div>
           )} */}
        </section>

        {/* RIGHT COLUMN: Tools & Stats */}
        <section className="flex flex-col gap-6">
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Library Tools</h3>
                <div className="flex flex-col gap-2">
                    <button 
                        onClick={addWords} 
                        disabled={isAddingWords}
                        className="w-full py-2 px-4 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 text-sm font-medium transition-all text-left flex justify-between disabled:opacity-50 disabled:cursor-wait"
                    >
                        <span>{isAddingWords ? "AI is thinking..." : "Add 5 New Verbs"}</span>
                        <span>{isAddingWords ? "..." : "+"}</span>
                    </button>
                    <button onClick={resetStats} className="w-full py-2 px-4 rounded-lg border border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-sm font-medium transition-all text-left flex justify-between">
                        <span>Reset Scores</span>
                        <span>↺</span>
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 overflow-hidden flex flex-col">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">My Words ({words.length})</h3>
                </div>
                <div className="overflow-y-auto flex-1 p-2">
                   {words.map(({ id, word, stats }) => (
                      <div key={id} className="px-3 py-3 hover:bg-slate-50 rounded-lg transition-colors mb-1">
                        <div className="flex justify-between items-baseline">
                          <span className="font-medium text-slate-700">{word.text}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-y-1">
                           {getStatBadge(stats, "presente")}
                           {getStatBadge(stats, "passato_prossimo")}
                           {getStatBadge(stats, "imperfetto")}
                           {getStatBadge(stats, "futuro")}
                           {(!stats || Object.keys(stats).length === 0) && <span className="text-[10px] text-slate-300 ml-2">No stats</span>}
                        </div>
                      </div>
                   ))}
                </div>
            </div>
        </section>

      </div>
    </main>
  );
}