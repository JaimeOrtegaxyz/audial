"use client";

import { useState, useRef, useEffect, useCallback, useSyncExternalStore, useMemo } from "react";
import type { StrudelAdapter, StrudelError } from "./StrudelHost";
import { parseClaudeOutput, isCodeUnchanged } from "@/lib/parseOutput";
import {
  getSessionStore,
  DEFAULT_CODE,
} from "@/lib/sessionStore";
import { getProviderForModel } from "./SettingsModal";
import type { Settings } from "./SettingsModal";

// format strudel errors for display with line info
function formatStrudelError(err: unknown): string {
  if (!err) return "unknown error";

  let message = "";
  
  // check if it's a strudel error with line info
  if (err && typeof err === "object" && "line" in err) {
    const se = err as StrudelError;
    message = se.message || "strudel error";
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }

  // Clean up the error message for better readability
  // Extract the core parse error message
  if (message.includes("[mini] parse error")) {
    // Format: "[mini] parse error at line X: Expected ... but "Y" found."
    const match = message.match(/\[mini\] parse error at line (\d+): (.+)/);
    if (match) {
      return `parse error at line ${match[1]}: ${match[2]}`;
    }
  }
  
  // Remove redundant prefixes
  message = message.replace(/^strudel error: /i, "");
  
  return message;
}

interface ClaudePanelProps {
  strudelAdapter: StrudelAdapter | null;
  isMobile?: boolean;
  settings?: Settings;
  onInfoClick?: () => void;
}

// quick action presets
const QUICK_ACTIONS = [
  { label: "darker", prompt: "make it darker and moodier" },
  { label: "+drums", prompt: "add more interesting drums" },
  { label: "faster", prompt: "increase the tempo and energy" },
  { label: "slower", prompt: "slow it down, more ambient" },
  { label: "+bass", prompt: "add a heavier bassline" },
  { label: "minimal", prompt: "strip it down to essentials" },
];

type PanelTab = "chat" | "saved";

interface SavedSong {
  id: string;
  filename: string;
  name: string;
  createdAt: string;
  prompt: string | null;
  code: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatSongTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  return `${year}${month}${day}-${hours}${minutes}`;
}

function extractNameFromPrompt(prompt?: string): string | null {
  if (!prompt) return null;
  const cleaned = prompt.replace(/[^a-zA-Z0-9 ]+/g, " ").trim();
  if (cleaned.length < 3) return null;
  return cleaned.length > 40 ? cleaned.slice(0, 40).trim() : cleaned;
}

function formatSongDateLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export default function ClaudePanel({ strudelAdapter, isMobile = false, settings, onInfoClick }: ClaudePanelProps) {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rawErrorResponse, setRawErrorResponse] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>("chat");
  const [savedSongs, setSavedSongs] = useState<SavedSong[]>([]);
  const [isLoadingSongs, setIsLoadingSongs] = useState(false);
  const [isSavingSong, setIsSavingSong] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState("");
  const [saveSuggestedName, setSaveSuggestedName] = useState("");
  const [pendingSaveCode, setPendingSaveCode] = useState<string | null>(null);
  const accumulatedTextRef = useRef<string>("");
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const saveNameInputRef = useRef<HTMLInputElement>(null);

  // session store subscription using useSyncExternalStore
  const store = getSessionStore();
  const sessionState = useSyncExternalStore(
    store.subscribe.bind(store),
    store.getState.bind(store),
    store.getState.bind(store)
  );

  const currentSession = sessionState.currentSession;
  // memoize to prevent useEffect dependency changes on every render
  const chatMessages = useMemo(() => currentSession?.chat || [], [currentSession?.chat]);
  const lastUserPrompt = useMemo(() => {
    for (let i = chatMessages.length - 1; i >= 0; i -= 1) {
      if (chatMessages[i].role === "user") {
        return chatMessages[i].content;
      }
    }
    return "";
  }, [chatMessages]);

  // initialize session on mount
  useEffect(() => {
    if (!currentSession) {
      store.ensureSession();
    }
  }, [currentSession, store]);

  // sync editor code to session when adapter is ready
  useEffect(() => {
    if (strudelAdapter && currentSession?.currentCode) {
      const editorCode = strudelAdapter.getCode();
      // only sync if editor has default code and session has different code
      if (editorCode === DEFAULT_CODE && currentSession.currentCode !== DEFAULT_CODE) {
        strudelAdapter.setCode(currentSession.currentCode);
      }
    }
  }, [strudelAdapter, currentSession?.currentCode]);

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;

    setError(null);
    setRawErrorResponse(null);
    setIsGenerating(true);
    accumulatedTextRef.current = "";

    const userPrompt = prompt.trim();
    setPrompt("");

    // get current code from editor
    const currentCode = strudelAdapter ? strudelAdapter.getCode() : undefined;

    // add user message to session
    store.appendUserMessage(userPrompt);

    // add placeholder assistant message
    store.appendAssistantMessage("generating...");

    try {
      if (!strudelAdapter) {
        throw new Error("editor not ready");
      }

      // sync current code to session before generating
      if (currentCode) {
        store.setCurrentCode(currentCode);
      }

      // determine mode: if there's real code, edit it; otherwise treat as new
      const hasRealCode = currentCode && currentCode.trim() !== "" && currentCode !== DEFAULT_CODE;
      const effectiveMode = hasRealCode ? "edit" : "new";

      let response: Response;
      try {
        const provider = settings?.model
          ? getProviderForModel(settings.model)
          : "anthropic";
        const apiKey =
          provider === "openai" ? settings?.apiKeyOpenAI : settings?.apiKeyAnthropic;

        response = await fetch("/api/claude", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: userPrompt,
            mode: effectiveMode,
            currentCode: effectiveMode === "edit" ? currentCode : undefined,
            chatHistory: chatMessages.slice(-10),
            sessionId: currentSession?.sessionId,
            model: settings?.model,
            apiKey,
          }),
        });
      } catch {
        // Network error - couldn't reach the server at all
        throw new Error("Network error: Could not connect to the server. Please check your internet connection.");
      }

      if (!response.ok) {
        let errorMessage = `Server error: ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch {
          // Response wasn't JSON, use status-based message
          if (response.status === 401) {
            errorMessage = "Invalid API key. Please check your API key in Settings.";
          } else if (response.status === 400) {
            errorMessage = "Bad request. Please check your settings.";
          } else if (response.status === 429) {
            errorMessage = "Rate limited. Please wait a moment and try again.";
          } else if (response.status >= 500) {
            errorMessage = "Server error. Please try again later.";
          }
        }
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("no response stream");

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

          for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                accumulatedTextRef.current += parsed.delta.text;
              } else if (parsed.type === "status") {
                if (parsed.status !== "generating...") {
                  setStatus(parsed.status);
                }
              } else if (parsed.type === "clear") {
                accumulatedTextRef.current = "";
              } else if (parsed.type === "error") {
                throw new Error(parsed.error?.message || "stream error");
              }
            } catch (parseErr) {
              // If it's an error we threw (not a JSON parse error), re-throw it
              if (parseErr instanceof Error && !parseErr.message.includes("JSON")) {
                throw parseErr;
              }
              // Otherwise it's an incomplete JSON chunk - ignore and continue
            }
          }
        }
      }

      const fullText = accumulatedTextRef.current;

      // Check for empty response
      if (!fullText || fullText.trim() === "") {
        throw new Error("Empty response from AI. The model may be overloaded - please try again.");
      }

      // use strict parser
      const parseResult = parseClaudeOutput(fullText);

      if (!parseResult.success || !parseResult.code) {
        setRawErrorResponse(parseResult.rawResponse || fullText);
        // Provide more specific error message
        const errorDetail = parseResult.error || "The AI response didn't contain valid code";
        throw new Error(errorDetail);
      }

      const newCode = parseResult.code;

      // check if code is unchanged (for edit mode)
      const codeUnchanged = currentCode && isCodeUnchanged(currentCode, newCode);

      // apply code atomically
      strudelAdapter.setCode(newCode);

      // update session with new code
      if (!codeUnchanged) {
        store.applyNewCode(newCode, userPrompt);
      }

      // update the assistant message
      const visualStatus = "";
      store.updateLastAssistantMessage(
        codeUnchanged ? "✓ no changes needed" : `✓ done${visualStatus}`,
        newCode
      );

      setStatus("starting...");

      // run the generated code and surface any strudel errors
      try {
        await strudelAdapter.run();
        setError(null);
      } catch (runErr) {
        const errorMsg = formatStrudelError(runErr);
        setError(errorMsg);
      }

      setStatus(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "failed";
      setError(msg);
      // update the placeholder message to show error
      store.updateLastAssistantMessage(`✗ ${msg}`);
      setStatus(null);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const handleQuickAction = (actionPrompt: string) => {
    // quick actions just set the prompt - do not force mode switch
    // user can use quick actions in any mode
    setPrompt(actionPrompt);
  };

  const handleRun = async () => {
    if (!strudelAdapter) return;
    try {
      await strudelAdapter.run();
      setIsPlaying(true);
      setError(null);
    } catch (runErr) {
      const errorMsg = formatStrudelError(runErr);
      setError(errorMsg);
    }
  };

  const handleStop = async () => {
    if (!strudelAdapter) return;
    try {
      await strudelAdapter.stop();
      setIsPlaying(false);
      setError(null);
    } catch {
      // Stop error silently handled
    }
  };

  // Toggle play/stop
  const handlePlayToggle = async () => {
    if (isPlaying) {
      await handleStop();
    } else {
      await handleRun();
    }
  };

  // start fresh session - clears everything including chat
  const handleStartFresh = useCallback(() => {
    if (!strudelAdapter) return;
    strudelAdapter.stop();
    setIsPlaying(false);
    strudelAdapter.setCode(DEFAULT_CODE);
    store.startNewSession(DEFAULT_CODE);
    setError(null);
    setRawErrorResponse(null);
    setStatus("started fresh session");
    setTimeout(() => setStatus(null), 1500);
  }, [strudelAdapter, store]);

  const handleRecallCode = useCallback(
    (code: string) => {
      if (!strudelAdapter || !code) return;
      strudelAdapter.stop();
      setIsPlaying(false);
      strudelAdapter.setCode(code);
      store.setCurrentCode(code);
      // do not auto-switch mode - user can recall in any mode
      setError(null);
      setStatus("recalled from history");
      setTimeout(() => setStatus(null), 1500);
    },
    [strudelAdapter, store]
  );

  const clearHistory = useCallback(() => {
    if (!strudelAdapter) return;
    strudelAdapter.stop();
    setIsPlaying(false);
    strudelAdapter.setCode(DEFAULT_CODE);
    store.setCurrentCode(DEFAULT_CODE);
    store.clearChat();
    setError(null);
    setRawErrorResponse(null);
    setStatus("chat and editor reset");
    setTimeout(() => setStatus(null), 1500);
  }, [strudelAdapter, store]);

  const fetchSavedSongs = useCallback(async () => {
    setIsLoadingSongs(true);
    try {
      const response = await fetch("/api/songs");
      if (!response.ok) {
        throw new Error("Failed to load saved songs.");
      }
      const data = await response.json();
      setSavedSongs(Array.isArray(data?.songs) ? data.songs : []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load saved songs.";
      setError(msg);
    } finally {
      setIsLoadingSongs(false);
    }
  }, []);

  const handleSaveSong = useCallback(() => {
    if (!strudelAdapter || isSavingSong || isSaveDialogOpen) return;
    const code = strudelAdapter.getCode();
    if (!code || !code.trim()) {
      setError("Nothing to save yet.");
      return;
    }

    const promptName = extractNameFromPrompt(lastUserPrompt);
    const fallbackName = `song-${formatSongTimestamp(new Date())}`;
    const suggestedName = promptName || fallbackName;
    setSaveNameInput(suggestedName);
    setSaveSuggestedName(suggestedName);
    setPendingSaveCode(code);
    setIsSaveDialogOpen(true);
  }, [strudelAdapter, isSavingSong, isSaveDialogOpen, lastUserPrompt]);

  const handleCancelSaveSong = useCallback(() => {
    setIsSaveDialogOpen(false);
    setPendingSaveCode(null);
  }, []);

  const handleConfirmSaveSong = useCallback(async () => {
    if (isSavingSong) return;
    const code = pendingSaveCode ?? strudelAdapter?.getCode() ?? "";
    if (!code || !code.trim()) {
      setError("Nothing to save yet.");
      setIsSaveDialogOpen(false);
      setPendingSaveCode(null);
      return;
    }

    const trimmedName = saveNameInput.trim();
    const fallbackName = saveSuggestedName || `song-${formatSongTimestamp(new Date())}`;
    const name = trimmedName.length > 0 ? trimmedName : fallbackName;

    setIsSavingSong(true);
    setError(null);

    try {
      const response = await fetch("/api/songs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          code,
          prompt: lastUserPrompt || undefined,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message =
          typeof payload?.error === "string" ? payload.error : "Failed to save song.";
        throw new Error(message);
      }

      const data = await response.json();
      if (data?.song) {
        setSavedSongs((prev) => {
          const existing = prev.filter((song) => song.filename !== data.song.filename);
          return [data.song, ...existing];
        });
      }
      setStatus("saved to /songs");
      setTimeout(() => setStatus(null), 2000);
      setIsSaveDialogOpen(false);
      setPendingSaveCode(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save song.";
      setError(msg);
    } finally {
      setIsSavingSong(false);
    }
  }, [
    isSavingSong,
    pendingSaveCode,
    strudelAdapter,
    saveNameInput,
    saveSuggestedName,
    lastUserPrompt,
  ]);

  const handleLoadSavedSong = useCallback(
    (song: SavedSong) => {
      handleRecallCode(song.code);
      setActiveTab("chat");
    },
    [handleRecallCode]
  );

  // Runtime errors should persist until user takes action (no auto-clear)
  // Only clear rawErrorResponse after a delay for non-runtime errors
  useEffect(() => {
    if (rawErrorResponse && !error?.includes('strudel') && !error?.includes('parse error')) {
      const timer = setTimeout(() => {
        setRawErrorResponse(null);
      }, 15000);
      return () => clearTimeout(timer);
    }
  }, [rawErrorResponse, error]);

  useEffect(() => {
    if (activeTab !== "saved") return;
    fetchSavedSongs();
  }, [activeTab, fetchSavedSongs]);

  useEffect(() => {
    if (activeTab !== "chat") return;
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages, activeTab]);

  useEffect(() => {
    if (!isSaveDialogOpen) return;
    const input = saveNameInputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, [isSaveDialogOpen]);

  return (
    <div
      className="flex flex-col h-full min-h-0 min-w-0"
      style={{ fontSize: "var(--panel-font-size)" }}
    >
      {/* tabs */}
      <div className="flex-shrink-0 px-3 md:px-4 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("chat")}
              className="rounded-full px-3 py-1 text-xs md:text-sm transition-all"
              style={{
                color: "var(--text-alt)",
                border: "1px solid var(--border-right-panel)",
                background: activeTab === "chat" ? "var(--surface)" : "var(--bg)",
                opacity: activeTab === "chat" ? 1 : 0.6,
              }}
            >
              chat
            </button>
            <button
              onClick={() => setActiveTab("saved")}
              className="rounded-full px-3 py-1 text-xs md:text-sm transition-all"
              style={{
                color: "var(--text-alt)",
                border: "1px solid var(--border-right-panel)",
                background: activeTab === "saved" ? "var(--surface)" : "var(--bg)",
                opacity: activeTab === "saved" ? 1 : 0.6,
              }}
            >
              {isMobile ? "saved" : "saved songs"}
              {savedSongs.length > 0 ? ` (${savedSongs.length})` : ""}
            </button>
          </div>
          {activeTab === "saved" && (
            <button
              onClick={fetchSavedSongs}
              disabled={isLoadingSongs}
              className="rounded-md px-2 py-1 text-xs transition-all"
              style={{
                color: "var(--text-alt)",
                border: "1px solid var(--border-right-panel)",
                opacity: isLoadingSongs ? 0.4 : 0.6,
              }}
              title="Refresh saved songs"
            >
              refresh
            </button>
          )}
        </div>
      </div>

      {activeTab === "saved" ? (
        <div
          className={`flex-1 overflow-y-auto px-3 md:px-4 pb-4 min-h-0 ${isMobile ? "text-sm" : ""}`}
          style={{ paddingTop: isMobile ? "12px" : "16px" }}
        >
          {isLoadingSongs ? (
            <div
              className="text-xs text-center"
              style={{ color: "var(--text-alt)", opacity: 0.6 }}
            >
              loading saved songs...
            </div>
          ) : savedSongs.length === 0 ? (
            <div
              className="text-xs text-center"
              style={{ color: "var(--text-alt)", opacity: 0.6 }}
            >
              no saved songs yet. save one below.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {savedSongs.map((song) => (
                <div
                  key={song.filename}
                  className="rounded-lg p-3"
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border-right-panel)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div
                        className="text-sm font-medium truncate"
                        style={{ color: "var(--text-alt)" }}
                      >
                        {song.name}
                      </div>
                      <div
                        className="text-xs"
                        style={{ color: "var(--text-alt)", opacity: 0.6 }}
                      >
                        {formatSongDateLabel(song.createdAt)}
                      </div>
                      {song.prompt && (
                        <div
                          className="text-xs mt-1 break-words"
                          style={{ color: "var(--text-alt)", opacity: 0.6 }}
                        >
                          prompt: {song.prompt}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleLoadSavedSong(song)}
                      className="rounded-md px-2 py-1 text-xs transition-all"
                      style={{
                        color: "var(--text-alt)",
                        border: "1px solid var(--border-right-panel)",
                        opacity: 0.7,
                      }}
                      title="Load song"
                    >
                      load
                    </button>
                  </div>
                  {song.code && (
                    <details className="mt-2">
                      <summary
                        className="text-xs cursor-pointer"
                        style={{ color: "var(--text-alt)", opacity: 0.6 }}
                      >
                        preview code
                      </summary>
                      <pre
                        className="mt-2 text-xs whitespace-pre-wrap max-h-40 overflow-y-auto"
                        style={{ color: "var(--text-alt)", opacity: 0.7 }}
                      >
                        {song.code}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* chat log */}
          <div
            ref={chatContainerRef}
            className={`flex-1 overflow-y-auto px-3 md:px-4 min-h-0 ${isMobile ? "text-sm" : ""}`}
            style={{
              paddingTop: isMobile ? "12px" : "24px",
              paddingBottom: isMobile ? "8px" : "16px",
            }}
          >
            {chatMessages.length === 0 ? (
              <div
                className={`text-dim text-center break-words ${isMobile ? "pt-4" : "pt-8"}`}
                style={{ color: "var(--text-alt)", opacity: 0.6 }}
              >
                describe the music you want — instrumentals, texture, experience...
              </div>
            ) : (
              <div className="flex flex-col gap-2 md:gap-3 min-w-0">
                {chatMessages.map((msg, idx) => (
                  <div
                    key={`${msg.createdAt}-${idx}`}
                    className={`break-words flex items-center gap-2 ${
                      msg.role === "user" ? "font-medium" : "text-dim pl-3 md:pl-4"
                    }`}
                    style={{
                      color: "var(--text-alt)",
                      opacity: msg.role === "user" ? 1 : 0.6,
                    }}
                  >
                    {msg.content === "generating..." && (
                      <span
                        className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
                        style={{ background: "var(--accent)" }}
                      />
                    )}
                    {msg.content.startsWith("✓") ? (
                      <span>
                        <span
                          className="text-xl md:text-2xl"
                          style={{
                            fontSize: isMobile ? "1.2em" : "1.5em",
                            lineHeight: "1",
                          }}
                        >
                          ✓
                        </span>
                        <span>{msg.content.slice(1)}</span>
                      </span>
                    ) : (
                      <span>{msg.content}</span>
                    )}
                    {msg.code && (
                      <button
                        onClick={() => handleRecallCode(msg.code!)}
                        className="ml-1 md:ml-2 opacity-50 transition-opacity flex-shrink-0"
                        style={{
                          color: "var(--text-alt)",
                          fontSize: isMobile ? "1.2em" : "1.5em",
                          lineHeight: "1",
                        }}
                        title="Recall This Code"
                      >
                        ↺
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* quick actions */}
          <div className="flex-shrink-0 px-2 md:px-4 py-1 md:py-2 flex flex-wrap gap-1 md:gap-1.5 justify-center">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => handleQuickAction(action.prompt)}
                disabled={isGenerating}
                className="px-2 md:px-2.5 py-0.5 md:py-1 text-xs rounded-full transition-all"
                style={{
                  color: "var(--text-alt)",
                  background: "var(--bg)",
                  border: "1px solid var(--border-right-panel)",
                  opacity: isGenerating ? 0.4 : 0.7,
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* status and error display */}
      <div className="px-2 md:px-4 py-1 flex-shrink-0 min-h-[20px] md:min-h-[24px]">
        {status && !error && status !== "generating..." && (
          <div
            className="text-xs flex items-center justify-center gap-2"
            style={{ color: "var(--text-alt)", opacity: 0.6 }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: "var(--accent)" }}
            />
            {status}
          </div>
        )}
        {error && (
          <div
            className="text-xs px-2 md:px-3 py-2 md:py-2.5 rounded-md font-mono break-words relative"
            style={{
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              color: "#ef4444",
            }}
          >
            <button
              onClick={() => { setError(null); setRawErrorResponse(null); }}
              className="absolute top-1 right-1 p-1 opacity-60 hover:opacity-100 transition-opacity"
              style={{ color: "#ef4444" }}
              title="Dismiss error"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <div className="pr-5">
              <span className="font-bold">⚠ error: </span>
              {error}
            </div>
            {rawErrorResponse && !isMobile && (
              <details className="mt-2">
                <summary className="cursor-pointer opacity-70">
                  show raw response
                </summary>
                <pre className="mt-2 text-xs whitespace-pre-wrap opacity-60 max-h-32 overflow-y-auto">
                  {rawErrorResponse.substring(0, 500)}
                  {rawErrorResponse.length > 500 && "..."}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>

      {/* controls */}
      <div className={`flex-shrink-0 flex items-center justify-center gap-2 md:gap-4 py-2 md:py-4 ${isMobile ? 'px-2' : ''}`}>
        {/* play/stop toggle - prominent */}
        <button
          onClick={handlePlayToggle}
          className="play-button rounded-xl md:rounded-2xl flex items-center justify-center gap-2"
          style={{ 
            minWidth: isMobile ? "80px" : "100px",
            height: isMobile ? "56px" : "72px",
            paddingLeft: isMobile ? "16px" : "20px",
            paddingRight: isMobile ? "20px" : "24px",
            background: isPlaying ? "var(--text-alt)" : "var(--surface)",
            color: isPlaying ? "var(--surface)" : "var(--text-alt)",
            border: isPlaying ? "none" : "1px solid var(--border-right-panel)",
            boxShadow: "none",
            transition: "background-color 0.2s, color 0.2s, border 0.2s, box-shadow 0.2s",
            transform: "none",
            WebkitTapHighlightColor: "transparent"
          }}
          onMouseDown={(e) => e.preventDefault()}
          title={isPlaying ? "Stop" : "Play"}
        >
          {isPlaying ? (
            /* stop icon - square */
            <svg className="w-6 h-6 md:w-8 md:h-8" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            /* play icon - triangle */
            <svg className="w-6 h-6 md:w-8 md:h-8" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="8,5 19,12 8,19" />
            </svg>
          )}
          <span className="text-sm md:text-base font-medium">{isPlaying ? "stop" : "play"}</span>
        </button>

        <button
          onClick={handleSaveSong}
          disabled={!strudelAdapter || isSavingSong || isGenerating || isSaveDialogOpen}
          className="rounded-md flex items-center justify-center gap-1 h-7 md:h-8 px-2 md:px-2.5 transition-all text-xs"
          style={{ 
            color: "var(--text-alt)",
            border: "1px solid var(--border-right-panel)",
            opacity: !strudelAdapter || isSavingSong || isGenerating || isSaveDialogOpen ? 0.4 : 0.7
          }}
          title="Save song to /songs"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          <span>{isSavingSong ? "saving..." : isMobile ? "save" : "save song"}</span>
        </button>
        
        {chatMessages.length > 0 && (
          <button
            onClick={handleStartFresh}
            className="rounded-md flex items-center justify-center gap-1 h-7 md:h-8 px-2 md:px-2.5 transition-all text-xs"
            style={{ 
              color: "var(--text-alt)",
              border: "1px solid var(--border-right-panel)",
              opacity: 0.7
            }}
            title="New Song"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{isMobile ? 'new' : 'new song'}</span>
          </button>
        )}
        
        {chatMessages.length > 0 && (
          <button
            onClick={clearHistory}
            className="rounded-md flex items-center justify-center gap-1 h-7 md:h-8 px-2 md:px-2.5 transition-all text-xs"
            style={{ 
              color: "var(--text-alt)",
              border: "1px solid var(--border-right-panel)",
              opacity: 0.7
            }}
            title="Reset History"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            <span>{isMobile ? 'reset' : 'reset history'}</span>
          </button>
        )}
      </div>

      {activeTab === "chat" && (
        <div className="flex-shrink-0 p-2 md:p-4 pt-0">
          <div
            className="flex items-center gap-2 md:gap-3 rounded-lg px-3 md:px-4 py-2 md:py-3"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border-right-panel)",
            }}
          >
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isGenerating
                  ? "generating..."
                  : isMobile ? "describe..." : "describe the music you want — instrumentals, texture, experience..."
              }
              className={`flex-1 bg-transparent focus:outline-none break-words ${isMobile ? 'text-sm' : ''}`}
              style={{
                color: "var(--text-alt)",
              }}
              disabled={isGenerating}
            />
            {onInfoClick && (
              <button
                onClick={onInfoClick}
                className="p-1 transition-opacity hover:opacity-100"
                style={{
                  color: "var(--text-alt)",
                  opacity: 0.5,
                }}
                title="About & License"
              >
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {isSaveDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-3"
          style={{ background: "rgba(15, 23, 42, 0.55)" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) handleCancelSaveSong();
          }}
        >
          <div
            className="w-full max-w-sm rounded-lg p-4"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border-right-panel)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium" style={{ color: "var(--text-alt)" }}>
              save song
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--text-alt)", opacity: 0.6 }}>
              name
            </div>
            <input
              ref={saveNameInputRef}
              type="text"
              value={saveNameInput}
              onChange={(e) => setSaveNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleConfirmSaveSong();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  handleCancelSaveSong();
                }
              }}
              className="mt-2 w-full rounded-md px-3 py-2 text-sm focus:outline-none"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border-right-panel)",
                color: "var(--text-alt)",
              }}
              disabled={isSavingSong}
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                onClick={handleCancelSaveSong}
                className="rounded-md px-3 py-1 text-xs transition-all"
                style={{
                  color: "var(--text-alt)",
                  border: "1px solid var(--border-right-panel)",
                  opacity: 0.7,
                }}
                disabled={isSavingSong}
              >
                cancel
              </button>
              <button
                onClick={handleConfirmSaveSong}
                className="rounded-md px-3 py-1 text-xs transition-all"
                style={{
                  color: "var(--text-alt)",
                  background: "var(--surface)",
                  border: "1px solid var(--border-right-panel)",
                  opacity: isSavingSong ? 0.5 : 0.9,
                }}
                disabled={isSavingSong}
              >
                {isSavingSong ? "saving..." : "save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
