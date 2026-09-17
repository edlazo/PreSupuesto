import type { Metadata } from "next";
import MaterialsTable from "@/components/MaterialsTable";

export const metadata: Metadata = {
  title: "Materiales · PreSupuesto",
  description: "Gestioná el catálogo de materiales de obra y sus precios unitarios.",
};

/** Materials management view. */
export default function MaterialsPage() {
  return <MaterialsTable />;
}
