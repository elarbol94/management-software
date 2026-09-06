import { figureMime, relativeFigurePath } from "./figure";
import { folderPermission, pickFolder, supportsFolderLink, type DirectoryHandle } from "./svg-folder-source";
export { folderPermission, pickFolder, supportsFolderLink };

export type FigureFolder = { handle: DirectoryHandle; prefix: string };
async function store<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("wiki-figure-folders", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("sources");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction("sources", mode);
      const request = action(transaction.objectStore("sources"));
      let result: T;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}
export function saveFigureFolder(sourceId: string, folder: FigureFolder) { return store("readwrite", (entry) => entry.put(folder, sourceId)); }
export function loadFigureFolder(sourceId: string) { return store<FigureFolder | undefined>("readonly", (entry) => entry.get(sourceId)).catch(() => undefined); }

export async function readFigureFolderFile(folder: FigureFolder, input: string): Promise<File> {
  const parts = relativeFigurePath(input, folder.prefix).split("/");
  let directory = folder.handle;
  for (let index = 0; index < parts.length; index++) {
    let matched = false;
    for await (const entry of directory.values()) {
      if (entry.name !== parts[index]) continue;
      if (index === parts.length - 1 && entry.kind === "file") return entry.getFile();
      if (entry.kind !== "directory") throw new Error("sourceUnavailable");
      directory = entry;
      matched = true;
      break;
    }
    if (!matched) throw new Error("sourceUnavailable");
  }
  throw new Error("sourceUnavailable");
}

/** Enumerate names only, on an explicit browse action; reading image bytes waits until insertion. */
export async function listFigureFolderPaths(handle: DirectoryHandle) {
  const paths: string[] = [];
  const visit = async (directory: DirectoryHandle, prefix: string, depth: number) => {
    if (depth > 12 || paths.length >= 1000) return;
    for await (const entry of directory.values()) {
      if (paths.length >= 1000) break;
      const path = prefix + entry.name;
      if (entry.kind === "directory") await visit(entry, `${path}/`, depth + 1);
      else if (figureMime(entry.name)) paths.push(path);
    }
  };
  await visit(handle, "", 0);
  return paths.sort((a, b) => a.localeCompare(b));
}
