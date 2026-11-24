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
  /**
   * Where the photo is served from once the reference is stored. A reference
   * that is not on disk yet carries the photo itself here, as a data URL.
   */
  imageUrl: string;
  labels: string[];
  semantic: string;
  prompt: string;
  boundingBox: BoundingBox;
  /** Null when the photo carries no GPS position. */
  location: GeoPoint | null;
  /** ISO timestamp from the camera, or null when the file has none. */
  capturedAt: string | null;
  addedAt: string;
  metadata: ImageMetadata;
  /** Vision model that wrote the title, labels, description and prompt. */
  model: string;
};
