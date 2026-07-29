import { redirect } from "next/navigation";

export default function LegacyStatsPage() {
  redirect("/?view=stats");
}
