import React from "react";
import { Calendar, MapPin, Store, Package, Layers, ShoppingBag } from "lucide-react";

export type TabKey = "today" | "route" | "salons" | "shop" | "orders" | "outbox";

interface NavigationProps {
  activeTab: TabKey;
  onSelectTab: (tab: TabKey) => void;
  pendingCount: number;
}

export const BottomNavigation: React.FC<NavigationProps> = ({
  activeTab,
  onSelectTab,
  pendingCount,
}) => {
  const tabs = [
    { key: "today" as TabKey, label: "Today", icon: Calendar },
    { key: "route" as TabKey, label: "Route", icon: MapPin },
    { key: "salons" as TabKey, label: "Salons", icon: Store },
    { key: "shop" as TabKey, label: "Shop", icon: ShoppingBag },
    { key: "orders" as TabKey, label: "Orders", icon: Package },
    { key: "outbox" as TabKey, label: "Outbox", icon: Layers, badge: pendingCount > 0 ? pendingCount : null },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#1d1a19]/95 backdrop-blur-md border-t border-[#e6dfdb] dark:border-[#3a3330] shadow-lg">
      <div className="max-w-md md:max-w-5xl mx-auto grid grid-cols-6 h-14 items-center px-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onSelectTab(t.key)}
              className={`flex flex-col items-center justify-center h-full min-h-[44px] min-w-[44px] relative transition-colors ${
                isActive
                  ? "text-[#7a2e4a] dark:text-[#d77a9c] font-bold"
                  : "text-[#6b625e] dark:text-[#a59b96] hover:text-[#1d1a19] dark:hover:text-white"
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 transition-transform ${isActive ? "scale-105" : ""}`} />
                {t.badge && (
                  <span className="absolute -top-1.5 -right-2.5 bg-amber-600 text-white text-[9px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center">
                    {t.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] tracking-tight mt-0.5 leading-none whitespace-nowrap">
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
