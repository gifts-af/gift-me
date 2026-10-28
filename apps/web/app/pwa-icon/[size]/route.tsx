import { notFound } from "next/navigation";
import { appIcon } from "@/lib/app-icon";

// The two sizes the manifest lists (Android needs 192 and 512 px).
const SIZES = ["192", "512"];

export function generateStaticParams() {
  return SIZES.map((size) => ({ size }));
}

export async function GET(_request: Request, { params }: RouteContext<"/pwa-icon/[size]">) {
  const { size } = await params;
  if (!SIZES.includes(size)) notFound();
  return appIcon(Number(size));
}
