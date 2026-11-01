import type { Metadata } from "next";
import { Tour } from "@/components/tour/tour";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Tour · ${APP_NAME}`,
  description: "Try GiftsAF with made-up people. Nothing is saved or bought.",
};

export default function TourPage() {
  return <Tour />;
}
