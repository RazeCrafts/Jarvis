import { AnimatePresence, motion } from "framer-motion";
import { ShieldAlert } from "lucide-react";
import { agentService } from "@/lib/agentService";
import { useUiStore } from "@/store";

/**
 * Global approve/deny dialog for dangerous tool calls coming from the agent
 * (terminal/shell, computer use, file writes). Blocks the backend tool until
 * the user answers — the guardrail waits on the other side of the socket.
 */
export function ConfirmationDialog() {
  const pending = useUiStore((s) => s.pendingConfirmation);

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          role="alertdialog"
          aria-label="Confirm agent action"
        >
          <motion.div
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="glass w-[380px] rounded-2xl p-5 shadow-2xl"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
                <ShieldAlert size={18} />
              </span>
              <div>
                <h2 className="text-sm font-medium">JARVIS wants to act</h2>
                <p className="text-[11px] text-fg-muted">This action can affect your system.</p>
              </div>
            </div>

            <div className="mt-3.5 rounded-xl bg-black/30 p-3">
              <p className="font-mono text-xs text-accent">{pending.tool}</p>
              <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-fg-muted">
                {JSON.stringify(pending.args, null, 2)}
              </pre>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => agentService.resolveConfirmation(pending.requestId, true)}
                className="flex-1 rounded-xl bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => agentService.resolveConfirmation(pending.requestId, false)}
                className="flex-1 rounded-xl bg-white/5 px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-white/10 hover:text-fg"
              >
                Deny
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
