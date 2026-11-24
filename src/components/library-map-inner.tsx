"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { DesignReference } from "@/lib/types";

export type MapItem = {
  ref: DesignReference;
  /** Found by meaning rather than by the words typed; drawn dashed. */
  related: boolean;
};

type Placed = MapItem & { lat: number; lng: number };

/** References that share one marker, with where it sits in map pixels. */
type Group = { members: Placed[]; x: number; y: number };

type Place = {
  key: string;
  lat: number;
  lng: number;
  members: Placed[];
  /** False when zooming all the way in would still leave the members together. */
  separable: boolean;
};

/** Diameter of the bubble of a reference that stands alone. */
const SINGLE = 40;
/** The big bubble of a place with several references: slightly bigger. */
const MAIN = 48;
/** The small bubbles around it. */
const SMALL = 22;
/** How many bubbles one place shows at most, the big one included. */
const MAX_BUBBLES = 6;
/** Distance from the centre of the big bubble to the centres of the small ones. */
const ORBIT = MAIN / 2 + SMALL / 2 - 5;
/** Width and height of the whole marker of a place with several references. */
const CLUSTER = 2 * ORBIT + SMALL;
/** Clear space kept between two markers, in pixels. */
const GAP = 6;
const MAX_ZOOM = 19;
const FIT = { padding: [70, 70] as [number, number], maxZoom: 14 };

/**
 * Six places around the big bubble, sixty degrees apart, as clock angles from
 * the top. The number takes the one at upper right; the small bubbles fill the
 * other five so that any count of them stays balanced about that diagonal.
 */
const NUMBER_ANGLE = 45;
const SMALL_ANGLES: Record<number, number[]> = {
  1: [225],
  2: [165, 285],
  3: [165, 225, 285],
  4: [105, 165, 285, 345],
  5: [105, 165, 225, 285, 345],
};

/** How wide a marker is drawn for the number of references it stands for. */
function markerSize(count: number): number {
  return count > 1 ? CLUSTER : SINGLE;
}

function placed(items: MapItem[]): Placed[] {
  return items.flatMap((item) =>
    item.ref.location
      ? [{ ...item, lat: item.ref.location.lat, lng: item.ref.location.lng }]
      : [],
  );
}

function boundsOf(items: { lat: number; lng: number }[]) {
  return L.latLngBounds(items.map((item) => [item.lat, item.lng]));
}

/** Which references end up in one marker at this zoom level. */
function groupsAt(map: L.Map, items: Placed[], zoom: number): Group[] {
  // References at exactly the same place can never be told apart on a map.
  const spots = new Map<string, Placed[]>();
  for (const item of items) {
    const spot = `${item.lat},${item.lng}`;
    const there = spots.get(spot);
    if (there) there.push(item);
    else spots.set(spot, [item]);
  }
  const groups: Group[] = Array.from(spots.values(), (members) => {
    const point = map.project([members[0].lat, members[0].lng], zoom);
    return { members, x: point.x, y: point.y };
  });

  // Merge any two markers that would touch. The merged marker is bigger and
  // sits between the two, so it may now reach a third: go round until a whole
  // pass merges nothing.
  for (let merged = true; merged; ) {
    merged = false;
    for (let a = 0; a < groups.length; a += 1) {
      for (let b = a + 1; b < groups.length; b += 1) {
        const one = groups[a];
        const other = groups[b];
        const reach =
          (markerSize(one.members.length) + markerSize(other.members.length)) /
            2 +
          GAP;
        if (Math.hypot(one.x - other.x, one.y - other.y) >= reach) continue;

        const total = one.members.length + other.members.length;
        one.x =
          (one.x * one.members.length + other.x * other.members.length) / total;
        one.y =
          (one.y * one.members.length + other.y * other.members.length) / total;
        one.members = [...one.members, ...other.members];
        groups.splice(b, 1);
        b = a; // measure everything after `a` again against its new size
        merged = true;
      }
    }
  }
  return groups;
}

function placesAt(map: L.Map, items: Placed[], zoom: number): Place[] {
  const order = new Map(items.map((item, index) => [item, index]));
  return groupsAt(map, items, zoom).map((group) => {
    // In the order given, so a match is shown before a related photo.
    const members = [...group.members].sort(
      (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
    );
    const centre = map.unproject([group.x, group.y], zoom);
    return {
      key: members.map((member) => member.ref.id).join("+"),
      lat: centre.lat,
      lng: centre.lng,
      members,
      separable:
        members.length > 1 && groupsAt(map, members, MAX_ZOOM).length > 1,
    };
  });
}

/** One round photo with a ring that keeps it apart from its neighbours and the map. */
function bubble(photo: { imageUrl: string; related: boolean }, diameter: number) {
  const disc = document.createElement("div");
  disc.className = photo.related
    ? "absolute -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border-2 border-dashed border-black bg-white shadow-[0_1px_4px_rgba(0,0,0,0.35)]"
    : "absolute -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border-2 border-white bg-[#e4e4e4] shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_1px_4px_rgba(0,0,0,0.35)]";
  disc.style.width = `${diameter}px`;
  disc.style.height = `${diameter}px`;
  const image = document.createElement("img");
  image.src = photo.imageUrl;
  image.alt = "";
  image.draggable = false;
  // Leaflet's stylesheet sizes every image in the marker pane itself, and it
  // is not in a cascade layer, so only an important utility can overrule it.
  image.className = "block size-full! rounded-full object-cover";
  disc.append(image);
  return disc;
}

/** Puts `element`'s centre `distance` pixels from the marker's centre, at a clock angle. */
function placeAround(
  element: HTMLElement,
  size: number,
  distance: number,
  angle: number,
) {
  const radians = (angle * Math.PI) / 180;
  element.style.left = `${size / 2 + distance * Math.sin(radians)}px`;
  element.style.top = `${size / 2 - distance * Math.cos(radians)}px`;
}

/**
 * The marker of a place. One reference is a single bubble. Several are a
 * slightly bigger bubble with up to five more as small bubbles around it, and
 * the number of references there in the sixth position.
 */
function placeIcon(
  photos: { imageUrl: string; related: boolean }[],
  count: number,
): L.DivIcon {
  const size = markerSize(count);
  const marker = document.createElement("div");
  marker.className =
    "relative size-full transition-transform duration-150 hover:scale-105";

  const main = bubble(photos[0], count > 1 ? MAIN : SINGLE);
  placeAround(main, size, 0, 0);
  marker.append(main);

  if (count > 1) {
    const around = photos.slice(1, MAX_BUBBLES);
    around.forEach((photo, index) => {
      const small = bubble(photo, SMALL);
      placeAround(small, size, ORBIT, SMALL_ANGLES[around.length][index]);
      marker.append(small);
    });

    const number = document.createElement("span");
    number.textContent = String(count);
    number.className =
      "absolute flex h-5 min-w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-black bg-[#CCFF00] px-1 font-mono text-[10px] leading-none text-black";
    placeAround(number, size, ORBIT, NUMBER_ANGLE);
    marker.append(number);
  }
  return L.divIcon({
    html: marker,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 4],
  });
}

function PlaceMarker({ place }: { place: Place }) {
  const map = useMap();
  const { members } = place;
  const count = members.length;
  // What the marker draws, as text, so the icon is rebuilt only when it changes.
  const shown = members
    .slice(0, MAX_BUBBLES)
    .map(({ ref, related }) => `${related ? "~" : ""}${ref.imageUrl}`)
    .join("\n");
  const icon = useMemo(
    () =>
      placeIcon(
        shown.split("\n").map((entry) => ({
          related: entry.startsWith("~"),
          imageUrl: entry.replace(/^~/, ""),
        })),
        count,
      ),
    [shown, count],
  );
  const label = count === 1 ? members[0].ref.title : `${count} references`;

  return (
    <Marker
      position={[place.lat, place.lng]}
      icon={icon}
      title={label}
      alt={label}
      eventHandlers={
        // Several references that zooming can pull apart: zoom. Otherwise
        // the marker opens a list of what is there.
        place.separable
          ? {
              click: () =>
                map.fitBounds(boundsOf(members), {
                  padding: FIT.padding,
                  maxZoom: MAX_ZOOM,
                }),
            }
          : undefined
      }
    >
      {place.separable ? null : (
        <Popup closeButton={false} minWidth={220} maxWidth={260}>
          <ul className="max-h-64 space-y-2.5 overflow-y-auto">
            {members.map(({ ref }) => (
              <li key={ref.id}>
                <Link
                  href={`/r/${ref.id}`}
                  className="group flex items-center gap-3"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ref.imageUrl}
                    alt=""
                    className="size-12 shrink-0 bg-[#e4e4e4] object-cover"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-sans text-xs font-medium group-hover:underline">
                      {ref.title}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-black/50">
                      {ref.labels.slice(0, 3).join(" · ")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Popup>
      )}
    </Marker>
  );
}

function Places({ items }: { items: Placed[] }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  // A new set of results is worth looking at as a whole. The same set arriving
  // again (a keystroke that changes nothing) leaves the view where it is.
  const fitted = useRef("");
  useEffect(() => {
    const shown = items
      .map((item) => `${item.ref.id}${item.related ? "~" : ""}`)
      .join(" ");
    if (items.length === 0 || shown === fitted.current) return;
    fitted.current = shown;
    map.fitBounds(boundsOf(items), { ...FIT, animate: false });
  }, [map, items]);

  const places = useMemo(() => placesAt(map, items, zoom), [map, items, zoom]);
  return places.map((place) => <PlaceMarker key={place.key} place={place} />);
}

/**
 * Every located reference as a round photo bubble. References too close to
 * show side by side share one marker: a bigger bubble with small ones around
 * it and the number of references it stands for.
 */
export function LibraryMapInner({ items }: { items: MapItem[] }) {
  // Matches first, so a shared marker leads with a match, not a related photo.
  const located = useMemo(
    () => placed(items).sort((a, b) => Number(a.related) - Number(b.related)),
    [items],
  );
  if (located.length === 0) return null;

  return (
    // The `!` utilities overrule Leaflet's own popup styling (see bubble).
    <div className="h-[70vh] max-h-[760px] min-h-[420px] w-full overflow-hidden bg-[#ececec] [&_.leaflet-container]:h-full [&_.leaflet-container]:w-full [&_.leaflet-container]:font-sans! [&_.leaflet-control-attribution]:text-[9px] [&_.leaflet-popup-content]:m-3! [&_.leaflet-popup-content-wrapper]:rounded-none! [&_.leaflet-popup-content-wrapper]:shadow-[0_2px_12px_rgba(0,0,0,0.25)]! [&_.leaflet-popup-content_a]:text-black!">
      <MapContainer
        bounds={boundsOf(located)}
        boundsOptions={FIT}
        // Low enough for a phone-width map to show places on several continents.
        minZoom={1}
        maxZoom={MAX_ZOOM}
        scrollWheelZoom
        worldCopyJump
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={MAX_ZOOM}
        />
        <Places items={located} />
      </MapContainer>
    </div>
  );
}
