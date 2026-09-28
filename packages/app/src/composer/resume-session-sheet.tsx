import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { useNavigateToImportedAgent } from "@/hooks/use-import-session";

export function ResumeSessionSheet({
  client,
  serverId,
  preferredProviderId,
  onClose,
}: {
  client: DaemonClient | null;
  serverId: string;
  preferredProviderId?: string;
  onClose: () => void;
}) {
  const navigateToImportedAgent = useNavigateToImportedAgent(serverId);
  return (
    <ImportSessionSheet
      visible
      client={client}
      serverId={serverId}
      preferredProviderId={preferredProviderId}
      onClose={onClose}
      onImported={navigateToImportedAgent}
    />
  );
}
