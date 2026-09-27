import { useState, useEffect } from 'react';
import {
  Building2,
  Mail,
  UserCog,
  Trash2,
  ChevronDown,
  Clock,
  Lock,
  Save,
  Plus,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { supabase } from '@/lib/supabase';
import type { WorkspaceMemberRole, WorkspaceInvitation } from '@/lib/types';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';
import Tabs from '@/components/common/Tabs';

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

const SETTINGS_TABS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'account', label: 'Account' },
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

  // Determine current user role
  const currentMember = members.find((m) => m.user_id === user?.id);
  const isAdmin = currentMember?.role === 'owner' || currentMember?.role === 'admin';

  // Initialize from stores
  useEffect(() => {
    if (currentWorkspace) {
      setWorkspaceName(currentWorkspace.name);
      setWorkspaceDescription(currentWorkspace.description ?? '');
      fetchMembers();
      fetchInvitations();
    }
  }, [currentWorkspace, fetchMembers]);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name);
      setTimezone(profile.timezone || 'UTC');
    }
  }, [profile]);

  const fetchInvitations = async () => {
    if (!currentWorkspace) return;
    const { data } = await supabase
      .from('workspace_invitations')
      .select('*')
      .eq('workspace_id', currentWorkspace.id)
      .is('accepted_at', null)
      .order('created_at', { ascending: false });
    setInvitations((data ?? []) as WorkspaceInvitation[]);
  };

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
    } catch (err: any) {
      setInviteError(err?.message ?? 'Failed to send invitation');
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

  return (
    <div className="flex-1 overflow-auto bg-white">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <h1 className="text-lg font-semibold text-gray-900">Settings</h1>

        <div className="mt-4">
          <Tabs tabs={SETTINGS_TABS} activeTab={activeTab} onChange={setActiveTab} />
        </div>

        {/* ─── Workspace Tab ─────────────────────── */}
        {activeTab === 'workspace' && (
          <div className="mt-6 space-y-8">
            {/* Workspace info */}
            <section>
              <h2 className="text-sm font-semibold text-gray-900">
                Workspace details
              </h2>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Name
                  </label>
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    disabled={!isAdmin}
                    className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Description
                  </label>
                  <textarea
                    value={workspaceDescription}
                    onChange={(e) => setWorkspaceDescription(e.target.value)}
                    disabled={!isAdmin}
                    rows={2}
                    className="w-full max-w-md resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </div>
                {isAdmin && (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={savingWorkspace}
                    icon={<Save size={14} />}
                    onClick={handleSaveWorkspace}
                  >
                    Save changes
                  </Button>
                )}
              </div>
            </section>

            {/* Members */}
            <section>
              <h2 className="text-sm font-semibold text-gray-900">Members</h2>
              <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-4 py-2 text-left font-medium text-gray-500">
                        Name
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">
                        Email
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">
                        Role
                      </th>
                      {isAdmin && (
                        <th className="px-4 py-2 text-right font-medium text-gray-500">
                          Actions
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {members.map((member) => (
                      <tr key={member.id}>
                        <td className="px-4 py-2.5 text-gray-900">
                          {member.profile?.display_name ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500">
                          {member.profile?.email ?? '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          {isAdmin && member.role !== 'owner' ? (
                            <select
                              value={member.role}
                              onChange={(e) =>
                                updateMemberRole(
                                  member.id,
                                  e.target.value as WorkspaceMemberRole,
                                )
                              }
                              className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-blue-500 focus:outline-none"
                            >
                              {ROLE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-600">
                              {member.role}
                            </span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-2.5 text-right">
                            {member.role !== 'owner' && member.user_id !== user?.id && (
                              <button
                                onClick={() => removeMember(member.id)}
                                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                title="Remove member"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Invite section */}
            {isAdmin && (
              <section>
                <h2 className="text-sm font-semibold text-gray-900">
                  Invite member
                </h2>
                <div className="mt-3 flex items-end gap-3">
                  <div className="flex-1 max-w-xs">
                    <label className="mb-1 block text-xs font-medium text-gray-500">
                      Email
                    </label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="colleague@example.com"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">
                      Role
                    </label>
                    <select
                      value={inviteRole}
                      onChange={(e) =>
                        setInviteRole(e.target.value as WorkspaceMemberRole)
                      }
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    variant="primary"
                    size="md"
                    loading={inviting}
                    icon={<Plus size={14} />}
                    onClick={handleInvite}
                  >
                    Send invite
                  </Button>
                </div>
                {inviteError && (
                  <p className="mt-2 text-sm text-red-600">{inviteError}</p>
                )}
              </section>
            )}

            {/* Pending invitations */}
            {isAdmin && invitations.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-900">
                  Pending invitations
                </h2>
                <div className="mt-3 space-y-2">
                  {invitations.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-2.5"
                    >
                      <div>
                        <p className="text-sm text-gray-900">{inv.email}</p>
                        <p className="text-xs text-gray-500">
                          Invited as{' '}
                          <span className="capitalize">{inv.role}</span> ·
                          Expires{' '}
                          {new Date(inv.expires_at).toLocaleDateString()}
                        </p>
                        <div className="mt-1 flex items-center gap-1">
                          <input
                            readOnly
                            value={`${window.location.origin}/invite?token=${inv.token}`}
                            className="w-64 rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-500 focus:outline-none"
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(`${window.location.origin}/invite?token=${inv.token}`);
                            }}
                            className="rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRevokeInvitation(inv.id)}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        title="Revoke invitation"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ─── Account Tab ───────────────────────── */}
        {activeTab === 'account' && (
          <div className="mt-6 space-y-8">
            {/* Profile info */}
            <section>
              <h2 className="text-sm font-semibold text-gray-900">Profile</h2>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Display name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Email
                  </label>
                  <input
                    type="email"
                    value={profile?.email ?? ''}
                    readOnly
                    className="w-full max-w-md rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Timezone
                  </label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={savingAccount}
                    icon={<Save size={14} />}
                    onClick={handleSaveAccount}
                  >
                    Save changes
                  </Button>
                  {accountSaved && (
                    <span className="text-sm text-green-600">Saved!</span>
                  )}
                </div>
              </div>
            </section>

            {/* Change password */}
            <section>
              <h2 className="text-sm font-semibold text-gray-900">
                Change password
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Use the password reset flow to change your password.
              </p>
              <div className="mt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Lock size={14} />}
                  onClick={() => window.location.href = '/forgot-password'}
                >
                  Reset password
                </Button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
