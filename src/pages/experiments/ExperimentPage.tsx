import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useExperimentStore } from '@/stores/experimentStore';
import ExperimentHeader from '@/components/experiments/ExperimentHeader';
import BlockEditor from '@/components/editor/BlockEditor';
import DetailsPanel from '@/components/experiments/panels/DetailsPanel';
import CommentsPanel from '@/components/experiments/panels/CommentsPanel';
import HistoryPanel from '@/components/experiments/panels/HistoryPanel';
import ReviewPanel from '@/components/experiments/panels/ReviewPanel';
import {
  Loader2,
  Check,
  Clock,
  PanelRightOpen,
  PanelRightClose,
  MessageSquare,
  History,
  FileCheck,
  Info,
} from 'lucide-react';

type SidebarTab = 'details' | 'comments' | 'history' | 'review';

const SIDEBAR_TABS: { id: SidebarTab; label: string; icon: React.ElementType }[] = [
  { id: 'details', label: 'Details', icon: Info },
  { id: 'comments', label: 'Comments', icon: MessageSquare },
  { id: 'history', label: 'History', icon: History },
  { id: 'review', label: 'Review', icon: FileCheck },
];

export default function ExperimentPage() {
  const { id } = useParams<{ id: string }>();
  const {
    currentExperiment,
    saving,
    lastSaved,
    loading,
    fetchExperiment,
  } = useExperimentStore();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<SidebarTab>('details');

  useEffect(() => {
    if (id) {
      fetchExperiment(id);
    }
  }, [id, fetchExperiment]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!currentExperiment) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-500">
        <Info className="h-10 w-10 text-gray-300" />
        <p className="text-lg font-medium">Experiment not found</p>
        <p className="text-sm">The experiment you're looking for doesn't exist or you don't have access.</p>
      </div>
    );
  }

  const readOnly = !!currentExperiment.is_locked;

  return (
    <div className="flex h-full flex-col">
      {/* Locked banner */}
      {currentExperiment.is_locked && (
        <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
          <Clock className="h-4 w-4 shrink-0" />
          <span>This experiment is locked and cannot be edited.</span>
        </div>
      )}

      {/* Header */}
      <ExperimentHeader experiment={currentExperiment} readOnly={readOnly} />

      {/* Main content + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main content area */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-8 py-6">
            <BlockEditor
              experimentId={currentExperiment.id}
              readOnly={readOnly}
            />
          </div>
        </div>

        {/* Sidebar toggle */}
        <button
          onClick={toggleSidebar}
          className="flex items-center self-start p-2 text-gray-400 hover:text-gray-600"
          title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          {sidebarOpen ? (
            <PanelRightClose className="h-5 w-5" />
          ) : (
            <PanelRightOpen className="h-5 w-5" />
          )}
        </button>

        {/* Right sidebar */}
        {sidebarOpen && (
          <div className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
            {/* Sidebar tabs */}
            <div className="flex border-b border-gray-200">
              {SIDEBAR_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition-colors ${
                      isActive
                        ? 'border-b-2 border-blue-600 text-blue-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Sidebar content */}
            <div className="flex-1 overflow-y-auto">
              {activeTab === 'details' && <DetailsPanel />}
              {activeTab === 'comments' && <CommentsPanel />}
              {activeTab === 'history' && <HistoryPanel />}
              {activeTab === 'review' && <ReviewPanel />}
            </div>
          </div>
        )}
      </div>

      {/* Save status indicator */}
      <div className="fixed bottom-4 left-4 z-50">
        <div className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium shadow-md border border-gray-200">
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
              <span className="text-gray-500">Saving...</span>
            </>
          ) : lastSaved ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-500" />
              <span className="text-gray-500">Saved</span>
            </>
          ) : (
            <>
              <Clock className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-amber-600">Unsaved changes</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
