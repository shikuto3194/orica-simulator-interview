import { createHash } from "node:crypto";
import type { GameState } from "@orica/rules-core";
import {
  isStrictRoomMutationRequest,
  parseRoomMutationId,
} from "../shared/room-protocol";
import {
  applyRoomGameplayCommand,
  autoDrainRoomState,
  createRoomMutationRandomContext,
  mutationFingerprint,
  prepareRoomViewerState,
  roomLegalActions,
  roomMutationRandomTrace,
  runWithRoomMutationRandom,
  RoomGameplayError,
  type RoomGameplayCommand,
} from "./game-api";

export interface LocalGameTraceEntry {
  actor: string;
  path: RoomGameplayCommand;
  body: Record<string, unknown>;
  version: number;
  randomTrace: Record<string, number>;
  autoDrain: unknown[];
  stateHash: string;
}
const stateHash = (state: GameState) =>
  createHash("sha256").update(JSON.stringify(state)).digest("hex");

type Identity = { actor: string; fingerprint: string; version: number | null };

/** One authoritative in-memory game. No DB, auth service or AI search. */
export class LocalGameSession {
  private state: GameState;
  private version = 1;
  private identities = new Map<string, Identity>();
  private trace: LocalGameTraceEntry[] = [];
  private readonly initialState: GameState;

  constructor(
    readonly id: string,
    initialState: GameState
  ) {
    this.initialState = structuredClone(initialState);
    this.state = structuredClone(initialState);
  }

  private requirePlayer(actor: string) {
    if (!this.state.players.some((player) => player.id === actor))
      throw new RoomGameplayError("Not a player role.", 403);
  }

  view(actor: string) {
    this.requirePlayer(actor);
    return {
      state: prepareRoomViewerState(this.state, actor),
      version: this.version,
      viewerPlayerId: actor,
      isSpectator: false,
    };
  }

  actions(actor: string) {
    this.requirePlayer(actor);
    return {
      actions: roomLegalActions(this.state, actor),
      version: this.version,
    };
  }

  snapshot() {
    return structuredClone({ state: this.state, version: this.version });
  }
  get currentVersion() {
    return this.version;
  }

  inspect() {
    return structuredClone({
      state: this.state,
      version: this.version,
      initialState: this.initialState,
      trace: this.trace,
    });
  }

  private fingerprint(
    path: RoomGameplayCommand,
    body: Record<string, unknown>
  ) {
    return mutationFingerprint(body, `/api/room/${this.id}/${path}`);
  }

  private matchIdentity(id: string, actor: string, fingerprint: string) {
    const saved = this.identities.get(id);
    if (saved && (saved.actor !== actor || saved.fingerprint !== fingerprint))
      throw new RoomGameplayError("Mutation identity mismatch.", 409);
    return saved;
  }

  mutate(
    actor: string,
    path: RoomGameplayCommand,
    body: Record<string, unknown>
  ) {
    this.requirePlayer(actor);
    if (!isStrictRoomMutationRequest(body))
      throw new RoomGameplayError("Invalid room mutation metadata.");
    const id = parseRoomMutationId(body.clientMutationId)!;
    const fingerprint = this.fingerprint(path, body);
    const saved = this.matchIdentity(id, actor, fingerprint);
    if (saved) {
      if (saved.version === null)
        throw new RoomGameplayError("ROOM_MUTATION_CANCELLED", 409);
      return {
        ok: true,
        ...this.view(actor),
        clientMutationId: id,
        duplicate: true,
        duplicateVersion: saved.version,
      };
    }
    if (path === "pregame-update" && !body.preGame)
      throw new RoomGameplayError("preGame partial update required.");
    if (path === "pregame-update" && !this.state.preGame)
      return {
        ok: true,
        ...this.view(actor),
        clientMutationId: id,
        alreadyComplete: true,
      };
    if (body.expectedVersion !== this.version)
      throw new RoomGameplayError("Conflict", 409);
    if (this.identities.size >= 4096)
      throw new RoomGameplayError(
        "Local session operation limit reached.",
        429
      );
    const random = createRoomMutationRandomContext();
    // Engine helpers may mutate arrays. Failed commands must not leak into the committed snapshot.
    const next = runWithRoomMutationRandom(random, () =>
      autoDrainRoomState(
        applyRoomGameplayCommand(structuredClone(this.state), actor, path, body)
      )
    );
    this.state = next.state;
    this.version++;
    this.identities.set(id, { actor, fingerprint, version: this.version });
    this.trace.push({
      actor,
      path,
      body: structuredClone(body),
      version: this.version,
      randomTrace: roomMutationRandomTrace(random),
      autoDrain: next.steps,
      stateHash: stateHash(this.state),
    });
    return { ok: true, ...this.view(actor), clientMutationId: id };
  }

  settle(
    actor: string,
    path: RoomGameplayCommand,
    id: string,
    payload: Record<string, unknown>
  ) {
    this.requirePlayer(actor);
    const fingerprint = this.fingerprint(path, payload);
    const saved = this.matchIdentity(id, actor, fingerprint);
    if (!saved) {
      if (this.identities.size >= 4096)
        throw new RoomGameplayError(
          "Local session operation limit reached.",
          429
        );
      this.identities.set(id, { actor, fingerprint, version: null });
    }
    return {
      clientMutationId: id,
      outcome: saved?.version != null ? "applied" : "cancelled",
      appliedVersion: saved?.version ?? null,
      roomVersion: this.version,
    };
  }
}
