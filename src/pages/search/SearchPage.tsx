import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  SlidersHorizontal,
  X,
  Calendar,
  FileText,
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useNotebookStore } from '@/stores/notebookStore';
import type { ExperimentStatus, Tag } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import ExperimentStatusBadge from '@/components/eln/ExperimentStatusBadge';
import EmptyState from '@/components/eln/EmptyState';
import { cn } from '@/lib/utils';

const DEBOUNCE_MS = 300;

const STATUS_OPTIONS: { value: ExperimentStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'in_review', label: 'In Review' },
  { value: 'changes_requested', label: 'Changes Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'locked', label: 'Locked' },
];

type SortOption = 'relevance' | 'date';

interface SearchResult {
  id: string;
  experiment_id: string;
  title: string;
  status: ExperimentStatus;
  notebook_id: string;
  created_by: string;
  experiment_date: string;
  created_at: string;
  updated_at: string;
  notebook_name: string | null;
  author_name: string | null;
  rank: number;
}

function highlightSnippet(text: string, query: string): string {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(
    new RegExp(`(${escaped})`, 'gi'),
    '<mark class="bg-yellow-200 rounded px-0.5">$1</mark>',
  );
}

export default function SearchPage() {
  const navigate = useNavigate();
  const { currentWorkspace, members, fetchMembers } = useWorkspaceStore();
  const { notebooks } = useNotebookStore();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ExperimentStatus | ''>('');
  const [notebookFilter, setNotebookFilter] = useState('');
  const [authorFilter, setAuthorFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>('relevance');

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (currentWorkspace) {
      fetchMembers();
      supabase
        .from('tags')
        .select('*')
        .eq('workspace_id', currentWorkspace.id)
        .then(({ data }) => setTags((data ?? []) as Tag[]));
    }
  }, [currentWorkspace, fetchMembers]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const executeSearch = useCallback(async () => {
    if (!currentWorkspace) return;
    const q = debouncedQuery.trim();
    if (!q && !statusFilter && !notebookFilter && !authorFilter && !dateFrom && !dateTo && selectedTags.length === 0) {
      setResults([]);
      setTotalCount(0);
      setTotalPages(0);
      setHasSearched(false);
      return;
    }

    setLoading(true);
    setHasSearched(true);

    try {
      const { data, error } = await supabase.rpc('search_experiments', {
        p_workspace_id: currentWorkspace.id,
        p_query: q || null,
        p_status: statusFilter || null,
        p_notebook_id: notebookFilter || null,
        p_created_by: authorFilter || null,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_tag_ids: selectedTags.length > 0 ? selectedTags : null,
        p_sort_by: sortBy,
        p_page: page,
        p_page_size: 25,
      });

      if (error) throw error;

      const payload = data as { results: SearchResult[]; total: number; total_pages: number };
      setResults(payload.results ?? []);
      setTotalCount(payload.total ?? 0);
      setTotalPages(payload.total_pages ?? 0);
    } catch (err) {
      console.error('Search failed:', err);
      setResults([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace, debouncedQuery, statusFilter, notebookFilter, authorFilter, dateFrom, dateTo, selectedTags, sortBy, page]);

  useEffect(() => {
    executeSearch();
  }, [executeSearch]);

  const clearFilters = () => {
    setStatusFilter('');
    setNotebookFilter('');
    setAuthorFilter('');
    setDateFrom('');
    setDateTo('');
    setSelectedTags([]);
  };

  const hasActiveFilters = !!(statusFilter || notebookFilter || authorFilter || dateFrom || dateTo || selectedTags.length > 0);

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  };

  return (
    <div className="flex-1 overflow-auto bg-background">
      {/* Search header */}
      <div className="border-b border-border bg-muted/50">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
            <Input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search experiments by title, content, or ID..."
              className="h-12 rounded-lg pl-12 pr-12 text-base"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-14 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                'absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 transition-colors',
                showFilters || hasActiveFilters
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <SlidersHorizontal className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-4">
        <div className="flex gap-6">
          {/* Filters panel */}
          {showFilters && (
            <div className="w-56 shrink-0 space-y-4 border-r border-border/50 pr-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Filters
                </h3>
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Notebook</label>
                <select
                  value={notebookFilter}
                  onChange={(e) => setNotebookFilter(e.target.value)}
                  className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">All notebooks</option>
                  {notebooks.map((nb) => (
                    <option key={nb.id} value={nb.id}>{nb.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as ExperimentStatus | '')}
                  className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Author</label>
                <select
                  value={authorFilter}
                  onChange={(e) => setAuthorFilter(e.target.value)}
                  className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">All authors</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.profile?.display_name ?? m.profile?.email ?? 'Unknown'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Date range</label>
                <div className="space-y-1.5">
                  <div className="relative">
                    <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="h-8 w-full rounded-lg border border-border bg-background py-1.5 pl-7 pr-2.5 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="relative">
                    <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="h-8 w-full rounded-lg border border-border bg-background py-1.5 pl-7 pr-2.5 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>
              </div>

              {tags.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Tags</label>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(tag.id)}
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                          selectedTags.includes(tag.id)
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80',
                        )}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Results area */}
          <div className="min-w-0 flex-1">
            {hasSearched && (
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {loading ? 'Searching...' : `${totalCount} result${totalCount !== 1 ? 's' : ''}`}
                </p>
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="text-muted-foreground">Sort by</span>
                  <button
                    onClick={() => setSortBy('relevance')}
                    className={cn(
                      sortBy === 'relevance' ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Relevance
                  </button>
                  <span className="text-border">|</span>
                  <button
                    onClick={() => setSortBy('date')}
                    className={cn(
                      sortBy === 'date' ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Date
                  </button>
                </div>
              </div>
            )}

            {!hasSearched && !loading && (
              <div className="py-20">
                <EmptyState
                  icon={<Search size={40} />}
                  title="Search your experiments"
                  description="Find experiments by title, content, experiment ID, or use filters to narrow results."
                />
              </div>
            )}

            {hasSearched && !loading && results.length === 0 && (
              <div className="py-16">
                <EmptyState
                  icon={<FileText size={40} />}
                  title="No results found"
                  description={`No experiments match "${debouncedQuery}"${hasActiveFilters ? ' with the current filters' : ''}. Try a different search term or adjust your filters.`}
                />
              </div>
            )}

            {results.length > 0 && (
              <div className="divide-y divide-border/50">
                {results.map((exp) => (
                  <button
                    key={exp.id}
                    onClick={() => navigate(`/app/experiments/${exp.id}`)}
                    className="block w-full px-3 py-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 rounded-lg bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                            {exp.experiment_id}
                          </span>
                          <ExperimentStatusBadge status={exp.status} />
                        </div>
                        <h3
                          className="mt-1 truncate text-sm font-medium text-foreground"
                          dangerouslySetInnerHTML={{
                            __html: highlightSnippet(exp.title, debouncedQuery),
                          }}
                        />
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          {exp.notebook_name && <span>{exp.notebook_name}</span>}
                          {exp.author_name && <span>{exp.author_name}</span>}
                          <span>{format(new Date(exp.updated_at), 'MMM d, yyyy')}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 py-4">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-muted"
                >
                  Previous
                </button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-muted"
                >
                  Next
                </button>
              </div>
            )}

            {loading && (
              <div className="space-y-3 py-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-14 rounded-full" />
                    </div>
                    <Skeleton className="mt-2 h-4 w-3/4" />
                    <Skeleton className="mt-1.5 h-3 w-1/2" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
