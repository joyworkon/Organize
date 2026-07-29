import { Suspense } from "react";
import { DashboardHub } from "@/components/dashboard/dashboard-hub";

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardHub />
    </Suspense>
  );
}
