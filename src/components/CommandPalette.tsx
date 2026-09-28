import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FlaskConical, Star, Clock, Search, Settings, LayoutTemplate,
  BookOpen, Plus, FolderPlus, User, Archive,
} from 'lucide-react';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { useUIStore } from '@/stores/uiStore';

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const openCreateExperiment = useUIStore((s) => s.openCreateExperiment);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const runCommand = useCallback((command: () => void) => {
    setOpen(false);
    command();
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => runCommand(() => openCreateExperiment())}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Experiment
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => navigate('/app/notebooks/new'))}
          >
            <FolderPlus className="mr-2 h-4 w-4" />
            New Notebook
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => runCommand(() => navigate('/app/experiments'))}>
            <FlaskConical className="mr-2 h-4 w-4" />
            All Experiments
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/my-experiments'))}>
            <User className="mr-2 h-4 w-4" />
            My Experiments
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/favorites'))}>
            <Star className="mr-2 h-4 w-4" />
            Favorites
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/recent'))}>
            <Clock className="mr-2 h-4 w-4" />
            Recent
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/templates'))}>
            <LayoutTemplate className="mr-2 h-4 w-4" />
            Templates
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/protocols'))}>
            <BookOpen className="mr-2 h-4 w-4" />
            Protocols
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/archived'))}>
            <Archive className="mr-2 h-4 w-4" />
            Archive
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/search'))}>
            <Search className="mr-2 h-4 w-4" />
            Search
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/settings'))}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
