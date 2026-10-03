import { useState, useEffect, useCallback } from 'react';
import {
  Trash2,
  Lock,
  Save,
  Plus,
  Loader2,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { supabase } from '@/lib/supabase';
import type { WorkspaceMemberRole, WorkspaceInvitation } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

// ── Constants ────────────────────────────────────

const ROLE_OPTIONS: { value: WorkspaceMemberRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
  { value: 'guest', label: 'Guest' },
];

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Moscow',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Australia/Sydney',
  'Pacific/Auckland',
];

// ── Component ────────────────────────────────────

export default function SettingsPage() {
  const { user, profile, updateProfile } = useAuthStore();
  const {
    currentWorkspace,
    members,
    fetchMembers,
    inviteMember,
    removeMember,
    updateMemberRole,
  } = useWorkspaceStore();

  const [activeTab, setActiveTab] = useState('workspace');

  // Workspace form
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceDescription, setWorkspaceDescription] = useState('');
  const [savingWorkspace, setSavingWorkspace] = useState(false);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceMemberRole>('member');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');

  // Pending invitations
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);

  // Account form
  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountSaved, setAccountSaved] = useState(false);

  // Remove member confirmation
  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);

  // Determine current user role
  const currentMember = members.find((m) => m.user_id === user?.id);
  const isAdmin = currentMember?.role === 'owner' || currentMember?.role === 'admin';

  const fetchInvitations = useCallback(async () => {
    if (!currentWorkspace) return;
    const { data, error } = await supabase
      .from('workspace_invitations')
      .select('*')
      .eq('workspace_id', currentWorkspace.id)
      .is('accepted_at', null)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Failed to load invitations:', error);
      setInvitations([]);
      return;
    }
    setInvitations((data ?? []) as WorkspaceInvitation[]);
  }, [currentWorkspace]);

  // Initialize from stores
  useEffect(() => {
    if (currentWorkspace) {
      setWorkspaceName(currentWorkspace.name);
      setWorkspaceDescription(currentWorkspace.description ?? '');
      fetchMembers();
      fetchInvitations();
    }
  }, [currentWorkspace, fetchMembers, fetchInvitations]);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name);
      setTimezone(profile.timezone || 'UTC');
    }
  }, [profile]);

  // Handlers
  const handleSaveWorkspace = async () => {
    if (!currentWorkspace) return;
    setSavingWorkspace(true);
    try {
      await supabase
        .from('workspaces')
        .update({
          name: workspaceName,
          description: workspaceDescription || null,
        })
        .eq('id', currentWorkspace.id);
    } catch (err) {
      console.error('Failed to update workspace:', err);
    } finally {
      setSavingWorkspace(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError('');
    try {
      await inviteMember(inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      setInviteRole('member');
      await fetchInvitations();
    } catch (err: unknown) {
      const message = err instanceof Object && 'message' in err ? String((err as { message: unknown }).message) : '';
      setInviteError(message || 'Failed to send invitation');
    } finally {
      setInviting(false);
    }
  };

  const handleRevokeInvitation = async (id: string) => {
    await supabase.from('workspace_invitations').delete().eq('id', id);
    setInvitations((prev) => prev.filter((inv) => inv.id !== id));
  };

  const handleSaveAccount = async () => {
    setSavingAccount(true);
    setAccountSaved(false);
    try {
      await updateProfile({ display_name: displayName, timezone });
      setAccountSaved(true);
      setTimeout(() => setAccountSaved(false), 2000);
    } catch (err) {
      console.error('Failed to update profile:', err);
    } finally {
      setSavingAccount(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!removeMemberId) return;
    await removeMember(removeMemberId);
    setRemoveMemberId(null);
  };

  return (
    <div className={cn('flex-1 overflow-auto bg-background')}>
      <div className={cn('mx-auto max-w-3xl px-6 py-6')}>
        <h1 className={cn('text-lg font-semibold text-foreground')}>Settings</h1>

        <Tabs value={activeTab} onValueChange={setActiveTab} className={cn('mt-4')}>
          <TabsList>
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
          </TabsList>

          {/* ─── Workspace Tab ─────────────────────── */}
          <TabsContent value="workspace" className={cn('mt-6 space-y-6')}>
            {/* Workspace info */}
            <section>
              <h2 className={cn('text-sm font-semibold text-foreground')}>
                Workspace details
              </h2>
              <div className={cn('mt-3 space-y-3')}>
                <div>
                  <Label htmlFor="ws-name">Name</Label>
                  <Input
                    id="ws-name"
                    className={cn('mt-1 h-8 max-w-md')}
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    disabled={!isAdmin}
                  />
                </div>
                <div>
                  <Label htmlFor="ws-desc">Description</Label>
                  <Textarea
                    id="ws-desc"
                    className={cn('mt-1 max-w-md resize-none')}
                    value={workspaceDescription}
                    onChange={(e) => setWorkspaceDescription(e.target.value)}
                    disabled={!isAdmin}
                    rows={2}
                  />
                </div>
                {isAdmin && (
                  <Button size="sm" disabled={savingWorkspace} onClick={handleSaveWorkspace}>
                    {savingWorkspace ? (
                      <Loader2 className={cn('mr-1.5 h-3.5 w-3.5 animate-spin')} />
                    ) : (
                      <Save className={cn('mr-1.5 h-3.5 w-3.5')} />
                    )}
                    Save changes
                  </Button>
                )}
              </div>
            </section>

            <Separator />

            {/* Members */}
            <section>
              <h2 className={cn('text-sm font-semibold text-foreground')}>Members</h2>
              <div className={cn('mt-3 overflow-hidden rounded-lg border border-border')}>
                <table className={cn('w-full text-sm')}>
                  <thead>
                    <tr className={cn('border-b border-border bg-muted/50')}>
                      <th className={cn('px-4 py-2 text-left font-medium text-muted-foreground')}>
                        Name
                      </th>
                      <th className={cn('px-4 py-2 text-left font-medium text-muted-foreground')}>
                        Email
                      </th>
                      <th className={cn('px-4 py-2 text-left font-medium text-muted-foreground')}>
                        Role
                      </th>
                      {isAdmin && (
                        <th className={cn('px-4 py-2 text-right font-medium text-muted-foreground')}>
                          Actions
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className={cn('divide-y divide-border')}>
                    {members.map((member) => (
                      <tr key={member.id}>
                        <td className={cn('px-4 py-2.5')}>
                          <div className={cn('flex items-center gap-2')}>
                            <Avatar size="sm">
                              <AvatarFallback>
                                {member.profile?.display_name?.charAt(0)?.toUpperCase() ?? '?'}
                              </AvatarFallback>
                            </Avatar>
                            <span className={cn('text-foreground')}>
                              {member.profile?.display_name ?? '—'}
                            </span>
                          </div>
                        </td>
                        <td className={cn('px-4 py-2.5 text-muted-foreground')}>
                          {member.profile?.email ?? '—'}
                        </td>
                        <td className={cn('px-4 py-2.5')}>
                          {isAdmin && member.role !== 'owner' ? (
                            <Select
                              value={member.role}
                              onValueChange={(val) =>
                                updateMemberRole(member.id, val as WorkspaceMemberRole)
                              }
                            >
                              <SelectTrigger size="sm" className={cn('w-28')}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ROLE_OPTIONS.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="secondary" className={cn('capitalize')}>
                              {member.role}
                            </Badge>
                          )}
                        </td>
                        {isAdmin && (
                          <td className={cn('px-4 py-2.5 text-right')}>
                            {member.role !== 'owner' && member.user_id !== user?.id && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => setRemoveMemberId(member.id)}
                                className={cn('text-muted-foreground hover:text-destructive')}
                              >
                                <Trash2 className={cn('h-3.5 w-3.5')} />
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <Separator />

            {/* Invite section */}
            {isAdmin && (
              <section>
                <h2 className={cn('text-sm font-semibold text-foreground')}>
                  Invite member
                </h2>
                <div className={cn('mt-3 flex items-end gap-3')}>
                  <div className={cn('max-w-xs flex-1')}>
                    <Label htmlFor="invite-email" className={cn('text-xs')}>
                      Email
                    </Label>
                    <Input
                      id="invite-email"
                      type="email"
                      className={cn('mt-1 h-8')}
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="colleague@example.com"
                    />
                  </div>
                  <div>
                    <Label className={cn('text-xs')}>Role</Label>
                    <div className={cn('mt-1')}>
                      <Select
                        value={inviteRole}
                        onValueChange={(val) => setInviteRole(val as WorkspaceMemberRole)}
                      >
                        <SelectTrigger className={cn('w-28')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button size="sm" disabled={inviting} onClick={handleInvite}>
                    {inviting ? (
                      <Loader2 className={cn('mr-1.5 h-3.5 w-3.5 animate-spin')} />
                    ) : (
                      <Plus className={cn('mr-1.5 h-3.5 w-3.5')} />
                    )}
                    Send invite
                  </Button>
                </div>
                {inviteError && (
                  <p className={cn('mt-2 text-sm text-destructive')}>{inviteError}</p>
                )}
              </section>
            )}

            {/* Pending invitations */}
            {isAdmin && invitations.length > 0 && (
              <>
                <Separator />
                <section>
                  <h2 className={cn('text-sm font-semibold text-foreground')}>
                    Pending invitations
                  </h2>
                  <div className={cn('mt-3 space-y-2')}>
                    {invitations.map((inv) => (
                      <div
                        key={inv.id}
                        className={cn(
                          'flex items-center justify-between rounded-lg border border-border px-4 py-2.5'
                        )}
                      >
                        <div>
                          <p className={cn('text-sm text-foreground')}>{inv.email}</p>
                          <p className={cn('text-xs text-muted-foreground')}>
                            Invited as{' '}
                            <span className={cn('capitalize')}>{inv.role}</span> ·
                            Expires{' '}
                            {new Date(inv.expires_at).toLocaleDateString()}
                          </p>
                          <div className={cn('mt-1 flex items-center gap-1')}>
                            <Input
                              readOnly
                              value={`${window.location.origin}/invite?token=${inv.token}`}
                              className={cn('h-6 w-64 bg-muted text-xs text-muted-foreground')}
                              onClick={(e) => (e.target as HTMLInputElement).select()}
                            />
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => {
                                navigator.clipboard.writeText(
                                  `${window.location.origin}/invite?token=${inv.token}`
                                );
                              }}
                            >
                              Copy
                            </Button>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleRevokeInvitation(inv.id)}
                          className={cn('text-muted-foreground hover:text-destructive')}
                        >
                          <Trash2 className={cn('h-3.5 w-3.5')} />
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </TabsContent>

          {/* ─── Account Tab ───────────────────────── */}
          <TabsContent value="account" className={cn('mt-6 space-y-6')}>
            {/* Profile info */}
            <section>
              <h2 className={cn('text-sm font-semibold text-foreground')}>Profile</h2>
              <div className={cn('mt-3 space-y-3')}>
                <div>
                  <Label htmlFor="display-name">Display name</Label>
                  <Input
                    id="display-name"
                    className={cn('mt-1 h-8 max-w-md')}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="profile-email">Email</Label>
                  <Input
                    id="profile-email"
                    type="email"
                    className={cn('mt-1 h-8 max-w-md')}
                    value={profile?.email ?? ''}
                    readOnly
                    disabled
                  />
                </div>
                <div>
                  <Label htmlFor="profile-tz">Timezone</Label>
                  <div className={cn('mt-1')}>
                    <Select value={timezone} onValueChange={(v) => v !== null && setTimezone(v)}>
                      <SelectTrigger className={cn('w-full max-w-md')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEZONES.map((tz) => (
                          <SelectItem key={tz} value={tz}>
                            {tz.replace(/_/g, ' ')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className={cn('flex items-center gap-3')}>
                  <Button size="sm" disabled={savingAccount} onClick={handleSaveAccount}>
                    {savingAccount ? (
                      <Loader2 className={cn('mr-1.5 h-3.5 w-3.5 animate-spin')} />
                    ) : (
                      <Save className={cn('mr-1.5 h-3.5 w-3.5')} />
                    )}
                    Save changes
                  </Button>
                  {accountSaved && (
                    <span className={cn('text-sm text-green-600')}>Saved!</span>
                  )}
                </div>
              </div>
            </section>

            <Separator />

            {/* Change password */}
            <section>
              <h2 className={cn('text-sm font-semibold text-foreground')}>
                Change password
              </h2>
              <p className={cn('mt-1 text-sm text-muted-foreground')}>
                Use the password reset flow to change your password.
              </p>
              <div className={cn('mt-3')}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { window.location.href = '/forgot-password'; }}
                >
                  <Lock className={cn('mr-1.5 h-3.5 w-3.5')} />
                  Reset password
                </Button>
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </div>

      {/* Remove member confirmation */}
      <AlertDialog
        open={removeMemberId !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveMemberId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this member from the workspace? They will lose access immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleConfirmRemove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
