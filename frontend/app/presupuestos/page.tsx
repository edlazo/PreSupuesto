import type { Metadata } from "next";
import BudgetHistory from "@/components/BudgetHistory";

export const metadata: Metadata = {
  title: "Presupuestos · PreSupuesto",
  description: "Historial de presupuestos guardados, para reabrirlos o exportarlos.",
};

/** Saved budget history view. */
export default function BudgetsPage() {
  return <BudgetHistory />;
}
