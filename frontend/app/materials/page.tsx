import type { Metadata } from "next";
import MaterialsTable from "@/components/MaterialsTable";

export const metadata: Metadata = {
  title: "Materials · PreSupuesto",
  description: "Manage the construction materials catalog and its unit prices.",
};

/** Materials management view. */
export default function MaterialsPage() {
  return <MaterialsTable />;
}
