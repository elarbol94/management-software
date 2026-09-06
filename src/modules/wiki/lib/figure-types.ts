export type FigureSourceDto = { id: string; kind: "laptop" | "server"; name: string; rootKey: string; owned: boolean };
export type FigureAssetDto = {
  id: string; attachmentId: string; fileName: string; mimeType: string; version: number; src: string;
  sourceId: string | null; relativePath: string; paused: boolean; status: string; caption: string;
  updatedAt: string; lastCheckedAt: string | null;
  revisions: Array<{ id: string; version: number; createdAt: string }>;
};
export type FigureManifest = { assets: FigureAssetDto[]; sources: FigureSourceDto[]; roots: string[] };
