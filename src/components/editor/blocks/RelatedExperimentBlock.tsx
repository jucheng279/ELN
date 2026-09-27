import { useState, useCallback } from 'react';
import { FlaskConical, ExternalLink, X, Search, Link } from 'lucide-react';
import ExperimentStatusBadge from '@/components/eln/ExperimentStatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { ExperimentStatus } from '@/lib/types';

interface RelatedExperimentBlockContent {
  experiment_id: string | null;
  experiment_display_id: string;
  title: string;
  status: string;
}

interface RelatedExperimentBlockProps {
  content: RelatedExperimentBlockContent;
  onUpdate: (content: RelatedExperimentBlockContent) => void;
  readOnly: boolean;
}

export default function RelatedExperimentBlock({
  content,
  onUpdate,
  readOnly,
}: RelatedExperimentBlockProps) {
  const [displayIdInput, setDisplayIdInput] = useState('');
  const [titleInput, setTitleInput] = useState('');

  const isLinked = !!content.experiment_id || !!content.title;

  const handleLinkExperiment = useCallback(() => {
    if (!displayIdInput.trim() || !titleInput.trim()) return;
    onUpdate({
      experiment_id: crypto.randomUUID(),
      experiment_display_id: displayIdInput.trim(),
      title: titleInput.trim(),
      status: 'draft',
    });
    setDisplayIdInput('');
    setTitleInput('');
  }, [displayIdInput, titleInput, onUpdate]);

  const handleUnlink = useCallback(() => {
    onUpdate({
      experiment_id: null,
      experiment_display_id: '',
      title: '',
      status: '',
    });
  }, [onUpdate]);

  if (!isLinked) {
    return (
      <div className="rounded-md border-2 border-dashed border-border p-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FlaskConical className="h-5 w-5" />
            <Search className="h-4 w-4" />
          </div>
          <p className="text-sm text-muted-foreground">Search for an experiment...</p>
          {!readOnly && (
            <div className="w-full max-w-sm space-y-2">
              <Input
                value={displayIdInput}
                onChange={(e) => setDisplayIdInput(e.target.value)}
                placeholder="Experiment ID (e.g. EXP-001)"
                className="h-8 text-sm"
              />
              <Input
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                placeholder="Experiment title"
                className="h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLinkExperiment();
                }}
              />
              <Button
                size="sm"
                onClick={handleLinkExperiment}
                disabled={!displayIdInput.trim() || !titleInput.trim()}
              >
                <Link className="h-3.5 w-3.5 mr-1.5" />
                Link Experiment
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border p-3 flex items-center gap-3">
      <div className="shrink-0 text-muted-foreground">
        <FlaskConical className="h-5 w-5" />
      </div>

      <span className="font-mono text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded shrink-0">
        {content.experiment_display_id}
      </span>

      <span className="font-medium text-foreground truncate">{content.title}</span>

      {content.status && (
        <div className="shrink-0">
          <ExperimentStatusBadge status={content.status as ExperimentStatus} />
        </div>
      )}

      <div className="ml-auto flex items-center gap-1 shrink-0">
        <Tooltip>
          <TooltipTrigger>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <ExternalLink className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open experiment</TooltipContent>
        </Tooltip>

        {!readOnly && (
          <Tooltip>
            <TooltipTrigger>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={handleUnlink}>
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Unlink experiment</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
