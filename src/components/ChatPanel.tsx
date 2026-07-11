import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { errMsg } from "../utils";
import { info, error } from "../log";

interface Msg {
  role: "user" | "assistant";
  text: string;
}

interface AskResult {
  answer: string;
  page: number | null;
}

export function ChatPanel({ onNavigate }: { onNavigate?: (page: number) => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const question = input.trim();
    if (!question || busy) return;
    info(`Ask: ${question}`);
    setInput("");
    setMessages((m) => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      const res = await invoke<AskResult>("ask", { question });
      setMessages((m) => [...m, { role: "assistant", text: res.answer }]);
      if (res.page != null) onNavigate?.(res.page);
    } catch (e) {
      const m = errMsg(e);
      error(`Ask failed: ${m}`);
       setMessages((m) => [...m, { role: "assistant", text: `Error: ${m}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-3 space-y-3" role="log" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-xs text-gray-500">Ask a question about your documents.</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-sm rounded-lg px-3 py-2 ${
              m.role === "user"
                ? "bg-blue-50 text-blue-900 ml-6"
                : m.text.startsWith("Error:")
                  ? "bg-error-bg text-error mr-6 whitespace-pre-wrap"
                  : "bg-gray-100 text-gray-800 mr-6 whitespace-pre-wrap"
            }`}
          >
            {m.text}
          </div>
        ))}
        {busy && <div className="text-xs text-gray-500" role="status">Thinking…</div>}
      </div>
      <div className="p-3 border-t border-gray-200">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask…"
            rows={2}
            className="flex-1 text-sm border border-gray-300 rounded-md p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            onClick={send}
            disabled={busy}
            className="self-end rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
