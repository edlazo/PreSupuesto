"use client";

import { useCallback, useState } from "react";
import BudgetPreview from "@/components/BudgetPreview";
import BudgetWorkspaceProvider, {
  useBudgetWorkspace,
} from "@/components/BudgetWorkspaceProvider";
import ChatPanel from "@/components/ChatPanel";
import ManualEntryForm from "@/components/ManualEntryForm";

/** The panel shown on a phone, where only one fits at a time. */
type MobilePanel = "budget" | "chat";

const PANEL_TABS: { id: MobilePanel; label: string }[] = [
  { id: "budget", label: "Presupuesto" },
  { id: "chat", label: "🤖 Asistente" },
];

export default function WorkspacePage() {
  return (
    <BudgetWorkspaceProvider>
      <Workspace />
    </BudgetWorkspaceProvider>
  );
}

/**
 * Main workspace. Loading the budget by hand is the primary path: the entry
 * form and the budget fill the screen, and the assistant is a panel you open
 * when you want it.
 */
function Workspace() {
  const { reload } = useBudgetWorkspace();
  const [activePanel, setActivePanel] = useState<MobilePanel>("budget");
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);

  const handleTurnComplete = useCallback(() => {
    // The assistant writes the same budget, so pull its work back in.
    reload();
  }, [reload]);

  return (
    <div className="flex h-[calc(100dvh-10.5rem)] min-h-[26rem] flex-col gap-3 md:h-[calc(100dvh-7.5rem)] md:min-h-[32rem] md:gap-4">
      {/* Phones show one panel at a time. */}
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

      <div
        className={`min-h-0 flex-1 md:grid md:gap-4 ${
          isAssistantOpen
            ? "md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
            : "md:grid-cols-[minmax(0,1fr)]"
        }`}
      >
        {/* Budget side: entry form on top, the budget underneath. */}
        <div
          id="budget-panel"
          role="tabpanel"
          aria-labelledby="budget-tab"
          className={`flex h-full min-h-0 flex-col gap-3 md:flex ${
            activePanel === "budget" ? "flex" : "hidden"
          }`}
        >
          <ManualEntryForm />

          <div className="min-h-0 flex-1">
            <BudgetPreview />
          </div>
        </div>

        {/* Assistant side: a tab on phones, a panel you open on desktop. */}
        <div
          id="chat-panel"
          role="tabpanel"
          aria-labelledby="chat-tab"
          className={`h-full min-h-0 ${activePanel === "chat" ? "block" : "hidden"} ${
            isAssistantOpen ? "md:block" : "md:hidden"
          }`}
        >
          <ChatPanel onTurnComplete={handleTurnComplete} onClose={() => setIsAssistantOpen(false)} />
        </div>
      </div>

      {/* The way back to the assistant on desktop, once it is closed. */}
      {isAssistantOpen ? null : (
        <button
          type="button"
          onClick={() => setIsAssistantOpen(true)}
          className="hidden shrink-0 self-end rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-primary hover:text-primary md:block"
        >
          🤖 Asistente IA
        </button>
      )}
    </div>
  );
}
