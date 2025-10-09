import { WebSocketServer, WebSocket } from "ws";
import http from "http";

export class SubtitleBroadcaster {
  private clients = new Set<WebSocket>();

  constructor(server: http.Server) {
    const wss = new WebSocketServer({ server });
    wss.on("connection", (ws: WebSocket) => {
      this.clients.add(ws);
      ws.on("close", () => this.clients.delete(ws));
    });
  }

  broadcast(payload: any) {
    const msg = JSON.stringify(payload);
    console.debug(
      `[SubtitleBroadcaster] Broadcasting payload to ${this.clients.size} client(s): ${msg}`
    );
    for (const ws of this.clients) ws.send(msg);
  }
}boaljdajusdjajsd
