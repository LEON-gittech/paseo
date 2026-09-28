import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { isRasterImagePath } from "@/attachments/file-types";
import { continuesTurn } from "@/agent-stream/turn-membership";
import type { StreamItem, ThoughtItem, ToolCallItem } from "@/types/stream";

export type ActivityItem = ThoughtItem | ToolCallItem;

export interface ToolCallDescriptor {
  detail: ToolCallDetail;
  name: string;
  status: "executing" | "running" | "completed" | "failed" | "canceled";
  error: unknown;
  metadata?: Record<string, unknown>;
}

export interface ToolCallRun {
  id: string;
  /** The chronological disclosure, including reasoning between tool calls. */
  items: readonly ActivityItem[];
  calls: readonly ToolCallItem[];
  latest: ActivityItem;
  isSealed: boolean;
}

export interface GroupedHistory<TGroup> {
  tail: StreamItem[];
  groupsByHostId: Map<string, TGroup>;
  pendingItems: readonly ActivityItem[];
}

export interface GroupedToolCalls<TGroup> {
  tail: StreamItem[];
  head: StreamItem[];
  groupsByHostId: ToolCallGroupLookup<TGroup>;
  historyGroupUpdatesByHostId: ToolCallGroupLookup<TGroup>;
}

export interface ToolCallGroupLookup<TGroup> {
  readonly size: number;
  get(id: string): TGroup | undefined;
  has(id: string): boolean;
}

const EMPTY_GROUPS = new Map<string, never>();

export function describeToolCall(item: ToolCallItem): ToolCallDescriptor {
  if (item.payload.source === "agent") {
    const { data } = item.payload;
    return {
      detail: data.detail,
      name: data.name,
      status: data.status,
      error: data.error,
      metadata: data.metadata,
    };
  }

  const { data } = item.payload;
  return {
    detail: {
      type: "unknown",
      input: data.arguments ?? null,
      output: data.result ?? null,
    },
    name: data.toolName,
    status: data.status,
    error: data.error,
  };
}

export function isGroupableToolCall(item: StreamItem): item is ToolCallItem {
  if (item.kind !== "tool_call") {
    return false;
  }
  const descriptor = describeToolCall(item);
  return (
    descriptor.detail.type !== "plan" &&
    !(descriptor.detail.type === "read" && isRasterImagePath(descriptor.detail.filePath)) &&
    descriptor.name.trim().toLowerCase() !== "speak"
  );
}

export function isExplorationToolCall(item: StreamItem): item is ToolCallItem {
  if (!isGroupableToolCall(item)) return false;
  const descriptor = describeToolCall(item);
  if (["read", "search", "shell", "fetch"].includes(descriptor.detail.type)) return true;
  return /(?:^|[_.:/])(?:read|search|grep|glob|bash|shell|exec|web_search)$/.test(
    descriptor.name.trim().toLowerCase(),
  );
}

function createRun(items: readonly ActivityItem[], isSealed: boolean): ToolCallRun {
  const first = items[0];
  const latest = items.at(-1);
  if (!first || !latest) {
    throw new Error("Cannot group an empty activity run");
  }
  return {
    id: first.id,
    items,
    calls: items.filter((item): item is ToolCallItem => item.kind === "tool_call"),
    latest,
    isSealed,
  };
}

function createHost(run: ToolCallRun): ActivityItem {
  if (run.items.length === 1) {
    return run.latest;
  }
  return { ...run.latest, id: run.id };
}

function isRunning(item: ActivityItem): boolean {
  if (item.kind === "thought") return item.status === "loading";
  const status = describeToolCall(item).status;
  return status === "running" || status === "executing";
}

function appendRun<TGroup>(input: {
  items: readonly ActivityItem[];
  isSealed: boolean;
  output: StreamItem[];
  groups: Map<string, TGroup>;
  buildGroup: (run: ToolCallRun) => TGroup;
  minItems: number;
}): void {
  if (input.items.length === 0) {
    return;
  }
  if (input.items.length < input.minItems) {
    input.output.push(...input.items);
    return;
  }
  const run = createRun(input.items, input.isSealed);
  const host = createHost(run);
  input.output.push(host);
  input.groups.set(host.id, input.buildGroup(run));
}

export function prepareGroupedHistory<TGroup>(input: {
  tail: StreamItem[];
  buildGroup: (run: ToolCallRun) => TGroup;
  isGroupable: (item: StreamItem) => item is ActivityItem;
  minItems: number;
}): GroupedHistory<TGroup> {
  const output: StreamItem[] = [];
  const groups = new Map<string, TGroup>();
  let pending: ActivityItem[] = [];

  for (const item of input.tail) {
    if (pending.length > 0 && !continuesTurn(pending.at(-1)!, item)) {
      appendRun({
        items: pending,
        isSealed: true,
        output,
        groups,
        buildGroup: input.buildGroup,
        minItems: input.minItems,
      });
      pending = [];
    }
    if (input.isGroupable(item)) {
      pending.push(item);
      continue;
    }
    appendRun({
      items: pending,
      isSealed: true,
      output,
      groups,
      buildGroup: input.buildGroup,
      minItems: input.minItems,
    });
    pending = [];
    output.push(item);
  }

  appendRun({
    items: pending,
    isSealed: true,
    output,
    groups,
    buildGroup: input.buildGroup,
    minItems: input.minItems,
  });

  return {
    tail: groups.size > 0 ? output : input.tail,
    groupsByHostId: groups,
    pendingItems: pending,
  };
}

export function groupLiveToolCalls<TGroup>(input: {
  history: GroupedHistory<TGroup>;
  head: StreamItem[];
  isTurnActive: boolean;
  buildGroup: (run: ToolCallRun) => TGroup;
  isGroupable: (item: StreamItem) => item is ActivityItem;
  minItems: number;
}): GroupedToolCalls<TGroup> {
  const head: StreamItem[] = [];
  const liveGroups = new Map<string, TGroup>();
  const historyHostedGroupIds = new Set<string>();
  let pending = [...input.history.pendingItems];
  let hostPlacement: "history" | "head" | null = pending.length > 0 ? "history" : null;
  let pendingIncludesHead = false;

  const flush = (isSealed: boolean) => {
    if (pending.length === 0) {
      return;
    }
    const run = createRun(pending, isSealed);
    if (run.items.length < input.minItems) {
      if (hostPlacement === "head") head.push(...run.items);
    } else {
      if (hostPlacement === "head") head.push(createHost(run));
      if (hostPlacement === "head" || pendingIncludesHead || !isSealed) {
        if (hostPlacement === "history") historyHostedGroupIds.add(run.id);
        liveGroups.set(run.id, input.buildGroup(run));
      }
    }
    pending = [];
    hostPlacement = null;
    pendingIncludesHead = false;
  };

  for (const item of input.head) {
    if (pending.length > 0 && !continuesTurn(pending.at(-1)!, item)) {
      flush(true);
    }
    if (input.isGroupable(item)) {
      if (pending.length === 0) {
        hostPlacement = "head";
      }
      pending.push(item);
      pendingIncludesHead = true;
      continue;
    }
    flush(true);
    head.push(item);
  }
  // Tool calls live in retained tail rather than the streaming head. The agent
  // lifecycle snapshot can still be idle while a newly received tool call is
  // already running, so its direct timeline status is the authoritative start
  // signal. The lifecycle state continues to keep completed calls live between
  // sequential tool updates.
  const trailingRunIsActive = input.isTurnActive || pending.some(isRunning);
  flush(!trailingRunIsActive);

  if (liveGroups.size === 0) {
    return {
      tail: input.history.tail,
      head: input.head,
      groupsByHostId: input.history.groupsByHostId,
      historyGroupUpdatesByHostId: EMPTY_GROUPS,
    };
  }
  if (input.history.groupsByHostId.size === 0) {
    const historyUpdates = new Map<string, TGroup>();
    for (const id of historyHostedGroupIds) {
      const group = liveGroups.get(id);
      if (group) historyUpdates.set(id, group);
    }
    return {
      tail: input.history.tail,
      head,
      groupsByHostId: liveGroups,
      historyGroupUpdatesByHostId: historyUpdates.size > 0 ? historyUpdates : EMPTY_GROUPS,
    };
  }
  const groupsByHostId = new Map(input.history.groupsByHostId);
  let historyGroupUpdatesByHostId: Map<string, TGroup> | null = null;
  for (const [id, group] of liveGroups) {
    groupsByHostId.set(id, group);
    if (historyHostedGroupIds.has(id)) {
      historyGroupUpdatesByHostId ??= new Map();
      historyGroupUpdatesByHostId.set(id, group);
    }
  }
  return {
    tail: input.history.tail,
    head,
    groupsByHostId,
    historyGroupUpdatesByHostId: historyGroupUpdatesByHostId ?? EMPTY_GROUPS,
  };
}
