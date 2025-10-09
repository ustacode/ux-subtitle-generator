import { EventEmitter } from "events";
import fetch, {
  Headers,
  type RequestInit,
  type Response,
} from "node-fetch";
import Pusher from "pusher-js";
import WebSocket from "ws";

const DEFAULT_TOKEN_URL = "https://id.kick.com/oauth/token";
const DEFAULT_API_BASE_URL = "https://kick.com/api/v2";
const DEFAULT_PUSHER_KEY = "32cbd69e4b950bf97679";
const DEFAULT_PUSHER_CLUSTER = "us2";
const CHANNEL_FORMATS = [
  (chatroomId: number) => `chatroom_${chatroomId}`,
  (chatroomId: number) => `chatrooms.${chatroomId}.v2`,
  (chatroomId: number) => `chatrooms.${chatroomId}`,
  (chatroomId: number) => `channel_${chatroomId}`,
];
const CHAT_MESSAGE_EVENT = "App\\Events\\ChatMessageEvent";

type PusherChannel = {
  bind(event: string, handler: (data: unknown) => void): void;
  unbind(event: string, handler: (data: unknown) => void): void;
};

interface MinimalPusherConnection {
  bind(event: string, handler: (data: unknown) => void): void;
  unbind(event?: string, handler?: (data: unknown) => void): void;
}

interface MinimalPusher {
  subscribe(channelName: string): PusherChannel;
  unsubscribe(channelName: string): void;
  disconnect(): void;
  connection: MinimalPusherConnection;
}

type PusherConstructor = new (
  key: string,
  options: Record<string, unknown>
) => MinimalPusher;

const globalRecord = globalThis as Record<string, unknown>;

if (typeof globalRecord.WebSocket === "undefined") {
  globalRecord.WebSocket = WebSocket;
}

export type SubtitleCommandAction = "start" | "stop" | "reset";

export interface KickCommandEvent {
  action: SubtitleCommandAction;
  username: string;
  messageId?: string;
  original: KickChatMessage;
}

export interface KickListenerStartOptions {
  channelSlug: string;
  commandPrefix?: string;
}

export interface KickOAuthCredentials {
  clientId: string;
  clientSecret: string;
  tokenUrl?: string;
  apiBaseUrl?: string;
  pusherKey?: string;
  pusherCluster?: string;
}

export interface KickOAuthToken {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
  receivedAt: Date;
}

interface KickChatMessage {
  id?: string;
  type?: string;
  message?: string;
  content?: string;
  body?: string;
  metadata?: Record<string, unknown>;
  sender?: KickChatSender;
}

interface KickChatSender {
  username?: string;
  user_id?: number;
  is_moderator?: boolean;
  is_owner?: boolean;
  is_admin?: boolean;
  is_broadcaster?: boolean;
  user_roles?: string[];
  roles?: string[];
  identity?: {
    badges?: Array<{ type?: string; text?: string; image?: string | null }>;
  };
  badges?: Array<{ type?: string }>;
}

export declare interface KickCommandListener {
  on(event: "connected", listener: () => void): this;
  on(event: "disconnected", listener: (reason: string) => void): this;
  on(event: "command", listener: (command: KickCommandEvent) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  emit(event: "connected"): boolean;
  emit(event: "disconnected", reason: string): boolean;
  emit(event: "command", command: KickCommandEvent): boolean;
  emit(event: "error", error: Error): boolean;
}

export class KickCommandListener
  extends EventEmitter
  implements KickCommandListener
{
  private cachedToken?: KickOAuthToken;
  private pusher?: MinimalPusher;
  private chatroomId?: number;
  private channelSlug?: string;
  private commandPrefix = "ux";
  private connectedNotified = false;
  private readonly channelSubscriptions: Array<{
    name: string;
    channel: PusherChannel;
  }> = [];
  private readonly channelHandlers = new Map<
    PusherChannel,
    Array<{ event: string; handler: (data: unknown) => void }>
  >();

  constructor(private readonly credentials: KickOAuthCredentials) {
    super();
  }

  async start(options: KickListenerStartOptions): Promise<void> {
    if (this.pusher) {
      return;
    }

    const slug = options.channelSlug.trim();
    if (!slug) {
      throw new Error("Kick channel slug is required to start the listener.");
    }

    this.commandPrefix = options.commandPrefix?.trim() || "ux";
    this.connectedNotified = false;
    this.channelSlug = slug;
    this.chatroomId = await this.getChatroomId(slug);

    try {
      this.createPusher();
      this.subscribeToChatrooms(this.chatroomId);
    } catch (error) {
      this.emit("error", error as Error);
      this.stop();
    }
  }

  stop(): void {
    for (const { channel, name } of this.channelSubscriptions.splice(
      0,
      this.channelSubscriptions.length
    )) {
      const handlers = this.channelHandlers.get(channel) ?? [];
      handlers.forEach(({ event, handler }) => channel.unbind(event, handler));
      this.channelHandlers.delete(channel);
      this.pusher?.unsubscribe(name);
    }

    if (this.pusher) {
      this.pusher.connection.unbind("connected");
      this.pusher.connection.unbind("disconnected");
      this.pusher.connection.unbind("error");
      this.pusher.disconnect();
      this.pusher = undefined;
    }

    this.chatroomId = undefined;
    this.channelSlug = undefined;
    this.connectedNotified = false;
  }

  async getChatroomId(channelSlug: string): Promise<number> {
    const slug = channelSlug.trim();
    if (!slug) {
      throw new Error("Kick channel slug is required to fetch chatroom id.");
    }

    const endpoint = `${(
      this.credentials.apiBaseUrl ?? DEFAULT_API_BASE_URL
    ).replace(/\/+$/, "")}/channels/${encodeURIComponent(slug)}`;

    const payload = await this.fetchJson<{
      chatroom?: { id?: number };
    }>(endpoint);

    const chatroomId = payload?.chatroom?.id;
    if (typeof chatroomId !== "number" || chatroomId <= 0) {
      throw new Error(
        `Kick API did not return a valid chatroom id for channel "${slug}".`
      );
    }

    return chatroomId;
  }

  async getAccessToken(forceRefresh = false): Promise<KickOAuthToken> {
    if (!forceRefresh && this.cachedToken && !this.isExpired(this.cachedToken)) {
      return this.cachedToken;
    }

    const token = await this.requestAccessToken();
    this.cachedToken = token;
    return token;
  }

  private createPusher(): void {
    if (this.pusher) {
      return;
    }

    const PusherCtor = Pusher as unknown as PusherConstructor;
    const pusher = new PusherCtor(
      this.credentials.pusherKey ?? DEFAULT_PUSHER_KEY,
      {
        cluster: this.credentials.pusherCluster ?? DEFAULT_PUSHER_CLUSTER,
        forceTLS: true,
        disableStats: true,
      }
    );

    pusher.connection.bind("connected", () => {
      if (!this.connectedNotified) {
        this.connectedNotified = true;
        this.emit("connected");
      }
    });

    pusher.connection.bind("disconnected", (reason: unknown) => {
      const message =
        typeof reason === "string"
          ? reason
          : JSON.stringify(reason ?? "unknown");
      this.emit("disconnected", message);
      this.stop();
    });

    pusher.connection.bind("error", (event: unknown) => {
      if (!event) return;
      const message =
        typeof event === "object" && "error" in (event as Record<string, unknown>)
          ? String((event as Record<string, unknown>).error)
          : JSON.stringify(event);
      this.emit(
        "error",
        new Error(`Kick Pusher connection error: ${message}`)
      );
    });

    this.pusher = pusher;
  }

  private subscribeToChatrooms(chatroomId: number): void {
    const pusher = this.pusher;
    if (!pusher) {
      throw new Error("Pusher client not initialized.");
    }

    for (const resolver of CHANNEL_FORMATS) {
      const channelName = resolver(chatroomId);
      const channel = pusher.subscribe(channelName);
      const handlers: Array<{
        event: string;
        handler: (data: unknown) => void;
      }> =
        [];

      const onMessage = (payload: unknown) => this.handleChatMessage(payload);
      channel.bind(CHAT_MESSAGE_EVENT, onMessage);
      handlers.push({ event: CHAT_MESSAGE_EVENT, handler: onMessage });

      const onError = (payload: unknown) => {
        this.emit(
          "error",
          new Error(
            `Kick Pusher subscription error on "${channelName}": ${JSON.stringify(
              payload
            )}`
          )
        );
      };
      channel.bind("pusher:subscription_error", onError);
      handlers.push({ event: "pusher:subscription_error", handler: onError });

      const onSubscribed = () => {
        if (!this.connectedNotified) {
          this.connectedNotified = true;
          this.emit("connected");
        }
      };
      channel.bind("pusher:subscription_succeeded", onSubscribed);
      handlers.push({
        event: "pusher:subscription_succeeded",
        handler: onSubscribed,
      });

      this.channelSubscriptions.push({ name: channelName, channel });
      this.channelHandlers.set(channel, handlers);
    }
  }

  private handleChatMessage(payload: unknown): void {
    const message = this.normalizeMessage(payload);
    if (!message) {
      return;
    }

    const rawText = message.content ?? message.message ?? message.body ?? "";
    const text = rawText.trim();

    if (!text || !this.commandPrefix) {
      return;
    }

    const action = this.parseCommand(text);
    if (!action) {
      return;
    }

    const sender = message.sender;
    if (!sender || !this.isPrivileged(sender)) {
      return;
    }

    const username = sender.username?.trim();

    this.emit("command", {
      action,
      username: username && username.length > 0 ? username : "unknown",
      messageId: message.id,
      original: message,
    });
  }

  private parseCommand(content: string): SubtitleCommandAction | undefined {
    const prefix = this.commandPrefix;
    if (!prefix) {
      return undefined;
    }

    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `^!${escapedPrefix}\\s+subtitle\\s+(start|stop|reset)\\b`,
      "i"
    );
    const match = content.match(regex);
    if (!match) {
      return undefined;
    }

    return match[1].toLowerCase() as SubtitleCommandAction;
  }

  private isPrivileged(sender: KickChatSender): boolean {
    if (
      sender.is_owner ||
      sender.is_moderator ||
      sender.is_admin ||
      sender.is_broadcaster
    ) {
      return true;
    }

    const roles = [
      ...(sender.user_roles ?? []),
      ...(sender.roles ?? []),
      ...(sender.identity?.badges?.map((badge) => badge.type ?? "") ?? []),
      ...(sender.badges?.map((badge) => badge.type ?? "") ?? []),
    ]
      .filter(Boolean)
      .map((role) => role.toLowerCase());

    return roles.some((role) =>
      ["owner", "moderator", "admin", "broadcaster", "founder"].includes(role)
    );
  }

  private normalizeMessage(payload: unknown): KickChatMessage | undefined {
    if (!payload) {
      return undefined;
    }

    if (typeof payload === "string") {
      try {
        return JSON.parse(payload) as KickChatMessage;
      } catch {
        return undefined;
      }
    }

    if (typeof payload === "object") {
      return payload as KickChatMessage;
    }

    return undefined;
  }

  private async requestAccessToken(): Promise<KickOAuthToken> {
    const { clientId, clientSecret, tokenUrl } = this.credentials;

    if (!clientId || !clientSecret) {
      throw new Error("Kick client credentials are required to authenticate.");
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await fetch(tokenUrl ?? DEFAULT_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const details = await this.safeReadError(response);
      throw new Error(
        `Kick OAuth request failed: ${response.status} ${response.statusText}${details}`
      );
    }

    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      token_type?: string;
    };

    const accessToken = payload.access_token?.trim();
    if (!accessToken) {
      throw new Error("Kick OAuth response missing access_token.");
    }

    const expiresIn = Number(payload.expires_in ?? 0);

    const tokenType = payload.token_type?.trim() || "Bearer";

    return {
      accessToken,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 0,
      tokenType,
      receivedAt: new Date(),
    };
  }

  private isExpired(token: KickOAuthToken): boolean {
    if (!token.expiresIn || token.expiresIn <= 0) {
      return false;
    }

    const expiryBufferMs = 30 * 1000;
    const expiryTime =
      token.receivedAt.getTime() + token.expiresIn * 1000 - expiryBufferMs;

    return Date.now() >= expiryTime;
  }

  private async safeReadError(response: Response): Promise<string> {
    try {
      const text = await response.text();
      if (!text) {
        return "";
      }
      return ` — ${text.slice(0, 200)}`;
    } catch {
      return "";
    }
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers ?? {});
    headers.set("accept", "application/json");
    headers.set("user-agent", "ux-subtitle-generator/1.0");

    const response = await fetch(url, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const details = await this.safeReadError(response);
      throw new Error(
        `Kick API request failed: ${response.status} ${response.statusText}${details}`
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
