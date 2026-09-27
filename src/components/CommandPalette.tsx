import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  FlaskConical,
  User,
  Star,
  Clock,
  FileText,
  BookOpen,
  Search,
  Settings,
  Plus,
  NotebookPen,
} from 'lucide-react';

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const runCommand = useCallback(
    (command: () => void) => {
      setOpen(false);
      command();
    },
    [],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => runCommand(() => navigate('/app/experiments'))}>
            <FlaskConical />
            <span>Experiments</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/my-experiments'))}>
            <User />
            <span>My Experiments</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/favorites'))}>
            <Star />
            <span>Favorites</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/recent'))}>
            <Clock />
            <span>Recent</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/templates'))}>
            <FileText />
            <span>Templates</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/protocols'))}>
            <BookOpen />
            <span>Protocols</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/search'))}>
            <Search />
            <span>Search</span>
            <CommandShortcut>⌘F</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/settings'))}>
            <Settings />
            <span>Settings</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => runCommand(() => navigate('/app/experiments'))}>
            <Plus />
            <span>New Experiment</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/app/notebooks/new'))}>
            <NotebookPen />
            <span>New Notebook</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
