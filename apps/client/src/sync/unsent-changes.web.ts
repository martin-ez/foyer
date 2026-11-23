import type { KeptChange, UnsentChanges } from "./household-sync";

const databaseName = "foyer";
const storeName = "unsent-changes";

type StoredChange = KeptChange & { memberId: string };

let opened: Promise<IDBDatabase | null> | undefined;

function database(): Promise<IDBDatabase | null> {
  opened ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(storeName, { autoIncrement: true });
        store.createIndex("memberId", "memberId");
        store.createIndex("changeId", "changeId");
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opened = undefined;
        };
        resolve(db);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opened;
}

function inStore<T>(
  mode: IDBTransactionMode,
  fallback: T,
  work: (store: IDBObjectStore) => () => T,
): Promise<T> {
  return database().then(
    (db) =>
      new Promise<T>((resolve) => {
        if (!db) return resolve(fallback);
        try {
          const transaction = db.transaction(storeName, mode);
          const result = work(transaction.objectStore(storeName));
          transaction.oncomplete = () => resolve(result());
          transaction.onerror = () => resolve(fallback);
          transaction.onabort = () => resolve(fallback);
        } catch {
          resolve(fallback);
        }
      }),
  );
}

function deleteEach(store: IDBObjectStore, request: IDBRequest<IDBValidKey[]>): void {
  request.onsuccess = () => {
    for (const key of request.result) store.delete(key);
  };
}

/** The member's unsent changes, kept in the browser's IndexedDB between launches of the web app.
 *  If the browser keeps nothing, as some private windows do, nothing is kept. */
export function unsentChangesOf(memberId: string): UnsentChanges | undefined {
  return {
    load: () =>
      inStore<KeptChange[]>("readonly", [], (store) => {
        const request = store.index("memberId").getAll(memberId);
        return () =>
          (request.result as StoredChange[]).map(({ changeId, encoded, describe }) => ({
            changeId,
            encoded,
            describe,
          }));
      }),
    keep: (changes) => {
      inStore("readwrite", undefined, (store) => {
        for (const change of changes) store.add({ ...change, memberId } satisfies StoredChange);
        return () => undefined;
      });
    },
    forget: (changeIds) => {
      inStore("readwrite", undefined, (store) => {
        const byChange = store.index("changeId");
        for (const changeId of changeIds) deleteEach(store, byChange.getAllKeys(changeId));
        return () => undefined;
      });
    },
    forgetAll: () => {
      forgetUnsentChanges(memberId);
    },
  };
}

/** Forgets every unsent change kept for the member, as when they sign out. */
export function forgetUnsentChanges(memberId: string): Promise<void> {
  return inStore("readwrite", undefined, (store) => {
    deleteEach(store, store.index("memberId").getAllKeys(memberId));
    return () => undefined;
  });
}
