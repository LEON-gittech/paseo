import type { StreamItem } from "@/types/stream";
import type { ToolCallDetailLevel } from "@/hooks/use-settings/storage";
import {
  groupLiveToolCalls,
  isExplorationToolCall,
  isGroupableToolCall,
  prepareGroupedHistory,
  type ActivityItem,
  type GroupedHistory,
  type GroupedToolCalls,
} from "./grouping";
import { buildOverviewGroup, type OverviewToolCallGroup } from "./overview/model";

export type { ToolCallDetailLevel } from "@/hooks/use-settings/storage";
export type ToolCallDetailGroup = OverviewToolCallGroup;

export interface PreparedToolCallHistory {
  mode: ToolCallDetailLevel;
  grouped: GroupedHistory<ToolCallDetailGroup>;
}

export interface ToolCallDetailProjection extends GroupedToolCalls<ToolCallDetailGroup> {}

// Approval UI owns pending plan presentation. Retain the canonical tool in the
// stream model so resolving it can reveal a card at its original position.
const visibleItemsCache = new WeakMap<StreamItem[], StreamItem[]>();
function visibleToolCallItems(items: StreamItem[]): StreamItem[] {
  const cached = visibleItemsCache.get(items);
  if (cached) return cached;
  const visible = items.filter((item) => {
    if (item.kind !== "tool_call" || item.payload.source !== "agent") return true;
    const data = item.payload.data;
    return (
      data.name !== "ExitPlanMode" && !(data.name === "plan_approval" && data.status === "running")
    );
  });
  const result = visible.length === items.length ? items : visible;
  visibleItemsCache.set(items, result);
  return result;
}

export function prepareToolCallHistory(
  level: ToolCallDetailLevel,
  tail: StreamItem[],
  groupReasoning = true,
): PreparedToolCallHistory {
  const isGroupable = (item: StreamItem): item is ActivityItem =>
    (groupReasoning && item.kind === "thought") ||
    (level === "overview" ? isGroupableToolCall(item) : isExplorationToolCall(item));
  return {
    mode: level,
    grouped: prepareGroupedHistory({
      tail: visibleToolCallItems(tail),
      buildGroup: (run) =>
        buildOverviewGroup(run, level === "overview" ? "overview" : "progressive"),
      isGroupable,
      minItems: level === "overview" ? 1 : 2,
    }),
  };
}

export function projectToolCallDetailLevel(input: {
  level: ToolCallDetailLevel;
  tail: StreamItem[];
  head: StreamItem[];
  preparedHistory: PreparedToolCallHistory | null;
  isTurnActive: boolean;
  groupReasoning?: boolean;
}): ToolCallDetailProjection {
  if (!input.preparedHistory || input.preparedHistory.mode !== input.level) {
    throw new Error(`Missing prepared ${input.level} tool call history`);
  }
  const isGroupable = (item: StreamItem): item is ActivityItem =>
    (input.groupReasoning !== false && item.kind === "thought") ||
    (input.level === "overview" ? isGroupableToolCall(item) : isExplorationToolCall(item));
  return groupLiveToolCalls({
    history: input.preparedHistory.grouped,
    head: visibleToolCallItems(input.head),
    isTurnActive: input.isTurnActive,
    buildGroup: (run) =>
      buildOverviewGroup(run, input.level === "overview" ? "overview" : "progressive"),
    isGroupable,
    minItems: input.level === "overview" ? 1 : 2,
  });
}
