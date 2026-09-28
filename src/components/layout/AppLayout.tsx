import { useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  FlaskRound,
  User,
  Clock,
  Star,
  Search,
  BookOpen,
  Plus,
  FileText,
  FlaskConical,
  Archive,
  Settings,
  LogOut,
  Menu,
  ChevronDown,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useNotebookStore } from '@/stores/notebookStore';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';
import NotificationCenter from '@/components/notifications/NotificationCenter';

import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
  CommandGroup,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';

/* ------------------------------------------------------------------ */
/*  Navigation definitions                                            */
/* ------------------------------------------------------------------ */

const primaryNav = [
  { to: '/app', label: 'All Experiments', icon: FlaskRound, end: true },
  { to: '/app/my-experiments', label: 'My Experiments', icon: User, end: false },
  { to: '/app/recent', label: 'Recent', icon: Clock, end: false },
  { to: '/app/favorites', label: 'Favorites', icon: Star, end: false },
  { to: '/app/search', label: 'Search', icon: Search, end: false },
];

const libraryNav = [
  { to: '/app/templates', label: 'Templates', icon: FileText },
  { to: '/app/protocols', label: 'Protocols', icon: FlaskConical },
  { to: '/app/archived', label: 'Archive', icon: Archive },
];

/* ------------------------------------------------------------------ */
/*  Sidebar content (shared between desktop sidebar & mobile Sheet)   */
/* ------------------------------------------------------------------ */

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuthStore();
  const {
    workspaces,
    currentWorkspace,
    selectWorkspace,
  } = useWorkspaceStore();
  const { notebooks } = useNotebookStore();

  const displayName = profile?.display_name || user?.email || 'User';
  const initials = displayName
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  async function handleSwitchWorkspace(id: string) {
    await selectWorkspace(id);
  }

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  function nav(path: string) {
    onNavigate?.();
    navigate(path);
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* ── Workspace switcher ── */}
      <div className="px-3 pt-3 pb-2">
        <Popover>
          <PopoverTrigger
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
              {currentWorkspace?.name?.charAt(0).toUpperCase() ?? 'W'}
            </span>
            <span className="flex-1 truncate text-sm font-semibold">
              {currentWorkspace?.name ?? 'Workspace'}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-sidebar-foreground/50" />
          </PopoverTrigger>

          <PopoverContent align="start" sideOffset={6} className="w-60 p-0">
            <Command>
              <CommandInput placeholder="Search workspaces…" />
              <CommandList>
                <CommandEmpty>No workspaces found.</CommandEmpty>
                <CommandGroup>
                  {workspaces.map((ws) => (
                    <CommandItem
                      key={ws.id}
                      value={ws.name}
                      onSelect={() => handleSwitchWorkspace(ws.id)}
                      data-checked={ws.id === currentWorkspace?.id ? true : undefined}
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary text-[9px] font-bold text-primary-foreground">
                        {ws.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="truncate">{ws.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => nav('/workspaces')}>
                    <Settings className="size-4" />
                    Manage workspaces
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <Separator />

      {/* ── Navigation ── */}
      <ScrollArea className="flex-1">
        <nav className="px-3 py-2">
          {/* Primary */}
          <div className="space-y-0.5">
            {primaryNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                  )
                }
              >
                <item.icon className="size-4 shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </div>

          <Separator className="my-3" />

          {/* Notebooks */}
          <div>
            <div className="flex items-center justify-between px-2.5 mb-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
                Notebooks
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-sidebar-foreground/40 hover:text-sidebar-foreground"
                onClick={() => nav('/app/notebooks/new')}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
            <div className="space-y-0.5">
              {notebooks.map((nb) => (
                <NavLink
                  key={nb.id}
                  to={`/app/notebooks/${nb.id}`}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                    )
                  }
                >
                  <BookOpen className="size-4 shrink-0" />
                  <span className="truncate">{nb.name}</span>
                </NavLink>
              ))}
              {notebooks.length === 0 && (
                <p className="px-2.5 py-1 text-xs text-sidebar-foreground/40">
                  No notebooks yet
                </p>
              )}
            </div>
          </div>

          <Separator className="my-3" />

          {/* Library */}
          <div>
            <span className="mb-1 block px-2.5 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
              Library
            </span>
            <div className="space-y-0.5">
              {libraryNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                    )
                  }
                >
                  <item.icon className="size-4 shrink-0" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>

          <Separator className="my-3" />

          {/* Settings */}
          <NavLink
            to="/app/settings"
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
              )
            }
          >
            <Settings className="size-4 shrink-0" />
            Settings
          </NavLink>
        </nav>
      </ScrollArea>

      <Separator />

      {/* ── User section ── */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <Avatar size="sm">
          {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt={displayName} />}
          <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium leading-tight">{displayName}</p>
          <p className="truncate text-[11px] text-sidebar-foreground/50">{user?.email}</p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-sidebar-foreground/40 hover:text-sidebar-foreground"
                  onClick={handleSignOut}
                />
              }
            >
              <LogOut className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main layout                                                       */
/* ------------------------------------------------------------------ */

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, signOut } = useAuthStore();
  const {
    workspaces,
    currentWorkspace,
    fetchWorkspaces,
    selectWorkspace,
  } = useWorkspaceStore();
  const { fetchNotebooks } = useNotebookStore();

  /* ── Bootstrap data ── */
  useEffect(() => {
    if (workspaces.length === 0) {
      fetchWorkspaces();
    }
  }, [workspaces.length, fetchWorkspaces]);

  useEffect(() => {
    if (!currentWorkspace && workspaces.length > 0) {
      selectWorkspace(workspaces[0].id);
    }
  }, [currentWorkspace, workspaces, selectWorkspace]);

  useEffect(() => {
    if (currentWorkspace) {
      fetchNotebooks(currentWorkspace.id);
    }
  }, [currentWorkspace, fetchNotebooks]);

  useEffect(() => {
    if (workspaces.length === 0 && !currentWorkspace) {
      const timer = setTimeout(() => navigate('/workspaces'), 1500);
      return () => clearTimeout(timer);
    }
  }, [workspaces.length, currentWorkspace, navigate]);

  /* ── Loading state ── */
  if (!currentWorkspace) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  /* ── Derived values ── */
  const displayName = profile?.display_name || user?.email || 'User';
  const initials = displayName
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const pathParts = location.pathname
    .replace('/app', '')
    .split('/')
    .filter(Boolean);

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* ── Desktop sidebar ── */}
        <aside className="hidden w-[248px] shrink-0 border-r border-sidebar-border lg:flex">
          <SidebarContent />
        </aside>

        {/* ── Main column ── */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* ── Top bar ── */}
          <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-background px-3">
            <div className="flex items-center gap-2">
              {/* Mobile menu */}
              <Sheet>
                <SheetTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" className="lg:hidden" />
                  }
                >
                  <Menu className="size-4" />
                </SheetTrigger>
                <SheetContent side="left" showCloseButton={false} className="w-[248px] p-0">
                  <SheetTitle className="sr-only">Navigation</SheetTitle>
                  <SheetDescription className="sr-only">Application sidebar navigation</SheetDescription>
                  <SidebarContent />
                </SheetContent>
              </Sheet>

              {/* Breadcrumb */}
              <Breadcrumb>
                <BreadcrumbList className="text-sm">
                  <BreadcrumbItem>
                    {pathParts.length > 0 ? (
                      <BreadcrumbLink
                        render={<NavLink to="/app" />}
                      >
                        {currentWorkspace.name}
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{currentWorkspace.name}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                  {pathParts.map((part, i) => {
                    const isLast = i === pathParts.length - 1;
                    const segmentPath =
                      '/app/' + pathParts.slice(0, i + 1).join('/');
                    const label =
                      part.charAt(0).toUpperCase() +
                      part.slice(1).replace(/-/g, ' ');

                    return (
                      <BreadcrumbItem key={i}>
                        <BreadcrumbSeparator />
                        {isLast ? (
                          <BreadcrumbPage>{label}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink
                            render={<NavLink to={segmentPath} />}
                          >
                            {label}
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    );
                  })}
                </BreadcrumbList>
              </Breadcrumb>
            </div>

            {/* Right actions */}
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => useUIStore.getState().openCreateExperiment()}
              >
                <Plus className="size-3.5" />
                New
              </Button>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => navigate('/app/search')}
                    />
                  }
                >
                  <Search className="size-4" />
                </TooltipTrigger>
                <TooltipContent>Search</TooltipContent>
              </Tooltip>

              <NotificationCenter />

              <DropdownMenu>
                <DropdownMenuTrigger className="ml-0.5 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar size="sm">
                    {profile?.avatar_url && (
                      <AvatarImage src={profile.avatar_url} alt={displayName} />
                    )}
                    <AvatarFallback className="text-[10px]">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={6} className="w-44">
                  <DropdownMenuItem
                    onSelect={() => navigate('/app/settings')}
                  >
                    <Settings className="size-4" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={handleSignOut}
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* ── Content area ── */}
          <main className="flex-1 overflow-y-auto bg-background">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
