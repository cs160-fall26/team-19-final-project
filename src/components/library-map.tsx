"use client";

import { useEffect, useState, type ComponentType } from "react";
import type { MapItem } from "@/components/library-map-inner";

export type { MapItem };

type MapView = ComponentType<{ items: MapItem[] }>;

/**
 * The references that carry a GPS position, on one map. Leaflet needs a
 * browser, so the map itself is loaded only once this has mounted.
 */
export function LibraryMap({ items }: { items: MapItem[] }) {
  const [View, setView] = useState<MapView | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("./library-map-inner").then((mod) => {
      if (!cancelled) setView(() => mod.LibraryMapInner);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!View) {
    return (
      <div className="flex h-[70vh] max-h-[760px] min-h-[420px] w-full items-center justify-center bg-[#ececec] font-mono text-xs text-black/50">
        Loading map…
      </div>
    );
  }
  return <View items={items} />;
}
