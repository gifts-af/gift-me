import type { Metadata } from "next";
import { ListTour } from "@/components/tour/list-tour";
import { APP_NAME } from "@/lib/brand";

// The list tour (ALL-71), from the home page's list hero.
export const metadata: Metadata = {
  title: `List tour · ${APP_NAME}`,
  description: "See how your GiftsAF wish list works, with made-up gifts. Nothing is saved or sent.",
};

export default function ListTourPage() {
  return <ListTour />;
}
