import { readFile } from "node:fs/promises";
import { pathToFileURL, URL } from "node:url";

const { fetch, AbortSignal, AbortController } = globalThis;

const decisions = new Set([
  "action",
  "step",
  "core-move",
  "brave-separation",
  "pregame-update",
]);

// This client uses an existing opponent session. It never creates an account,
// requests administrator credentials, or calls the legacy/full-state APIs.
export class DotRoomClient {
  #token;
  #fetch;
  #userId;
  #expiresAt;
  #base;
  #roomId;
  #closed = false;
  #controller = new AbortController();

  constructor({
    baseUrl = "http://127.0.0.1:4310",
    roomId,
    accessToken,
    fetchImpl = fetch,
  }) {
    const origin = new URL(baseUrl);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(
      origin.hostname
    );
    if (
      origin.username ||
      origin.password ||
      origin.origin !== baseUrl.replace(/\/$/, "") ||
      !(
        origin.protocol === "https:" ||
        (loopback && origin.protocol === "http:")
      )
    ) {
      throw new Error("API origin must be HTTPS, or HTTP on loopback only.");
    }
    if (roomId != null && !/^[a-z0-9]+$/.test(roomId))
      throw new Error("A valid room ID is required.");
    if (typeof accessToken !== "string" || /\s/.test(accessToken))
      throw new Error("An existing opponent JWT is required.");
    let claims;
    try {
      const parts = accessToken.split(".");
      if (parts.length !== 3) throw new Error();
      claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
      throw new Error("An existing opponent JWT is required.");
    }
    if (
      typeof claims.sub !== "string" ||
      !claims.sub ||
      !Number.isFinite(claims.exp)
    ) {
      throw new Error("Opponent JWT must have a subject and expiry.");
    }
    // Decoding supplies the body userId only. The real API verifies the JWT.
    this.#userId = claims.sub;
    this.#expiresAt = claims.exp * 1000;
    this.#token = accessToken;
    this.#base = origin.origin;
    this.#roomId = roomId;
    this.#fetch = fetchImpl;
  }

  close() {
    this.#closed = true;
    this.#token = null;
    this.#controller.abort();
  }

  #checkSession() {
    if (this.#closed) throw new Error("Opponent session disconnected.");
    if (Date.now() >= this.#expiresAt)
      throw new Error("Opponent session expired; obtain a fresh session.");
  }

  async #request(path, method = "GET", body) {
    this.#checkSession();
    const accessToken = this.#token;
    let response;
    try {
      response = await this.#fetch(this.#base + path, {
        method,
        redirect: "error",
        signal: AbortSignal.any([
          this.#controller.signal,
          AbortSignal.timeout(15000),
        ]),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      this.#checkSession();
      throw new Error(
        "API connection failed; operation was not retried. Recheck state before a new decision."
      );
    }
    this.#checkSession();
    const data = await response.json();
    this.#checkSession();
    if (!response.ok) {
      const message = String(data.error ?? "Request failed").replaceAll(
        accessToken,
        "[redacted]"
      );
      const error = new Error(`HTTP ${response.status}: ${message}`);
      error.status = response.status;
      if (Number.isInteger(data.currentVersion))
        error.currentVersion = data.currentVersion;
      throw error;
    }
    return data;
  }

  async rooms() {
    const result = await this.#request("/api/room");
    if (!Array.isArray(result.rooms))
      throw new Error("Unexpected room list response.");
    return result.rooms;
  }

  async invitations() {
    return this.#request("/api/room-invitations");
  }

  async acceptInvitation(invitationId) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(invitationId)) {
      throw new Error("A valid invitation ID is required.");
    }
    const { invitations } = await this.invitations();
    const invitation = invitations.find((item) => item.id === invitationId);
    if (!invitation?.available) throw new Error("Invitation is unavailable.");
    const membership = (await this.rooms()).find(
      (room) => room.roomId === invitation.roomId
    );
    if (membership && membership.role !== "bob")
      throw new Error("Host session detected.");
    const joined = await this.#request(
      `/api/room-invitations/${invitationId}/accept`,
      "POST",
      {}
    );
    if (joined.role !== "bob" || joined.roomId !== invitation.roomId) {
      throw new Error(
        "The invitation did not assign the expected opponent seat."
      );
    }
    this.#roomId = joined.roomId;
    return joined;
  }

  async #requireBob({ readOnly = false } = {}) {
    if (!this.#roomId)
      throw new Error("Accept an invitation or specify a room first.");
    const membership = (await this.rooms()).find(
      (room) => room.roomId === this.#roomId
    );
    if (membership?.role === "bob") return;
    // Completed rooms disappear from the active list. Ordinary authenticated
    // metadata still proves this exact user's seat before any terminal read.
    // Mutations continue to require an active opponent membership.
    if (!membership && readOnly) {
      const metadata = await this.#request(`/api/room/${this.#roomId}`);
      if (
        metadata.players?.some(
          (player) => player.userId === this.#userId && player.role === "bob"
        )
      )
        return metadata;
    }
    throw new Error("This session is not the opponent seat (bob).");
  }

  async join() {
    if (!this.#roomId) throw new Error("A room ID is required.");
    const membership = (await this.rooms()).find(
      (room) => room.roomId === this.#roomId
    );
    if (membership && membership.role !== "bob") {
      throw new Error(
        "Host session detected. Use a separate existing opponent session."
      );
    }
    const joined = await this.#request(
      `/api/room/${this.#roomId}/join`,
      "POST",
      { userId: this.#userId }
    );
    if (joined.role !== "bob")
      throw new Error(
        "The API did not assign the opponent seat; no game actions were sent."
      );
    return joined;
  }

  async lobby() {
    const metadata = await this.#requireBob({ readOnly: true });
    return metadata ?? this.#request(`/api/room/${this.#roomId}`);
  }

  async state() {
    await this.#requireBob({ readOnly: true });
    return this.#request(`/api/room/${this.#roomId}/state/full`);
  }

  async deck(cardNos) {
    if (
      !Array.isArray(cardNos) ||
      !cardNos.length ||
      cardNos.some((card) => typeof card !== "string" || !card)
    ) {
      throw new Error(
        "Deck must contain actual card numbers; the server validates the deck rules."
      );
    }
    await this.#requireBob();
    return this.#request(`/api/room/${this.#roomId}/deck`, "POST", {
      userId: this.#userId,
      deckCardNos: cardNos,
    });
  }

  async heartbeat() {
    await this.#requireBob();
    return this.#request(`/api/room/${this.#roomId}/heartbeat`, "POST", {
      userId: this.#userId,
    });
  }

  async decision(kind, payload) {
    if (!decisions.has(kind))
      throw new Error("Only normal room decision endpoints are supported.");
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      !Number.isInteger(payload.expectedVersion) ||
      payload.expectedVersion < 0
    ) {
      throw new Error(
        "A decision needs the expectedVersion from the latest opponent state."
      );
    }
    if (
      ["state", "userId", "playerId", "actingPlayerId"].some((key) =>
        Object.hasOwn(payload, key)
      )
    ) {
      throw new Error("Do not supply a game state or another player identity.");
    }
    await this.#requireBob();
    return this.#request(`/api/room/${this.#roomId}/${kind}`, "POST", payload);
  }
}

async function main() {
  const [command, payloadPath] = process.argv.slice(2);
  if (!command || command === "--help") {
    console.log(
      "DOT_ROOM_ID and DOT_ACCESS_TOKEN must identify an existing opponent session."
    );
    console.log("DOT_API_BASE defaults to http://127.0.0.1:4310.");
    console.log("node dot-room-client.mjs join|lobby|state|heartbeat");
    console.log(
      "node dot-room-client.mjs deck|action|step|core-move|brave-separation|pregame-update payload.json"
    );
    console.log(
      "No account creation, token export, game creation, reset, deletion, or automatic play."
    );
    return;
  }
  if (
    !["join", "lobby", "state", "heartbeat", "deck", ...decisions].includes(
      command
    )
  )
    throw new Error("Unknown command.");
  const client = new DotRoomClient({
    baseUrl: process.env.DOT_API_BASE || "http://127.0.0.1:4310",
    roomId: process.env.DOT_ROOM_ID,
    accessToken: process.env.DOT_ACCESS_TOKEN,
  });
  let result;
  if (command === "deck" || decisions.has(command)) {
    if (!payloadPath) throw new Error("Supply a JSON payload file.");
    const payload = JSON.parse(await readFile(payloadPath, "utf8"));
    result =
      command === "deck"
        ? await client.deck(payload)
        : await client.decision(command, payload);
  } else {
    result = await client[command]();
  }
  console.log(JSON.stringify(result, null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
