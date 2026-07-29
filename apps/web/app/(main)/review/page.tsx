import { redirect } from "next/navigation";

export default function LegacyReviewPage() {
  redirect("/?view=review");
}
