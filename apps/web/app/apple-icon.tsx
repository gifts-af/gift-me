import { appIcon } from "@/lib/app-icon";

// iOS rounds the corners itself, so the square stays square.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return appIcon(180);
}
