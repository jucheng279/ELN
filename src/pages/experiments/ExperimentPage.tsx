import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useExperimentStore } from '@/stores/experimentStore';
import ExperimentHeader from '@/components/experiments/ExperimentHeader';
import BlockEditor from '@/components/editor/BlockEditor';
import DetailsPanel from '@/components/experiments/panels/DetailsPanel';
import CommentsPanel from '@/components/experiments/panels/CommentsPanel';
import HistoryPanel from '@/components/experiments/panels/HistoryPanel';
import ReviewPanel from '@/components/experiments/panels/ReviewPanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  Loader2,
  Lock,
  PanelRightOpen,
  PanelRightClose,
  MessageSquare,
  History,
  FileCheck,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type SidebarTab = 'details' | 'comments' | 'history' | 'review';

const SIDEBAR_TABS: {
  id: SidebarTab;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: 'details', label: 'Details', icon: Info },
  { id: 'comments', label: 'Comments', icon: MessageSquare },
  { id: 'history', label: 'History', icon: History },
  { id: 'review', label: 'Review', icon: FileCheck },
];

export default function ExperimentPage() {
  const { id } = useParams<{ id: string }>();
  const { currentExperiment, saving, lastSaved, loading, fetchExperiment } =
    useExperimentStore();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<SidebarTab>('details');
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

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
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!currentExperiment) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Info className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-lg font-medium text-foreground">
          Experiment not found
        </p>
        <p className="text-sm">
          The experiment you&apos;re looking for doesn&apos;t exist or you
          don&apos;t have access.
        </p>
      </div>
    );
  }

  const readOnly = !!currentExperiment.is_locked;

  const sidebarContent = (
    <Tabs
      value={activeTab}
      onValueChange={(val) => setActiveTab(val as SidebarTab)}
      className="flex h-full flex-col"
    >
      <TabsList variant="line" className="w-full shrink-0 border-b px-1">
        {SIDEBAR_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="gap-1.5 text-xs"
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
      <TabsContent value="details" className="flex-1 overflow-y-auto">
        <DetailsPanel />
      </TabsContent>
      <TabsContent value="comments" className="flex-1 overflow-hidden">
        <CommentsPanel />
      </TabsContent>
      <TabsContent value="history" className="flex-1 overflow-hidden">
        <HistoryPanel />
      </TabsContent>
      <TabsContent value="review" className="flex-1 overflow-hidden">
        <ReviewPanel />
      </TabsContent>
    </Tabs>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Locked banner */}
      {currentExperiment.is_locked && (
        <div
          className={cn(
            'flex items-center gap-2 border-b px-4 py-2 text-sm',
            'bg-amber-50 border-amber-200 text-amber-800',
            'dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300'
          )}
        >
          <Lock className="h-4 w-4 shrink-0" />
          <span>This experiment is locked and cannot be edited.</span>
        </div>
      )}

      {/* Header (save status is now inline) */}
      <ExperimentHeader
        experiment={currentExperiment}
        readOnly={readOnly}
        saving={saving}
        lastSaved={lastSaved}
      />

      {/* Main content + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor area */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-8 py-6">
            <BlockEditor
              experimentId={currentExperiment.id}
              readOnly={readOnly}
            />
          </div>
        </div>

        {/* Desktop sidebar toggle */}
        <div className="hidden md:flex">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="mt-2 mr-1"
                  onClick={toggleSidebar}
                />
              }
            >
              {sidebarOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </TooltipTrigger>
            <TooltipContent side="left">
              {sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Desktop sidebar */}
        {sidebarOpen && (
          <div
            className={cn(
              'hidden md:flex w-[340px] shrink-0 flex-col border-l bg-background'
            )}
          >
            {sidebarContent}
          </div>
        )}

        {/* Mobile sidebar trigger + Sheet */}
        <div className="fixed bottom-4 right-4 z-40 md:hidden">
          <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
            <SheetTrigger
              render={
                <Button
                  size="icon"
                  className="h-10 w-10 rounded-lg shadow-lg"
                />
              }
            >
              <PanelRightOpen className="h-5 w-5" />
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-[340px] p-0"
              showCloseButton
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Experiment sidebar</SheetTitle>
              </SheetHeader>
              {sidebarContent}
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </div>
  );
}
