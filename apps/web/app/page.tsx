import { redirect } from "next/navigation";

// The platform has no home page yet; the lists product is the front door for now (T19).
export default function Home() {
  redirect("/lists");
}
