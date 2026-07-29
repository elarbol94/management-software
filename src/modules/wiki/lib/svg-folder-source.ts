/**
 * Keeps the browser's handle to the SVG source folder so the graphics panel can
 * re-read it on later visits without the user picking the folder again.
 *
 * The server never sees a filesystem path — it cannot reach the user's Nextcloud
 * folder. The handle lives in the browser; only file bytes are uploaded.
 */

type PermissionMode = { mode: "read" };
type FileHandle = { kind: "file"; name: string; getFile: () => Promise<File> };
export type DirectoryHandle = {
  kind: "directory";
  name: string;
  values: () => AsyncIterable<DirectoryHandle | FileHandle>;
  queryPermission?: (options: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (options: PermissionMode) => Promise<PermissionState>;
};

const DB_NAME = "wiki-svg-folders";
const STORE = "handles";

export function supportsFolderLink() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function loadFolderHandle(pageId: string) {
  if (typeof indexedDB === "undefined") return null;
  return await withStore<DirectoryHandle | undefined>("readonly", (store) => store.get(pageId))
    .then((handle) => handle ?? null)
    .catch(() => null);
}

export async function saveFolderHandle(pageId: string, handle: DirectoryHandle) {
  await withStore("readwrite", (store) => store.put(handle, pageId)).catch(() => undefined);
}

export async function clearFolderHandle(pageId: string) {
  await withStore("readwrite", (store) => store.delete(pageId)).catch(() => undefined);
}

export async function folderPermission(handle: DirectoryHandle, request: boolean) {
  const ask = request ? handle.requestPermission : handle.queryPermission;
  if (!ask) return "granted" as const;
  return await ask.call(handle, { mode: "read" }).catch(() => "denied" as const);
}

export async function pickFolder() {
  const picker = (window as unknown as { showDirectoryPicker: (options?: { mode?: "read" }) => Promise<DirectoryHandle> }).showDirectoryPicker;
  return await picker({ mode: "read" });
}

/** Walks the linked folder and returns every SVG with its folder-relative path. */
export async function collectSvgFiles(handle: DirectoryHandle, prefix = ""): Promise<Array<{ path: string; file: File }>> {
  const found: Array<{ path: string; file: File }> = [];
  for await (const entry of handle.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      found.push(...await collectSvgFiles(entry, path));
    } else if (/\.svgz?$/i.test(entry.name)) {
      found.push({ path, file: await entry.getFile() });
    }
  }
  return found;
}
