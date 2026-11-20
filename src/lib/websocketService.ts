/**
 * Singleton WebSocket client for the JARVIS backend.
 * - Auto-reconnect with exponential backoff (1s → 30s cap)
 * - Outbound queue while disconnected
 * - Fan-out message + status listeners
 */

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface WsEvent {
  type: string;
  [key: string]: unknown;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private listeners = new Set<(event: WsEvent) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private queue: string[] = [];
  private retries = 0;
  private reconnectTimer: number | null = null;
  private closedByUser = false;

  constructor(url = "ws://127.0.0.1:8420/ws/chat") {
    this.url = url;
  }

  setUrl(url: string): void {
    if (url === this.url) return;
    this.url = url;
    this.reconnect(0);
  }

  connect(): void {
    if (typeof window === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closedByUser = false;
    this.setStatus("connecting");

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.retries = 0;
      this.setStatus("connected");
      // Flush anything queued while offline.
      const pending = this.queue.splice(0);
      for (const payload of pending) this.ws?.send(payload);
    };

    this.ws.onmessage = (event) => {
      let parsed: WsEvent;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        return;
      }
      for (const listener of this.listeners) {
        try {
          listener(parsed);
        } catch (error) {
          console.error("ws listener failed", error);
        }
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.setStatus("disconnected");
      if (!this.closedByUser) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      try {
        this.ws?.close();
      } catch {
        /* ignore */
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.closedByUser) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.retries, RECONNECT_MAX_MS);
    this.retries += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private reconnect(delayMs: number): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    if (delayMs <= 0) {
      this.connect();
    } else {
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delayMs);
    }
  }

  send(event: WsEvent): void {
    const payload = JSON.stringify(event);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      // Keep only the most recent 50 events while offline.
      this.queue.push(payload);
      if (this.queue.length > 50) this.queue.shift();
      this.connect();
    }
  }

  onMessage(listener: (event: WsEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: ConnectionStatus): void {
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (error) {
        console.error("ws status listener failed", error);
      }
    }
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus("disconnected");
  }
}

export const websocketService = new WebSocketService();
