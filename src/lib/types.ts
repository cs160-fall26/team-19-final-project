export type BoundingBox = {
  /** Normalized 0–1 relative to image */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GeoPoint = {
  lat: number;
  lng: number;
  /** Metres above sea level, when the camera recorded it. */
  altitude?: number;
};

/** Facts read from the file itself; a field is absent when the file does not carry it. */
export type ImageMetadata = {
  fileName: string;
  fileType: string;
  fileSize: number;
  width: number;
  height: number;
  camera?: string;
  lens?: string;
  focalLength?: string;
  aperture?: string;
  shutter?: string;
  iso?: number;
  software?: string;
  /** Dominant colours of the boxed region, as hex. */
  palette: string[];
};

export type DesignReference = {
  id: string;
  title: string;
  imageUrl: string;
  labels: string[];
  semantic: string;
  prompt: string;
  boundingBox: BoundingBox;
  /** The designer's optional note on what they wanted from the box. */
  note?: string;
  /** Shared by every reference extracted from the same upload. */
  photoId?: string;
  /** The boxed region on its own, shown in the library grid. */
  thumbnailUrl?: string;
  /** Null when the photo carries no GPS position. */
  location: GeoPoint | null;
  /** ISO timestamp from the camera, or null when the file has none. */
  capturedAt: string | null;
  addedAt: string;
  metadata: ImageMetadata;
  /** Vision model that wrote the title, labels, description and prompt. */
  model: string;
};
