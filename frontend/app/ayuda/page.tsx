import type { Metadata } from "next";
import HelpGuide from "@/components/HelpGuide";

export const metadata: Metadata = {
  title: "Ayuda · PreSupuesto",
  description:
    "Guía paso a paso para cargar materiales, pedirle presupuestos al asistente, ver los importes en dólares y mandar el PDF.",
};

/** User documentation view. */
export default function HelpPage() {
  return <HelpGuide />;
}
