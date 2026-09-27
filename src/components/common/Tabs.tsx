interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
}

export default function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="flex items-center gap-0 border-b border-gray-200">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={[
              'relative px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap',
              isActive
                ? 'text-blue-600'
                : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={[
                  'ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-xs',
                  isActive
                    ? 'bg-blue-50 text-blue-600'
                    : 'bg-gray-100 text-gray-500',
                ].join(' ')}
              >
                {tab.count}
              </span>
            )}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t" />
            )}
          </button>
        );
      })}
    </div>
  );
}
