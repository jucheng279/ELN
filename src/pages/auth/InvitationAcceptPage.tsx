import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { Check, AlertCircle, Loader2 } from 'lucide-react';
import AuthLayout from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';

export default function InvitationAcceptPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, initialized } = useAuthStore();

  const token = searchParams.get('token');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    workspace_id: string;
    role?: string;
    already_member?: boolean;
  } | null>(null);

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
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!token) {
    return (
      <AuthLayout>
        <div className="rounded-lg border bg-card p-6 shadow-sm text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-destructive" />
          <h2 className="text-lg font-semibold text-foreground">Invalid invitation</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            No invitation token was provided.
          </p>
          <Button
            size="lg"
            variant="outline"
            className="mt-4"
            onClick={() => navigate('/app')}
          >
            Go to app
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        {result ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg border bg-muted">
              <Check size={20} className="text-foreground" />
            </div>
            <p className="font-medium text-foreground">
              {result.already_member
                ? 'You are already a member'
                : 'You have joined the workspace'}
            </p>
            {result.role && !result.already_member && (
              <p className="mt-1 text-sm text-muted-foreground">
                Your role: {result.role}
              </p>
            )}
            <Button
              size="lg"
              className="mt-4"
              onClick={() => navigate('/app')}
            >
              Go to workspace
            </Button>
          </div>
        ) : (
          <div className="text-center">
            <h1 className="text-lg font-semibold text-foreground">Workspace Invitation</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You have been invited to join a workspace. Click below to accept.
            </p>

            {error && (
              <p className="mt-4 text-sm text-destructive">{error}</p>
            )}

            <Button
              size="lg"
              className="mt-6 w-full"
              onClick={handleAccept}
              disabled={loading}
            >
              {loading && <Loader2 className="animate-spin" />}
              Accept Invitation
            </Button>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
