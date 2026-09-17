"use client";

import { useCallback, useState } from "react";
import BudgetPreview from "@/components/BudgetPreview";
import ChatPanel from "@/components/ChatPanel";

/**
 * Main workspace: the agent conversation on the left, the live budget it
 * produces on the right. Every completed turn bumps `refreshToken`, which is
 * what makes the preview reload.
 */
export default function WorkspacePage() {
  const [refreshToken, setRefreshToken] = useState(0);

  const handleTurnComplete = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[32rem] flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <div className="min-h-[24rem] flex-1 lg:h-full">
        <ChatPanel onTurnComplete={handleTurnComplete} />
      </div>
      <div className="min-h-[24rem] flex-1 lg:h-full">
        <BudgetPreview refreshToken={refreshToken} />
      </div>
    </div>
  );
}
