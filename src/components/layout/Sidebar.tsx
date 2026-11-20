import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { TABS, type TabDef } from "@/lib/tabs";
import { useAgentStore, useUiStore } from "@/store";

function Tooltip({ children }: { children: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-elevated px-2.5 py-1 text-xs text-fg opacity-0 shadow-lg ring-1 ring-border transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
    >
      {children}
    </span>
  );
}

function SidebarButton({
  tab,
  active,
  onSelect,
}: {
  tab: TabDef;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={tab.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-13 w-14 flex-col items-center justify-center gap-1 rounded-xl py-2 transition-colors",
        active ? "text-accent" : "text-fg-muted hover:bg-white/5 hover:text-fg",
      )}
    >
      {active && (
        <motion.span
          layoutId="rail-indicator"
          className="absolute -left-1.5 bottom-2.5 top-2.5 w-0.5 rounded-full bg-accent shadow-[0_0_10px_rgb(0_212_255/0.8)]"
          transition={{ type: "spring", stiffness: 500, damping: 38 }}
        />
      )}
      <Icon
        size={20}
        strokeWidth={1.6}
        className={cn(
          "transition-[filter]",
          active ? "drop-shadow-[0_0_6px_rgb(0_212_255/0.6)]" : "",
        )}
      />
      <span
        className={cn(
          "text-[9px] leading-none tracking-wide transition-colors",
          active ? "text-accent/90" : "text-fg-muted group-hover:text-fg/80",
        )}
      >
        {tab.label}
      </span>
    </button>
  );
}

function ConnectionDot() {
  const isConnected = useAgentStore((s) => s.isConnected);
  const label = isConnected ? "Backend connected" : "Backend offline";
  return (
    <div className="group relative flex h-6 w-6 items-center justify-center" role="status" aria-label={label}>
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          isConnected ? "bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153/0.7)]" : "bg-fg-muted/50",
        )}
      />
      <Tooltip>{label}</Tooltip>
    </div>
  );
}

export function Sidebar() {
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const setSidebarHovered = useUiStore((s) => s.setSidebarHovered);

  return (
    <nav
      aria-label="Main"
      className="relative z-20 flex w-16 shrink-0 flex-col items-center justify-between pb-3 pt-1"
      onMouseEnter={() => setSidebarHovered(true)}
      onMouseLeave={() => setSidebarHovered(false)}
    >
      <div className="flex flex-col items-center gap-1.5">
        {TABS.filter((t) => t.position === "top").map((tab) => (
          <SidebarButton
            key={tab.id}
            tab={tab}
            active={activeTab === tab.id}
            onSelect={() => setActiveTab(tab.id)}
          />
        ))}
      </div>

      <div className="flex flex-col items-center gap-2">
        <ConnectionDot />
        {TABS.filter((t) => t.position === "bottom").map((tab) => (
          <SidebarButton
            key={tab.id}
            tab={tab}
            active={activeTab === tab.id}
            onSelect={() => setActiveTab(tab.id)}
          />
        ))}
      </div>
    </nav>
  );
}
