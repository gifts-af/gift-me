import { ImageResponse } from "next/og";
import { holidayLogoNow } from "@/lib/holiday";
import { iconSvg } from "@/lib/logo-art";

// The home-screen and browser-tab icon: the yellow AF tag on near-black
// (ALL-48), wearing its Santa hat in the holiday window.
export async function appIcon(size: number, { rounded = false } = {}) {
  const svg = iconSvg(size, { holiday: await holidayLogoNow(), rounded });
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws an <img>, not a page
    <img src={`data:image/svg+xml,${encodeURIComponent(svg)}`} width={size} height={size} alt="" />,
    { width: size, height: size },
  );
}
