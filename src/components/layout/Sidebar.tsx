import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { TABS, type TabDef } from "@/lib/tabs";
import { useUiStore } from "@/store";

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
      title={tab.label}
      className={cn(
        "group relative flex h-13 w-14 flex-col items-center justify-center gap-1 rounded-xl py-2 transition-colors",
        active ? "bg-surface text-accent" : "text-fg-muted hover:bg-surface hover:text-fg",
      )}
    >
      {active && (
        <motion.span
          layoutId="rail-indicator"
          className="absolute -left-1.5 bottom-2.5 top-2.5 w-0.5 rounded-full bg-accent"
          transition={{ type: "spring", stiffness: 500, damping: 38 }}
        />
      )}
      <Icon size={19} strokeWidth={1.7} />
      <span
        className={cn(
          "text-[9px] font-medium leading-none tracking-wide transition-colors",
          active ? "text-accent" : "text-fg-muted group-hover:text-fg",
        )}
      >
        {tab.shortLabel}
      </span>
    </button>
  );
}

export function Sidebar() {
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);

  return (
    <nav aria-label="Main" className="relative z-20 flex w-16 shrink-0 flex-col items-center justify-between pb-3 pt-1">
      <div className="flex flex-col items-center gap-1">
        {TABS.filter((t) => t.position === "top").map((tab) => (
          <SidebarButton
            key={tab.id}
            tab={tab}
            active={activeTab === tab.id}
            onSelect={() => setActiveTab(tab.id)}
          />
        ))}
      </div>

      <div className="flex flex-col items-center gap-1">
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
