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

/** An image pasted or dropped into the generation chat. */
export type PastedImage = {
  id: string;
  /** Downscaled JPEG data URL. */
  dataUrl: string;
  name?: string;
};

/** Something the designer said, with the references they attached to it. */
export type UserMessage = {
  id: string;
  role: "user";
  text: string;
  /** References attached with this message: library ids and pasted image ids. */
  referenceIds: string[];
  /** Images pasted into this message; their ids also appear in referenceIds. */
  pastedImages?: PastedImage[];
  createdAt: string;
};

/** A design the model made in reply. */
export type DesignMessage = {
  id: string;
  role: "assistant";
  /**
   * A complete HTML document. It may contain referenceImageToken(n) where the
   * chat's nth reference (see chatReferenceIds) should appear; the app swaps
   * in the image when shown.
   */
  html: string;
  model: string;
  /** True when the designer made this version by hand in Edit mode. */
  editedByHand?: boolean;
  createdAt: string;
};

export type ChatMessage = UserMessage | DesignMessage;

/** A generation conversation: each reply revises the design before it. */
export type Chat = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
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
