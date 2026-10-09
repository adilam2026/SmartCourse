/** Registry of open SSE connections, so they can be closed the moment access is revoked. */
interface Conn {
  familyId: string;
  profileId: string;
  sessionId: string;
  send(event: string, data: unknown): void;
  close(): void;
}

export class SseHub {
  private conns = new Set<Conn>();

  add(conn: Conn): () => void {
    this.conns.add(conn);
    return () => this.conns.delete(conn);
  }

  private closeWhere(pred: (c: Conn) => boolean): number {
    let n = 0;
    for (const c of [...this.conns]) {
      if (pred(c)) {
        this.conns.delete(c);
        c.close();
        n++;
      }
    }
    return n;
  }

  disconnectProfile(profileId: string): number {
    return this.closeWhere((c) => c.profileId === profileId);
  }

  disconnectSession(sessionId: string): number {
    return this.closeWhere((c) => c.sessionId === sessionId);
  }

  broadcast(familyId: string, event: string, data: unknown): void {
    for (const c of this.conns) if (c.familyId === familyId) c.send(event, data);
  }

  get size(): number {
    return this.conns.size;
  }
}
