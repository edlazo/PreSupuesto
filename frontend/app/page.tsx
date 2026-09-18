"use client";

import { useCallback, useState } from "react";
import BudgetPreview from "@/components/BudgetPreview";
import ChatPanel from "@/components/ChatPanel";

/** The panel shown on a phone, where only one fits at a time. */
type MobilePanel = "chat" | "budget";

const PANEL_TABS: { id: MobilePanel; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "budget", label: "Presupuesto" },
];

/**
 * Main workspace: the agent conversation on the left, the live budget it
 * produces on the right. Every completed turn bumps `refreshToken`, which is
 * what makes the preview reload.
 *
 * Both panels need the full height to be usable, so on a phone they become
 * tabs; from `md` up they sit side by side. The inactive panel is hidden with
 * CSS rather than unmounted, so switching tabs never loses the conversation.
 */
export default function WorkspacePage() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [activePanel, setActivePanel] = useState<MobilePanel>("chat");

  const handleTurnComplete = useCallback(() => {
    setRefreshToken((current) => current + 1);
    // A new budget is worth looking at, so surface it on small screens.
    setActivePanel("budget");
  }, []);

  return (
    <div className="flex h-[calc(100dvh-10.5rem)] min-h-[26rem] flex-col gap-3 md:h-[calc(100dvh-7.5rem)] md:min-h-[32rem] md:gap-4">
      <div
        role="tablist"
        aria-label="Vistas del escritorio"
        className="flex shrink-0 items-center gap-1 rounded-xl border border-border bg-surface p-1 md:hidden"
      >
        {PANEL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${tab.id}-tab`}
            aria-selected={activePanel === tab.id}
            aria-controls={`${tab.id}-panel`}
            onClick={() => setActivePanel(tab.id)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              activePanel === tab.id
                ? "bg-primary text-primary-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] md:gap-4">
        <div
          id="chat-panel"
          role="tabpanel"
          aria-labelledby="chat-tab"
          className={`h-full md:block ${activePanel === "chat" ? "block" : "hidden"}`}
        >
          <ChatPanel onTurnComplete={handleTurnComplete} />
        </div>
        <div
          id="budget-panel"
          role="tabpanel"
          aria-labelledby="budget-tab"
          className={`h-full md:block ${activePanel === "budget" ? "block" : "hidden"}`}
        >
          <BudgetPreview refreshToken={refreshToken} />
        </div>
      </div>
    </div>
  );
}
