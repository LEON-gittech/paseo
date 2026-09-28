import React, { memo, useCallback, useMemo, useRef, type ReactNode } from "react";
import { ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { Brain, Search, SquareTerminal, Wrench } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { ExpandableBadge } from "@/components/message";
import { useIsCompactFormFactor } from "@/constants/layout";
import { describeToolCall, type ToolCallRun } from "../grouping";
import { type OverviewSummary, type OverviewToolCallGroup } from "./model";
import { OverviewToolCallGroupSheet } from "./sheet";

interface OverviewGroupProps {
  group: OverviewToolCallGroup;
  expanded: boolean;
  isLastInSequence: boolean;
  onExpandedChange: (groupId: string, expanded: boolean) => void;
  children: ReactNode;
}

const TOOL_CALL_GROUP_MAX_HEIGHT = 400;

function joinSummaryParts(parts: string[], conjunction: string): string {
  if (parts.length === 0) {
    return "";
  }
  let joined = parts[0] ?? "";
  if (parts.length === 2) {
    joined = `${parts[0]} ${conjunction} ${parts[1]}`;
  } else if (parts.length > 2) {
    joined = `${parts.slice(0, -1).join(", ")}, ${conjunction} ${parts.at(-1)}`;
  }
  const firstCharacter = joined[0];
  return firstCharacter ? `${firstCharacter.toLocaleUpperCase()}${joined.slice(1)}` : joined;
}

function useOverviewSummary(summary: OverviewSummary, hasThoughts: boolean): string {
  const { t } = useTranslation();
  return useMemo(() => {
    const parts: string[] = [];
    const entries = [
      [summary.editedFileCount, "toolCallGroup.editedFiles"],
      [summary.commandCount, "toolCallGroup.commands"],
      [summary.readFileCount, "toolCallGroup.readFiles"],
      [summary.searchCount, "toolCallGroup.searches"],
      [summary.otherToolCount, "toolCallGroup.otherTools"],
      [summary.paseoCallCount, "toolCallGroup.paseoCalls"],
    ] as const;
    for (const [count, key] of entries) {
      if (count > 0) {
        parts.push(t(`${key}.${count === 1 ? "one" : "other"}`, { count }));
      }
    }
    if (parts.length > 0) return joinSummaryParts(parts, t("toolCallGroup.and"));
    return hasThoughts ? t("toolCallGroup.thinking") : "";
  }, [hasThoughts, summary, t]);
}

function latestActivityPreview(run: ToolCallRun): string | undefined {
  const latest = run.items.at(-1);
  if (!latest || latest.kind !== "tool_call") return undefined;
  const descriptor = describeToolCall(latest);
  const detail = descriptor.detail;
  let text: string | undefined = descriptor.name;
  if (detail.type === "read") text = detail.filePath.split(/[/\\]/).at(-1);
  else if (detail.type === "search") text = detail.query;
  else if (detail.type === "shell") text = detail.command.split("\n")[0];
  return text?.trim().slice(0, 96) || undefined;
}

function groupIcon(summary: OverviewSummary, hasThoughts: boolean) {
  if (summary.editedFileCount > 0) return Wrench;
  if (summary.commandCount > 0) return SquareTerminal;
  if (summary.readFileCount > 0 || summary.searchCount > 0) return Search;
  return hasThoughts ? Brain : Wrench;
}

export const OverviewToolCallGroupView = memo(function OverviewToolCallGroupView({
  group,
  expanded,
  isLastInSequence,
  onExpandedChange,
  children,
}: OverviewGroupProps) {
  const scrollRef = useRef<ScrollView>(null);
  const isCompact = useIsCompactFormFactor();
  const hasThoughts = group.run.items.some((item) => item.kind === "thought");
  const aggregateSummary = useOverviewSummary(group.summary, hasThoughts);
  const isError = group.run.calls.some((call) => describeToolCall(call).status === "failed");
  const icon = groupIcon(group.summary, hasThoughts);
  const secondaryLabel = group.isLoading ? latestActivityPreview(group.run) : undefined;
  const scrollToLatest = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);
  const toggle = useCallback(() => {
    onExpandedChange(group.run.id, !expanded);
  }, [expanded, group.run.id, onExpandedChange]);
  const close = useCallback(() => {
    onExpandedChange(group.run.id, false);
  }, [group.run.id, onExpandedChange]);
  const renderDetails = useCallback(
    () => (
      <ScrollView
        ref={scrollRef}
        style={[styles.scroll, !group.run.isSealed && styles.activeScroll]}
        contentContainerStyle={styles.content}
        nestedScrollEnabled
        showsVerticalScrollIndicator
        onContentSizeChange={scrollToLatest}
      >
        {children}
      </ScrollView>
    ),
    [children, group.run.isSealed, scrollToLatest],
  );

  if (isCompact) {
    return (
      <>
        <ExpandableBadge
          testID={group.mode === "progressive" ? "activity-group" : "tool-call-group"}
          label={aggregateSummary}
          secondaryLabel={secondaryLabel}
          icon={icon}
          isLoading={group.isLoading}
          isError={isError}
          isExpanded={false}
          isLastInSequence={isLastInSequence}
          onToggle={toggle}
        />
        <OverviewToolCallGroupSheet
          visible={expanded}
          summary={aggregateSummary}
          icon={icon}
          onClose={close}
        >
          {children}
        </OverviewToolCallGroupSheet>
      </>
    );
  }

  return (
    <ExpandableBadge
      testID={group.mode === "progressive" ? "activity-group" : "tool-call-group"}
      label={aggregateSummary}
      secondaryLabel={secondaryLabel}
      icon={icon}
      isLoading={group.isLoading}
      isError={isError}
      isExpanded={expanded}
      isLastInSequence={isLastInSequence}
      onToggle={toggle}
      renderDetails={renderDetails}
      borderlessWhenExpanded
    />
  );
});

const styles = StyleSheet.create((theme) => ({
  scroll: {
    maxHeight: TOOL_CALL_GROUP_MAX_HEIGHT,
  },
  activeScroll: {
    maxHeight: 240,
  },
  content: {
    paddingTop: theme.spacing[1],
    paddingHorizontal: 13,
  },
}));
