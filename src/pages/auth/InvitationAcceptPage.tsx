import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { FlaskConical, Check, AlertCircle } from 'lucide-react';
import Button from '@/components/common/Button';

export default function InvitationAcceptPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, initialized } = useAuthStore();

  const token = searchParams.get('token');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ workspace_id: string; role?: string; already_member?: boolean } | null>(null);

  useEffect(() => {
    if (!initialized) return;
    if (!user) {
      const returnUrl = `/invite?token=${encodeURIComponent(token ?? '')}`;
      navigate(`/login?redirect=${encodeURIComponent(returnUrl)}`, { replace: true });
    }
  }, [initialized, user, token, navigate]);

  async function handleAccept() {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('accept_invitation', {
        p_token: token,
      });
      if (rpcError) throw rpcError;
      setResult(data as any);
    } catch (err: any) {
      setError(err.message ?? 'Failed to accept invitation');
    } finally {
      setLoading(false);
    }
  }

  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm text-center">
          <AlertCircle size={40} className="mx-auto text-red-400 mb-3" />
          <h2 className="text-lg font-semibold text-gray-900">Invalid invitation</h2>
          <p className="mt-2 text-sm text-gray-500">No invitation token was provided.</p>
          <Button className="mt-4" onClick={() => navigate('/app')}>
            Go to app
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
            <FlaskConical size={22} className="text-white" />
          </div>
          <h1 className="mt-3 text-xl font-semibold text-gray-900">Workspace Invitation</h1>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          {result ? (
            <div className="text-center">
              <Check size={40} className="mx-auto text-green-500 mb-3" />
              <p className="font-medium text-gray-900">
                {result.already_member ? 'You are already a member' : 'You have joined the workspace'}
              </p>
              {result.role && !result.already_member && (
                <p className="mt-1 text-sm text-gray-500">Your role: {result.role}</p>
              )}
              <Button className="mt-4" onClick={() => navigate('/app')}>
                Go to workspace
              </Button>
            </div>
          ) : (
            <div className="text-center">
              {error && (
                <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 text-left">{error}</div>
              )}
              <p className="text-sm text-gray-600 mb-4">
                You have been invited to join a workspace. Click below to accept.
              </p>
              <Button onClick={handleAccept} loading={loading} fullWidth>
                Accept Invitation
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
