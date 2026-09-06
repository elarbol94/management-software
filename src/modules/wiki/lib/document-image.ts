export type DocumentImage = { bytes: Uint8Array; mimeType: string; width: number; height: number };
export type DocumentImageResolver = (nodeId: string) => DocumentImage | undefined;
