"use client";

import { useEffect, useState } from "react";
import { apiFetch, postJSON, setAuth, clearAuth, getUser } from "../lib/api";

const USERS = ["zack", "mary"];

export default function Home() {
  const [user, setUser] = useState(null);
  const [words, setWords] = useState([]);
  const [error, setError] = useState("");
  const [reqText, setReqText] = useState(""); // what we sent to OpenAI
  const [resText, setResText] = useState(""); // what OpenAI returned

  useEffect(() => {
    setUser(getUser());
  }, []);

  async function loginAs(name) {
    setError("");
    try {
      const data = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/auth/dev-login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name })
      }).then(r => r.json());

      if (data.access && data.user) {
        setAuth({ access: data.access, user: data.user });
        setUser(data.user);
        await ensureSeedWords();
        await loadWords();
      } else {
        setError("Login failed");
      }
    } catch (e) {
      setError(e.message);
    }
  }

  async function ensureSeedWords() {
    try {
      const list = await apiFetch("/words/");
      if (list.length === 0) {
        const seed = ["fare", "andare", "parlare", "avere"];
        for (const lemma of seed) {
          await apiFetch("/words/", {
            method: "POST",
            body: JSON.stringify({
              text: lemma,
              pos: "verb",
              features: {
                tenses: ["presente"],
                persons: ["1s", "2s", "3s", "1p", "2p", "3p"]
              }
            })
          });
        }
      }
    } catch {
      // ignore
    }
  }

  async function loadWords() {
    try {
      const data = await apiFetch("/words/");
      setWords(data);
    } catch (e) {
      setError(e.message);
    }
  }

  async function logout() {
    clearAuth();
    setUser(null);
    setWords([]);
    setReqText("");
    setResText("");
  }

  async function getNextSpec() {
    try {
      const spec = await apiFetch("/practice/next-spec/");
      const englishHint = `Produce Italian sentence for ${spec.lemma} (${spec.pos}) → ${spec.person || "3s"}, ${spec.tense || "presente"}. Return JSON {"it","en"}.`;
      setReqText(JSON.stringify({ spec, builtPrompt: englishHint }, null, 2));
      // call backend OpenAI endpoint
      await callOpenAIFromSpec(spec);
    } catch (e) {
      setError(e.message);
    }
  }

  async function callOpenAIFromSpec(spec) {
    try {
      const data = await postJSON("/llm/generate/", { spec });
      // show exactly what we sent and received
      setReqText(JSON.stringify(data.sent, null, 2));
      setResText(JSON.stringify({ response: data.response, json: data.json, usage: data.usage }, null, 2));
    } catch (e) {
      setResText("");
      setError(e.message);
    }
  }

  function isLoggedIn() {
    return !!user;
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-6">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Caligula</h1>
          <div>
            {isLoggedIn() ? (
              <div className="flex items-center gap-3">
                <span className="text-sm">Logged in as <b>{user.username}</b></span>
                <button onClick={logout} className="px-3 py-1 rounded-md bg-gray-200 hover:bg-gray-300">Logout</button>
              </div>
            ) : (
              <div className="flex gap-2">
                {USERS.map(u => (
                  <button
                    key={u}
                    onClick={() => loginAs(u)}
                    className="px-3 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                  >
                    {u}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        {error && <div className="mb-4 text-red-600">{error}</div>}

        {!isLoggedIn() ? (
          <p className="text-sm text-slate-600">
            Choose a user to log in (dev mode, no password). Refresh persists via localStorage.
          </p>
        ) : (
          <>
            <section className="mb-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Your Words</h2>
                <button onClick={loadWords} className="px-3 py-1 rounded-md bg-gray-200 hover:bg-gray-300">
                  Refresh
                </button>
              </div>
              <ul className="mt-3 divide-y divide-gray-200 bg-white rounded-lg shadow">
                {words.map(({ id, word, miss_count, hit_count }) => (
                  <li key={id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="font-medium">
                        {word.text} <span className="text-xs text-slate-500">({word.pos})</span>
                      </div>
                      <div className="text-xs text-slate-500">miss:{miss_count} · hit:{hit_count}</div>
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(word.created_at).toLocaleString()}
                    </div>
                  </li>
                ))}
                {words.length === 0 && (
                  <li className="px-4 py-3 text-slate-500">No words yet.</li>
                )}
              </ul>
            </section>

            <section className="mb-6">
              <h2 className="text-xl font-semibold mb-2">OpenAI Test (dev)</h2>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={getNextSpec}
                  className="px-3 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  Get next prompt spec
                </button>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-white p-3 rounded-lg shadow">
                  <div className="text-sm font-medium mb-1">Request we sent</div>
                  <pre className="text-xs whitespace-pre-wrap">{reqText || "—"}</pre>
                </div>
                <div className="bg-white p-3 rounded-lg shadow">
                  <div className="text-sm font-medium mb-1">Response we got</div>
                  <pre className="text-xs whitespace-pre-wrap">{resText || "—"}</pre>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}