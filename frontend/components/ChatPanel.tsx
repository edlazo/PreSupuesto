"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, sendChatMessage } from "@/lib/api";
import type { ChatMessage, ChatResponse } from "@/lib/types";

const SUGGESTIONS = [
  "¿Qué materiales tenés para albañilería?",
  "Calculá un muro de ladrillos de 20 m² con 10% de desperdicio",
  "Armá un presupuesto para refaccionar un baño de 12 m²",
] as const;

interface ChatPanelProps {
  /** Called after every completed turn so the budget preview can refresh. */
  onTurnComplete: () => void;
  /** Hide the panel. Only offered on desktop, where it is optional. */
  onClose?: () => void;
}

/** Conversation with the Hermes Agent. */
export default function ChatPanel({ onTurnComplete, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [engine, setEngine] = useState<ChatResponse["engine"]>(null);
  const [isSending, setIsSending] = useState(false);

  const transcriptRef = useRef<HTMLDivElement>(null);
  // Sequential ids keep message keys stable without calling Date.now() during render.
  const messageCounterRef = useRef(0);

  function nextMessageId(prefix: string) {
    messageCounterRef.current += 1;
    return `${prefix}-${messageCounterRef.current}`;
  }

  // Keep the newest message in view.
  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isSending]);

  async function send(text: string) {
    const trimmed = text.trim();

    if (!trimmed || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: nextMessageId("user"),
      role: "user",
      content: trimmed,
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      const response = await sendChatMessage(trimmed, sessionId);

      setSessionId(response.session_id);
      setEngine(response.engine);
      setMessages((current) => [
        ...current,
        { id: nextMessageId("agent"), role: "agent", content: response.reply },
      ]);
      onTurnComplete();
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Hubo un problema al contactar al agente.";

      setMessages((current) => [
        ...current,
        { id: nextMessageId("error"), role: "agent", content: message, failed: true },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section
      aria-label="Conversación con el agente"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5 sm:py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">🤖 Asistente IA</h2>
          <p className="text-xs text-muted">
            Opcional: pedile precios, un cálculo o el presupuesto entero
          </p>
        </div>
        <span
          // The Gemini badge matters: it means the Hermes gateway is down and
          // the reply came from the fallback.
          title={
            engine === "gemini"
              ? "No se puede contactar al gateway de Hermes: las respuestas vienen de Gemini"
              : undefined
          }
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            engine === "gemini"
              ? "bg-primary-soft text-primary"
              : sessionId
                ? "bg-success-soft text-success"
                : "bg-surface-muted text-muted"
          }`}
        >
          {engine === "gemini"
            ? "Respaldo Gemini"
            : sessionId
              ? "Sesión activa"
              : "Sesión nueva"}
        </span>

        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar el asistente"
            title="Cerrar el asistente"
            className="hidden rounded-md px-2 py-1 text-sm text-muted transition-colors hover:bg-surface-muted hover:text-foreground md:block"
          >
            ✕
          </button>
        ) : null}
      </header>

      <div ref={transcriptRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
            <div>
              <p className="text-sm font-medium">Contale qué trabajo hay que presupuestar</p>
              <p className="mt-1 text-sm text-muted">
                El agente lee el catálogo de materiales y calcula los precios por vos.
              </p>
            </div>
            <div className="flex w-full max-w-md flex-col gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void send(suggestion)}
                  className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-left text-sm text-muted transition-colors hover:border-primary hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm ${
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : message.failed
                      ? "bg-danger-soft text-danger"
                      : "bg-surface-muted text-foreground"
                }`}
              >
                {message.content}
              </div>
            </article>
          ))
        )}

        {isSending ? (
          <article className="flex justify-start" aria-live="polite">
            <div className="flex items-center gap-2 rounded-2xl bg-surface-muted px-4 py-3 text-sm text-muted">
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:-0.2s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:-0.1s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted" />
              <span className="ml-1">Trabajando en eso</span>
            </div>
          </article>
        ) : null}
      </div>

      <form
        className="border-t border-border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <div className="flex items-end gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Mensaje
          </label>
          <textarea
            id="chat-input"
            rows={2}
            value={input}
            disabled={isSending}
            placeholder="Ej.: presupuestá 15 m² de piso de cocina con porcelanato"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter adds a line break.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
            className="min-h-[3rem] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-primary disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isSending || input.trim().length === 0}
            className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
      </form>
    </section>
  );
}
