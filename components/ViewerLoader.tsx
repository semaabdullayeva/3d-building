"use client";

import dynamic from "next/dynamic";

// Three.js needs the browser (WebGL, window) – render the viewer on the client only.
const ApartmentViewerApp = dynamic(() => import("./ApartmentViewerApp"), { ssr: false });

export default function ViewerLoader() {
  return <ApartmentViewerApp />;
}
