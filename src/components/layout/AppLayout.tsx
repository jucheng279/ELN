import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  ChevronDown,
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
  Bell,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useNotebookStore } from '@/stores/notebookStore';
import DropdownMenu from '@/components/common/DropdownMenu';

const navItems = [
  { to: '/app', label: 'All Experiments', icon: FlaskRound, end: true },
  { to: '/app/my-experiments', label: 'My Experiments', icon: User, end: false },
  { to: '/app/recent', label: 'Recent', icon: Clock, end: false },
  { to: '/app/favorites', label: 'Favorites', icon: Star, end: false },
  { to: '/app/search', label: 'Search', icon: Search, end: false },
];

const bottomNavItems = [
  { to: '/app/templates', label: 'Templates', icon: FileText },
  { to: '/app/protocols', label: 'Protocols', icon: FlaskConical },
  { to: '/app/archived', label: 'Archive', icon: Archive },
];

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
  const { notebooks, fetchNotebooks } = useNotebookStore();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);

  // Bootstrap: fetch workspaces, select first, fetch notebooks
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

  // Redirect to workspace picker when none exist after fetching
  useEffect(() => {
    if (workspaces.length === 0 && !currentWorkspace) {
      const timer = setTimeout(() => {
        navigate('/workspaces');
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [workspaces.length, currentWorkspace, navigate]);

  if (!currentWorkspace) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
      </div>
    );
  }

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  async function handleSwitchWorkspace(id: string) {
    await selectWorkspace(id);
    setWsDropdownOpen(false);
  }

  // Breadcrumb segments
  const pathParts = location.pathname.replace('/app', '').split('/').filter(Boolean);

  const displayName = profile?.display_name || user?.email || 'User';
  const initials = displayName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-gray-200 bg-gray-50 transition-transform duration-200 lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* Workspace header */}
        <div className="relative border-b border-gray-200 px-4 py-3">
          <button
            onClick={() => setWsDropdownOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-100 transition-colors"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-blue-600 text-[11px] font-bold text-white">
              {currentWorkspace?.name?.charAt(0).toUpperCase() ?? 'W'}
            </div>
            <span className="flex-1 truncate text-sm font-semibold text-gray-900">
              {currentWorkspace?.name ?? 'Workspace'}
            </span>
            <ChevronDown size={14} className="shrink-0 text-gray-400" />
          </button>

          {wsDropdownOpen && (
            <div className="absolute left-3 right-3 top-full z-50 mt-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => handleSwitchWorkspace(ws.id)}
                  className={[
                    'flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors',
                    ws.id === currentWorkspace?.id
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50',
                  ].join(' ')}
                >
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-blue-600 text-[9px] font-bold text-white">
                    {ws.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="truncate">{ws.name}</span>
                </button>
              ))}
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button
                  onClick={() => {
                    setWsDropdownOpen(false);
                    navigate('/workspaces');
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
                >
                  <Settings size={14} />
                  Manage workspaces
                </button>
              </div>
            </div>
          )}

          {/* Mobile close */}
          <button
            className="absolute right-3 top-3 lg:hidden rounded p-1 text-gray-400 hover:bg-gray-100"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {/* Primary nav */}
          <div className="space-y-0.5">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  ].join(' ')
                }
              >
                <item.icon size={16} className="shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </div>

          {/* Notebooks section */}
          <div className="mt-6">
            <div className="flex items-center justify-between px-2.5 mb-1">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Notebooks
              </span>
              <button
                onClick={() => navigate('/app/notebooks/new')}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                title="Create notebook"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="space-y-0.5">
              {notebooks.map((nb) => (
                <NavLink
                  key={nb.id}
                  to={`/app/notebooks/${nb.id}`}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    [
                      'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                    ].join(' ')
                  }
                >
                  <BookOpen size={15} className="shrink-0" />
                  <span className="truncate">{nb.name}</span>
                </NavLink>
              ))}
              {notebooks.length === 0 && (
                <p className="px-2.5 py-1 text-xs text-gray-400">No notebooks</p>
              )}
            </div>
          </div>

          {/* Secondary nav */}
          <div className="mt-6 space-y-0.5">
            {bottomNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  ].join(' ')
                }
              >
                <item.icon size={16} className="shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>

        {/* Sidebar footer – settings + user */}
        <div className="border-t border-gray-200 p-3 space-y-1">
          <NavLink
            to="/app/settings"
            className={({ isActive }) =>
              [
                'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
              ].join(' ')
            }
          >
            <Settings size={16} className="shrink-0" />
            Settings
          </NavLink>

          <div className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[11px] font-semibold text-gray-600">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{displayName}</p>
              <p className="truncate text-xs text-gray-400">{user?.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4">
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <button
              className="rounded p-1 text-gray-500 hover:bg-gray-100 lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>

            {/* Breadcrumb */}
            <nav className="flex items-center gap-1 text-sm text-gray-500">
              <span className="font-medium text-gray-700">
                {currentWorkspace?.name ?? 'Workspace'}
              </span>
              {pathParts.map((part, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span className="text-gray-300">/</span>
                  <span className={i === pathParts.length - 1 ? 'text-gray-700' : ''}>
                    {part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' ')}
                  </span>
                </span>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-1">
            <button className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
              <Search size={17} />
            </button>
            <button className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
              <Bell size={17} />
            </button>
            <DropdownMenu
              trigger={
                <button className="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-[11px] font-semibold text-gray-600 hover:bg-gray-300 transition-colors">
                  {initials}
                </button>
              }
              items={[
                { label: 'Settings', icon: Settings, onClick: () => navigate('/app/settings') },
                { label: 'Sign out', icon: LogOut, onClick: handleSignOut, variant: 'danger' },
              ]}
            />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto bg-white">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
