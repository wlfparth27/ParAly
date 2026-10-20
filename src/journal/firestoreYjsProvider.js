import { Bytes, doc, onSnapshot, runTransaction } from 'firebase/firestore';
import * as Y from 'yjs';

/**
 * Small Firestore-backed Yjs state provider.
 *
 * It stores one merged Yjs state per notebook page. On every pause in editing,
 * it transactionally merges the current local Yjs state with the latest remote
 * state, so two clients cannot replace each other's CRDT updates with stale
 * snapshots. No external collaboration service is used.
 */
export class FirestoreYjsProvider {
  constructor(db, ydoc, pagePath, callbacks = {}) {
    this.db = db;
    this.ydoc = ydoc;
    this.stateRef = doc(db, ...pagePath, 'yjs', 'state');
    this.onSynced = callbacks.onSynced || (() => {});
    this.onError = callbacks.onError || (() => {});
    this.active = true;
    this.flushTimer = null;
    this.flushInProgress = null;

    this.updateHandler = (_update, origin) => {
      if (!this.active || origin === this) return;
      this.scheduleFlush();
    };
    this.ydoc.on('update', this.updateHandler);

    this.unsubscribe = onSnapshot(this.stateRef, (snapshot) => {
      if (!this.active || !snapshot.exists()) return;
      const encoded = snapshot.data().update;
      if (!encoded || typeof encoded.toUint8Array !== 'function') return;
      try {
        Y.applyUpdate(this.ydoc, encoded.toUint8Array(), this);
        this.onSynced();
      } catch (error) {
        this.onError(error);
      }
    }, (error) => this.onError(error));
  }

  scheduleFlush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch((error) => this.onError(error));
    }, 700);
  }

  async flush() {
    if (!this.active && this.ydoc.getXmlFragment('default').length === 0) return;
    if (this.flushInProgress) {
      await this.flushInProgress;
      return;
    }

    // Avoid creating a cloud state record from an untouched, not-yet-synced doc.
    if (this.ydoc.getXmlFragment('default').length === 0) return;

    const localState = Y.encodeStateAsUpdate(this.ydoc);
    this.flushInProgress = runTransaction(this.db, async (transaction) => {
      const current = await transaction.get(this.stateRef);
      let mergedState = localState;
      if (current.exists()) {
        const encoded = current.data().update;
        if (encoded && typeof encoded.toUint8Array === 'function') {
          mergedState = Y.mergeUpdates([encoded.toUint8Array(), localState]);
        }
      }
      transaction.set(this.stateRef, {
        update: Bytes.fromUint8Array(mergedState),
        updatedAt: Date.now(),
      });
    }).finally(() => {
      this.flushInProgress = null;
    });

    await this.flushInProgress;
  }

  destroy() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.ydoc.off('update', this.updateHandler);
    this.unsubscribe?.();
    this.active = false;
    // Finish any local edits before the page component releases this provider.
    // An empty document is intentionally not written.
    this.flush().catch((error) => this.onError(error));
  }
}
