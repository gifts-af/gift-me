import { ImageResponse } from "next/og";

// The home-screen and browser-tab icon: a teal square with a white "G",
// until the name and logo are settled (ALL-14). Teal is --primary (light).
export function appIcon(size: number, { rounded = false } = {}) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f766e",
          color: "#ffffff",
          fontSize: size * 0.62,
          fontWeight: 700,
          fontFamily: "sans-serif",
          borderRadius: rounded ? size * 0.22 : 0,
        }}
      >
        G
      </div>
    ),
    { width: size, height: size },
  );
}
